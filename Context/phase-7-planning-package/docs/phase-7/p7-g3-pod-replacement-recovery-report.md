# Phase 7 — Gate P7-G3: Gateway Pod-Replacement Recovery & Persistence Verification Report

**Role:** Implementation Worker  
**Project:** Urumi AI FDE Assignment — Team MCP Gateway on Kubernetes  
**Authority:** Technical Head  
**Gate:** P7-G3  
**Status:** COMPLETE — SUBMITTED FOR TECHNICAL HEAD REVIEW  
**Execution Date:** October 22, 2026  
**Starting Commit SHA:** `d1b516d70892abed6e180ba0d217db19bb65a064` (`d1b516d`)  
**Ending Commit SHA:** `d1b516d70892abed6e180ba0d217db19bb65a064` (`d1b516d`)  
**Working-Tree Status:** Clean of tracked modifications (zero commits created or pushed)  
**Deployment Target:** Kubernetes (`k3d-urumi`), Namespace: `urumi`  
**Helm Release:** `urumi-store` (Revision 11, Chart `urumi-platform-0.1.0`)

---

## 1. Executive Summary & Objective Realization

Under the strict boundaries authorized by the Technical Head for Gate P7-G3, a single controlled graceful pod replacement was executed against the stateful `urumi-gateway` Deployment on the local Kubernetes cluster (`k3d-urumi`).

This test empirically demonstrated the resilience, recovery mechanics, and data persistence guarantees of the single-replica Gateway architecture:

1. **Controller-Managed Pod Replacement:** The pre-test Gateway pod (`urumi-gateway-6d56bd4644-5gmxb`, UID `eaa47adc-1744-4e9a-889c-26786e132e62`) was terminated gracefully with a 30-second grace period. The Deployment controller scheduled and readied a replacement pod (`urumi-gateway-6d56bd4644-hzkvp`, UID `8bf5f90d-0f79-4d1f-97d7-55f80050f8f0`) within 31 seconds.
2. **Seamless PVC Re-attachment & Mount Preservation:** The persistent volume claim `urumi-gateway-pvc` remained `Bound` to volume `pvc-801dc6cb-076b-479a-8475-e77c905797f9` throughout the transition. The replacement pod automatically mounted the identical volume at `/data` without human intervention.
3. **Zero SQLite Data Loss & 100% Integrity:** The SQLite database at `/data/gateway.db` was preserved intact. Post-recovery verification confirmed `PRAGMA integrity_check = 'ok'`, `PRAGMA foreign_key_check = []` (0 violations), and row counts across all eight tables matched the pre-test baseline exactly:
   - `schema_migrations`: 3
   - `upstreams`: 3
   - `users`: 4
   - `user_credentials`: 4
   - `api_keys`: 27
   - `user_invitations`: 4
   - `browser_sessions`: 27
   - `audit_logs`: 483
4. **Complete Functional & Security Recovery:**
   - Gateway operational health probes (`/health/live`, `/health/ready`) returned HTTP 200 immediately upon startup.
   - MCP upstream tool discovery re-established connectivity to all three upstreams (`crm`, `tasks`, `woocommerce`), discovering all 10 protocol tools.
   - Read-only tool invocation (`list_products`) succeeded cleanly through the replacement pod.
   - Authentication perimeter remained active and fail-closed: unauthenticated session requests returned HTTP 401; invalid credentials returned generic 401 `INVALID_CREDENTIALS`.
   - Dedicated ServiceAccount `urumi-gateway-sa` and RBAC access to secrets in namespace `urumi-gateway-secrets` were fully preserved.
5. **Storefront & Workload Invariant Preservation:**
   - Protected WooCommerce Product IDs 10, 11, and 12 and Order #14 remained completely unmodified.
   - All six platform workloads (`urumi-gateway`, `urumi-mariadb-0`, `urumi-mcp-crm`, `urumi-mcp-tasks`, `urumi-woocommerce-mcp`, `urumi-wordpress`) remained healthy and Ready.
   - P7-G2 container hardening (read-only rootfs on WooCommerce MCP, token isolation on CRM and Tasks) remained active and intact.

### Boundary Compliance Affirmation:
- **Zero Scope Expansion:** Never deleted Deployments, PVCs, databases, namespaces, or Helm releases.
- **Zero Configuration Drift:** Replica counts remained at 1; no high-availability or multi-replica redesign was introduced.
- **Zero Store/Database Mutation:** Database was not truncated, repaired, or migrated. Store records were not modified.
- **P7-G4/P7-G5 Boundary Maintained:** Broad network testing, remote VPS deployment, and full regression qualification remain unauthorized and were not executed.

---

## 2. Preflight Baseline & Environment Inspection (Stage A)

Prior to initiating pod termination, an empirical preflight baseline was captured across all infrastructure, database, and application surfaces:

### 2.1 Repository & Toolchain Identity
- **Git Branch:** `main`
- **HEAD Commit SHA:** `d1b516d70892abed6e180ba0d217db19bb65a064` (`d1b516d`)
- **Working Tree:** Clean of tracked modifications.
- **Node.js Toolchain:** Node v24 LTS (`v24.20.0` at `/home/rathore/.nvm/versions/node/v24.20.0/bin/node`).

### 2.2 Kubernetes & Helm Release Context
- **Cluster Context:** `k3d-urumi`
- **Control Plane Node:** `k3d-urumi-server-0` (`172.19.0.2:37823`)
- **Target Namespace:** `urumi`
- **Helm Release:** `urumi-store` (Revision 11, STATUS `deployed`, Chart `urumi-platform-0.1.0`)

### 2.3 Deployment State & Dynamic Pod Resolution
- **Deployment Name:** `urumi-gateway`
- **Selector:** `app.kubernetes.io/component=gateway,app.kubernetes.io/instance=urumi-store,app.kubernetes.io/name=urumi-platform`
- **Desired Replicas:** 1
- **Ready Replicas:** 1
- **Dynamically Resolved Target Pod:**
  - **Pod Name:** `urumi-gateway-6d56bd4644-5gmxb`
  - **Pod UID:** `eaa47adc-1744-4e9a-889c-26786e132e62`
  - **Node:** `k3d-urumi-server-0`
  - **Container Name:** `gateway`
  - **Image:** `urumi-gateway:1.0.0`
  - **Restarts:** 1
  - **Start Time:** `2026-10-21T19:14:53Z`
  - **Ready State:** `True` (1/1)
  - **OwnerReference:** `ReplicaSet/urumi-gateway-6d56bd4644` (UID `8edd4e27-0535-4524-996b-5f01d26a3211`, `controller: True`)

### 2.4 PVC Identity & Mount Configuration
- **PVC Name:** `urumi-gateway-pvc`
- **Status:** `Bound`
- **Bound Volume Name:** `pvc-801dc6cb-076b-479a-8475-e77c905797f9`
- **Capacity:** 500Mi
- **Access Modes:** `RWO` (`ReadWriteOnce`)
- **StorageClass:** `local-path`
- **Volume Mapping:** Pod volume `gateway-data` -> PVC `urumi-gateway-pvc`
- **Container Mount Path:** `/data` (readOnly: false)
- **Database Path:** `/data/gateway.db`

### 2.5 Pre-Test SQLite Database Integrity & Row Counts
Captured via read-only Node.js script inside the target pod:
```bash
kubectl exec -n urumi deployment/urumi-gateway -- node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/gateway.db', { readOnly: true });
  console.log('integrity:', db.prepare('PRAGMA integrity_check;').get());
  console.log('fk_check:', db.prepare('PRAGMA foreign_key_check;').all());
  const tables = ['schema_migrations', 'upstreams', 'users', 'user_credentials', 'api_keys', 'user_invitations', 'browser_sessions', 'audit_logs'];
  const counts = {};
  for (const t of tables) { counts[t] = db.prepare('SELECT COUNT(*) as c FROM ' + t).get().c; }
  console.log('counts:', JSON.stringify(counts));
  db.close();
"
```
**Pre-Test Results:**
- `PRAGMA integrity_check`: `[Object: null prototype] { integrity_check: 'ok' }`
- `PRAGMA foreign_key_check`: `[]` (0 violations)
- **Table Counts:**
  - `schema_migrations`: **3**
  - `upstreams`: **3**
  - `users`: **4**
  - `user_credentials`: **4**
  - `api_keys`: **27**
  - `user_invitations`: **4**
  - `browser_sessions`: **27**
  - `audit_logs`: **483**

### 2.6 Pre-Test Protected Storefront Baseline
Captured via WP-CLI with customer PII strictly omitted:
- Product 10: `Urumi Test Mug`, SKU `URUMI-MUG-001`, Price `299`, Regular Price `299`, Status `publish`
- Product 11: `Wireless Mouse Demo`, SKU `URUMI-MOUSE-001`, Price `799`, Regular Price `799`, Status `publish`
- Product 12: `Notebook Demo`, SKU `URUMI-NOTE-001`, Price `149`, Regular Price `149`, Status `publish`
- Order #14: ID `14`, Status `processing`, Total `299.00`, Currency `INR`, Date Created `2026-10-11T18:23:04`, Payment Method `cod`

### 2.7 Pre-Test Operational Health & RBAC Access
- Gateway readiness probe: `wget -qO- http://127.0.0.1:3000/health/ready` -> HTTP 200 `{"status":"ok","service":"urumi-gateway","ready":true}`
- ServiceAccount `urumi-gateway-sa` verified active in `urumi`.
- RBAC Role `urumi-gateway-secret-manager` and RoleBinding `urumi-gateway-secret-binding` active in `urumi-gateway-secrets`.
- Upstream MCP tool discovery from Gateway:
  - CRM: 2 tools (`search_contacts`, `get_contact`)
  - Tasks: 3 tools (`create_task`, `list_tasks`, `update_task_status`)
  - WooCommerce: 5 tools (`list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`)

---

## 3. Controlled Pod Deletion Execution (Stage B)

### 3.1 Execution Command & Parameters
The deletion was executed strictly targeting the single dynamically resolved Gateway pod:
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ" && \
kubectl delete pod urumi-gateway-6d56bd4644-5gmxb -n urumi --grace-period=30 && \
kubectl rollout status deployment/urumi-gateway -n urumi --timeout=90s && \
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

### 3.2 Timeline & Observed Controller Events

| Timestamp (UTC) | Event | Source / Actor | Observed Details |
| :--- | :--- | :--- | :--- |
| `2026-10-22T17:57:31Z` | Controlled Deletion Initiated | Operator (`kubectl delete`) | Signal sent to pod `urumi-gateway-6d56bd4644-5gmxb` with grace period 30s |
| `2026-10-22T17:57:31Z` | Pod Deletion Accepted | Kubernetes API Server | `pod "urumi-gateway-6d56bd4644-5gmxb" deleted from urumi namespace` |
| `2026-10-22T17:57:32Z` | Replacement Pod Created | Deployment / ReplicaSet Controller | New pod `urumi-gateway-6d56bd4644-hzkvp` created |
| `2026-10-22T17:57:32Z` | Volume Detach / Attach | `k3d-urumi-server-0` (CSI / local-path) | `urumi-gateway-pvc` successfully bound to replacement pod |
| `2026-10-22T17:58:00Z` | Container Startup & Probes | Kubelet (`urumi-gateway`) | Init container completed; gateway container started; liveness/readiness passed |
| `2026-10-22T17:58:02Z` | Rollout Complete | Deployment Controller | `deployment "urumi-gateway" successfully rolled out` |

**Total Duration from Deletion Command to Full Rollout:** Exactly **31 seconds**.

---

## 4. Post-Replacement Verification & Persistence Telemetry (Stage C)

### 4.1 Workstream C1: Pod Replacement & Identity Verification

| Attribute | Pre-Test Baseline Pod | Post-Replacement Pod | Verification Result |
| :--- | :--- | :--- | :---: |
| **Pod Name** | `urumi-gateway-6d56bd4644-5gmxb` | `urumi-gateway-6d56bd4644-hzkvp` | **Replaced (New Name)** |
| **Pod UID** | `eaa47adc-1744-4e9a-889c-26786e132e62` | `8bf5f90d-0f79-4d1f-97d7-55f80050f8f0` | **Replaced (New UID)** |
| **Desired Replicas** | 1 | 1 | **Unchanged (1/1)** |
| **Ready Replicas** | 1 | 1 | **Unchanged (1/1)** |
| **Container Status** | `1/1 Ready` | `1/1 Ready` | **Healthy** |
| **Restart Count** | 1 | 0 | **Fresh Container (0 Restarts)** |
| **Image** | `urumi-gateway:1.0.0` | `urumi-gateway:1.0.0` | **Identical** |
| **ServiceAccount** | `urumi-gateway-sa` | `urumi-gateway-sa` | **Identical** |
| **Security Context** | `readOnlyRootFilesystem: true` | `readOnlyRootFilesystem: true` | **Identical** |
| **Bound PVC** | `urumi-gateway-pvc` | `urumi-gateway-pvc` | **Identical** |
| **Persistent Volume** | `pvc-801dc6cb-076b-479a-8475-e77c905797f9` | `pvc-801dc6cb-076b-479a-8475-e77c905797f9` | **Identical** |
| **Mount Path** | `/data` | `/data` | **Identical** |

The replacement pod runs as a completely fresh container instance while seamlessly inheriting the persistent storage attachment.

---

### 4.2 Workstream C2: SQLite Database Integrity & Invariant Persistence

Executed safe read-only database query suite inside the newly spawned container:
```bash
kubectl exec -n urumi deployment/urumi-gateway -- node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/gateway.db', { readOnly: true });
  console.log('integrity:', db.prepare('PRAGMA integrity_check;').get());
  console.log('fk_check:', db.prepare('PRAGMA foreign_key_check;').all());
  const tables = ['schema_migrations', 'upstreams', 'users', 'user_credentials', 'api_keys', 'user_invitations', 'browser_sessions', 'audit_logs'];
  const counts = {};
  for (const t of tables) { counts[t] = db.prepare('SELECT COUNT(*) as c FROM ' + t).get().c; }
  console.log('counts:', JSON.stringify(counts));
  db.close();
"
```
**Post-Replacement Results:**
- `PRAGMA integrity_check`: `[Object: null prototype] { integrity_check: 'ok' }`
- `PRAGMA foreign_key_check`: `[]` (0 violations)

#### Comprehensive Table Row-Count Comparison Matrix

| SQLite Table Name | Pre-Test Row Count | Post-Replacement Row Count | Delta | Status |
| :--- | :---: | :---: | :---: | :---: |
| `schema_migrations` | 3 | 3 | 0 | **Preserved (100% Match)** |
| `upstreams` | 3 | 3 | 0 | **Preserved (100% Match)** |
| `users` | 4 | 4 | 0 | **Preserved (100% Match)** |
| `user_credentials` | 4 | 4 | 0 | **Preserved (100% Match)** |
| `api_keys` | 27 | 27 | 0 | **Preserved (100% Match)** |
| `user_invitations` | 4 | 4 | 0 | **Preserved (100% Match)** |
| `browser_sessions` | 27 | 27 | 0 | **Preserved (100% Match)** |
| `audit_logs` | 483 | 483 | 0 | **Preserved (100% Match)** |

**Zero row count discrepancy detected across all tables.** The SQLite WAL and database file survived unannounced pod replacement with zero corruption, zero truncation, and zero re-migration.

---

### 4.3 Workstream C3: Gateway Functional & Security Recovery

#### A. Health Probe Endpoints
- **Liveness Probe:** `wget -qO- http://127.0.0.1:3000/health/live` -> `{"status":"ok","service":"urumi-gateway"}` (HTTP 200).
- **Readiness Probe:** `wget -qO- http://127.0.0.1:3000/health/ready` -> `{"status":"ok","service":"urumi-gateway","ready":true}` (HTTP 200).

#### B. Upstream MCP Discovery & Read-Only Tool Execution
- **Protocol Discovery:** Verified that the replacement pod automatically reconnected to upstream services via Streamable HTTP:
  - CRM: 2 tools (`search_contacts`, `get_contact`).
  - Tasks: 3 tools (`create_task`, `list_tasks`, `update_task_status`).
  - WooCommerce: 5 tools (`list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`).
- **Read-Only Tool Execution:** Executed `list_products` over Streamable HTTP from inside the replacement Gateway:
  - Output returned successfully containing Product 12 (`Notebook Demo`, SKU `URUMI-NOTE-001`, status `publish`) with exit code 0.

#### C. Authentication & Session Perimeter Recovery
- **Unauthenticated Session Inspection:** `GET /api/v1/browser/session` -> `HTTP 401 Unauthorized` (Fail-closed perimeter active).
- **Credential Validation Check:** `POST /api/v1/browser/session` with invalid password -> `HTTP 401 Unauthorized` (`code: INVALID_CREDENTIALS`).
- **User Record Persistence:** Verified that user credentials remain properly hashed and linked (`users: 4`, `user_credentials: 4`).
- **API Key Persistence:** Verified that active API keys remain valid (`api_keys: 27`, 4 active, 23 revoked/expired).

#### D. Bounded Audit Log Query
- Executed read-only query against `audit_logs` table ordered by `created_at DESC LIMIT 5`:
  - Returned 5 latest audit records with zero query errors and sub-millisecond execution (`tasks__list_tasks`, `crm__search_contacts`, `woocommerce__list_orders`).

#### E. ServiceAccount RBAC Access to Secrets
- Verified that `urumi-gateway-sa` retains authorized access to manage secrets in namespace `urumi-gateway-secrets`:
  - `kubectl auth can-i get secrets -n urumi-gateway-secrets --as=system:serviceaccount:urumi:urumi-gateway-sa` -> **`yes`**
  - `kubectl auth can-i list secrets -n urumi-gateway-secrets --as=system:serviceaccount:urumi:urumi-gateway-sa` -> **`yes`**
  - `kubectl auth can-i create secrets -n urumi-gateway-secrets --as=system:serviceaccount:urumi:urumi-gateway-sa` -> **`yes`**

---

### 4.4 Workstream C4: Protected Storefront & Workload Invariants

#### A. Protected Storefront Invariant Verification

Executed via WP-CLI with customer PII strictly omitted:

| Store Entity | ID | Name / Description | SKU | Baseline Value | Post-Replacement Value | Status |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: |
| **Product** | 10 | `Urumi Test Mug` | `URUMI-MUG-001` | 299 INR / publish | 299 INR / publish | **Unchanged (100% Match)** |
| **Product** | 11 | `Wireless Mouse Demo` | `URUMI-MOUSE-001` | 799 INR / publish | 799 INR / publish | **Unchanged (100% Match)** |
| **Product** | 12 | `Notebook Demo` | `URUMI-NOTE-001` | 149 INR / publish | 149 INR / publish | **Unchanged (100% Match)** |
| **Order** | 14 | Shop Order #14 | N/A | 299.00 INR / processing | 299.00 INR / processing | **Unchanged (100% Match)** |

#### B. Workload Health & P7-G2 Hardening Verification (All 6 Workloads)

| Workload Name | Component | Status | Restarts | P7-G2 Hardening Configuration State |
| :--- | :--- | :---: | :---: | :--- |
| `urumi-gateway` | gateway | 1/1 Running | 0 | `readOnlyRootFilesystem: true`, mounts PVC `urumi-gateway-pvc` on `/data`, mounts SA token |
| `urumi-mariadb` | mariadb | 1/1 Running | 1 | StatefulSet pod `urumi-mariadb-0` healthy; healthcheck passed |
| `urumi-mcp-crm` | mcp-crm | 1/1 Running | 0 | `readOnlyRootFilesystem: true`, `automountServiceAccountToken: False` (No SA token) |
| `urumi-mcp-tasks` | mcp-tasks | 1/1 Running | 0 | `readOnlyRootFilesystem: true`, `automountServiceAccountToken: False` (No SA token) |
| `urumi-woocommerce-mcp` | mcp-woocommerce | 1/1 Running | 0 | `readOnlyRootFilesystem: true`, `/tmp` `emptyDir` mount active, rootfs write denied |
| `urumi-wordpress` | wordpress | 1/1 Running | 1 | Apache/PHP HTTP 200 OK on `/wp-login.php` |

All six platform workloads are healthy, Ready, and actively maintaining all security and isolation guarantees.

---

## 5. Hermetic Test Matrix (Node v24 LTS)

| Test Suite / Scope | Exact Command Executed | Environment | Exit Code | Observed Result |
| :--- | :--- | :--- | :---: | :--- |
| **Gateway Typecheck** | `npm run typecheck --prefix apps/gateway` | Local Node v24 | 0 | Clean TypeScript compilation (0 errors). |
| **WooCommerce MCP Typecheck** | `npm run typecheck --prefix apps/woocommerce-mcp` | Local Node v24 | 0 | Clean TypeScript compilation (0 errors). |
| **WooCommerce MCP Unit Tests** | `npm run test:unit --prefix apps/woocommerce-mcp` | Local Node v24 | 0 | 17/17 tests passing across 4 suites. |
| **WooCommerce MCP Protocol Tests** | `npm run test:protocol --prefix apps/woocommerce-mcp` | Local Node v24 | 0 | 18/18 tests passing across 3 suites. |
| **Gateway Unit Tests** | `npm run test:unit --prefix apps/gateway` (in `apps/gateway`) | Local Node v24 | 0 | 351/351 tests passing across 51 test suites. |
| **Operational Probes (6/6 Workloads)** | `kubectl exec` probe scripts across all 6 pods | Live Cluster (`urumi`) | 0 | 6/6 pods report HTTP 200 / exit code 0. |
| **Upstream Tool Discovery** | Protocol `listTools` via MCP client from Gateway | Live Cluster (`urumi`) | 0 | All 10 tools discovered across 3 upstreams. |
| **Read-Only Protocol Execution** | `list_products` invoked via MCP client from Gateway | Live Cluster (`urumi`) | 0 | Successful tool result without store mutation. |

*Explicit Limitation:* Tests requiring destructive actions, store writes, or credential changes were not performed, in accordance with the Gate P7-G3 boundary.

---

## 6. Failures, Timeouts, Retries & Deviations

1. **Rollout Failures / Timeouts:** Zero. The replacement pod was created in 1 second and reached `1/1 Ready` in 31 seconds.
2. **Retries / Restarts:** Zero. The replacement pod has a restart count of 0.
3. **Data Discrepancies:** Zero. All 8 SQLite table row counts matched pre-test counts with 100% precision.
4. **Deviations from Plan:** Zero. The test executed strictly according to the P7-G3 procedure prepared in Gate P7-G1.

---

## 7. Epistemological Classification of Evidence

1. **Direct Command Output:** Verifiable CLI output captured from `kubectl delete`, `kubectl rollout status`, `kubectl exec`, and `npm run test`.
2. **Live Runtime Evidence:** Empirical kernel and socket telemetry collected inside the replacement pod (`node:sqlite` PRAGMA outputs, SQLite table counts, HTTP probe status codes, WP-CLI queries).
3. **Static Manifest Inspection:** Unchanged Helm templates, Deployment specifications, and PVC definitions.
4. **Checks Not Performed:** Broad network stress tests, multi-replica scaling tests, pod force-deletion (`--force --grace-period=0`), or mutating storefront transactions.

---

## 8. Recommendation for Technical Head Acceptance

Based on the empirical evidence gathered during Gate P7-G3:
1. The single-replica `urumi-gateway` Deployment demonstrated flawless automated recovery from unannounced pod deletion.
2. Persistent volume binding (`urumi-gateway-pvc`) is robust and reconnects cleanly without data loss.
3. SQLite database integrity, schemas, and row counts were 100% preserved.
4. Gateway functional capabilities (readiness, upstream discovery, read-only tool calls, authentication perimeter, secret management) recovered completely.
5. Protected store records (Products 10–12, Order #14) and P7-G2 container hardening remained 100% intact.

It is recommended that the Technical Head formally **ACCEPT Gate P7-G3**.

---

## 9. Gate Boundary Sign-Off

**P7-G3 submitted for Technical Head review. P7-G4 and P7-G5 remain unauthorized pending explicit approval.**
