# Phase 7 — Gate P7-G1: Targeted Container Hardening & Remediation Report

**Role:** Implementation Worker  
**Project:** Urumi AI FDE Assignment — Team MCP Gateway on Kubernetes  
**Authority:** Technical Head  
**Gate:** P7-G1  
**Status:** COMPLETE — SUBMITTED FOR TECHNICAL HEAD REVIEW  
**Execution Date:** October 22, 2026  
**Starting Commit SHA:** `5be0529eab431f47e2e81f1027f58f750074770d` (`5be0529`)  
**Deployment Target:** Kubernetes (`k3d-urumi`), Namespace: `urumi`  
**Helm Release:** `urumi-store` (Revision 10, Chart `urumi-platform-0.1.0`)

---

## 1. Executive Summary & Scope Compliance

In accordance with Technical Head approval for Gate P7-G1, this gate successfully implemented the smallest evidence-backed container security and requirements remediation set identified during P7-G0:

1. **Workstream A (WooCommerce MCP Hardening):** Hardened the WooCommerce MCP container to run with a strictly enforced `readOnlyRootFilesystem: true`, backed by a minimal non-persistent `emptyDir` mount at `/tmp`. Zero application code or runtime modifications were required.
2. **Workstream B (Kubernetes Token Isolation):** Disabled unnecessary Kubernetes API ServiceAccount token automounting (`automountServiceAccountToken: false`) on both the CRM and Tasks PodSpecs, closing a default credential exposure surface. The Gateway's legitimate secret-management identity (`urumi-gateway-sa`) was intentionally preserved.
3. **Workstream C (INF-02 Traceability Correction):** Evaluated authoritative requirement statements and empirical cluster evidence to reconcile Requirement `INF-02` from `Partial (Store Workloads Verified)` to `Verified (Phases 4–7)`.
4. **Workstream D (Future Test Planning):** Authored two complete, implementation-ready plans for subsequent gates without executing any destructive or mutating steps:
   - **P7-G3 Pod-Replacement Recovery Test Plan:** A controller-managed pod-deletion and persistence verification procedure.
   - **P7-G5 Regression Qualification Plan:** An end-to-end regression test specification across all platform surfaces using explicit Node.js 24 runtime bindings.

### Strict Boundary Affirmation:
- **Zero Live Mutations:** Neither `helm upgrade`, `helm install`, nor `kubectl apply` was executed against the running cluster.
- **Zero Workload Restarts:** No live pods were deleted, replaced, or restarted during P7-G1.
- **Zero Data Mutations:** Protected WooCommerce Product IDs 10, 11, 12, Order #14, and the Gateway SQLite database remain completely unmutated.
- **Zero NetworkPolicy Changes:** Cluster networking rules remain unchanged.

---

## 2. Baseline Status & Pre-Change Checks

Before applying any template or documentation modifications, the environment and repository baseline were verified:

| Check Item | Verified Baseline State | Evidence / Tool |
| :--- | :--- | :--- |
| **Git Branch & HEAD SHA** | Branch `main`, HEAD commit `5be0529eab431f47e2e81f1027f58f750074770d` | `git rev-parse HEAD` |
| **P7-G0 Preflight Deliverables** | Preflight report and execution log verified present and approved | `p7-g0-preflight-report.md` |
| **Live Cluster Workloads** | 6 workloads (gateway, mariadb, crm, tasks, woocommerce, wordpress) 1/1 Running | `kubectl get pods -n urumi` |
| **Protected Store Entities** | Product 10 (Mug), 11 (Mouse), 12 (Notebook), Order 14 (Processing) intact | WP-CLI check (P7-G0) |
| **Gateway SQLite Database** | `PRAGMA integrity_check = 'ok'`, 0 foreign key violations | SQLite engine check (P7-G0) |
| **Node.js Environment** | Node v24 LTS (`v24.20.0`) available at `/home/rathore/.nvm/versions/node/v24.20.0/bin/node` | `node -v` |

---

## 3. Workstream A — WooCommerce MCP Container Filesystem Hardening

### 3.1 Investigation Findings
An empirical review of the WooCommerce MCP container configuration and source code was conducted:
1. **Container Execution Identity:** `apps/woocommerce-mcp/Dockerfile` builds from `node:24-alpine` and sets `USER 10001:10001`. The container runs as non-root user `mcpuser`.
2. **Application Write Analysis:** Inspection of `apps/woocommerce-mcp/src/` (`index.ts`, `server.ts`, `client.ts`, `tools/`) revealed that the service acts as a pure stateless HTTP proxy to the WordPress REST API over JSON-RPC. There are zero filesystem write calls (`fs.writeFile`, `fs.createWriteStream`), zero local caching directories, and zero database files.
3. **Write Paths Required:** The only filesystem path required by Node.js or Alpine runtime operations (such as ephemeral stream buffers or temporary lockfiles) is `/tmp`.
4. **Feasibility Conclusion:** The workload safely supports `readOnlyRootFilesystem: true` when provided an `emptyDir` mount at `/tmp`.

### 3.2 Implemented Changes
In `infra/helm/urumi-platform/templates/mcp-deployment.yaml`:
- Updated `securityContext.readOnlyRootFilesystem` from `false` to `true`.
- Added a container `volumeMounts` entry mapping volume `tmp` to mount path `/tmp`.
- Added a PodSpec `volumes` definition declaring `tmp` as an ephemeral `emptyDir: {}`.

In `infra/helm/urumi-platform/values.yaml`:
- Updated `upstreams.woocommerce.securityContext.readOnlyRootFilesystem` default value from `false` to `true`.

### 3.3 Rendered Configuration Diff
```diff
--- /tmp/helm-test/before-mcp-deployment.yaml
+++ /tmp/helm-test/after-mcp-deployment.yaml
@@ -42,7 +42,7 @@
               protocol: TCP
           securityContext:
             allowPrivilegeEscalation: false
-            readOnlyRootFilesystem: false
+            readOnlyRootFilesystem: true
             capabilities:
               drop:
                 - ALL
+          volumeMounts:
+            - name: tmp
+              mountPath: /tmp
           env:
             - name: NODE_ENV
@@ -101,3 +104,6 @@
           resources:
             limits:
               cpu: 200m
+      volumes:
+        - name: tmp
+          emptyDir: {}
```

---

## 4. Workstream B — Disable Unnecessary API Token Automounting

### 4.1 Investigation Findings
1. **CRM Workload (`apps/mcp-crm`):** A standalone in-memory upstream MCP service implementing contact search and CRM lookups. It has zero interaction with the Kubernetes API server and requires no service-account token.
2. **Tasks Workload (`apps/mcp-tasks`):** A standalone in-memory upstream MCP service implementing task tracking. It has zero interaction with the Kubernetes API server and requires no service-account token.
3. **Gateway Workload (`apps/gateway`):** In contrast to CRM and Tasks, the Gateway legitimately manages Kubernetes Secrets for upstream credentials (under `urumi-gateway-secrets`) using its dedicated ServiceAccount (`urumi-gateway-sa`). Its token automounting was preserved.

### 4.2 Implemented Changes
In `infra/helm/urumi-platform/templates/crm-deployment.yaml`:
- Added `automountServiceAccountToken: false` under `spec.template.spec`.

In `infra/helm/urumi-platform/templates/tasks-deployment.yaml`:
- Added `automountServiceAccountToken: false` under `spec.template.spec`.

### 4.3 Rendered Configuration Verification
Both `values-local.yaml` and `values-prod.yaml` renderings confirmed that:
- `Deployment/urumi-mcp-crm` renders `spec.template.spec.automountServiceAccountToken: false`.
- `Deployment/urumi-mcp-tasks` renders `spec.template.spec.automountServiceAccountToken: false`.
- Existing labels, selectors, ports, liveness/readiness probes, and resource bounds remain completely intact.

---

## 5. Workstream C — INF-02 Requirements-Traceability Correction

### 5.1 Authoritative Requirement Definition
- **Requirement ID:** `INF-02`
- **Requirement Statement:** "Unified Helm chart deploying the entire platform."
- **Owning Component:** `infra/helm/urumi-platform`
- **Verification Criteria:** `helm lint` passes with 0 errors; `helm template` produces valid manifests.
- **Previous Traceability Status:** `Partial (Store Workloads Verified)`

### 5.2 Evidence Evaluation
1. **Chart Comprehensiveness:** The chart `infra/helm/urumi-platform` manages all platform workloads:
   - Gateway Deployment, Service, ServiceAccount, PVC
   - Upstream MCP Deployments & Services (WooCommerce MCP, CRM, Tasks)
   - Store Workloads (WordPress Deployment, MariaDB StatefulSet, Services, PVCs)
   - Network Policies (Ingress isolation, egress boundaries, database protection)
   - Ingress configuration with dual-profile support (`nip.io` local, custom domain prod)
2. **Lint & Manifest Validation:**
   - `helm lint infra/helm/urumi-platform -f values-local.yaml` -> **0 failures**.
   - `helm lint infra/helm/urumi-platform -f values-prod.yaml` -> **0 failures**.
   - `helm template` renders clean, valid Kubernetes resources for both profiles.
3. **Empirical Deployment Evidence:**
   - Active release `urumi-store` (revision 10, chart `urumi-platform-0.1.0`) running in namespace `urumi` on `k3d-urumi`.
   - All 6 workloads (`urumi-gateway`, `urumi-mariadb-0`, `urumi-mcp-crm`, `urumi-mcp-tasks`, `urumi-woocommerce-mcp`, `urumi-wordpress`) are currently 1/1 Running and Ready.
4. **Decision:** The requirement demands a unified Helm chart deploying the entire platform, verified by linting, rendering, and active runtime deployment. The empirical evidence fully satisfies this acceptance criteria. The status in `docs/requirements-traceability.md` was updated to:
   - **Status:** `Verified (Phases 4–7)`
   - **Evidence Reference:** Full documentation of multi-profile linting, rendering, and revision 10 runtime release with 6/6 healthy platform workloads.

---

## 6. Workstream D — Future Implementation-Ready Test Plans

### 6.1 P7-G3 Pod-Replacement Recovery Test Plan (Not Executed)

#### A. Objective & Authority
Demonstrate that the stateful `urumi-gateway` Deployment survives an unannounced pod deletion (controller-managed replacement), resumes healthy operation with a new Pod UID, reconnects to the existing PVC (`urumi-gateway-pvc`), and preserves SQLite database integrity and table counts without human intervention or data loss.

> [!WARNING]
> **Execution Status: UNAUTHORIZED in P7-G1.**  
> This plan is prepared for Gate P7-G3. It must not be executed without explicit Technical Head authorization for Gate P7-G3.

#### B. Preconditions & Approvals
1. Formal Technical Head approval for Gate P7-G3.
2. Verified cluster context: `k3d-urumi`, namespace: `urumi`.
3. Gateway Deployment: `urumi-gateway`, Helm release: `urumi-store` (Revision 10).
4. No concurrent administrative operations or database migrations.

#### C. Read-Only Pre-Test Baseline
Before initiating pod deletion, record the following baseline metrics:
```bash
# 1. Identify active Gateway Pod Name and UID
export ORIG_POD=$(kubectl get pod -n urumi -l app.kubernetes.io/name=gateway -o jsonpath='{.items[0].metadata.name}')
export ORIG_UID=$(kubectl get pod -n urumi $ORIG_POD -o jsonpath='{.metadata.uid}')
export PVC_NAME=$(kubectl get pvc -n urumi -l app.kubernetes.io/name=gateway -o jsonpath='{.items[0].metadata.name}')
export VOLUME_NAME=$(kubectl get pvc -n urumi $PVC_NAME -o jsonpath='{.spec.volumeName}')

echo "Original Pod: $ORIG_POD (UID: $ORIG_UID)"
echo "Bound PVC: $PVC_NAME -> Volume: $VOLUME_NAME"

# 2. Capture Pre-Test SQLite Database Integrity & Row Counts
kubectl exec -n urumi $ORIG_POD -- node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/gateway.db', { readOnly: true });
  console.log('PRE_INTEGRITY:', db.prepare('PRAGMA integrity_check;').get());
  console.log('PRE_FK_CHECK:', db.prepare('PRAGMA foreign_key_check;').all());
  const tables = ['schema_migrations', 'upstreams', 'users', 'user_credentials', 'api_keys', 'user_invitations', 'browser_sessions', 'audit_logs'];
  const counts = {};
  for (const t of tables) {
    counts[t] = db.prepare('SELECT COUNT(*) as c FROM ' + t).get().c;
  }
  console.log('PRE_COUNTS:', JSON.stringify(counts));
  db.close();
"

# 3. Capture Protected Store State (Products 10, 11, 12 and Order #14)
kubectl exec -n urumi deployment/urumi-wordpress -- php /var/www/html/wp-cli.phar wc product list --user=1 --fields=id,sku,price,status --allow-root
kubectl exec -n urumi deployment/urumi-wordpress -- php /var/www/html/wp-cli.phar wc shop_order get 14 --user=1 --fields=id,status,total,currency --allow-root
```

#### D. Controlled Pod Replacement Procedure
```bash
# 1. Initiate controlled controller-managed pod termination
kubectl delete pod $ORIG_POD -n urumi --grace-period=30

# 2. Wait for Deployment controller to schedule and ready the replacement pod
kubectl rollout status deployment/urumi-gateway -n urumi --timeout=90s

# 3. Identify replacement Pod Name and verify new UID
export NEW_POD=$(kubectl get pod -n urumi -l app.kubernetes.io/name=gateway -o jsonpath='{.items[0].metadata.name}')
export NEW_UID=$(kubectl get pod -n urumi $NEW_POD -o jsonpath='{.metadata.uid}')

if [ "$ORIG_UID" == "$NEW_UID" ]; then
  echo "CRITICAL FAILURE: Pod UID did not change!"
  exit 1
else
  echo "SUCCESS: Pod replaced. Old UID: $ORIG_UID -> New UID: $NEW_UID"
fi
```

#### E. Post-Replacement Verification Criteria
1. **Liveness & Readiness Check:**
   ```bash
   kubectl exec -n urumi $NEW_POD -- wget -qO- http://127.0.0.1:3000/healthz
   # Expected response: 200 OK {"status":"ok"}
   ```
2. **PVC Persistence & SQLite Database Verification:**
   ```bash
   kubectl exec -n urumi $NEW_POD -- node -e "
     const { DatabaseSync } = require('node:sqlite');
     const db = new DatabaseSync('/data/gateway.db', { readOnly: true });
     const integrity = db.prepare('PRAGMA integrity_check;').get();
     const fk = db.prepare('PRAGMA foreign_key_check;').all();
     console.log('POST_INTEGRITY:', integrity);
     console.log('POST_FK_CHECK:', fk);
     if (integrity.integrity_check !== 'ok' || fk.length > 0) {
       console.error('INTEGRITY FAILURE DETECTED');
       process.exit(1);
     }
     const tables = ['schema_migrations', 'upstreams', 'users', 'user_credentials', 'api_keys', 'user_invitations', 'browser_sessions', 'audit_logs'];
     const counts = {};
     for (const t of tables) {
       counts[t] = db.prepare('SELECT COUNT(*) as c FROM ' + t).get().c;
     }
     console.log('POST_COUNTS:', JSON.stringify(counts));
     db.close();
   "
   ```
   *Pass Criteria:* Post-replacement counts match pre-test counts exactly (or increment audit logs by expected health check events only). Zero data loss across `users`, `api_keys`, and `upstreams`.
3. **Protected Store Invariant Check:**
   Verify Product IDs 10, 11, 12 and Order #14 remain unmodified.

#### F. Stop & Rollback Conditions
- If the replacement pod fails to achieve `1/1 Ready` within 90 seconds.
- If SQLite reports any corruption or foreign-key violations.
- If any table count decreases.
- If PVC volume binding shifts or fails to mount.

---

### 6.2 P7-G5 Regression Qualification Plan (Not Executed)

#### A. Objective
Execute a comprehensive, deterministic regression qualification suite covering all gateway subsystems, MCP protocol contracts, web dashboard assets, security boundaries, and store invariants.

> [!WARNING]
> **Execution Status: UNAUTHORIZED in P7-G1.**  
> This plan specifies canonical test execution for Gate P7-G5.

#### B. Execution Matrix & Canonical Commands
All Node.js suites must execute explicitly using Node v24 LTS:
`export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"`

| Subsystem / Test Suite | Canonical Command | Execution Type | Target Environment | Required Evidence / Pass Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **Gateway Typecheck** | `npm run typecheck --prefix apps/gateway` | Read-Only | Workspace files | Clean exit (code 0), 0 TypeScript errors |
| **Gateway Unit Tests** | `npm run test:unit --prefix apps/gateway` | Read-Only (In-memory mock DB) | Disposable in-memory SQLite | 51 suites, 351 tests passing, 0 failures |
| **WooCommerce MCP Unit & Protocol** | `npm run test:unit --prefix apps/woocommerce-mcp && npm run test:protocol --prefix apps/woocommerce-mcp` | Read-Only | Mock upstream HTTP fixtures | 7 suites, 35 tests passing, 0 failures |
| **Dashboard Build** | `npm run build --prefix apps/dashboard` | Read-Only (Asset compilation) | Workspace files | Vite bundles SPA into `apps/dashboard/dist/` (code 0) |
| **Protocol: Browser Chat Stream** | `npx tsx --test apps/gateway/test/protocol/browser-chat.test.ts` | Read-Only mock transport | Local disposable fixture | SSE stream tokens, tool calls, complete events verified |
| **Protocol: Tool Execution & Confirmation** | `npx tsx --test apps/gateway/test/protocol/tool-call.test.ts` | Read-Only mock transport | Local disposable fixture | Safe tools execute immediately; mutating require confirmation |
| **Auth Perimeter Separation** | `npx tsx --test apps/gateway/test/unit/browser-auth-perimeter.test.ts` | Read-Only | In-memory auth state | Strict isolation: browser session rejected on MCP SSE; API keys rejected on web endpoints |
| **Key Revocation & Lifecycle** | `npx tsx --test apps/gateway/test/unit/api-key-lifecycle.test.ts` | Read-Only | In-memory SQLite fixture | Revoked keys immediately return 401; active keys authenticate |
| **Audit Scrubbing & PII Redaction** | `npx tsx --test apps/gateway/test/unit/audit-query.test.ts` | Read-Only | In-memory SQLite fixture | Customer PII redacted from tool outputs; auth tokens scrubbed from logs |
| **Helm Profile Rendering** | `helm template urumi-platform infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml && helm template urumi-platform infra/helm/urumi-platform -f infra/helm/urumi-platform/values-prod.yaml` | Read-Only | Helm templates | Valid Kubernetes manifests for local and prod profiles |
| **Protected Store Baseline** | `kubectl exec -n urumi deployment/urumi-wordpress -- php /var/www/html/wp-cli.phar wc product list --user=1 --fields=id,sku --allow-root` | Read-Only | Live cluster (`urumi`) | Exactly Products 10, 11, 12 exist; exactly Order #14 exists; 0 test artifacts |
| **Live SQLite Integrity Check** | `kubectl exec -n urumi deployment/urumi-gateway -- node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/data/gateway.db', { readOnly: true }); console.log(db.prepare('PRAGMA integrity_check;').get());"` | Read-Only | Live cluster (`urumi`) | Returns `{ integrity_check: 'ok' }` |

---

## 7. Verification Tests Executed & Empirical Results

The following safe, read-only checks were performed during Gate P7-G1:

### 7.1 Helm Chart Linting
```bash
helm lint infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml
helm lint infra/helm/urumi-platform -f infra/helm/urumi-platform/values-prod.yaml
```
**Result:**
```text
==> Linting infra/helm/urumi-platform
[INFO] Chart.yaml: icon is recommended
1 chart(s) linted, 0 chart(s) failed

==> Linting infra/helm/urumi-platform
[INFO] Chart.yaml: icon is recommended
1 chart(s) linted, 0 chart(s) failed
```

### 7.2 Rendered PodSpec Inspection
```bash
python3 -c "
import yaml
for env, path in [('local', '/tmp/helm-test/local-rendered.yaml'), ('prod', '/tmp/helm-test/prod-rendered.yaml')]:
    print(f'=== {env.upper()} ===')
    with open(path) as f:
        docs = list(yaml.safe_load_all(f))
    for doc in docs:
        if not doc or doc.get('kind') != 'Deployment': continue
        name = doc['metadata']['name']
        if name in ['urumi-woocommerce-mcp', 'urumi-mcp-crm', 'urumi-mcp-tasks', 'urumi-gateway']:
            spec = doc['spec']['template']['spec']
            print(f'Deployment: {name}')
            print(f'  automountServiceAccountToken: {spec.get(\"automountServiceAccountToken\")}')
            print(f'  container: {spec[\"containers\"][0][\"name\"]}')
            print(f'    readOnlyRootFilesystem: {spec[\"containers\"][0].get(\"securityContext\", {}).get(\"readOnlyRootFilesystem\")}')
            print(f'    volumeMounts: {spec[\"containers\"][0].get(\"volumeMounts\")}')
"
```
**Result:**
```text
=== LOCAL ===
Deployment: urumi-mcp-crm
  automountServiceAccountToken: False
  container: mcp-crm
    readOnlyRootFilesystem: True
    volumeMounts: [{'name': 'tmp', 'mountPath': '/tmp'}]
Deployment: urumi-gateway
  automountServiceAccountToken: None
  container: gateway
    readOnlyRootFilesystem: True
    volumeMounts: [{'name': 'gateway-data', 'mountPath': '/data'}, {'name': 'tmp', 'mountPath': '/tmp'}]
Deployment: urumi-woocommerce-mcp
  automountServiceAccountToken: None
  container: woocommerce-mcp
    readOnlyRootFilesystem: True
    volumeMounts: [{'name': 'tmp', 'mountPath': '/tmp'}]
Deployment: urumi-mcp-tasks
  automountServiceAccountToken: False
  container: mcp-tasks
    readOnlyRootFilesystem: True
    volumeMounts: [{'name': 'tmp', 'mountPath': '/tmp'}]
=== PROD ===
Deployment: urumi-mcp-crm
  automountServiceAccountToken: False
  container: mcp-crm
    readOnlyRootFilesystem: True
    volumeMounts: [{'name': 'tmp', 'mountPath': '/tmp'}]
Deployment: urumi-gateway
  automountServiceAccountToken: None
  container: gateway
    readOnlyRootFilesystem: True
    volumeMounts: [{'name': 'gateway-data', 'mountPath': '/data'}, {'name': 'tmp', 'mountPath': '/tmp'}]
Deployment: urumi-woocommerce-mcp
  automountServiceAccountToken: None
  container: woocommerce-mcp
    readOnlyRootFilesystem: True
    volumeMounts: [{'name': 'tmp', 'mountPath': '/tmp'}]
Deployment: urumi-mcp-tasks
  automountServiceAccountToken: False
  container: mcp-tasks
    readOnlyRootFilesystem: True
    volumeMounts: [{'name': 'tmp', 'mountPath': '/tmp'}]
```

### 7.3 Workspace Compilation & Unit Test Suites
```bash
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"
npm run typecheck --prefix apps/gateway
npm run typecheck --prefix apps/woocommerce-mcp
npm run build --prefix apps/dashboard
npm run test:unit --prefix apps/woocommerce-mcp
npm run test:protocol --prefix apps/woocommerce-mcp
npm run test:unit --prefix apps/gateway
```
**Results:**
- `apps/gateway` Typecheck: Clean (0 errors).
- `apps/woocommerce-mcp` Typecheck: Clean (0 errors).
- `apps/dashboard` Production Build: Built successfully in 3.89s (`dist/` generated).
- `apps/woocommerce-mcp` Unit & Protocol Tests: 35 passing, 0 failures.
- `apps/gateway` Unit Tests: 351 passing across 51 test suites, 0 failures.

---

## 8. Summary of Changed Files

| File Path | Description of Authorized Change |
| :--- | :--- |
| `infra/helm/urumi-platform/templates/mcp-deployment.yaml` | Hardened WooCommerce MCP container with `readOnlyRootFilesystem: true`, added `/tmp` volume mount and `emptyDir` volume. |
| `infra/helm/urumi-platform/values.yaml` | Updated default `upstreams.woocommerce.securityContext.readOnlyRootFilesystem` to `true`. |
| `infra/helm/urumi-platform/templates/crm-deployment.yaml` | Added `automountServiceAccountToken: false` under `spec.template.spec`. |
| `infra/helm/urumi-platform/templates/tasks-deployment.yaml` | Added `automountServiceAccountToken: false` under `spec.template.spec`. |
| `docs/requirements-traceability.md` | Reconciled Requirement `INF-02` from `Partial` to `Verified (Phases 4–7)` with empirical release evidence. |
| `docs/phase-7/p7-g1-targeted-hardening-report.md` | Authoritative Gate P7-G1 report containing evidence, rendered diffs, and future test plans. |
| `docs/phase-7/phase-7-execution-log.md` | Updated chronological execution timeline with Gate P7-G1 actions and results. |

---

## 9. Gate Boundary Sign-Off

All objectives authorized for Gate P7-G1 have been fully satisfied with zero scope expansion:
1. Container filesystem hardening and ServiceAccount token isolation verified across both Helm profiles.
2. Requirement INF-02 reconciled based on authoritative evidence.
3. Plans for P7-G3 and P7-G5 completed and documented.
4. Live cluster resources, Helm releases, running pods, database contents, and store records remain 100% unmutated.

**P7-G1 submitted for Technical Head review. P7-G2 and all live-cluster remediation or recovery testing remain unauthorized pending explicit approval.**
