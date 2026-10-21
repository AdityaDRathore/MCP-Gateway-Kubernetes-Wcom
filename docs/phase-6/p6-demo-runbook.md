# Phase 6 Demonstration Runbook: Evaluator Walkthrough & Presenter Checklist

**Project:** Urumi Enterprise AI Gateway & Multi-Tenant Management Platform  
**Gate:** P6-G6 (Documentation and Repeatable Demo)  
**Audience:** Technical Evaluators, Solution Architects, DevOps & Field Engineers  
**Execution Time:** ~10–15 minutes  
**Safety Classification:** **NON-DESTRUCTIVE / EVALUATOR-SAFE**  
**Protected Records Policy:** Baseline Order #14 and Product IDs 10, 11, 12 are immutable and guaranteed untouched.

---

## 1. Presenter Pre-Flight Checklist

Before presenting the live demonstration, complete this rapid checklist:

| Check | Item | Verification Command / URL | Expected State |
|:---:|:---|:---|:---|
| [ ] | **Kubernetes Cluster** | `kubectl get pods -n urumi` | All 6 pods `1/1 Running` (gateway, mariadb, crm, tasks, woocommerce, wordpress). |
| [ ] | **Ingress DNS Resolution** | `curl -s -I http://dashboard.127.0.0.1.nip.io:8080/` | HTTP 200 OK (Dashboard SPA). |
| [ ] | **Downstream MCP Stream** | `curl -s -I http://dashboard.127.0.0.1.nip.io:8080/mcp` | HTTP 401 Unauthorized (Confirms Streamable HTTP active; rejects unauthenticated calls). |
| [ ] | **Storefront Availability** | `curl -s -I http://shop.127.0.0.1.nip.io:8080/` | HTTP 200 OK (WooCommerce store active). |
| [ ] | **Model Provider Config** | `.secrets/gemini.env` or gateway pod environment | `GEMINI_API_KEY` configured and non-empty. |
| [ ] | **Dedicated Test Member** | User `member_test_9690` | Active member in gateway database (ID: `d6902021-d08e-45e1-9939-10cc4f1a3d3f`). |
| [ ] | **Protected Records Guard** | Database query on `wordpress.wp_posts` | Products 10, 11, 12 and Order #14 intact. |

---

## 2. Repeatable 10-Step Demonstration Protocol

### Step 1: System Baseline & Dual-Listener Boundary Check

Demonstrate that the platform runs completely inside Kubernetes with dual-listener perimeter isolation:

```bash
# 1. Inspect cluster workloads
kubectl get pods -n urumi -o wide

# 2. Verify Port 3000 MCP plane rejects unauthenticated browser traffic
curl -s -o /dev/null -w "MCP HTTP Status: %{http_code}\n" http://dashboard.127.0.0.1.nip.io:8080/mcp
# Expected: MCP HTTP Status: 401 (Missing Authorization header)

# 3. Verify Port 3001 Browser plane responds with Dashboard SPA
curl -s -I http://dashboard.127.0.0.1.nip.io:8080/ | grep -i "content-type"
# Expected: Content-Type: text/html; charset=utf-8
```

*Talking Point for Presenter:*  
> "The Urumi Gateway enforces complete perimeter isolation. Port 3000 serves the machine MCP Streamable HTTP protocol requiring cryptographic Bearer keys. Port 3001 serves the human React dashboard requiring session cookies and CSRF tokens. Ambient cookie authentication cannot bleed into MCP tool routes."

---

### Step 2: Member Sign-In & Dashboard Chat Interface

1. Open your browser and navigate to: `http://dashboard.127.0.0.1.nip.io:8080/`.
2. Authenticate as a team member or administrator:
   - **Username**: `admin` (or `member_test_9690`)
   - **Password**: `[REDACTED_ADMIN_PASSWORD]` (read securely from `.secrets/` or environment)
3. Upon authentication, click on the **AI Assistant** tab in the sidebar navigation.
4. Point out the dark glassmorphic interface, conversation window, and prompt input box.

*Talking Point for Presenter:*  
> "Identity is anchored strictly in server-side session cookies validated against SQLite in WAL mode. The chat interface maintains ephemeral React state, meaning zero database migrations or table bloating."

---

### Step 3: Natural-Language Read-Only Query (WooCommerce Upstream)

1. In the chat input, type the following natural-language request:
   ```text
   What products are currently available in our WooCommerce store? Please list their names, prices, and stock status.
   ```
2. Press **Enter** or click **Send**.

---

### Step 4: Tool Execution Visibility & Synthesized Response

Observe the real-time execution feedback:
1. **Tool Execution Badge**: A tool execution pill appears immediately:
   - **Tool Name**: `woocommerce__list_products`
   - **Status**: Green `success` pill
   - **Duration**: Exact round-trip execution time (e.g. `118ms`)
2. **Expandable Payload Drawer**:
   - Click on the tool execution badge.
   - The drawer reveals the canonical tool arguments sent to WooCommerce (`{ "per_page": 10 }`) and the sanitized JSON array returned by the upstream service.
3. **Synthesized Assistant Reply**:
   - The LLM formats a human-friendly response summarizing the active catalog items:
     - *Urumi Test Mug* (₹299.00)
     - *Wireless Mouse Demo* (₹799.00)
     - *Notebook Demo* (₹149.00)

*Talking Point for Presenter:*  
> "Notice that the model did not just reply with text—it autonomously selected the namespaced tool `woocommerce__list_products`, executed it via the central gateway, and presented real-time execution telemetry to the user. All outputs are safely wrapped to prevent prompt injection."

---

### Step 5: Explicitly Confirmed State Mutation

Demonstrate the server-side confirmation engine protecting the store from unauthorized modifications:

1. Submit a prompt requesting a state mutation:
   ```text
   Please create a high-priority task titled "Warehouse restock audit" assigned to contact CRM-CONT-001 with status in_progress.
   ```
2. **Interactive Confirmation Card Appears**:
   - The agent loop evaluates `tasks__create_task`.
   - The server classifies this as a mutating tool and suspends execution.
   - The gateway mints an HMAC-SHA256 confirmation token with a 60-second expiration.
   - The chat UI displays a prominent confirmation card:
     - **Action**: `tasks__create_task`
     - **Arguments**:
       ```json
       {
         "title": "Warehouse restock audit",
         "priority": "high",
         "status": "in_progress",
         "assignee_contact_id": "CRM-CONT-001"
       }
       ```
     - **Timer**: 60-second countdown indicator.
     - **Actions**: **Confirm & Execute** (Green button) and **Cancel** (Red button).
3. Click **Confirm & Execute**:
   - The browser sends `POST /api/v1/browser/chat/confirm` with the cryptographic token.
   - The gateway verifies the signature, confirms the user matches the session actor, consumes the single-use nonce, and dispatches the tool.
   - The task is created (`TASK-002`), and the assistant confirms successful execution.

*(Optional Alternative: Demonstrate Protected Record Rejection)*  
Try asking: *"Please change the status of Order 14 to cancelled."*  
The server-side safeguard immediately aborts the tool call before execution with `MUTATION_TARGET_PROTECTED`, preserving Order #14.

*Talking Point for Presenter:*  
> "State mutations cannot be executed silently by the LLM. The server requires an explicit cryptographic confirmation token bound to the actor's session, canonical arguments, and a single-use nonce. Furthermore, protected baseline records like Order #14 and Product IDs 10–12 are hard-blocked at the gate level."

---

### Step 6: Audit Log Attribution Verification

Verify that every tool call executed in the chat is attributed to the human operator:

1. In the Dashboard sidebar, navigate to the **Audit Logs** tab.
2. Observe the latest audit log records:
   - **User ID**: Displays the authenticated member's ID (e.g. `usr-admin-1` or `d6902021-...`).
   - **Tool Name**: `woocommerce__list_products` and `tasks__create_task`.
   - **Status**: `success`.
   - **Duration**: Exact measured execution time (e.g. `118ms`).
   - **Arguments Hash**: SHA-256 fingerprint of arguments (raw PII and credentials are never stored).

*Talking Point for Presenter:*  
> "Every action taken by the AI assistant is fully attributed in the two-phase audit ledger. Operators have end-to-end compliance tracking for every upstream tool invocation."

---

### Step 7: External MCP Client Connection via Gateway URL

Transition to the machine-to-machine perimeter:

1. Navigate to the **API Keys** tab in the Dashboard.
2. Click **Generate New Key**:
   - **Name**: `demo-evaluator-external-key`
   - Copy the generated plaintext key (`urumi_live_...`).
3. Connect an external MCP client (such as MCP Inspector or an SDK client script) using:
   - **Endpoint**: `http://dashboard.127.0.0.1.nip.io:8080/mcp`
   - **Transport**: `Streamable HTTP`
   - **Header**: `Authorization: Bearer urumi_live_[REDACTED_KEY]`

---

### Step 8: Multi-Upstream Tool Discovery & Cross-Server Workflow

1. **Verify Discovered Tools**:
   Execute `tools/list` on the external client.  
   The gateway returns exactly **10 tools** aggregated across the three enabled upstreams:
   - `woocommerce__*` (5 tools)
   - `crm__*` (2 tools)
   - `tasks__*` (3 tools)
   Each tool indicates `_meta: { reachable: true }`.

2. **Execute Single-Prompt Cross-Server Multi-Turn Workflow**:
   Submit a single user prompt that requires data from two independent upstreams:
   ```text
   "Who is the procurement contact for Acme Retail Ltd in our CRM, and what pending or in-progress tasks are assigned to them?"
   ```
3. **Execution Trace**:
   - **Turn 1**: The client invokes `crm__search_contacts({ query: "Acme Retail Ltd" })`. The gateway routes the request to `urumi-mcp-crm`, returning contact `CRM-CONT-001` (Alice Smith).
   - **Turn 2**: The client invokes `tasks__list_tasks({ status: "in_progress" })`. The gateway routes the request to `urumi-mcp-tasks`, returning task `TASK-001` assigned to `CRM-CONT-001`.
   - **Turn 3**: The client synthesizes both results into a final answer:
     > *"The procurement contact for Acme Retail Ltd is Alice Smith (Procurement Director). She is currently assigned TASK-001: 'Review corporate mug order fulfillment' (High priority)."*

*Talking Point for Presenter:*  
> "The external MCP client has no direct access to CRM or Tasks pods. It interacts strictly with the central gateway endpoint using a member Bearer key. A single prompt drives autonomous multi-turn reasoning across two separate internal microservices."

---

### Step 9: Dedicated Test Key Instant Revocation

Demonstrate immediate fail-closed revocation:

1. Return to the Dashboard **API Keys** tab.
2. Locate `demo-evaluator-external-key` and click **Revoke**.
3. Confirm revocation. The key status immediately changes to `Revoked`.
4. In the external MCP client (or via curl), issue a fresh request using that revoked key:
   ```bash
   curl -s -i -X POST http://dashboard.127.0.0.1.nip.io:8080/mcp \
     -H "Host: dashboard.127.0.0.1.nip.io" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer [REVOKED_DEMO_KEY]" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```
5. **Expected Output**:
   ```http
   HTTP/1.1 401 Unauthorized
   Content-Type: application/json; charset=utf-8

   {"error":"Unauthorized: Invalid or revoked API key"}
   ```

*Talking Point for Presenter:*  
> "Key revocation is instantaneous. The gateway validates the SHA-256 hash against SQLite on every request. Revoked keys are rejected on the very next attempt across fresh connections."

---

### Step 10: Clean-Up of Disposable Demo Artifacts

Demonstrate safe, non-destructive clean-up without touching baseline records:

1. **Clean Up Disposable Tasks**:
   If a demo task (e.g. `TASK-002`) was created during Step 5, it exists strictly in ephemeral in-memory storage of `urumi-mcp-tasks` and resets automatically on pod restart, or can be updated via the API.
2. **Clean Up Disposable Products (if any created)**:
   If a disposable product was created using the approved demo prefix (`chat-demo-...`), query WooCommerce via the store admin or API and delete only that specific ID.
3. **Verify Protected Baseline Integrity**:
   Confirm that all protected records remain 100% intact:
   ```bash
   kubectl -n urumi exec urumi-mariadb-0 -c mariadb -- \
     mariadb -u root -p$(kubectl -n urumi get secret urumi-store-secrets -o jsonpath="{.data.mariadb-root-password}" | base64 -d) wordpress -e \
     "SELECT ID, post_title, post_type, post_status FROM wp_posts WHERE ID IN (10, 11, 12, 14);"
   ```
   **Expected Output**:
   ```text
   +----+-----------------------------------------+------------+---------------+
   | ID | post_title                              | post_type  | post_status   |
   +----+-----------------------------------------+------------+---------------+
   | 10 | Urumi Test Mug                          | product    | publish       |
   | 11 | Wireless Mouse Demo                     | product    | publish       |
   | 12 | Notebook Demo                           | product    | publish       |
   | 14 | Order &ndash; October 11, 2026 @ 06:23 PM | shop_order | wc-processing |
   +----+-----------------------------------------+------------+---------------+
   ```
   All 4 protected records remain completely untouched.

---

## 3. Presenter Quick-Reference Card

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              PRESENTER CHEAT SHEET                                     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Dashboard URL:     http://dashboard.127.0.0.1.nip.io:8080/                          │
│ 2. MCP Endpoint:      http://dashboard.127.0.0.1.nip.io:8080/mcp                      │
│ 3. Storefront:        http://shop.127.0.0.1.nip.io:8080/                               │
│ 4. Read-Only Prompt:  "What products are currently available in our catalog?"          │
│ 5. Mutation Prompt:   "Create a high-priority task titled 'Warehouse audit'            │
│                        assigned to contact CRM-CONT-001."                              │
│ 6. Cross-Server:      "Who is the procurement contact for Acme Retail Ltd in our CRM,   │
│                        and what pending or in-progress tasks are assigned to them?"    │
│ 7. Safe Mutation SKU: /^chat-demo-[a-z0-9_-]+$/                                        │
│ 8. Protected Targets: NEVER modify Product IDs 10, 11, 12 or Order #14                 │
│ 9. Revocation:        Dashboard -> API Keys -> Revoke -> Verify HTTP 401               │
│ 10. Audit Check:      Dashboard -> Audit Logs -> Confirm caller attribution            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
