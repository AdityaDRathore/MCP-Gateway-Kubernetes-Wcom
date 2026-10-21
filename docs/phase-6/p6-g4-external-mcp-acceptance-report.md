# Phase 6 Gate P6-G4: External MCP Client Acceptance & Cross-Server Verification Report

**Date:** October 22, 2026  
**Gate:** P6-G4 (External MCP Client Acceptance & Cross-Server Verification)  
**Status:** **ACCEPTED / VERIFIED**  
**Role:** Implementation Worker reporting to Technical Head  
**Branch:** `main`  
**Baseline Commit SHA:** `3a276679541575ca268f61448b376cbe3d36b7b2`  
**Final Commit SHA:** `a99545d`  

---

## 1. Executive Summary & Acceptance Matrix

Phase 6 Gate P6-G4 is an acceptance and verification gate demonstrating that an external Model Context Protocol (MCP) client can connect to the central Urumi Gateway using exclusively:
1. The existing public Gateway Ingress URL: `http://dashboard.127.0.0.1.nip.io:8080/mcp`.
2. A valid member-specific API key (`Authorization: Bearer urumi_live_[REDACTED]`).

The gate verifies that:
- The external client discovers all 10 tools from all three enabled upstream services (`woocommerce`, `crm`, `tasks`) without direct upstream access or credentials.
- The client successfully executes a read-only orders query (`woocommerce__list_orders`), safely returning Order #14 with customer PII strictly omitted.
- The client executes a **single natural-language prompt** requiring autonomous, model-driven tool execution across two separate upstream MCP servers (`crm__search_contacts` and `tasks__list_tasks`), producing a synthesized final response.
- Revoking the member API key immediately causes subsequent requests to be rejected with HTTP 401 Unauthorized across fresh network connections.

### Acceptance Criteria Matrix

| Criterion | Requirement | Test Type | Observed Result | Status |
|:---|:---|:---|:---|:---:|
| **CRIT-1: Client Connection & Tool Discovery** | Connect via Gateway URL + Member API key; discover all enabled upstreams; no upstream URLs or secrets exposed. | Live External Client | 10 tools discovered across WooCommerce (5), CRM (2), Tasks (3) with `_meta: { reachable: true }`. Zero admin leaks. | **PASS** |
| **CRIT-2: Orders Query Acceptance** | Execute read-only orders query via gateway; verify Order #14; customer PII redacted; protected records preserved. | Live External Client | `woocommerce__list_orders` returned Order #14 (`processing`, total 299.00 INR, sku `URUMI-MUG-001`). PII omitted. Protected records 10, 11, 12, 14 verified unmodified in MariaDB. | **PASS** |
| **CRIT-3: Single-Prompt Cross-Server Workflow** | Single user prompt requiring tools from two different upstream servers with model-driven multi-turn orchestration. | Live External Client + Gemini LLM | Single prompt submitted. Model autonomously emitted `crm__search_contacts` (Turn 1) -> resolved Alice Smith (`CRM-CONT-001`) -> emitted `tasks__list_tasks` (Turn 2) -> resolved `TASK-001` -> synthesized final response. | **PASS** |
| **CRIT-4: Safe Disposable Key Revocation** | Pre-revocation request succeeds (200); revoke via supported API; fresh request rejected with HTTP 401. | Live External Client & Browser API | Disposable key succeeded initially (200 OK). Revoked via `POST /api/v1/browser/keys/:id/revoke`. Fresh request via fresh transport rejected with HTTP 401 Unauthorized. | **PASS** |
| **REG-1: Unit Test Suite** | 100% passing gateway unit tests; zero regressions from schema sanitization & thoughtSignature preservation. | Automated Unit Tests | 351 / 351 unit tests passed across 51 test suites. | **PASS** |
| **REG-2: Protocol Test Suite** | 100% passing gateway protocol tests. | Automated Protocol Tests | 34 / 34 protocol tests passed across 13 test suites. | **PASS** |

---

## 2. Gate Baseline & Environment Verification

### Git State
- **Branch**: `main`
- **Baseline Commit**: `3a276679541575ca268f61448b376cbe3d36b7b2`
- **Baseline Subject**: `ph 6: feat: implement bounded agent loop, tool confirmation, and dashboard chat tab integration gate-3`
- **Working Tree Prior to P6-G4 Execution**: Clean.

### Runtime Infrastructure & Endpoints
- **External Client Target**: `http://dashboard.127.0.0.1.nip.io:8080/mcp`
- **Ingress Controller**: Traefik Ingress routing host `dashboard.127.0.0.1.nip.io`
  - Path `/mcp` -> `service/urumi-gateway:3000` (Streamable HTTP Transport)
  - Path `/` -> `service/urumi-gateway:3001` (Dashboard SPA & Browser API)
- **Active Cluster Upstreams (Kubernetes Namespace `urumi`)**:
  - `woocommerce`: `http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp` (Status: `active`, 5 tools)
  - `crm`: `http://urumi-mcp-crm.urumi.svc.cluster.local:3000/mcp` (Status: `active`, 2 tools)
  - `tasks`: `http://urumi-mcp-tasks.urumi.svc.cluster.local:3000/mcp` (Status: `active`, 3 tools)
- **Zero Client Upstream Leakage**: The external client never receives, requests, or references any upstream cluster DNS name or internal port. All calls are dispatched to the `/mcp` gateway endpoint.

---

## 3. Dedicated Test Account & API Key Strategy

In accordance with Technical Head Revisions 2 and 3:
1. **Test Member Account**: Existing test member `member_test_9690` (`role: member`, ID: `d6902021-d08e-45e1-9939-10cc4f1a3d3f`).
   - Reactivated via the supported admin endpoint: `POST /api/v1/browser/members/:id/reactivate`.
2. **Dedicated Acceptance Key**:
   - Name: `p6-g4-acceptance-member-key`
   - Prefix: `urumi_live_51a0c...`
   - Generated via `POST /api/v1/browser/keys` with `userId: d6902021-d08e-45e1-9939-10cc4f1a3d3f`.
3. **Dedicated Disposable Key for Revocation**:
   - Name: `p6-g4-revocation-disposable-key`
   - Provisioned solely for the revocation lifecycle test and immediately revoked during the test run.
4. **Secret Sanitization**:
   - Raw keys and bearer tokens are never logged or stored in reports.
   - Passwords and bearer tokens are scrubbed in all log output.

---

## 4. Acceptance Evidence

### Criterion 1: External Client Connection & Multi-Upstream Tool Discovery

The external client was instantiated using the official `@modelcontextprotocol/sdk/client` with `StreamableHTTPClientTransport` connecting to `http://dashboard.127.0.0.1.nip.io:8080/mcp` with header `Authorization: Bearer [REDACTED_MEMBER_KEY]`.

**Discovered Tools (10 total)**:
```json
[
  { "name": "woocommerce__list_orders", "_meta": { "reachable": true } },
  { "name": "woocommerce__get_order", "_meta": { "reachable": true } },
  { "name": "woocommerce__list_products", "_meta": { "reachable": true } },
  { "name": "woocommerce__create_product", "_meta": { "reachable": true } },
  { "name": "woocommerce__update_order_status", "_meta": { "reachable": true } },
  { "name": "crm__search_contacts", "_meta": { "reachable": true } },
  { "name": "crm__get_contact", "_meta": { "reachable": true } },
  { "name": "tasks__list_tasks", "_meta": { "reachable": true } },
  { "name": "tasks__create_task", "_meta": { "reachable": true } },
  { "name": "tasks__update_task_status", "_meta": { "reachable": true } }
]
```

**Observations**:
- Exactly 10 tools returned from all three enabled upstream services.
- Every tool includes `_meta: { reachable: true }`, reflecting healthy upstream connectivity.
- No administrative endpoints (`/admin/v1/*` or `/api/v1/browser/*`) are present in the catalog.

---

### Criterion 2: Orders Query Acceptance (`woocommerce__list_orders`)

The external client invoked `woocommerce__list_orders` through the gateway with `{ per_page: 5 }`.

**Sanitized Output Summary**:
```json
[
  {
    "id": 14,
    "status": "processing",
    "currency": "INR",
    "total": "299.00",
    "date_created": "2026-10-11T18:23:04",
    "payment_method": "Cash on delivery",
    "line_items": [
      {
        "id": 1,
        "name": "Urumi Test Mug",
        "product_id": 10,
        "quantity": 1,
        "subtotal": "299.00",
        "total": "299.00",
        "sku": "URUMI-MUG-001"
      }
    ]
  }
]
```

**Protection Verification**:
- Customer billing address: Redacted / omitted.
- Customer shipping address: Redacted / omitted.
- Customer email & phone: Redacted / omitted.
- **MariaDB Database Verification**:
  ```sql
  SELECT ID, post_title, post_type, post_status FROM wp_posts WHERE ID IN (10, 11, 12, 14);
  ```
  | ID | post_title | post_type | post_status | Status |
  |:---|:---|:---|:---|:---:|
  | 10 | Urumi Test Mug | product | publish | **Unmodified** |
  | 11 | Wireless Mouse Demo | product | publish | **Unmodified** |
  | 12 | Notebook Demo | product | publish | **Unmodified** |
  | 14 | Order &ndash; October 11, 2026 @ 06:23 PM | shop_order | wc-processing | **Unmodified** |

---

### Criterion 3: Single-Prompt Cross-Server Workflow (Model-Driven Multi-Turn Orchestration)

To satisfy Technical Head Revision 4, the external client accepted a single user prompt and executed an autonomous model-driven loop using `GeminiProviderAdapter` (`gemini-flash-lite-latest`) against the gateway's discovered tools.

**Original Single Prompt**:
> *"Who is the procurement contact for Acme Retail Ltd in our CRM, and what pending or in-progress tasks are assigned to them?"*

**Autonomous Execution Trace**:
1. **Turn 1 (Model Reasoning -> CRM Tool Call)**:
   - Model receives tool definitions from Gateway.
   - Emits tool call: `crm__search_contacts({ query: "Acme Retail Ltd" })`.
   - External MCP Client invokes `crm__search_contacts` through Gateway.
   - Gateway dispatches to upstream CRM and returns:
     ```json
     [
       {
         "id": "CRM-CONT-001",
         "name": "Alice Smith",
         "title": "Procurement Director",
         "company": "Acme Retail Ltd",
         "email": "alice.smith@example.mock",
         "phone": "+91-98765-43210",
         "status": "active",
         "notes": "Key buyer for corporate merchandise and demo mugs."
       }
     ]
     ```
2. **Turn 2 (Model Reasoning -> Tasks Tool Call)**:
   - Model receives contact `CRM-CONT-001` (Alice Smith).
   - Preserving reasoning continuity via `thoughtSignature`, the model autonomously emits a second tool call: `tasks__list_tasks({ status: "in_progress" })`.
   - External MCP Client invokes `tasks__list_tasks` through Gateway.
   - Gateway dispatches to upstream Tasks and returns:
     ```json
     [
       {
         "id": "TASK-001",
         "title": "Review corporate mug order fulfillment",
         "description": "Verify warehouse inventory for Order 14.",
         "priority": "high",
         "status": "in_progress",
         "assignee_contact_id": "CRM-CONT-001",
         "created_at": "2026-10-15T10:00:00.000Z",
         "updated_at": "2026-10-15T10:00:00.000Z"
       }
     ]
     ```
3. **Turn 3 (Final Synthesis)**:
   - Model analyzes both live upstream results and generates the final response:
     > *"The procurement contact for Acme Retail Ltd is **Alice Smith** (Procurement Director, Contact ID: `CRM-CONT-001`). She currently has one in-progress task assigned to her: **TASK-001** - 'Review corporate mug order fulfillment' (High priority), which involves verifying warehouse inventory for Order 14."*

**Verification Outcome**:
- Genuine model-driven tool orchestration (zero hardcoded or manual tool sequences).
- Dispatched across two separate upstream MCP servers (`crm` and `tasks`).
- Both tool calls executed via `tools/call` on the Gateway and succeeded live.

---

### Criterion 4: Safe Disposable Key Revocation Acceptance

1. **Pre-Revocation Validation**:
   - Disposable key `p6-g4-revocation-disposable-key` issued to `member_test_9690`.
   - Client issued `POST /mcp` with `Authorization: Bearer [DISPOSABLE_KEY]`.
   - Gateway responded with **HTTP 200 OK**.
2. **Supported Key Revocation**:
   - Issued `POST /api/v1/browser/keys/:keyId/revoke` via the authenticated Browser API.
   - Gateway recorded `revoked_at` timestamp in SQLite `api_keys` table.
   - Response: `{"success": true, "message": "API key revoked successfully"}`.
3. **Post-Revocation Validation**:
   - Created a fresh `StreamableHTTPClientTransport` / fresh HTTP request (preventing stale connection/session reuse).
   - Issued `POST /mcp` with `Authorization: Bearer [DISPOSABLE_KEY]`.
   - Gateway immediately rejected the request before routing:
     - **Status Code**: `HTTP 401 Unauthorized`
     - **Response Body**: `{"error":"Unauthorized: Invalid or revoked API key"}`.

---

## 5. Test Execution Evidence

### 1. Dedicated Live Acceptance Suite
```bash
RUN_P6_G4_ACCEPTANCE=true npx tsx --test apps/gateway/test/integration/p6-g4-external-mcp-acceptance.test.ts
```
**Output**:
```text
▶ Phase 6 Gate P6-G4: External MCP Client Acceptance & Cross-Server Verification
  ✔ Criterion 1: External Client Connects via Gateway URL & Discovers Multi-Upstream Tools (36.375338ms)
  ✔ Criterion 2: Orders Query Acceptance through Central Gateway (woocommerce__list_orders) (157.55606ms)
  ✔ Criterion 3: Single-Prompt Cross-Server Workflow (Model-Driven Multi-Turn Orchestration) (3084.124124ms)
  ✔ Criterion 4: API-Key Revocation Acceptance & Rejection Verification (16.366616ms)
✔ Phase 6 Gate P6-G4: External MCP Client Acceptance & Cross-Server Verification (3761.972028ms)
ℹ tests 4
ℹ suites 1
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4361.590555
```

### 2. Standard Gateway Unit Test Suite
```bash
npm run test:unit --workspace=apps/gateway
```
**Output**:
```text
ℹ tests 351
ℹ suites 51
ℹ pass 351
ℹ fail 0
ℹ duration_ms 14537.304471
```

### 3. Standard Gateway Protocol Test Suite
```bash
npm run test:protocol --workspace=apps/gateway
```
**Output**:
```text
ℹ tests 34
ℹ suites 13
ℹ pass 34
ℹ fail 0
ℹ duration_ms 15339.285894
```

---

## 6. Minimal Code Changes Made & Technical Rationale

Two minimal changes were made to `apps/gateway/src/chat/` to support reliable model-driven function calling with the Google Gemini REST API:

1. **`apps/gateway/src/chat/gemini-provider.ts`**:
   - **Schema Sanitization**: Added recursive `sanitizeSchemaForGemini()` stripping JSON Schema properties not recognized by the Gemini OpenAPI function declaration parser (`$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`, `_meta`).
   - **Role Alignment**: Updated `functionResponse` contents to use `role: 'user'` and wrapped Array payloads in `{ result: payload }` to conform to Gemini protobuf `Struct` specifications.
   - **Reasoning Continuity**: Preserved `thoughtSignature` and `id` across multi-turn assistant and model tool call turns.
2. **`apps/gateway/src/chat/types.ts`**:
   - Added `thoughtSignature?: string;` optional property to `ModelToolCall`.
3. **`apps/gateway/test/unit/chat-provider.test.ts`**:
   - Updated unit assertion to expect `contents[2].role === 'user'` matching Gemini REST API specifications.

---

## 7. Limitations & Remaining Scope Boundaries

- **Gate P6-G4 Boundaries**: P6-G4 is strictly an external client acceptance and evidence gate. No infrastructure changes, helm chart modifications, or database migrations were performed.
- **Model Usage**: External client tool orchestration was executed using `gemini-flash-lite-latest` grounded in `.secrets/gemini.env`.
- **Protected Records**: WooCommerce Product IDs 10, 11, 12 and Order #14 remain strictly protected and unmodified.

---

## 8. Recommendation for P6-G5

Gate P6-G4 has satisfied all four primary acceptance criteria and all Technical Head revisions:
1. Multi-upstream tool discovery through the Gateway URL is fully operational.
2. The orders query executes cleanly with customer PII redacted.
3. Single-prompt model-driven cross-server tool execution (CRM + Tasks) has been demonstrated live.
4. API-key revocation is immediately effective and verified across fresh network connections.
5. All 351 unit tests and 34 protocol tests pass without regressions.

**Recommendation**: Authorize progression to **Phase 6 Gate P6-G5 (Hardening, Regression, & Acceptance Package)** upon Technical Head review.
