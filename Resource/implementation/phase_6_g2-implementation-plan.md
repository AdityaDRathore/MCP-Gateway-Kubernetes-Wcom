# Phase 6 Gate P6-G2: Chat Backend & Provider Adapter Implementation Plan

## Goal Description
Implement the server-side model provider abstraction layer for the Urumi Enterprise AI Gateway. Gate P6-G2 establishes the provider adapter interface (`ModelProvider`), a production-ready Google Gemini REST API client (`GeminiProviderAdapter`) using server-side credentials, a zero-network deterministic mock adapter (`DeterministicMockProviderAdapter`) for offline testing, configuration schema enhancements, and complete unit test coverage. This satisfies all Phase 6 Gate P6-G2 requirements without introducing tool loop dispatch or UI code (strictly deferred to Gate P6-G3).

---

## User Review Required

> [!IMPORTANT]
> **Credential Isolation Invariant**: The `GEMINI_API_KEY` is strictly server-side. It is loaded via environment variables / Kubernetes Secrets (`.secrets/gemini.env`), never embedded in frontend Vite bundles, never returned in API payloads, and scrubbed from all outgoing error messages and server logs.

> [!NOTE]
> **Node Engine Requirement**: The monorepo requires Node `>=24.0.0` (as declared in root `package.json`). All commands, test executions, and builds will use `/home/rathore/.nvm/versions/node/v24.20.0/bin/node` to support `node:sqlite` and native Web Crypto APIs.

> [!TIP]
> **Deterministic Mock Selection**: Under `NODE_ENV=test` or when `CHAT_PROVIDER=mock`, the gateway selects `DeterministicMockProviderAdapter`, enabling 100% offline regression testing (`npm test`) without token costs or egress dependencies. Production failures in Gemini never fall back to mock.

---

## Open Questions

None. All architectural decisions, interface contracts, error semantics, and trust boundaries were established and approved in Gate P6-G1 (`docs/phase-6/p6-g1-architecture-and-security-approval.md`).

---

## Proposed Changes

### Gateway Chat Provider Layer (`apps/gateway/src/chat/`)

#### [NEW] `apps/gateway/src/chat/types.ts`
- Declares core provider interfaces and data transfer objects (DTOs):
  - `ModelRole`: `'user' | 'assistant' | 'system' | 'tool'`
  - `ModelMessage`: Role, optional string content, optional tool calls, optional tool call ID.
  - `ModelToolCall`: Unique call ID, namespaced public tool name (e.g. `woocommerce__list_orders`), and argument object.
  - `ModelToolDefinition`: Tool name, description, and JSON Schema parameters.
  - `ModelRequestOptions`: Array of messages, array of tool definitions, optional `AbortSignal`, optional timeout in ms.
  - `ModelResponse`: Generated text content, optional tool calls, `finishReason` (`'stop' | 'tool_calls' | 'length' | 'error'`), and token usage metrics.
  - `ModelProvider`: Interface exposing `readonly name: string; generateChatTurn(options: ModelRequestOptions): Promise<ModelResponse>;`
  - Strongly typed error classes:
    - `ProviderError` (base error)
    - `ProviderUnconfiguredError` (HTTP 503, `PROVIDER_UNCONFIGURED`)
    - `ProviderTimeoutError` (HTTP 504, `PROVIDER_TIMEOUT`)
    - `ProviderRateLimitError` (HTTP 429, `PROVIDER_RATE_LIMITED`)
    - `ProviderProtocolError` (HTTP 502, `PROVIDER_ERROR`)

#### [NEW] `apps/gateway/src/chat/gemini-provider.ts`
- Implements `GeminiProviderAdapter` connecting to Google Gemini REST API (`generateContent` endpoint):
  - Model: configurable, defaults to `gemini-1.5-flash`.
  - Authentication: Header `x-goog-api-key: <apiKey>` (avoiding query string key leakage in URLs/logs).
  - Validation: If `apiKey` is missing or blank, `generateChatTurn` immediately rejects with `ProviderUnconfiguredError`.
  - Message Translation:
    - System message mapped to `systemInstruction.parts[0].text`.
    - User and assistant messages mapped to Gemini `contents` with `role: 'user'` or `role: 'model'`.
    - Tool responses mapped to `role: 'function'` with `functionResponse.name` and `functionResponse.response.content`.
  - Tool Translation:
    - Formats `ModelToolDefinition[]` into Gemini's `tools: [{ functionDeclarations: [...] }]` format, converting parameter schemas appropriately.
  - Response Translation:
    - Parses `candidates[0].content.parts`: extracts text into `content` and `functionCall` into `ModelToolCall[]`.
    - Detects `finishReason: 'tool_calls'` when `functionCall` parts exist.
  - Resiliency & Bounds:
    - Default 15-second per-request timeout via `AbortSignal.timeout()`.
    - Single retry on HTTP 429 / 503 with exponential jitter backoff ($\le 2$ seconds).
    - String and error sanitization ensuring raw API keys and stack traces are never leaked in error messages.

#### [NEW] `apps/gateway/src/chat/mock-provider.ts`
- Implements `DeterministicMockProviderAdapter` for offline and unit test execution:
  - Detects prompt intents deterministically:
    - "create product" -> returns `woocommerce__create_product` with `chat-demo-shirt` SKU.
    - "orders" / "list orders" -> returns `woocommerce__list_orders` with `{ per_page: 5 }`.
    - "tasks" / "list tasks" -> returns `tasks__list_tasks` with `{}`.
    - "contacts" / "search contacts" -> returns `crm__search_contacts` with `{ query: "test" }`.
    - Incoming tool response -> synthesizes clean markdown summary of the executed action.
    - General conversational questions -> returns deterministic assistant text.
  - Exposes test hooks to simulate rate limits, timeouts, and provider errors when requested by unit tests.

#### [MODIFY] `apps/gateway/src/config.ts`
- Extends `ConfigSchema` with chat configuration keys:
  - `CHAT_PROVIDER`: `z.enum(['gemini', 'mock']).default('gemini')`
  - `GEMINI_API_KEY`: `z.string().optional()`
  - `GEMINI_MODEL`: `z.string().default('gemini-1.5-flash')`
  - `CHAT_TURN_TIMEOUT_MS`: `z.coerce.number().int().min(1000).max(60000).default(30000)`
  - `PROVIDER_TIMEOUT_MS`: `z.coerce.number().int().min(1000).max(30000).default(15000)`

---

### Gateway Test Suite (`apps/gateway/test/unit/`)

#### [NEW] `apps/gateway/test/unit/chat-provider.test.ts`
- Comprehensive unit test suite covering:
  1. `GeminiProviderAdapter` fail-closed configuration: throws `ProviderUnconfiguredError` if API key is missing.
  2. `GeminiProviderAdapter` request payload serialization: verifies `systemInstruction`, `contents`, and `tools.functionDeclarations`.
  3. `GeminiProviderAdapter` response parsing: validates text extraction and `functionCall` translation.
  4. `GeminiProviderAdapter` rate limit recovery: validates single retry on HTTP 429 and eventual propagation.
  5. `GeminiProviderAdapter` timeout & abort handling: verifies `ProviderTimeoutError` on deadline.
  6. `GeminiProviderAdapter` secret scrubbing: verifies API keys never appear in error messages or stringified responses.
  7. `DeterministicMockProviderAdapter` tool generation: tests deterministic tool calls for orders, tasks, crm, and products.
  8. `DeterministicMockProviderAdapter` tool summary generation: tests synthesized final answers from tool results.
  9. `DeterministicMockProviderAdapter` simulated failures: validates mock error modes.

---

## Verification Plan

### Automated Tests
Run unit, protocol, and integration test suites using Node 24:
```bash
export PATH="/home/rathore/Documents/Urumi Assignment/node_modules/.bin:/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"

# Run new chat provider unit tests
npx tsx --test test/unit/chat-provider.test.ts

# Run entire gateway unit test suite (312+ tests)
npm run test:unit

# Typecheck gateway
npm run typecheck
```

### Manual Verification
1. Verify `apps/gateway/src/chat/types.ts` exports all required DTOs.
2. Verify `GeminiProviderAdapter` correctly reads `GEMINI_API_KEY` from `.secrets/gemini.env`.
3. Verify that zero build files or frontend code reference `GEMINI_API_KEY`.
