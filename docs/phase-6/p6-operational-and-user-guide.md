# Phase 6 Operational & User Guide: In-Dashboard Chat Agent and External MCP Client

**Project:** Urumi Enterprise AI Gateway & Multi-Tenant Management Platform  
**Repository:** `AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`  
**Phase:** Phase 6 (In-Dashboard Chat Agent, Model Provider Abstraction, Mutation Confirmation & External MCP Interoperability)  
**Status:** **ACCEPTED / EVALUATOR-READY**  
**Related Documents:** [`docs/architecture.md`](../architecture.md), [`docs/requirements-traceability.md`](../requirements-traceability.md), [`ADR-021`](../decisions/ADR-021-in-dashboard-chat-agent-and-mutation-confirmation.md), [`p6-g5-cross-path-security-and-regression-report.md`](./p6-g5-cross-path-security-and-regression-report.md)

---

## 1. Overview & System Purpose

Phase 6 extends the Urumi Enterprise Gateway with autonomous Large Language Model (LLM) capabilities across two distinct consumption perimeters:
1. **In-Dashboard AI Assistant (Browser Perimeter, Port 3001)**: An authenticated chat interface embedded in the React 19 dashboard. Logged-in team members can issue natural-language instructions that trigger multi-turn tool calling across all enabled upstream services (WooCommerce, CRM, Tasks) with strict execution bounds, real-time tool visibility, cryptographic mutation confirmation, and complete audit attribution.
2. **External MCP Client Interoperability (Machine Perimeter, Port 3000)**: Standard Model Context Protocol (MCP) clients (e.g. MCP Inspector, Claude Code, Cursor) connect over Streamable HTTP (`POST /mcp`) using dedicated member Bearer API keys (`Authorization: Bearer urumi_live_...`), discover aggregated upstream catalogs, and execute single-prompt cross-server workflows with instantaneous key revocation.

---

## 2. Setup & Prerequisites

### 2.1 System Prerequisites
- **Local Kubernetes Engine**: `k3d` running cluster `urumi` (pinned to `rancher/k3s:v1.37.1-k3s1`).
- **Cluster Ingress**: Traefik ingress controller mapping host port **8080** to ingress HTTP.
- **Node Runtime**: Node.js 24 LTS (`v24.20.0`) specified via `.nvmrc`.
- **Healthy Pods in Namespace `urumi`**:
  ```bash
  kubectl get pods -n urumi
  ```
  Expected active workloads:
  - `urumi-gateway` (1/1 Running)
  - `urumi-mariadb-0` (1/1 Running)
  - `urumi-mcp-crm` (1/1 Running)
  - `urumi-mcp-tasks` (1/1 Running)
  - `urumi-woocommerce-mcp` (1/1 Running)
  - `urumi-wordpress` (1/1 Running)

### 2.2 Network Endpoints & Host Resolution
All endpoints resolve via wildcard DNS `127.0.0.1.nip.io`:
| Endpoint Description | Ingress URL | Target Service Port | Authentication Scheme |
|:---|:---|:---:|:---|
| **Dashboard SPA & Browser API** | `http://dashboard.127.0.0.1.nip.io:8080/` | `urumi-gateway:3001` | Session Cookie (`urumi_session`) + CSRF (`X-Urumi-CSRF`) |
| **Downstream MCP Protocol** | `http://dashboard.127.0.0.1.nip.io:8080/mcp` | `urumi-gateway:3000` | Bearer API Key (`Authorization: Bearer urumi_live_...`) |
| **WooCommerce Storefront** | `http://shop.127.0.0.1.nip.io:8080/` | `urumi-wordpress:80` | None (Public storefront) |

### 2.3 Environment Variables & Provider Configuration
Configuration is managed in `apps/gateway/src/config.ts` via Zod schema validation:

| Variable | Type | Default | Description |
|:---|:---:|:---:|:---|
| `CHAT_PROVIDER` | enum | `'gemini'` | Selects model provider: `'gemini'` (production Google GenAI) or `'mock'` (hermetic test provider). |
| `GEMINI_API_KEY` | string | `undefined` | Google Gemini API key. Required when `CHAT_PROVIDER === 'gemini'`. |
| `GEMINI_MODEL` | string | `'gemini-flash-lite-latest'` | Target Gemini model identifier (e.g. `'gemini-flash-lite-latest'`, `'gemini-2.5-flash'`). |
| `CHAT_TURN_TIMEOUT_MS` | number | `30000` | End-to-end conversation turn deadline (1,000–60,000 ms). Default: 30 seconds. |
| `PROVIDER_TIMEOUT_MS` | number | `15000` | Individual model provider request timeout (1,000–30,000 ms). Default: 15 seconds. |
| `BROWSER_PORT` | number | `3001` | Dedicated HTTP port for dashboard SPA and `/api/v1/browser/*` REST API. |
| `PORT` | number | `3000` | Dedicated HTTP port for `/mcp` protocol stream and internal `/admin/v1/*` API. |
| `ALLOWED_ORIGINS` | string | CSV | Allowed browser Origin hostnames for CSRF defense. |
| `DB_PATH` | string | `'/data/gateway.db'` | Persistent volume mount path for SQLite database in WAL mode. |

### 2.4 Safe Credential Handling
- **Zero Plaintext Secrets in Manifests or Git**: Never paste, commit, or log API keys, database passwords, or session secrets.
- **Local Secret Storage**: Local developer secrets are stored in `.secrets/gemini.env` (which is strictly gitignored).
- **Cluster Secret Injection**: Secrets are mounted into the gateway container as environment variables via Kubernetes Secret references (`secretKeyRef`).
- **Response Redaction**: The gateway actively scrubs credential patterns (`urumi_[a-zA-Z0-9_]{10,}`, `AIzaSy...`, password key-value pairs) from model outputs before sending responses to the client.

---

## 3. Architecture & Security Model

```
                    ┌────────────────────────────────────────────────────────┐
                    │                   Ingress Perimeter                    │
                    │         Traefik on dashboard.127.0.0.1.nip.io:8080     │
                    └───────────────┬────────────────────────┬───────────────┘
                                    │                        │
            Path: /mcp              │                        │  Path: /
                                    ▼                        ▼
                    ┌────────────────────────┐      ┌────────────────────────┐
                    │  Port 3000: MCP Plane  │      │ Port 3001: Browser UI  │
                    │  Bearer Auth ONLY      │      │ Cookie + CSRF ONLY     │
                    └───────────┬────────────┘      └───────────┬────────────┘
                                │                               │
                                │                      POST /api/v1/browser/chat
                                │                               │
                                │                               ▼
                                │                   ┌────────────────────────┐
                                │                   │   AgentLoopOrchestrator│
                                │                   │   - 5-Iteration Cap    │
                                │                   │   - 30s Turn Deadline  │
                                │                   │   - 64 KiB Result Cap  │
                                │                   └───────────┬────────────┘
                                │                               │
                                │           generateChatTurn()  │  Tool Calls
                                │       ┌───────────────────────┴───────────────────────┐
                                │       ▼                                               ▼
                                │  ┌─────────────────────────┐             ┌─────────────────────────┐
                                │  │ ModelProvider Adapter   │             │ ConfirmationManager     │
                                │  │ - Gemini (GenAI SDK)    │             │ - Protected Record Guard│
                                │  │ - Mock (Hermetic Tests) │             │ - HMAC-SHA256 (60s TTL) │
                                │  └─────────────────────────┘             │ - Demo Fixture Exemption│
                                │                                          └────────────┬────────────┘
                                │                                                       │
                                │                                                       │ Permitted / Confirmed
                                ▼                                                       ▼
                    ┌────────────────────────────────────────────────────────────────────────┐
                    │                      Central ToolRouter & Audit Engine                 │
                    │  - Concurrency Limiter (20 global / 4 per upstream FIFO queue)         │
                    │  - Two-Phase Audit Service: writes user_id, duration, SHA-256 arg hash │
                    │  - Upstream Circuit Breakers & 10s AbortController Timeouts           │
                    └───────────────────────────────────┬────────────────────────────────────┘
                                                        │
                         ┌──────────────────────────────┼──────────────────────────────┐
                         ▼                              ▼                              ▼
            ┌────────────────────────┐    ┌────────────────────────┐    ┌────────────────────────┐
            │  WooCommerce MCP Pod   │    │      CRM MCP Pod       │    │     Tasks MCP Pod      │
            │  (5 Approved Tools)    │    │   (2 Synthetic Tools)  │    │  (3 In-Memory Tools)   │
            └────────────────────────┘    └────────────────────────┘    └────────────────────────┘
```

### 3.1 Architectural Principles
1. **Decoupled Dual Perimeters**:
   - Machine Bearer keys cannot access `/api/v1/browser/chat` (HTTP 401 `SESSION_MISSING`).
   - Browser cookies cannot access `/mcp` on Port 3000 (HTTP 401 `Missing Authorization header`).
2. **Actor Session Derivation & Audit Attribution**:
   - The agent loop derives caller identity strictly from the verified server-side session cookie (`req.sessionContext.user`). Client-supplied identity headers (`X-User-Id`) are strictly ignored.
   - When tools are executed, caller identity is passed directly to `ToolRouter.dispatch({ user, ... })`, ensuring every tool call in `audit_logs` is attributed to the exact logged-in user.
3. **Bounded Agent Loop State Machine**:
   - **5-Iteration Cap**: Execution halts immediately if the model requests more than 5 tool turns (`LOOP_ITERATION_LIMIT_EXCEEDED`).
   - **30-Second Turn Deadline**: Wall-clock budget tracked per turn; aborts with HTTP 504 `PROVIDER_TIMEOUT` if budget is exhausted.
   - **64 KiB Result Truncation**: Prevents LLM context overflow or memory denial of service.
   - **Untrusted Output Wrapping**: Tool results are enclosed in fenced markdown blocks with system notices preventing prompt injection.
4. **Server-Side Mutation Confirmation Engine**:
   - **Protected Baseline Records Guard**: Order #14 and Product IDs 10, 11, 12 cannot be modified or deleted under any circumstances (`MUTATION_TARGET_PROTECTED`).
   - **Approved Disposable Demo Fixture Exemption**: Creating products with SKUs matching `/^chat-demo-[a-z0-9_-]+$/` and positive decimal price is permitted autonomously without interactive confirmation.
   - **Cryptographic Confirmation Tokens**: For all other mutations, mints an HMAC-SHA256 signed token binding `userId`, `toolName`, canonical arguments (`canonicalizeArgs`), 60-second expiration timestamp, and single-use `nonce`. Tokens cannot be reused, modified, or confirmed by a different user.

---

## 4. Dashboard Chat Walkthrough

### 4.1 Opening the AI Assistant
1. Open a modern web browser and navigate to: `http://dashboard.127.0.0.1.nip.io:8080/`.
2. Sign in with valid team credentials (e.g., username `admin` or an invited team member).
3. In the sidebar navigation, click on the **AI Assistant** tab (`ChatTab.tsx`).

### 4.2 Submitting a Read-Only Query
1. In the chat message input box, type a natural-language query:
   ```text
   What products are currently available in our WooCommerce catalog?
   ```
2. Click **Send** (or press Enter).
3. **Execution Observability**:
   - The UI displays an animated typing/loading indicator.
   - A tool execution badge appears: `woocommerce__list_products` with a green status pill and measured execution duration (e.g. `124ms`).
   - Clicking on the tool badge expands an inspection drawer displaying the canonical arguments (`{ "per_page": 10 }`) and the returned upstream JSON result.
4. **Final Synthesized Response**:
   - The assistant summarizes the active products (e.g. Urumi Test Mug, Wireless Mouse Demo, Notebook Demo) with prices and stock statuses.

### 4.3 Triggering & Confirming a Supported Mutation
1. Submit a prompt requesting a state modification (for example, creating a new team task or updating task status):
   ```text
   Please create an in-progress high priority task titled "Review catalog inventory" assigned to contact CRM-CONT-001.
   ```
2. **Server-Side Interception & Confirmation Card**:
   - The agent loop evaluates the tool call (`tasks__create_task`).
   - The server detects that this is a mutating tool requiring human confirmation.
   - The server mints an HMAC-SHA256 confirmation token (60-second TTL) and returns a `confirmation_required` response.
   - The dashboard chat UI renders an **Interactive Confirmation Card**:
     - **Tool Name**: `tasks__create_task`
     - **Arguments**:
       ```json
       {
         "title": "Review catalog inventory",
         "priority": "high",
         "status": "in_progress",
         "assignee_contact_id": "CRM-CONT-001"
       }
       ```
     - **Expiry Countdown**: Shows 60-second expiration countdown.
     - **Action Buttons**: **Confirm & Execute** (primary green) and **Cancel** (danger red).
3. **Confirming the Action**:
   - Click **Confirm & Execute**.
   - The browser dispatches `POST /api/v1/browser/chat/confirm` with `confirmationToken` and `X-Urumi-CSRF`.
   - The gateway validates the token signature, checks expiry, verifies the user matches, and consumes the single-use nonce.
   - The tool executes via `ToolRouter.dispatch()`, logs the execution to `audit_logs` under the logged-in user, and returns the newly created task (`TASK-002`).
   - The assistant updates the conversation confirming that the task was successfully created.

---

## 5. External MCP Client Walkthrough

External MCP clients (such as MCP Inspector, Claude Code, or Cursor) connect directly to the central gateway via standard Model Context Protocol Streamable HTTP.

### 5.1 Gateway URL & Member API Key Provisioning
1. The external downstream MCP URL is:
   ```text
   http://dashboard.127.0.0.1.nip.io:8080/mcp
   ```
2. In the dashboard, navigate to the **API Keys** tab.
3. Click **Generate New Key**, enter a descriptive name (e.g. `external-client-key`), and click **Generate**.
4. Copy the raw plaintext key immediately (`urumi_live_...`). Plaintext keys are never shown again and are stored hashed with SHA-256.

### 5.2 Connecting via MCP Inspector or Client SDK
Start the official MCP Inspector or configure an MCP client:
```bash
npx @modelcontextprotocol/inspector
```
Configure transport settings:
- **Transport Type**: `Streamable HTTP`
- **URL**: `http://dashboard.127.0.0.1.nip.io:8080/mcp`
- **Headers**:
  ```http
  Authorization: Bearer urumi_live_[REDACTED_MEMBER_KEY]
  ```

### 5.3 Multi-Upstream Tool Discovery
Upon connecting, the client issues `tools/list`. The gateway aggregates tools from all enabled upstreams:
- `woocommerce__list_orders` (Read-only orders)
- `woocommerce__get_order` (Order detail by ID)
- `woocommerce__list_products` (Catalog browsing)
- `woocommerce__create_product` (Product creation)
- `woocommerce__update_order_status` (Status management)
- `crm__search_contacts` (CRM contact search)
- `crm__get_contact` (CRM contact detail)
- `tasks__list_tasks` (Tasks list and filter)
- `tasks__create_task` (Task creation)
- `tasks__update_task_status` (Task state management)

Each tool includes `_meta: { reachable: true }` indicating upstream health.

### 5.4 Single-Prompt Cross-Server Multi-Turn Workflow
Submit a single natural-language instruction that requires reasoning across multiple distinct servers:
```text
"Who is the procurement contact for Acme Retail Ltd in our CRM, and what pending or in-progress tasks are assigned to them?"
```
**Autonomous Multi-Turn Execution**:
1. **Turn 1**: The model invokes `crm__search_contacts({ query: "Acme Retail Ltd" })`. The gateway routes the call to `urumi-mcp-crm`, returning contact `CRM-CONT-001` (Alice Smith).
2. **Turn 2**: Preserving reasoning continuity (`thoughtSignature`), the model invokes `tasks__list_tasks({ status: "in_progress" })`. The gateway routes the call to `urumi-mcp-tasks`, returning task `TASK-001`.
3. **Turn 3**: The model synthesizes both live upstream responses into a comprehensive final answer identifying Alice Smith and her assigned task `TASK-001`.

### 5.5 Instant Key Revocation Demonstration
1. In the Dashboard under **API Keys**, locate the test key and click **Revoke**.
2. Immediately submit a fresh MCP tool request or reconnection using that key.
3. The gateway checks the SHA-256 hash in `api_keys`, detects `revoked_at IS NOT NULL`, and rejects the request immediately:
   - **HTTP Status**: `401 Unauthorized`
   - **Response Payload**: `{"error":"Unauthorized: Invalid or revoked API key"}`.

---

## 6. Security Boundaries & Safeguards

| Safeguard | Enforcement Mechanism | Failure Mode / HTTP Status |
|:---|:---|:---:|
| **Cross-Perimeter Isolation** | Port 3000 requires `Authorization: Bearer`; rejects cookies. Port 3001 requires session cookie; rejects Bearer keys. | HTTP 401 Unauthorized (`SESSION_MISSING` / `Missing Authorization header`) |
| **CSRF Defense** | Custom header `X-Urumi-CSRF` + timing-safe HMAC validation + canonical Origin verification on all state-changing browser routes. | HTTP 403 Forbidden (`CSRF_TOKEN_INVALID` / `CSRF_ORIGIN_FORBIDDEN`) |
| **RBAC Role Boundaries** | Members cannot access administrative endpoints (`/members`, `/invitations`, `/upstreams`, `/audit`). | HTTP 403 Forbidden (`FORBIDDEN`) |
| **Key Ownership (IDOR)** | Members can only list and revoke keys where `user_id === session.user.id`. Query parameter overrides (`?userId=...`) are ignored. | HTTP 403 Forbidden (`FORBIDDEN`) |
| **Inactive Account Fail-Closed** | Deactivated users are rejected at login with timing-safe generic errors, and existing keys return 401. | HTTP 401 Unauthorized (`INVALID_CREDENTIALS` / `Invalid or revoked API key`) |
| **Protected Records Guard** | Hardcoded server-side checks abort any mutation targeting Order #14, Products 10, 11, 12, or baseline SKUs. | HTTP 200 with Tool Error (`MUTATION_TARGET_PROTECTED`) |
| **Secret & PII Redaction** | Multi-pass regex scrubbing replaces synthetic keys (`urumi_live_...`) with `[REDACTED_SECRET]` and Gemini keys (`AIzaSy...`) with `[REDACTED_KEY]`. `woocommerce__list_orders` omits customer addresses, email, and phone. | Scrubbed / Redacted in transit |
| **Bounded Execution** | 5-iteration loop cap and 30-second end-to-end turn deadline. | HTTP 200 (`LOOP_ITERATION_LIMIT_EXCEEDED`) or HTTP 504 (`PROVIDER_TIMEOUT`) |

---

## 7. Troubleshooting Guide

### 7.1 Provider Unconfigured (`HTTP 503 PROVIDER_UNCONFIGURED`)
- **Symptom**: Chat submissions return HTTP 503 with `"Chat service unconfigured: model provider credential not configured"`.
- **Root Cause**: `GEMINI_API_KEY` is empty, unset, or invalid while `CHAT_PROVIDER === 'gemini'`.
- **Remediation**:
  1. Verify the secret file `.secrets/gemini.env` exists with format: `GEMINI_API_KEY=your_key_here`.
  2. For test runs, set `CHAT_PROVIDER=mock` or run under `NODE_ENV=test` to enable `DeterministicMockProviderAdapter`.
  3. Ensure the Kubernetes secret is mounted into the gateway pod: `kubectl get secret urumi-gateway-secrets -n urumi`.

### 7.2 Provider Rate-Limited (`HTTP 429 PROVIDER_RATE_LIMITED`)
- **Symptom**: Chat submissions return HTTP 429 with `"Model provider rate limit exceeded"`.
- **Root Cause**: Upstream Gemini quota or rate limits reached for the configured API key/tier.
- **Remediation**: Wait 30–60 seconds before retrying, or configure a higher-quota API key in the gateway environment.

### 7.3 Request Timed Out (`HTTP 504 PROVIDER_TIMEOUT`)
- **Symptom**: Chat requests abort after approximately 30 seconds with `"Model provider request timed out"` or turn deadline exceeded.
- **Root Cause**: The model took too long to reason, an upstream tool was slow, or the 30-second turn deadline (`CHAT_TURN_TIMEOUT_MS`) elapsed.
- **Remediation**: Simplify the prompt, check upstream server responsiveness via `kubectl logs -n urumi deployment/urumi-woocommerce-mcp`, or increase `CHAT_TURN_TIMEOUT_MS` in non-production environments.

### 7.4 Invalid or Revoked API Key (`HTTP 401 Unauthorized`)
- **Symptom**: External MCP client fails handshake or tool calls with `"Unauthorized: Invalid or revoked API key"`.
- **Root Cause**: The Bearer token was mistyped, expired, belongs to a deactivated user, or was revoked in the Dashboard.
- **Remediation**: Generate a fresh API key via the Dashboard "API Keys" tab and update the client authorization header.

### 7.5 Upstream Unavailable / Circuit Breaker Open (`HTTP 502 Bad Gateway`)
- **Symptom**: Tool execution fails with upstream connection error or tool returns `_meta: { reachable: false }`.
- **Root Cause**: Upstream pod is crashed, unready, or timing out beyond the 10,000ms threshold.
- **Remediation**: Check upstream health via `kubectl get pods -n urumi` and inspect logs. The gateway will automatically isolate the failure and keep remaining upstreams operational.

### 7.6 Mutation Confirmation Failure (`HTTP 400 / 403 INVALID_CONFIRMATION_TOKEN`)
- **Symptom**: Clicking "Confirm & Execute" results in an error: `CONFIRMATION_EXPIRED`, `CONFIRMATION_TOKEN_CONSUMED`, or `CONFIRMATION_USER_MISMATCH`.
- **Root Cause**:
  - The 60-second token TTL expired before the user clicked confirm.
  - The token was already consumed (single-use nonce protection).
  - A different user session attempted to confirm the token (user mismatch protection).
- **Remediation**: Re-submit the chat instruction to generate a fresh confirmation card and confirm within 60 seconds.

---

## 8. Requirements Traceability Matrix (Phase 6)

| Req ID | Requirement Statement | Implementation Files | Acceptance Evidence | Status |
|:---:|:---|:---|:---|:---:|
| **CHT-02** | Chat interface communicating with an LLM (Gemini / Mock). | `apps/gateway/src/chat/gemini-provider.ts`<br/>`apps/gateway/src/chat/mock-provider.ts`<br/>`apps/dashboard/src/components/ChatTab.tsx` | Unit tests: `agent-loop.test.ts`. Protocol tests: `browser-chat.test.ts`, `p6-g5-cross-path-security.test.ts`. Live Gemini provider verified. | **VERIFIED** |
| **CHT-03** | LLM executes tools through the gateway as the logged-in user. | `apps/gateway/src/chat/agent-loop.ts`<br/>`apps/gateway/src/upstream/tool-router.ts`<br/>`apps/gateway/src/audit/audit-service.ts` | Protocol tests: `SEC-7` in `p6-g5-cross-path-security.test.ts` validates `user_id` attribution in SQLite `audit_logs`. | **VERIFIED** |
| **CHT-04** | Real-time tool execution visibility in chat (tool name, inputs, status pill). | `apps/dashboard/src/components/ChatTab.tsx` | UI rendering of badges, status pills (`success`, `error`, `confirmation_required`), ms duration, and expandable drawers verified. | **VERIFIED** |
| **EXT-01** | External client connects to gateway URL (`/mcp`). | `apps/gateway/src/server.ts`<br/>`apps/gateway/src/mcp/mcp-server.ts` | Live acceptance test: `Criterion 1` in `p6-g4-external-mcp-acceptance.test.ts` connects official MCP SDK client via gateway Ingress. | **VERIFIED** |
| **EXT-02** | External client authenticates with member's API key. | `apps/gateway/src/auth/api-key-auth-middleware.ts`<br/>`apps/gateway/src/auth/api-key-service.ts` | Live acceptance test: `Criterion 1` and `Criterion 4` verify Bearer auth with dedicated member key and instant revocation. | **VERIFIED** |
| **EXT-03** | External client executes cross-server workflow combining tools from 2 servers. | `apps/gateway/src/chat/gemini-provider.ts`<br/>`apps/gateway/test/integration/p6-g4-external-mcp-acceptance.test.ts` | Live acceptance test: `Criterion 3` executes single prompt invoking `crm__search_contacts` and `tasks__list_tasks` sequentially. | **VERIFIED** |

---

## 9. Known Limitations & Environment Boundaries

To ensure complete transparency and evaluator readiness, the following operational boundaries are documented:
1. **Ephemeral Chat State**: The Dashboard AI Assistant maintains conversation messages in React client state. Refreshing the browser clears the conversation history. This is by design: no database migrations or chat history tables were introduced, preserving existing SQLite schemas.
2. **Turn-Based JSON vs Streaming SSE**: In-dashboard chat uses turn-based HTTP POST (`/api/v1/browser/chat`) with real-time tool badges and confirmation cards. Streaming partial tokens (SSE) for raw text is reserved for future enhancements; complete turn responses are delivered atomically upon turn completion.
3. **External Gemini Egress Dependency**: When running with `CHAT_PROVIDER=gemini`, the gateway host must have outbound HTTPS network connectivity to Google Generative AI endpoints. In air-gapped or test environments, setting `CHAT_PROVIDER=mock` provides hermetic verification with zero external dependencies.
4. **Disposable Demo SKU Scope**: Autonomous product creation without confirmation is strictly limited to SKUs matching `/^chat-demo-[a-z0-9_-]+$/`. All other product creations or status mutations enforce interactive human confirmation.
5. **Per-Tool Granular Role Restrictions**: Granular per-tool permissions (e.g. restricting specific tools to specific roles) remain classified as deferred bonus scope. All authenticated members currently have access to all registered upstream tools subject to mutation confirmation.
