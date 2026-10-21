# ADR-021: In-Dashboard Chat Agent, Model Provider Abstraction, and Mutation Confirmation Lifecycle

**Status**: Accepted & Empirically Verified (Phase 6 Gates P6-G1 through P6-G5)  
**Date**: 2026-10-22  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-008`](./ADR-008-five-tool-contract-and-pii-redaction.md), [`ADR-011`](./ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md), [`ADR-014`](./ADR-014-two-phase-audit-logging-and-retention.md), [`ADR-019`](./ADR-019-browser-identity-session-and-csrf.md), [`ADR-020`](./ADR-020-dual-listener-and-ingress-perimeter.md), [`architecture.md`](../architecture.md), [`requirements-traceability.md`](../requirements-traceability.md)

---

## 1. Context & Problem Statement

Phase 5 delivered the human administrative dashboard (`apps/dashboard`), browser identity management via Scrypt KDF, single-use member invitations, scoped MCP API key lifecycle, and dual-listener network isolation between Port 3000 (`/mcp`) and Port 3001 (`/api/v1/browser/*`).

Phase 6 introduces two core requirements from the Urumi AI assignment brief:
1. **In-Dashboard Chat Agent (CHT-02, CHT-03, CHT-04)**: An authenticated chat interface enabling team members to submit natural-language queries that autonomously execute tools against aggregated upstream microservices (WooCommerce, CRM, Tasks) as the logged-in user, with real-time execution visibility and audit attribution.
2. **External MCP Client Interoperability (EXT-01, EXT-02, EXT-03)**: Compatibility with standard MCP clients (e.g. MCP Inspector, Claude Code, Cursor) connecting to the downstream `/mcp` gateway endpoint using dedicated member API keys, discovering all enabled upstreams, and executing cross-server multi-turn workflows.

Integrating an autonomous Large Language Model (LLM) into an enterprise Kubernetes tool gateway presents critical security, architectural, and operational challenges:
- **Prompt Injection & Over-Privileged Execution**: External inputs or malicious upstream data could trick the LLM into invoking unapproved mutations, bypassing business rules, or executing destructive actions.
- **Runaway Loops & Cost Explosion**: An unbounded tool-calling loop could burn thousands of API tokens or exhaust upstream service resources.
- **Accidental State Destruction**: Automated agents could corrupt or delete protected baseline records (WooCommerce Order #14 and Product IDs 10, 11, 12).
- **Credential & PII Leakage**: Raw API keys, database credentials, or customer personal identifiable information (PII) could be regurgitated into chat responses or audit logs.
- **Ambient Authentication Confusion**: Browser session cookies must not be accepted on machine protocol endpoints (`/mcp`), and machine bearer keys must not be accepted on browser chat endpoints (`/api/v1/browser/chat`).

---

## 2. Decision & Architecture

### 2.1 Model Provider Abstraction Layer

To ensure vendor neutrality and deterministic hermetic testing, the gateway abstracts all LLM interactions behind a unified `ModelProvider` contract (`apps/gateway/src/chat/types.ts`):

```typescript
export interface ModelProvider {
  readonly name: string;
  isConfigured(): boolean;
  generateChatTurn(options: ModelRequestOptions): Promise<ModelResponse>;
}
```

The system provides two production-grade implementations:
1. **`GeminiProviderAdapter` (`apps/gateway/src/chat/gemini-provider.ts`)**:
   - Integrates with Google Gemini models via `@google/genai` (defaulting to `gemini-flash-lite-latest` or `gemini-2.5-flash`).
   - Translates MCP tool schemas into Gemini Function Declarations, stripping unsupported schema keys while preserving types and descriptions.
   - Preserves reasoning metadata (`thoughtSignature`) across multi-turn tool loops to support Gemini thinking models without protocol breakage.
   - Maps upstream network and provider failures into a standardized typed error hierarchy:
     - `ProviderUnconfiguredError` (HTTP 503)
     - `ProviderTimeoutError` (HTTP 504)
     - `ProviderRateLimitError` (HTTP 429)
     - `ProviderProtocolError` (HTTP 502)
2. **`DeterministicMockProviderAdapter` (`apps/gateway/src/chat/mock-provider.ts`)**:
   - Provides deterministic, hermetic multi-turn tool calling and text generation for automated unit and protocol test suites.
   - Operates with zero network calls, zero external credentials, and sub-millisecond execution latency.

A centralized factory (`createModelProvider` in `apps/gateway/src/chat/index.ts`) instantiates the provider based on configuration (`CHAT_PROVIDER` and `NODE_ENV`).

---

### 2.2 Bounded Agent Loop State Machine

The agent loop (`apps/gateway/src/chat/agent-loop.ts`) enforces strict execution bounds on every user turn:

```
      [USER PROMPT]
            │
            ▼
        ( INIT ) ----------------------------> [ABORT: Invalid Request]
            │
            ▼
  +-> ( CHECK DEADLINE ) --------------------> [ABORT: 30s Turn Deadline Exceeded]
  │         │
  │         ▼
  │   ( INVOKE PROVIDER ) -------------------> [ABORT: Provider Error / Timeout]
  │         │
  │         ▼
  │   ( EVALUATE RESPONSE )
  │         │
  │         +---> FinishReason = 'stop' (Text) -> ( FINALIZE ) -> [200 OK Response]
  │         │
  │         +---> FinishReason = 'tool_calls'
  │                     │
  │                     ▼
  │             ( CHECK LIMITS )
  │                     │
  │                     +---> Iteration Count >= 5 -> [ABORT: 5-Iteration Cap Exceeded]
  │                     │
  │                     ▼
  │             ( VALIDATE TOOL CALLS )
  │                     │
  │                     +---> Unknown Tool Name ------> Inject Tool Error & Loop
  │                     +---> Protected Record Target -> Inject Tool Error & Loop
  │                     +---> Mutating Tool w/o Conf -> [200 OK: Confirmation Required]
  │                     │
  │                     ▼
  │             ( SEQUENTIAL DISPATCH )
  │                     │
  │                     │ ToolRouter.dispatch(user = req.user)
  │                     ▼
  │             [ Sanitize & Truncate (64 KiB) ]
  │                     │
  │                     ▼
  +---------------------+ (Append safe markdown block to messages)
```

#### Strict Execution Bounds:
1. **5-Iteration Cap (`MAX_TOOL_ITERATIONS = 5`)**: Halts runaway tool execution immediately after 5 iterations and returns a user notice with error code `LOOP_ITERATION_LIMIT_EXCEEDED`.
2. **30-Second Turn Deadline (`turnTimeoutMs = 30000`)**: Enforces an end-to-end wall-clock budget. If the remaining budget drops below 500ms, execution terminates with `ProviderTimeoutError` (HTTP 504).
3. **Sequential Tool Execution**: Multiple tool calls emitted in a single turn are executed sequentially through `ToolRouter.dispatch()`, preventing concurrency exhaustion or uncontrolled fan-out.
4. **64 KiB Tool Result Cap**: Tool output byte length is inspected. Outputs exceeding 65,536 bytes are truncated and appended with `[Output truncated to 64 KiB by Gateway security policy]`.
5. **Untrusted Data Isolation**: All tool outputs are wrapped in fenced markdown blocks with explicit system warnings preventing models from interpreting tool outputs as system overrides.
6. **Dual Secret Redaction**: Responses, tool results, and error messages pass through a multi-pattern regex sanitizer (`sanitizeText`) scrubbing synthetic API keys (`urumi_[a-zA-Z0-9_]{10,}`), Gemini keys (`AIzaSy...`), and credential key-value pairs.

---

### 2.3 Server-Side Mutation Confirmation Engine

State-changing tools are safeguarded by a two-tier protection policy implemented in `apps/gateway/src/chat/confirmation.ts`:

#### 1. Protected Baseline Records Safeguard:
- Order #14: Any mutating tool targeting Order #14 (`order_id == 14` or `'14'`) is aborted immediately with `MUTATION_TARGET_PROTECTED`.
- Product IDs 10, 11, 12: Any mutating tool targeting product IDs 10, 11, or 12 is aborted immediately.
- SKU Collision Defense: Product creations with SKUs matching baseline catalog items (`woo-vneck-tee`, `woo-hoodie-logo`, `woo-beanie`) are rejected.

#### 2. Approved Disposable Demo Fixture Exemption:
- `woocommerce__create_product` is permitted autonomously **only if** `args.sku` strictly matches the regex `/^chat-demo-[a-z0-9_-]+$/` and contains a valid name and price. This enables automated evaluation while guaranteeing that permanent catalog records cannot be modified.

#### 3. Cryptographic Confirmation Token Lifecycle:
- For any other state-changing tool call (`woocommerce__update_order_status`, `tasks__create_task`, `tasks__update_task_status`, or non-demo product creation), the agent loop suspends execution and mints an HMAC-SHA256 signed confirmation token:
  $$\text{Payload} = \{\text{userId}, \text{toolName}, \text{canonicalArgs}, \text{expiresAt}, \text{nonce}\}$$
  $$\text{Token} = \text{Base64Url}(\text{JSON}(\text{Payload})) \mathbin{\Vert} \text{"."} \mathbin{\Vert} \text{HMAC-SHA256}(\text{Payload}, K_{\text{gateway}})$$
- **60-Second TTL**: Tokens expire after 60 seconds.
- **Single-Use Nonce**: Nonces are stored in memory and invalidated upon consumption, preventing replay attacks.
- **Identity Binding**: The token is strictly verified against the authenticated `userId` of the confirming session. Cross-user confirmation attempts return HTTP 403 `CONFIRMATION_USER_MISMATCH`.
- **Argument Integrity**: Arguments are canonicalized with sorted keys (`canonicalizeArgs`). Tampered arguments fail signature validation.

---

### 2.4 Browser Identity & Audit Attribution

- Chat endpoints (`POST /api/v1/browser/chat` and `POST /api/v1/browser/chat/confirm`) are mounted exclusively on Port 3001 and require valid session cookies and `X-Urumi-CSRF` headers.
- Actor identity is derived strictly from the server-side session: `{ id: user.id, username: user.username, role: user.role }`.
- When the agent loop executes a tool, it invokes `ToolRouter.dispatch({ user, toolName, args })`.
- `ToolRouter` records Phase 1 and Phase 2 audit entries in the SQLite `audit_logs` table on the persistent volume (`/data/gateway.db`), populating `user_id = user.id`, tool name, millisecond duration, execution status, and a deterministic SHA-256 hash of the arguments (`arguments_hash`).
- This guarantees complete traceability: every tool call made by the chat agent is permanently attributed to the human operator who initiated the conversation turn.

---

### 2.5 Dual-Perimeter Cross-Path Isolation

The platform enforces absolute isolation between the two client perimeters:
- **Perimeter 1: Browser Control Plane (`dashboard.127.0.0.1.nip.io:8080/api/v1/browser/*` on Port 3001)**:
  - Authenticated via HttpOnly session cookies.
  - Requires CSRF tokens and canonical Origin verification.
  - Rejects external MCP Bearer keys with HTTP 401 (`SESSION_MISSING`).
- **Perimeter 2: External MCP Protocol Plane (`dashboard.127.0.0.1.nip.io:8080/mcp` on Port 3000)**:
  - Authenticated via Bearer API keys (`Authorization: Bearer urumi_live_...`).
  - Ignores session cookies; requests without Bearer tokens are rejected with HTTP 401 (`Missing Authorization header`).
  - Instantaneous key revocation: revoked keys are rejected on the very next request.

---

## 3. Consequences & Verification Evidence

### Positive Consequences
- **Complete Safety**: Baseline WooCommerce records (Order #14, Products 10, 11, 12) cannot be modified or deleted by the agent loop or external clients.
- **Audited Autonomous Actions**: Every tool execution is recorded with caller identity and execution metrics in SQLite WAL storage.
- **Zero Schema Migrations**: Dashboard chat operates with ephemeral React client state, requiring zero database migrations or table schema changes.
- **Cross-Server Multi-Turn Orchestration**: Proven capable of executing complex single prompts spanning multiple independent upstreams (`crm__search_contacts` followed by `tasks__list_tasks`).

### Verification Evidence
- **P6-G2**: Model provider abstraction layer verified with Gemini and deterministic mock providers.
- **P6-G3**: Bounded agent loop (5 iterations, 30s deadline, 64 KiB cap, confirmation engine) verified with 19 unit tests and 9 protocol tests.
- **P6-G4**: External MCP client acceptance verified against live Kubernetes cluster (tool discovery, orders query, cross-server workflow, instant revocation).
- **P6-G5**: Cross-path security verified with 28 protocol test cases (token non-substitutability, CSRF/Origin enforcement, RBAC, IDOR protection, PII redaction, provider error mappings).
