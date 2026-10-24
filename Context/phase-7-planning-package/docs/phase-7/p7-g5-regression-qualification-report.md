# Phase 7 — Gate P7-G5: Regression Qualification Report

**Role:** Implementation Worker  
**Project:** Urumi AI FDE Assignment — Team MCP Gateway on Kubernetes  
**Authority:** Technical Head  
**Gate:** P7-G5  
**Status:** COMPLETE — SUBMITTED FOR TECHNICAL HEAD REVIEW  
**Execution Date:** October 24, 2026  
**Starting Reference:** P7-G4 report, submitted at SHA `a353cddfb9981c623f015130b692214ed499d01e` (`a353cdd`)  
**Current HEAD SHA:** `3b7644b615124e0c456b1e83936133faaa4cf252` (`3b7644b`)  
**Ending Commit SHA:** `3b7644b615124e0c456b1e83936133faaa4cf252` (`3b7644b`)  
**Working-Tree Status:** Clean of tracked commits (zero commits created or pushed)  
**Cluster Context:** `k3d-urumi` | **Namespace:** `urumi` | **Helm Release:** `urumi-store` (Revision 11)

---

## 1. Executive Summary & Objective Realization

Under the authority of the Technical Head, Gate P7-G5 was executed to qualify the complete Phase 7 platform through a reproducible, comprehensive regression pass following the P7-G2 runtime hardening changes, the P7-G3 Gateway pod-replacement resilience verification, and the P7-G4 network-boundary testing.

This gate was conducted strictly as a **test-and-evidence gate** without creating commits, pushing branches, modifying Helm templates, redeploying workloads, altering NetworkPolicies, rotating credentials, or mutating store or database persistence.

### Key Qualification Findings:
1. **Automated Test Suites (100% Pass Rate across Active Suites):**
   - **`apps/gateway` Unit Tests:** **351/351 passed** across 51 test suites (0 failures).
   - **`apps/gateway` Protocol Tests:** **62/62 passed** across 18 test suites (0 failures).
   - **`apps/gateway` Local Integration & Concurrency Stress:** **8/8 passed** across 2 suites (0 failures).
   - **`apps/woocommerce-mcp` Unit Tests:** **17/17 passed** across 5 test suites (0 failures).
   - **`apps/woocommerce-mcp` Protocol Tests:** **35/35 passed** across 7 test suites (0 failures).
   - **`apps/mcp-crm` Unit Tests:** **20/20 passed** across 5 test suites (0 failures).
   - **`apps/mcp-crm` Protocol Tests:** **6/6 passed** across 1 test suite (0 failures).
   - **`apps/mcp-tasks` Unit Tests:** **27/27 passed** across 7 test suites (0 failures).
   - **`apps/mcp-tasks` Protocol Tests:** **8/8 passed** across 1 test suite (0 failures).
   - **Total Automated Tests Executed & Passed:** **534 tests passed, 0 failures, 0 regressions.**

2. **Build & Typecheck Cleanliness:**
   - `packages/shared`: Typecheck & build passed (`tsc` 0 errors).
   - `apps/dashboard`: Typecheck & production SPA build passed (`tsc && vite build` in 2.05s).
   - `apps/gateway`: Typecheck passed (`tsc --noEmit` 0 errors).
   - `apps/woocommerce-mcp`: Typecheck passed (`tsc --noEmit` 0 errors).
   - `apps/mcp-crm`: Typecheck passed (`tsc --noEmit` 0 errors).
   - `apps/mcp-tasks`: Typecheck passed (`tsc --noEmit` 0 errors).

3. **Kubernetes Manifest & Helm Configuration Security:**
   - `helm lint`: Passed for both `values-local.yaml` and `values-prod.yaml` (0 failures).
   - Template rendering confirmed security posture:
     - WooCommerce MCP enforces `readOnlyRootFilesystem: true` with writable `/tmp` on `emptyDir`.
     - CRM MCP and Tasks MCP enforce `automountServiceAccountToken: false` and `readOnlyRootFilesystem: true` with `/tmp` on `emptyDir`.
     - Gateway Deployment retains dedicated `urumi-gateway-sa` and PVC mount on `/data`.
     - Production rendering strictly omits all `test-client` ingress rules.

4. **Runtime Regression & Operational Health:**
   - All six platform workloads (`urumi-gateway`, `urumi-mariadb-0`, `urumi-mcp-crm`, `urumi-mcp-tasks`, `urumi-woocommerce-mcp`, `urumi-wordpress`) remain 1/1 Running & Ready with zero restarts.
   - Gateway liveness and readiness probes return HTTP 200.
   - Gateway tool discovery across the 3 upstreams discovers all 10 expected tools.
   - Safe read-only MCP tool invocations (`list_products`, `get_order: 14`, `search_contacts`, `list_tasks`) succeeded with zero errors.
   - WooCommerce MCP root filesystem is read-only (`EROFS`) and `/tmp` is writable.
   - CRM and Tasks ServiceAccount token directories remain absent.
   - Gateway ServiceAccount and RBAC bindings to `urumi-gateway-secrets` remain intact.
   - Gateway PVC `urumi-gateway-pvc` remains Bound.
   - SQLite database passes `PRAGMA integrity_check` (`ok`), `foreign_key_check` (`[]`), and table counts match pre-test baseline identically (`3, 3, 4, 4, 27, 4, 27, 483`).
   - Protected store products (10, 11, 12) and Order #14 retain baseline fields without drift.

---

## 2. Baseline Reconciliation & Test Inventory (Stage A)

### 2.1 Repository History Reconciliation
- **Starting Reference SHA:** `a353cddfb9981c623f015130b692214ed499d01e` (`a353cdd`)
- **Current HEAD SHA:** `3b7644b615124e0c456b1e83936133faaa4cf252` (`3b7644b`)
- **Git Branch:** `main` (clean working tree, up to date with `origin/main`)
- **History Reconciliation:**
  - `git log --oneline -n 3` shows:
    - `3b7644b`: `docs: add phase 7 gate p7-g4 networkpolicy boundary verification report and execution log updates`
    - `a353cdd`: `docs: add Phase 7 Gate P7-G3 pod-replacement recovery and persistence verification report`
    - `d1b516d`: `feat: execute Gate P7-G2 controlled deployment, runtime hardening verification, and reporting`
  - Commit `3b7644b` is the direct child of reference commit `a353cdd` and solely incorporates the P7-G4 verification report and execution log.
  - Zero code, Helm, or application files were altered between `a353cdd` and `3b7644b`.

### 2.2 Test Suite Inventory & Safety Classification

| Component | Test Suite | Command | File Count | Safety Classification | Execution Status |
|---|---|---|:---:|---|:---:|
| **Gateway** | Unit Tests | `(cd apps/gateway && npm run test:unit)` | 40 files | Safe (in-memory/temp sqlite) | **Executed (351/351 PASS)** |
| **Gateway** | Protocol Tests | `(cd apps/gateway && npm run test:protocol)` | 10 files | Safe (in-memory/temp sqlite) | **Executed (62/62 PASS)** |
| **Gateway** | Concurrency Stress | `(cd apps/gateway && npm run test:integration)` | 1 file (`stage3-concurrency-stress.test.ts`) | Safe (temp directory sandbox) | **Executed (8/8 PASS)** |
| **Gateway** | External Acceptance | `p6-g4-external-mcp-acceptance.test.ts` | 1 file | Opt-in live test (`RUN_P6_G4_ACCEPTANCE`) | **Skipped (Protects live cluster)** |
| **Gateway** | Live Gemini Smoke | `live-gemini-smoke.ts` | 1 file | Live external Gemini provider call | **Skipped (Boundary rule compliance)** |
| **WooCommerce MCP** | Unit Tests | `(cd apps/woocommerce-mcp && npm run test:unit)` | 5 files | Safe (mocked upstream) | **Executed (17/17 PASS)** |
| **WooCommerce MCP** | Protocol Tests | `(cd apps/woocommerce-mcp && npm run test:protocol)` | 3 files | Safe (mocked upstream transport) | **Executed (35/35 PASS)** |
| **CRM MCP** | Unit Tests | `(cd apps/mcp-crm && npm run test:unit)` | 2 files | Safe (in-memory fixtures) | **Executed (20/20 PASS)** |
| **CRM MCP** | Protocol Tests | `(cd apps/mcp-crm && npm run test:protocol)` | 1 file | Safe (HTTP transport) | **Executed (6/6 PASS)** |
| **Tasks MCP** | Unit Tests | `(cd apps/mcp-tasks && npm run test:unit)` | 2 files | Safe (in-memory store) | **Executed (27/27 PASS)** |
| **Tasks MCP** | Protocol Tests | `(cd apps/mcp-tasks && npm run test:protocol)` | 1 file | Safe (HTTP transport) | **Executed (8/8 PASS)** |
| **Dashboard** | Build & Typecheck | `(cd apps/dashboard && npm run build)` | SPA | Safe (Vite bundle output) | **Executed (PASS in 2.05s)** |
| **Helm** | Lint (Local & Prod) | `helm lint infra/helm/urumi-platform -f ...` | 2 profiles | Safe (read-only validation) | **Executed (0 failures)** |
| **Helm** | Render (Local & Prod) | `helm template urumi-store infra/helm/urumi-platform -f ...` | 2 profiles | Safe (read-only manifest rendering) | **Executed (PASS)** |

---

## 3. Automated Regression Suite Execution (Stage B)

All non-destructive automated test suites were executed sequentially using Node v24 LTS (`v24.20.0`):

### 3.1 Gateway Unit & Security Suites
- **Command:** `(cd apps/gateway && npm run test:unit)`
- **Results:**
  - Total Tests: **351**
  - Suites: **51**
  - Passed: **351**
  - Failed: **0**
  - Duration: 16.59 s
- **Key Sub-Areas Verified:**
  - `agent-loop.test.ts`: Iteration bounds (max 5 iterations), provider timeout/error fallback, tool schema handling.
  - `browser-auth-perimeter.test.ts`: Browser session cookie enforcement, fail-closed access on unauthenticated routes, generic 401 on invalid credentials.
  - `csrf-origin.test.ts`: Origin validation, CSRF token verification, cross-origin request rejection.
  - `audit-persistence.test.ts` & `audit-query.test.ts`: Dual-phase audit durability, operator attribution, cursor pagination.
  - `api-key-lifecycle.test.ts`: Cryptographic generation, Argon2/scrypt hashing, prefix validation, revocation handling.
  - `secret-manager.test.ts`: Kubernetes Secret client allowlist, redaction of sensitive credentials in error logs.
  - `trusted-proxy-ip.test.ts`: Client IP resolution via rightmost trusted proxy hop, spoofed `X-Forwarded-For` mitigation.
  - `ssrf-url-validator.test.ts`: ADR-017 canonical URL validation, rejection of IP literals, non-http schemes, path traversal.
  - `tool-router.test.ts`: Fail-closed execution on Phase 1 audit failure, response size limits, error classification.

### 3.2 Gateway Protocol Test Suite
- **Command:** `(cd apps/gateway && npm run test:protocol)`
- **Results:**
  - Total Tests: **62**
  - Suites: **18**
  - Passed: **62**
  - Failed: **0**
  - Duration: 17.40 s
- **Key Sub-Areas Verified:**
  - `p6-g5-cross-path-security.test.ts`: Role-based access control, IDOR boundaries (Alice cannot revoke Bob's key), PII redaction on WooCommerce order queries, Canary credential masking.
  - `sdk-cancellation.test.ts`: Request cancellation correlation on shared transport without disrupting sibling invocations.
  - `mcp-protocol.test.ts`: Streamable HTTP JSON-RPC protocol compliance, header validation.
  - `upstream-discovery.test.ts`: Multi-upstream tool catalog discovery, graceful failure isolation on unreachable upstreams.

### 3.3 Gateway Integration & Concurrency Stress Suite
- **Command:** `(cd apps/gateway && npm run test:integration)`
- **Results:**
  - Total Tests: **8**
  - Suites: **2**
  - Passed: **8**
  - Failed: **0**
  - Duration: 2.06 s
- **Key Sub-Areas Verified:**
  - Concurrent audit writes and bounded paginated reads (20 workers, 100 operations).
  - Concurrent API key creation, verification, and revocation under high load.
  - POSIX directory/file permission verification (`0700` dir, `0600` db/wal/shm).
  - 5 consecutive online backup, corruption, and restore recovery cycles.

### 3.4 Upstream Services Suites
- **WooCommerce MCP Unit Tests:** 17/17 passed (5 suites, duration: 1.12 s).
  - OAuth 1.0a HMAC-SHA256 signature generation, PII omission in log formatters, error mappers.
- **WooCommerce MCP Protocol Tests:** 35/35 passed (7 suites, duration: 4.03 s).
  - `list_products`, `list_orders`, `get_order`, `create_product`, `update_order_status` over streamable HTTP. Strict PII omission verified on order payload.
- **CRM MCP Unit & Protocol Tests:** 20/20 unit passed (5 suites), 6/6 protocol passed (1 suite, duration: 2.15 s).
  - Deterministic contact search, ID regex validation, HTTP health and wire tools.
- **Tasks MCP Unit & Protocol Tests:** 27/27 unit passed (7 suites), 8/8 protocol passed (1 suite, duration: 2.30 s).
  - Numerical task ID generation, CRM assignee validation, 24-hour idempotency cache eviction, task status lifecycle.

### 3.5 Helm Chart & Template Qualification
- **`helm lint`:**
  - Local Profile (`values-local.yaml`): 1 chart linted, 0 failures.
  - Production Profile (`values-prod.yaml`): 1 chart linted, 0 failures.
- **Security Posture in Rendered Production Manifest (`/tmp/rendered-prod.yaml`):**
  - `readOnlyRootFilesystem: true` verified on `woocommerce-mcp`, `mcp-crm`, `mcp-tasks`, and `gateway`.
  - Writable `tmp` volume (`emptyDir: {}`) verified across all four workloads.
  - `automountServiceAccountToken: false` verified on `mcp-crm` and `mcp-tasks`.
  - `test-client` pod selector rules strictly omitted from production NetworkPolicies.

---

## 4. Read-Only Runtime Regression (Stage C)

Empirical runtime verification was executed across the live `urumi` namespace on cluster `k3d-urumi`:

### 4.1 Workload Health & Readiness
All 6 platform workloads verified 1/1 Running & Ready with zero restarts:
- `urumi-gateway-6d56bd4644-98s4l`: 1/1 Ready, 0 restarts
- `urumi-mariadb-0`: 1/1 Ready, 0 restarts
- `urumi-mcp-crm-7fc69678df-cglbg`: 1/1 Ready, 0 restarts
- `urumi-mcp-tasks-86964f8b95-n6cnz`: 1/1 Ready, 0 restarts
- `urumi-woocommerce-mcp-68dd5696d7-c2xfp`: 1/1 Ready, 0 restarts
- `urumi-wordpress-d994966c6-jffwh`: 1/1 Ready, 0 restarts

### 4.2 Gateway Endpoints & Tool Discovery
- Liveness: `GET /health/live` returned HTTP 200 `{"status":"ok","service":"urumi-gateway"}`.
- Readiness: `GET /health/ready` returned HTTP 200 `{"status":"ok","service":"urumi-gateway","ready":true}`.
- Upstream Tool Discovery: Exactly 10 tools discovered:
  - `woocommerce-mcp` (5): `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`
  - `crm-mcp` (2): `search_contacts`, `get_contact`
  - `tasks-mcp` (3): `create_task`, `list_tasks`, `update_task_status`

### 4.3 Safe Read-Only Upstream Operations
Executed directly through Gateway to verify end-to-end data pipelines:
- `woocommerce-mcp [list_products]`: Successfully returned product catalog containing Product IDs 10, 11, and 12.
- `woocommerce-mcp [get_order] (order_id: 14)`: Successfully returned Order #14 without customer PII:
  ```json
  {"id":14,"status":"processing","currency":"INR","total":"299.00","date_created":"2026-10-11T18:23:04","payment_method":"cod"}
  ```
- `crm-mcp [search_contacts]`: Successfully executed search query.
- `tasks-mcp [list_tasks]`: Successfully returned baseline tasks `TASK-001` and `TASK-002`.

### 4.4 Runtime Hardening & RBAC Invariants
- **WooCommerce MCP Rootfs:** `touch /ro_test.txt` returned `Read-only file system` (`EROFS`); `/tmp` is writable.
- **CRM & Tasks Token Mounts:** Both pods verified with `/var/run/secrets/kubernetes.io/serviceaccount` absent.
- **Gateway SA & RBAC:** ServiceAccount `urumi-gateway-sa` (UID `041a0ed0-2b85-41aa-bf8a-6cf84f229b81`), Role `urumi-gateway-secret-manager` (UID `2a1b4bf3-9b2c-4283-8532-22838591bb19`), and RoleBinding `urumi-gateway-secret-binding` (UID `d3db207c-6ecd-4e67-be59-575b2d191d30`) remain active.
- **Gateway PVC:** `urumi-gateway-pvc` remains `Bound` to volume `pvc-801dc6cb-076b-479a-8475-e77c905797f9`.

### 4.5 SQLite Database Integrity & Row Counts
Inspected via read-only Node.js `DatabaseSync`:
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: `[]` (0 violations)
- **Table Row Counts (100% matched baseline):**
  - `schema_migrations`: **3**
  - `upstreams`: **3**
  - `users`: **4**
  - `user_credentials`: **4**
  - `api_keys`: **27**
  - `user_invitations`: **4**
  - `browser_sessions`: **27**
  - `audit_logs`: **483**

### 4.6 Protected Storefront State Baseline
Inspected via WP-CLI with customer PII omitted:
- Product 10: `Urumi Test Mug`, SKU `URUMI-MUG-001`, Price `299`, Regular Price `299`, Status `publish`
- Product 11: `Wireless Mouse Demo`, SKU `URUMI-MOUSE-001`, Price `799`, Regular Price `799`, Status `publish`
- Product 12: `Notebook Demo`, SKU `URUMI-NOTE-001`, Price `149`, Regular Price `149`, Status `publish`
- Order #14: ID `14`, Status `processing`, Total `299.00`, Currency `INR`, Date Created `2026-10-11T18:23:04`, Payment Method `cod`

---

## 5. Security and Compatibility Review (Stage D)

The qualification evidence was analyzed against the Phase 7 architectural specifications:

1. **Gateway-Mediated Access vs. Direct Access:**
   - Gateway successfully discovers and invokes all 10 tools across WooCommerce, CRM, and Tasks.
   - P7-G4 verified that direct access from Gateway to WordPress and MariaDB is blocked.
   - WooCommerce MCP has operational access to WordPress REST API and does not have or require direct access to MariaDB.

2. **NetworkPolicy Boundary Nuance (P7-G4 Qualification):**
   - In P7-G4, allowed paths were confirmed working at the application level.
   - Connection refusals (`ECONNREFUSED`) observed on denied paths were corroborated by proving that the destination services (WordPress:80, MariaDB:3306, MCPs:3000) are open, active, and healthy for authorized sources. The packet rejection was thus demonstrated to be NetworkPolicy-enforced rather than an artifact of a closed port or missing endpoint.

3. **Authentication Perimeter & IDOR Defenses:**
   - Browser sessions and external MCP API keys maintain separate, non-conflating authentication perimeters.
   - Self-service member endpoints reject IDOR key revocations (Alice cannot revoke Bob's key).
   - Inactive member credentials fail closed with HTTP 401 across both browser and MCP endpoints.

4. **Secret Isolation & PII Protection:**
   - Order retrieval tools and chat responses strictly redact customer billing addresses, phone numbers, and emails.
   - Canary tokens and provider secrets are masked in audit records and error messages.

5. **Runtime Persistence & Pod Resilience:**
   - Gateway pod replacement recovery (verified in P7-G3) confirmed that SQLite database state is completely preserved across pod lifecycle transitions.
   - Zero SQLite database corruption, zero foreign-key violations, and zero row-count drift occurred across P7-G2, P7-G3, P7-G4, and P7-G5.

6. **P7-G2 Runtime Hardening Invariants:**
   - Root filesystem read-only enforcement on WooCommerce MCP and service account token isolation on CRM and Tasks remain permanently active in both live pods and rendered Helm manifests.

---

## 6. Skipped, Blocked, or Inconclusive Checks

1. **`p6-g4-external-mcp-acceptance.test.ts` (SKIPPED):**
   - **Reason:** Requires `RUN_P6_G4_ACCEPTANCE=true` and creates temporary test API keys and browser sessions against the live cluster. Skipped to adhere to the non-negotiable safety boundary prohibiting test fixture creation in persistent cluster state during qualification.
2. **`live-gemini-smoke.ts` (SKIPPED):**
   - **Reason:** Requires live external Gemini API egress and quota consumption. Skipped in accordance with the mandatory safety boundary; Gemini adapter contracts and error mappings are 100% covered by hermetic automated suites (`chat-provider.test.ts`, `agent-loop.test.ts`, `p6-g5-cross-path-security.test.ts`).

---

## 7. Mapping of Phase 7 Objectives to Empirical Evidence

| Acceptance Area | Requirement | Evidence File & Status | Disposition |
|---|---|---|:---:|
| **Hardening (P7-G1/P7-G2)** | WooCommerce MCP rootfs read-only, `/tmp` writable, CRM/Tasks token disabled | `rendered-prod.yaml`, container live probe | **PASS** |
| **Resilience (P7-G3)** | Gateway pod replacement recovers in <60s, PVC bound, zero SQLite data loss | P7-G3 report, runtime verification | **PASS** |
| **Network Boundaries (P7-G4)** | Gateway isolated from WP/DB directly; upstreams isolated; allowed paths work | P7-G4 report, live probe matrix | **PASS** |
| **Tool Routing & MCP** | All 10 tools discovered; valid schema execution; arguments validated | `upstream-discovery.test.ts`, live discovery | **PASS** |
| **Security Perimeter** | CSRF, Origin, session auth, API key auth, IDOR defense, PII redaction | `browser-auth-perimeter.test.ts`, `p6-g5` suite | **PASS** |
| **Store Baseline** | Products 10–12 and Order #14 preserved without drift | WP-CLI live inspection | **PASS** |
| **Database Integrity** | SQLite passes integrity & foreign key checks; table counts match baseline | Safe read-only inspection | **PASS** |

---

## 8. Technical Head Recommendation & Disposition

All non-destructive automated test suites, typechecks, builds, Helm chart validations, and live runtime checks completed with zero errors, zero regressions, and zero data drift.

**Disposition:** **PASS**

---

P7-G5 submitted for Technical Head review. Final Phase 7 handoff remains unauthorized pending explicit approval.
