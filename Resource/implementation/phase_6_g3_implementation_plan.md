# Phase 6 Gate P6-G3: Bounded Agent Loop & Dashboard Chat UI Implementation Plan

## Goal Description
Implement the core conversational agent layer for the Urumi Enterprise AI Gateway. Gate P6-G3 delivers:
1. **The Bounded Agent Loop** (`apps/gateway/src/chat/agent-loop.ts`): Orchestrates provider interaction, tool resolution against the live catalog snapshot, server-side argument validation, execution strictly via `ToolRouter.dispatch()`, 5-iteration loop cap, 30-second turn deadline, 64 KiB result truncation, untrusted tool result sanitization, and fail-closed audit attribution to the authenticated session user.
2. **The Server-Side Mutation Confirmation Lifecycle** (`apps/gateway/src/chat/confirmation.ts`): Detects state mutations, blocks unauthorized state changes, enforces immutable safeguards for protected WooCommerce baseline records (Product IDs 10, 11, 12 and Order #14), applies the approved disposable fixture policy (`chat-demo-...`), and mints/verifies HMAC-SHA256 cryptographically bound confirmation tokens.
3. **Authenticated Browser Chat Endpoints** (`apps/gateway/src/http/browser.ts`): Mounts `POST /api/v1/browser/chat` and `POST /api/v1/browser/chat/confirm` on Port 3001, fully protected by existing session cookie auth, active user check, CSRF tokens, and origin allowlists.
4. **Minimal Dashboard Chat UI** (`apps/dashboard/src/components/ChatTab.tsx`): Integrates a sleek, glassmorphic conversational interface into `DashboardLayout.tsx` supporting natural language submission, assistant replies, tool execution badges/pills, interactive confirmation modals for pending mutations, and clear error banners for unconfigured providers.

---

## User Review Required

> [!IMPORTANT]
> **Zero Credential Exposure Invariant**: Model provider credentials (`GEMINI_API_KEY`) and MCP bearer keys are kept exclusively on the server. Neither `apps/dashboard` bundle nor browser HTTP payloads will ever receive or handle provider keys.

> [!IMPORTANT]
> **Strict Protected Records Guard**: WooCommerce Product IDs 10, 11, 12 and Order #14 remain permanently immutable. Any model-proposed or user-confirmed action attempting to mutate these records will be aborted immediately server-side with `MUTATION_TARGET_PROTECTED`. Product demonstrations must use `chat-demo-...` SKUs.

> [!NOTE]
> **Ephemeral Conversation History**: In strict accordance with the approved G1 design, conversation history is maintained exclusively in browser React state. No database migrations, chat tables, or persistent message storage will be introduced.

---

## Open Questions

None. All trust boundaries, identity propagation rules, provider contracts, and loop bounds were formally specified and approved in Gate P6-G1 (`docs/phase-6/p6-g1-architecture-and-security-approval.md`) and built upon Gate P6-G2 (`Resource/implementation/phase_6_g2-implementation-plan.md`).

---

## Proposed Changes

### Component 1: Gateway Confirmation & Mutation Engine (`apps/gateway/src/chat/`)

#### [NEW] `apps/gateway/src/chat/confirmation.ts`
- Implements cryptographic confirmation token lifecycle and protected record safeguards:
  - `isProtectedRecord(toolName: string, args: Record<string, unknown>): { protected: boolean; reason?: string }`:
    - Blocks any modification targeting WooCommerce Order #14 (`order_id === 14` or `order_id === '14'`).
    - Blocks any modification targeting WooCommerce Product IDs 10, 11, 12 (`product_id` or `id` in `[10, 11, 12, '10', '11', '12']`).
    - Blocks creating products with reserved SKUs.
  - `isDisposableFixture(toolName: string, args: Record<string, unknown>): boolean`:
    - Evaluates `toolName === 'woocommerce__create_product'` and `args.sku` matching `/^chat-demo-[a-z0-9_-]+$/`.
  - `ConfirmationManager`:
    - Generates signed HMAC-SHA256 tokens binding:
      `userId`, `toolName`, `canonicalJson(args)`, `expiresAt` (60s TTL), and `nonce`.
    - Verifies token signature with timing-safe comparison (`crypto.timingSafeEqual`).
    - Enforces expiry, user binding (rejects with 403 on user mismatch), single-use nonce tracking (rejects replays with 400), and argument integrity.

```typescript
export interface ConfirmationPayload {
  userId: string;
  toolName: string;
  canonicalArgs: string;
  expiresAt: number;
  nonce: string;
}

export class ConfirmationManager {
  private readonly secret: Buffer;
  private readonly consumedNonces = new Set<string>();

  constructor(secret?: string) {
    this.secret = secret ? Buffer.from(secret, 'utf-8') : crypto.randomBytes(32);
  }

  mintToken(params: { userId: string; toolName: string; args: Record<string, unknown>; ttlMs?: number }): string;
  verifyAndConsumeToken(token: string, currentUserId: string): { valid: boolean; error?: string; code?: string; payload?: ConfirmationPayload };
}
```

---

### Component 2: Bounded Agent Loop Orchestrator (`apps/gateway/src/chat/`)

#### [NEW] `apps/gateway/src/chat/agent-loop.ts`
- Implements `AgentLoopOrchestrator`:
  - **Inputs**: Authenticated user (`AuthenticatedUser`), prompt (`message: string`), conversation history (`ModelMessage[]`), catalog snapshot (`CatalogService`), tool router (`ToolRouter`), model provider (`ModelProvider`).
  - **Hard Bounds**:
    - Maximum **5 tool iterations** per turn (`LOOP_ITERATION_LIMIT_EXCEEDED`).
    - Overall **30-second turn deadline** across all provider calls and tool dispatches (`REQUEST_TIMEOUT`).
    - **64 KiB result cap**: Tool results larger than 64 KiB are truncated with `[Output truncated to 64 KiB by Gateway security policy]`.
    - **Sequential execution**: Tool calls in a single turn are executed sequentially to prevent fan-out DoS.
    - **Untrusted data wrapping**: Tool results are wrapped in structured markdown and separated from system instructions.
  - **Execution Flow**:
    1. Formulates tool definitions from `catalogService.getSnapshot()`.
    2. Enforces turn deadline: `remainingBudgetMs = totalBudgetMs - (Date.now() - startTime)`.
    3. Calls `modelProvider.generateChatTurn({ messages, tools, timeoutMs: remainingBudgetMs })`.
    4. If model returns text: sanitizes text and returns final `ChatTurnResponse`.
    5. If model returns tool calls:
       - Increments iteration counter (aborts if $>5$).
       - For each tool call:
         - Checks catalog resolution (feeds error back to model if unknown tool).
         - Checks protected records guard (fails closed if targeting Order 14 or Products 10-12).
         - Checks mutability:
           - If mutating and NOT a disposable fixture (`chat-demo-...`), suspends turn and mints confirmation token.
           - If read-only or approved disposable fixture, dispatches through `toolRouter.dispatch({ publicToolName, arguments, user, requestDeadlineMs })`.
         - Truncates output to 64 KiB.
         - Appends tool output message to conversation.
    6. Loops until model emits completion text or limits are reached.
  - **Resume Flow**:
    - `resumeTurnWithConfirmedAction(...)`: Executes the verified tool call, feeds the result back to `modelProvider`, and returns the summarized response.

#### [MODIFY] `apps/gateway/src/chat/index.ts`
- Re-exports `agent-loop.ts` and `confirmation.ts`.

---

### Component 3: Gateway Browser API Routes & Server Wiring (`apps/gateway/src/`)

#### [MODIFY] `apps/gateway/src/http/browser.ts`
- Extends `BrowserRouterOptions` with `toolRouter`, `modelProvider`, `confirmationManager`, and `agentLoop`.
- Adds authenticated chat endpoints:
  - `POST /api/v1/browser/chat`:
    - Validates request body with Zod schema (`message`: string 1..4000, `history`: optional array).
    - Session authentication via `createSessionAuthMiddleware`.
    - CSRF protection via `createCsrfMiddleware`.
    - Derives `actor = req.sessionContext.user`.
    - Generates unique `turnId = crypto.randomUUID()`.
    - Runs `agentLoop.executeTurn(...)`.
    - Returns HTTP 200 with `ChatTurnResponse`.
    - Handles errors: `ProviderUnconfiguredError` (503), `ProviderTimeoutError` (504), `ProviderRateLimitError` (429), `ProviderProtocolError` (502).
  - `POST /api/v1/browser/chat/confirm`:
    - Validates request body: `{ confirmationToken: string, history?: ModelMessage[] }`.
    - Verifies token with `confirmationManager.verifyAndConsumeToken(token, req.sessionContext.user.id)`.
    - Re-checks protected record safeguard.
    - Executes confirmed tool through `agentLoop.resumeTurnWithConfirmedAction(...)`.
    - Returns HTTP 200 with `ChatTurnResponse`.

#### [MODIFY] `apps/gateway/src/server.ts`
- Updates `BrowserServerOptions` to accept `toolRouter?: ToolRouter` and `modelProvider?: ModelProvider`.
- Instantiates `ConfirmationManager` and `AgentLoopOrchestrator` when options are provided, passing them to `createBrowserRouter`.

#### [MODIFY] `apps/gateway/src/index.ts`
- Creates `modelProvider = createModelProvider(config)` and passes `toolRouter` and `modelProvider` into `createBrowserApp(...)`.

---

### Component 4: Dashboard Chat UI (`apps/dashboard/src/`)

#### [NEW] `apps/dashboard/src/components/ChatTab.tsx`
- Sleek, modern, glassmorphic conversational interface:
  - Natural language message input with send button and keyboard shortcuts (`Enter` to submit).
  - Ephemeral chat history stored in React state.
  - Chat bubbles for User and Assistant.
  - Sanitized tool-activity badges:
    - Displays public tool name (`woocommerce__list_orders`).
    - Status pill: green `success`, red `error`, amber `confirmation_required`.
    - Execution duration pill.
    - Collapsible arguments and result preview.
  - Interactive Confirmation Card:
    - Prominently displays proposed mutation, parameters, and confirmation prompt.
    - "Confirm Action" button posts to `/api/v1/browser/chat/confirm`.
    - "Cancel" button aborts the pending mutation.
  - Error banner showing clear messages when the provider is unconfigured or rate limited.
  - Safe HTML rendering (plain text and code blocks, zero `dangerouslySetInnerHTML`).
  - "Clear Conversation" button.

#### [MODIFY] `apps/dashboard/src/components/DashboardLayout.tsx`
- Adds `'chat'` to `TabType`.
- Adds nav item: `{ id: 'chat', label: 'AI Assistant', icon: '🤖' }`.
- Renders `<ChatTab />` when `activeTab === 'chat'`.

---

## Verification Plan

### Automated Tests

1. **Agent Loop Unit Tests (`apps/gateway/test/unit/agent-loop.test.ts`)**:
   - `testNormalAssistantResponse`: Plain conversation without tool calls.
   - `testSingleToolExecution`: Model invokes `woocommerce__list_orders`, router dispatches, model summarizes.
   - `testMultiTurnToolWorkflow`: Compound tool workflow (CRM lookup followed by Tasks list).
   - `testIterationCap`: Mock model keeps returning tool calls; loop terminates on iteration 6 with `LOOP_ITERATION_LIMIT_EXCEEDED`.
   - `test30SecondDeadline`: Simulates delay exceeding budget; terminates with `REQUEST_TIMEOUT`.
   - `test64KiBResultTruncation`: Upstream returns >64 KiB result; verified safe truncation notice appended.
   - `testUnknownToolHandling`: Model calls non-existent tool; feeds error back without crashing.
   - `testProtectedRecordsSafeguard`:
     - Mutating Order #14 is rejected with `MUTATION_TARGET_PROTECTED`.
     - Mutating Product 10, 11, or 12 is rejected with `MUTATION_TARGET_PROTECTED`.
   - `testMutationConfirmationLifecycle`:
     - Mutating action triggers `confirmation_required` with signed token.
     - Confirmation verification succeeds with matching token and user.
     - Confirmation rejected on expired token, tampered arguments, user mismatch, or replay.
   - `testDisposableFixtureExemption`:
     - `woocommerce__create_product` with `chat-demo-shirt` executes without interactive confirmation.
   - `testActorAttribution`:
     - Verifies `user.id` is passed to `ToolRouter.dispatch()` and recorded in Phase 1 audit.

2. **Browser Chat Protocol Tests (`apps/gateway/test/protocol/browser-chat.test.ts`)**:
   - Unauthenticated access returns 401.
   - Missing/invalid CSRF header returns 403.
   - Disallowed Origin returns 403.
   - Deactivated user returns 401.
   - Valid chat turn round-trip returns 200 with `ChatTurnResponse`.
   - Confirmation endpoint `/api/v1/browser/chat/confirm` validates token and returns 200.
   - Provider unconfigured returns 503 `PROVIDER_UNCONFIGURED`.

3. **Dashboard Build & Typecheck**:
   - `npm run build` in `apps/dashboard` (Vite production bundle).
   - `npm run typecheck` in `apps/gateway` (TypeScript strict check).
   - `npm run test:unit` in `apps/gateway`.

### Manual / Browser Verification
- Verify that `ChatTab` renders cleanly in the dashboard with modern glassmorphism.
- Verify prompt input, message bubbles, tool badges, confirmation modal, and reset button.
