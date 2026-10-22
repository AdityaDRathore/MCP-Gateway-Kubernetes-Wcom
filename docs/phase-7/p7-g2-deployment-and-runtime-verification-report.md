# Phase 7 — Gate P7-G2: Controlled Deployment & Runtime Hardening Verification Report

**Role:** Implementation Worker  
**Project:** Urumi AI FDE Assignment — Team MCP Gateway on Kubernetes  
**Authority:** Technical Head  
**Gate:** P7-G2  
**Status:** COMPLETE — SUBMITTED FOR TECHNICAL HEAD REVIEW  
**Execution Date:** October 22, 2026  
**Starting Commit SHA:** `81193bef317315129f37b145ae611e4cd980ffc5` (`81193be`)  
**Ending Commit SHA:** `81193bef317315129f37b145ae611e4cd980ffc5` (`81193be`)  
**Working-Tree Status:** Clean of tracked modifications (zero commits created or pushed)  
**Deployment Target:** Kubernetes (`k3d-urumi`), Namespace: `urumi`  
**Helm Release:** `urumi-store` (Upgraded from Revision 10 to Revision 11, Chart `urumi-platform-0.1.0`)

---

## 1. Executive Summary & Scope Compliance

Under the strict boundaries authorized by the Technical Head for Gate P7-G2, the targeted container hardening changes reviewed in Gate P7-G1 were deployed to the existing local Kubernetes cluster (`k3d-urumi`) and verified at runtime:

1. **WooCommerce MCP Filesystem Hardening:** Enforced `readOnlyRootFilesystem: true` in the running container and mounted `/tmp` from an ephemeral `emptyDir` volume. Empirically demonstrated at runtime that the root overlay filesystem is mounted read-only (`ro`), root and application write attempts are denied by the kernel (`Read-only file system`, EROFS), while `/tmp` remains fully writable by non-root user `mcpuser` (`10001:10001`).
2. **CRM MCP ServiceAccount Token Isolation:** Set `automountServiceAccountToken: false` at the PodSpec level. Empirically confirmed at runtime that the projected Kubernetes API token volume mount (`/var/run/secrets/kubernetes.io/serviceaccount`) is absent from the PodSpec and does not exist in the container filesystem.
3. **Tasks MCP ServiceAccount Token Isolation:** Set `automountServiceAccountToken: false` at the PodSpec level. Empirically confirmed at runtime that the projected Kubernetes API token volume mount (`/var/run/secrets/kubernetes.io/serviceaccount`) is absent from the PodSpec and does not exist in the container filesystem.
4. **Gateway Identity & Invariant Preservation:** The Gateway Deployment (`urumi-gateway`) was preserved without restart or configuration drift. Its dedicated ServiceAccount (`urumi-gateway-sa`), token automount, and RBAC bindings to namespace `urumi-gateway-secrets` were 100% preserved.
5. **Data & Workload Preservation:** Zero mutations were applied to persistent data. Gateway SQLite integrity checks and foreign key checks passed with 0 violations; table row counts remained completely identical to the baseline. Protected WooCommerce Product IDs 10, 11, and 12 and Order #14 remained completely unmutated. All 3 PVCs remained `Bound` on `local-path`.

### Gate Boundary Adherence:
- **Zero Scope Expansion:** Did not alter NetworkPolicies, Services, Ingress, Gateway application code, browser authentication, API keys, or Secrets.
- **Zero Store/Database Mutation:** WordPress, MariaDB, PVC definitions, storage classes, and persistence settings were completely untouched.
- **Zero Destructive Actions:** No PVC was deleted, no database recreated, and no manual pod deletions were performed.
- **P7-G3 Boundary Maintained:** Pod-replacement recovery testing remains unauthorized and was not executed.

---

## 2. Preflight Baseline & Environment Inspection (Stage A)

Prior to initiating deployment, a comprehensive baseline was captured across all infrastructure and data planes:

### 2.1 Repository & Toolchain Identity
- **Branch:** `main`
- **HEAD Commit SHA:** `81193bef317315129f37b145ae611e4cd980ffc5` (`81193be`)
- **P7-G1 Commit Status:** Present as current HEAD commit (`feat(infra): complete Phase 7 Gate P7-G1 targeted container hardening and remediation`).
- **Working Tree:** Tracked files clean; untracked proposed planning package in `Context/phase-7-planning-package/` and preflight reference in `Resource/implementation/`.
- **Node.js Runtime:** Node v24 LTS (`v24.20.0` at `/home/rathore/.nvm/versions/node/v24.20.0/bin/node`).

### 2.2 Kubernetes & Helm Release Status
- **Current Context:** `k3d-urumi`
- **Cluster Control Plane:** `https://0.0.0.0:37823` (`k3d-urumi-server-0` at `172.19.0.2`)
- **Target Namespace:** `urumi`
- **Helm Release:** `urumi-store`
- **Pre-Upgrade Revision:** 10 (Updated: `Wed Oct 21 18:16:20 2026`, Status: `deployed`, Chart: `urumi-platform-0.1.0`, App Version: `1.0.0`)

### 2.3 Pre-Upgrade Workload Baseline (All Six Workloads)

| Workload Name | Component | Pre-Upgrade Pod Name | Pre-Upgrade Pod UID | Image Reference | Ready | Restarts | Status |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| `urumi-gateway` | gateway | `urumi-gateway-6d56bd4644-5gmxb` | `eaa47adc-1744-4e9a-889c-26786e132e62` | `urumi-gateway:1.0.0` | 1/1 | 1 | Running |
| `urumi-mariadb` | mariadb | `urumi-mariadb-0` | `e0d6929c-7e63-4993-8362-827d372a8572` | `mariadb:11.4.5@sha256:49117dcc565...` | 1/1 | 1 | Running |
| `urumi-mcp-crm` | mcp-crm | `urumi-mcp-crm-6b6ccc5769-6pvfn` | `2bce4429-afdd-49ac-9399-069c9a853c5e` | `mcp-crm:1.0.0` | 1/1 | 1 | Running |
| `urumi-mcp-tasks` | mcp-tasks | `urumi-mcp-tasks-b7bdc9c5f-r8mhb` | `576d50ea-bfd3-4764-b3c0-17c78546c8c4` | `mcp-tasks:1.0.0` | 1/1 | 1 | Running |
| `urumi-woocommerce-mcp` | mcp-woocommerce | `urumi-woocommerce-mcp-69dc88fbcb-bj8pv` | `ababb14d-4b5a-49d0-948c-a470b7d30cb4` | `urumi-woocommerce-mcp:1.0.0` | 1/1 | 1 | Running |
| `urumi-wordpress` | wordpress | `urumi-wordpress-d994966c6-qfx6x` | `cfb0248d-f171-4bdf-8a19-66e1557f1cc1` | `wordpress:7.1.3-php8.3-apache@sha256:...` | 1/1 | 1 | Running |

### 2.4 Pre-Upgrade PodSpec Inspection

- **WooCommerce MCP (`urumi-woocommerce-mcp`):**
  - `readOnlyRootFilesystem`: `false` (Defect identified in P7-G0)
  - `volumeMounts`: `['kube-api-access-qbdbz -> /var/run/secrets/kubernetes.io/serviceaccount']` (Zero `/tmp` mount)
  - `volumes`: `['kube-api-access-qbdbz']`
  - `automountServiceAccountToken`: `None` (Defaulted to true)
- **CRM MCP (`urumi-mcp-crm`):**
  - `automountServiceAccountToken`: `None` (Defaulted to true)
  - `volumeMounts`: `['tmp -> /tmp', 'kube-api-access-gscmd -> /var/run/secrets/kubernetes.io/serviceaccount']`
- **Tasks MCP (`urumi-mcp-tasks`):**
  - `automountServiceAccountToken`: `None` (Defaulted to true)
  - `volumeMounts`: `['tmp -> /tmp', 'kube-api-access-mp9wl -> /var/run/secrets/kubernetes.io/serviceaccount']`
- **Gateway (`urumi-gateway`):**
  - `serviceAccountName`: `urumi-gateway-sa`
  - `automountServiceAccountToken`: `None` (Mounts `kube-api-access-g4qd9 -> /var/run/secrets/kubernetes.io/serviceaccount`)
  - `readOnlyRootFilesystem`: `true`
  - `volumeMounts`: `['gateway-data -> /data', 'tmp -> /tmp', 'kube-api-access-g4qd9 -> /var/run/secrets/kubernetes.io/serviceaccount']`

### 2.5 Persistent Volume Claims Baseline

| PVC Name | Status | Bound Volume Name | Capacity | Access Mode | StorageClass | VolumeMode |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| `urumi-gateway-pvc` | Bound | `pvc-801dc6cb-076b-479a-8475-e77c905797f9` | 500Mi | RWO | `local-path` | Filesystem |
| `urumi-mariadb-pvc` | Bound | `pvc-58d7357d-5671-476d-904a-cda0a12cf269` | 1Gi | RWO | `local-path` | Filesystem |
| `urumi-wordpress-pvc` | Bound | `pvc-78d0d23b-59fe-4c82-be1e-687d9c40fd6f` | 1Gi | RWO | `local-path` | Filesystem |

### 2.6 Gateway SQLite Integrity Baseline

Executed read-only verification inside container `gateway`:
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
**Pre-Upgrade Baseline Result:**
- `PRAGMA integrity_check`: `[Object: null prototype] { integrity_check: 'ok' }`
- `PRAGMA foreign_key_check`: `[]` (0 violations)
- Row counts: `{"schema_migrations":3,"upstreams":3,"users":4,"user_credentials":4,"api_keys":27,"user_invitations":4,"browser_sessions":27,"audit_logs":483}`

### 2.7 Protected Store Baseline (Products 10–12 and Order #14)

Executed via WP-CLI with customer PII strictly omitted:
```bash
# Products 10, 11, 12
kubectl exec -n urumi deployment/urumi-wordpress -- php /var/www/html/wp-cli.phar wc product list --user=1 --fields=id,name,sku,price,regular_price,status --allow-root

# Order #14
kubectl exec -n urumi deployment/urumi-wordpress -- php /var/www/html/wp-cli.phar wc shop_order get 14 --user=1 --fields=id,status,total,currency,date_created,payment_method --allow-root
```
**Pre-Upgrade Baseline Result:**
- Product 10: `Urumi Test Mug`, SKU `URUMI-MUG-001`, Price `299`, Regular Price `299`, Status `publish`
- Product 11: `Wireless Mouse Demo`, SKU `URUMI-MOUSE-001`, Price `799`, Regular Price `799`, Status `publish`
- Product 12: `Notebook Demo`, SKU `URUMI-NOTE-001`, Price `149`, Regular Price `149`, Status `publish`
- Order #14: ID `14`, Status `processing`, Total `299.00`, Currency `INR`, Date Created `2026-10-11T18:23:04`, Payment Method `cod`

### 2.8 Gateway ServiceAccount & RBAC Baseline
- ServiceAccount `urumi-gateway-sa` exists in namespace `urumi` (UID `041a0ed0-2b85-41aa-bf8a-6cf84f229b81`).
- Role `urumi-gateway-secret-manager` exists in namespace `urumi-gateway-secrets` granting `["get", "list", "create", "update", "delete"]` on `secrets`.
- RoleBinding `urumi-gateway-secret-binding` exists in namespace `urumi-gateway-secrets` binding `ServiceAccount/urumi-gateway-sa` (namespace `urumi`) to Role `urumi-gateway-secret-manager`.

---

## 3. Proposed Upgrade Verification & Rendered Diff Review (Stage B)

### 3.1 Helm Chart Linting
Both local and production values profiles were linted:
```bash
helm lint infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml
helm lint infra/helm/urumi-platform -f infra/helm/urumi-platform/values-prod.yaml
```
- **Local Profile Result:** `1 chart(s) linted, 0 chart(s) failed` (0 errors).
- **Prod Profile Result:** `1 chart(s) linted, 0 chart(s) failed` (0 errors).

### 3.2 Values Analysis & Upgrade Strategy
Inspection of live release Revision 10 values (`helm get values urumi-store -n urumi`) revealed that Revision 10 was deployed using user-supplied values that inherit `gateway.trustedProxies` directly from `values.yaml` (`"127.0.0.1,::1,10.42.0.0/16,10.43.0.0/16,172.19.0.0/16"`).

To strictly adhere to the technical mandate that **only the three intended PodSpecs change and no unintended Gateway configuration drift or rollout occurs**, the deployment was executed with `--reuse-values`:
`helm upgrade urumi-store infra/helm/urumi-platform -n urumi --reuse-values`

### 3.3 Rendered Manifest Comparison (Pre-Deployment Diff)

A strict resource-by-resource diff was generated between the active deployed manifests (`helm get manifest urumi-store -n urumi`, 28 resources) and the dry-run output of the proposed upgrade:

```text
Total resources: Current=28, Target=28

--- curr/Deployment/urumi-mcp-crm
+++ target/Deployment/urumi-mcp-crm
@@ -28,6 +28,7 @@
         app.kubernetes.io/instance: urumi-store
         app.kubernetes.io/name: urumi-platform
     spec:
+      automountServiceAccountToken: false
       containers:
       - env:
         - name: NODE_ENV

--- curr/Deployment/urumi-mcp-tasks
+++ target/Deployment/urumi-mcp-tasks
@@ -28,6 +28,7 @@
         app.kubernetes.io/instance: urumi-store
         app.kubernetes.io/name: urumi-platform
     spec:
+      automountServiceAccountToken: false
       containers:
       - env:
         - name: NODE_ENV

--- curr/Deployment/urumi-woocommerce-mcp
+++ target/Deployment/urumi-woocommerce-mcp
@@ -89,7 +89,7 @@
           capabilities:
             drop:
             - ALL
-          readOnlyRootFilesystem: false
+          readOnlyRootFilesystem: true
         startupProbe:
           failureThreshold: 10
           httpGet:
@@ -98,6 +98,9 @@
           initialDelaySeconds: 2
           periodSeconds: 3
           timeoutSeconds: 2
+        volumeMounts:
+        - mountPath: /tmp
+          name: tmp
       securityContext:
         runAsGroup: 10001
         runAsNonRoot: true
@@ -105,3 +108,6 @@
         seccompProfile:
           type: RuntimeDefault
       terminationGracePeriodSeconds: 30
+      volumes:
+      - emptyDir: {}
+        name: tmp

Total changed resources in dryrun: 3
```

### 3.4 Invariant Pre-Deployment Affirmation:
- Exactly 3 resources modified across all 28 Kubernetes objects.
- `urumi-gateway` Deployment: **0 changes**.
- `urumi-wordpress` Deployment: **0 changes**.
- `urumi-mariadb` StatefulSet: **0 changes**.
- All PVCs (`gateway`, `mariadb`, `wordpress`): **0 changes**.
- All Services, Ingress, NetworkPolicies, ServiceAccounts, and RBAC roles: **0 changes**.
- Image references, environment variables, credentials, and persistence settings: **0 changes**.

---

## 4. Controlled Deployment Execution (Stage C)

### 4.1 Deployment Command
```bash
helm upgrade urumi-store infra/helm/urumi-platform -n urumi --reuse-values
```
- **Exit Status:** 0
- **Helm Output:**
  ```text
  Release "urumi-store" has been upgraded. Happy Helming!
  NAME: urumi-store
  LAST DEPLOYED: Thu Oct 22 22:15:13 2026
  NAMESPACE: urumi
  STATUS: deployed
  REVISION: 11
  TEST SUITE: None
  ```

### 4.2 Rollout Tracking & Completion
Monitored rollout completion across the three target workloads:
```bash
kubectl rollout status deployment/urumi-woocommerce-mcp -n urumi --timeout=90s
kubectl rollout status deployment/urumi-mcp-crm -n urumi --timeout=90s
kubectl rollout status deployment/urumi-mcp-tasks -n urumi --timeout=90s
```
- **`urumi-woocommerce-mcp`:** Successfully rolled out (old replica terminated, new replica ready).
- **`urumi-mcp-crm`:** Successfully rolled out.
- **`urumi-mcp-tasks`:** Successfully rolled out.

### 4.3 Workload Identity & Pod Transition Matrix

| Workload Name | Component | Pre-Upgrade Pod UID | Post-Upgrade Pod UID | UID Transition Status | Restart Count | Ready State |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| `urumi-gateway` | gateway | `eaa47adc-1744-4e9a-889c-26786e132e62` | `eaa47adc-1744-4e9a-889c-26786e132e62` | **Unchanged (Preserved)** | 1 | 1/1 Running |
| `urumi-mariadb` | mariadb | `e0d6929c-7e63-4993-8362-827d372a8572` | `e0d6929c-7e63-4993-8362-827d372a8572` | **Unchanged (Preserved)** | 1 | 1/1 Running |
| `urumi-wordpress` | wordpress | `cfb0248d-f171-4bdf-8a19-66e1557f1cc1` | `cfb0248d-f171-4bdf-8a19-66e1557f1cc1` | **Unchanged (Preserved)** | 1 | 1/1 Running |
| `urumi-woocommerce-mcp` | mcp-woocommerce | `ababb14d-4b5a-49d0-948c-a470b7d30cb4` | `3502b258-3038-4db5-a8e9-553413c55348` | **Rolled Out (New UID)** | 0 | 1/1 Running |
| `urumi-mcp-crm` | mcp-crm | `2bce4429-afdd-49ac-9399-069c9a853c5e` | `2cc485e1-7436-44c8-8133-c62bdfcd888c` | **Rolled Out (New UID)** | 0 | 1/1 Running |
| `urumi-mcp-tasks` | mcp-tasks | `576d50ea-bfd3-4764-b3c0-17c78546c8c4` | `25e0981f-5a09-4a1c-b8c3-fa4f81d00e31` | **Rolled Out (New UID)** | 0 | 1/1 Running |

All 6 workloads returned to healthy, 1/1 Running & Ready status immediately following rollout completion.

---

## 5. Runtime Security Verification (Stage D)

### 5.1 Workstream D1: WooCommerce MCP Filesystem Hardening Verification

#### A. PodSpec & Security Context Verification
Inspection of the live pod `urumi-woocommerce-mcp-68dd5696d7-gr2kl`:
- **Pod UID:** `3502b258-3038-4db5-a8e9-553413c55348` (new UID confirmed)
- **Container Name:** `woocommerce-mcp`
- **Image:** `urumi-woocommerce-mcp:1.0.0`
- **`securityContext.readOnlyRootFilesystem`:** `true`
- **`securityContext.allowPrivilegeEscalation`:** `false`
- **`securityContext.capabilities.drop`:** `['ALL']`
- **`podSecurityContext.runAsUser`:** `10001`
- **`podSecurityContext.runAsGroup`:** `10001`
- **`podSecurityContext.runAsNonRoot`:** `true`
- **`podSecurityContext.seccompProfile`:** `{'type': 'RuntimeDefault'}`
- **Volume Mounts:** `tmp -> /tmp`
- **Pod Volumes:** `tmp: emptyDir: {}`

#### B. In-Container Process & Mount Telemetry
```bash
kubectl exec -n urumi deployment/urumi-woocommerce-mcp -- sh -c "id && grep -E '^(Cap|Seccomp)' /proc/1/status && cat /proc/mounts | grep -E '(overlay|/tmp)'"
```
**Empirical Output:**
```text
uid=10001(mcpuser) gid=10001(mcpuser) groups=10001(mcpuser)
CapInh:	0000000000000000
CapPrm:	0000000000000000
CapEff:	0000000000000000
CapBnd:	0000000000000000
CapAmb:	0000000000000000
Seccomp:	2
Seccomp_filters:	1
overlay / overlay ro,relatime,lowerdir=...
/dev/sda5 /tmp ext4 rw,relatime 0 0
```
- Root filesystem is explicitly mounted **`ro`** (read-only).
- `/tmp` is explicitly mounted as an isolated **`rw`** filesystem backed by `emptyDir`.

#### C. Non-Destructive Filesystem Write Probes
```bash
kubectl exec -n urumi deployment/urumi-woocommerce-mcp -- sh -c "
  (touch /test-root 2>&1 && rm -f /test-root) || true
  (touch /app/test-app 2>&1 && rm -f /app/test-app) || true
  (touch /tmp/test-tmp && rm /tmp/test-tmp && echo 'SUCCESS: /tmp is writable by non-root mcpuser') || echo 'FAILURE'
"
```
**Empirical Output:**
```text
touch: /test-root: Read-only file system
touch: /app/test-app: Read-only file system
SUCCESS: /tmp is writable by non-root mcpuser
```
- Kernel actively denies writes to `/` and `/app` with `EROFS` (`Read-only file system`).
- `/tmp` is fully writable and cleanable by unprivileged user `10001:10001`.

#### D. Health & Protocol Smoke Tests
- Health probe: `wget -qO- http://127.0.0.1:3000/health`
  - Result: `HTTP/1.1 200 OK` -> `{"status":"ok","service":"urumi-woocommerce-mcp","transport":"Streamable HTTP",...}`
- Read-only protocol smoke test: Dispatched `list_products` from Gateway over Streamable HTTP:
  - Result: HTTP 200 OK; successfully returned catalog containing Product 12 (`Notebook Demo`) without error or disk mutation.

---

### 5.2 Workstream D2: CRM & Tasks Token Isolation Verification

#### A. PodSpec & Volume Mount Inspection
Inspected live PodSpecs for `urumi-mcp-crm-7fc69678df-6qm5k` and `urumi-mcp-tasks-86964f8b95-thjmj`:

| Workload | Live Pod Name | Live Pod UID | `automountServiceAccountToken` | Container `volumeMounts` | Pod `volumes` |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **CRM MCP** | `urumi-mcp-crm-7fc69678df-6qm5k` | `2cc485e1-7436-44c8-8133-c62bdfcd888c` | **`False`** | `['tmp -> /tmp']` | `['tmp']` |
| **Tasks MCP** | `urumi-mcp-tasks-86964f8b95-thjmj` | `25e0981f-5a09-4a1c-b8c3-fa4f81d00e31` | **`False`** | `['tmp -> /tmp']` | `['tmp']` |

The standard projected volume `kube-api-access-*` was completely eliminated from both PodSpecs.

#### B. In-Container Token Path Absence Probes
```bash
kubectl exec -n urumi deployment/urumi-mcp-crm -- sh -c "ls -la /var/run/secrets/kubernetes.io/serviceaccount 2>&1 || echo 'TOKEN MOUNT ABSENT'"
kubectl exec -n urumi deployment/urumi-mcp-tasks -- sh -c "ls -la /var/run/secrets/kubernetes.io/serviceaccount 2>&1 || echo 'TOKEN MOUNT ABSENT'"
```
**Empirical Output:**
```text
ls: /var/run/secrets/kubernetes.io/serviceaccount: No such file or directory
TOKEN MOUNT ABSENT
ls: /var/run/secrets/kubernetes.io/serviceaccount: No such file or directory
TOKEN MOUNT ABSENT
```
Zero Kubernetes API credentials or ServiceAccount tokens exist inside either container filesystem.

#### C. Service Health & Upstream Functionality
- `crm` Health Probe: `http://127.0.0.1:3000/health` -> `HTTP 200 OK` (`{"status":"ok","service":"urumi-mcp-crm",...}`)
- `tasks` Health Probe: `http://127.0.0.1:3000/health` -> `HTTP 200 OK` (`{"status":"ok","service":"urumi-mcp-tasks",...}`)
- Upstream MCP Tool Discovery:
  - CRM discovered 2 tools: `search_contacts`, `get_contact`.
  - Tasks discovered 3 tools: `create_task`, `list_tasks`, `update_task_status`.
- Tool Execution Smoke Test: `search_contacts` executed successfully via Gateway client transport returning `{"content":[{"type":"text","text":"[]"}]}` with exit code 0.

---

### 5.3 Workstream D3: Gateway Identity & RBAC Preservation

Inspected live pod `urumi-gateway-6d56bd4644-5gmxb`:
- **Pod UID:** `eaa47adc-1744-4e9a-889c-26786e132e62` (Identical to preflight baseline; zero restarts during rollout).
- **ServiceAccount:** `urumi-gateway-sa` (Preserved).
- **ServiceAccount Token Mount:** `/var/run/secrets/kubernetes.io/serviceaccount` backed by `kube-api-access-g4qd9` (Preserved).
- **Filesystem Hardening:** `readOnlyRootFilesystem: true`, volume mounts `gateway-data -> /data` and `tmp -> /tmp` (Preserved).
- **RBAC Role & Binding:** `Role/urumi-gateway-secret-manager` and `RoleBinding/urumi-gateway-secret-binding` in namespace `urumi-gateway-secrets` remain active and bound to `urumi-gateway-sa`.
- **Health Probes:**
  - `http://127.0.0.1:3000/health/ready` -> `{"status":"ok","service":"urumi-gateway","ready":true}`
  - `http://127.0.0.1:3000/health/live` -> `{"status":"ok","service":"urumi-gateway","live":true}`

---

## 6. Post-Deployment Regression & Preservation Checks (Stage E)

### 6.1 Executed Test Matrix

All test suites were executed under Node v24 LTS (`v24.20.0`):

| Test Suite / Scope | Exact Command | Environment | Exit Code | Verified Outcome / Pass Criteria |
| :--- | :--- | :--- | :---: | :--- |
| **WooCommerce MCP Unit Tests** | `npm run test:unit --prefix apps/woocommerce-mcp` | Local Node v24 | 0 | 17 unit tests passing across 4 suites, 0 failures. |
| **WooCommerce MCP Protocol Tests** | `npm run test:protocol --prefix apps/woocommerce-mcp` | Local Node v24 | 0 | 18 protocol tests passing across 3 suites, 0 failures. |
| **Gateway Typecheck** | `npm run typecheck --prefix apps/gateway` | Local Node v24 | 0 | Clean TypeScript compilation, 0 type errors. |
| **WooCommerce MCP Typecheck** | `npm run typecheck --prefix apps/woocommerce-mcp` | Local Node v24 | 0 | Clean TypeScript compilation, 0 type errors. |
| **Dashboard SPA Production Build** | `npm run build --prefix apps/dashboard` | Local Node v24 | 0 | Vite built production bundle in 2.30s (`dist/` generated). |
| **Gateway Unit Tests** | `npm run test:unit --prefix apps/gateway` | Local Node v24 | 0 | 351 unit tests passing across 51 test suites, 0 failures. |
| **Gateway Security Perimeter Tests** | `npx tsx --test test/unit/browser-auth-perimeter.test.ts` (in `apps/gateway`) | Local Node v24 | 0 | 10/10 tests passing: dual listener isolation, CSRF, origin check. |
| **API Key Lifecycle & Auth Tests** | `npx tsx --test test/unit/api-key-lifecycle.test.ts` (in `apps/gateway`) | Local Node v24 | 0 | 7/7 tests passing: constant-time compare, immediate revocation. |
| **Audit Query & Bounded Pagination** | `npx tsx --test test/unit/audit-query.test.ts` (in `apps/gateway`) | Local Node v24 | 0 | 9/9 tests passing: bounds, batch username resolve, no table scans. |
| **Helm Chart Lint (Local Profile)** | `helm lint infra/helm/urumi-platform -f values-local.yaml` | Host Helm CLI | 0 | 1 chart linted, 0 failed. |
| **Helm Chart Lint (Prod Profile)** | `helm lint infra/helm/urumi-platform -f values-prod.yaml` | Host Helm CLI | 0 | 1 chart linted, 0 failed. |
| **Live Workload Health Probes (6/6)** | Probes executed via `kubectl exec` across all 6 platform pods | Live Cluster (`urumi`) | 0 | 6/6 pods return HTTP 200 OK / exit 0 on canonical health checks. |
| **MCP Upstream Discovery (3/3)** | MCP `StreamableHTTPClientTransport` `listTools` from Gateway | Live Cluster (`urumi`) | 0 | All 10 tools discovered: crm (2), tasks (3), woocommerce (5). |
| **MCP Read-Only Tool Invocation** | Invoked `list_products` and `search_contacts` from Gateway | Live Cluster (`urumi`) | 0 | Successful tool responses without store or database mutation. |

*Explicit Limitation:* Consistent with Gate P7-G2 boundaries, test suites requiring mutating store operations or pod deletion (e.g., P7-G3 pod-replacement recovery, live order creation) were strictly omitted.

---

### 6.2 Gateway SQLite Database Integrity & Invariants

Executed safe, read-only query suite inside container `gateway`:
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
**Post-Deployment Verification Result:**
- `PRAGMA integrity_check`: `[Object: null prototype] { integrity_check: 'ok' }`
- `PRAGMA foreign_key_check`: `[]` (0 violations)
- Table row counts:
  - `schema_migrations`: **3** (Identical)
  - `upstreams`: **3** (Identical)
  - `users`: **4** (Identical)
  - `user_credentials`: **4** (Identical)
  - `api_keys`: **27** (Identical)
  - `user_invitations`: **4** (Identical)
  - `browser_sessions`: **27** (Identical)
  - `audit_logs`: **483** (Identical)

Database content and schema integrity are 100% intact with zero drift.

---

### 6.3 Protected Storefront Invariant Verification

Executed via WP-CLI with customer PII strictly omitted:
```bash
kubectl exec -n urumi deployment/urumi-wordpress -- php /var/www/html/wp-cli.phar wc product list --user=1 --fields=id,name,sku,price,regular_price,status --allow-root
kubectl exec -n urumi deployment/urumi-wordpress -- php /var/www/html/wp-cli.phar wc shop_order get 14 --user=1 --fields=id,status,total,currency,date_created,payment_method --allow-root
```
**Post-Deployment Verification Result:**

| Entity | ID | Name / Description | SKU | Price / Total | Status | Post-Deployment State |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: |
| **Product** | 10 | `Urumi Test Mug` | `URUMI-MUG-001` | 299 | `publish` | **Intact (100% Match)** |
| **Product** | 11 | `Wireless Mouse Demo` | `URUMI-MOUSE-001` | 799 | `publish` | **Intact (100% Match)** |
| **Product** | 12 | `Notebook Demo` | `URUMI-NOTE-001` | 149 | `publish` | **Intact (100% Match)** |
| **Order** | 14 | Shop Order #14 | N/A | 299.00 INR | `processing` | **Intact (100% Match)** |

Zero store drift, zero product mutations, and zero order modifications occurred.

---

### 6.4 PVC Persistence & Volume Binding Verification

```bash
kubectl get pvc -n urumi -o wide
```
**Post-Deployment Output:**
- `urumi-gateway-pvc`: Status `Bound`, Volume `pvc-801dc6cb-076b-479a-8475-e77c905797f9`, Capacity `500Mi`, StorageClass `local-path`.
- `urumi-mariadb-pvc`: Status `Bound`, Volume `pvc-58d7357d-5671-476d-904a-cda0a12cf269`, Capacity `1Gi`, StorageClass `local-path`.
- `urumi-wordpress-pvc`: Status `Bound`, Volume `pvc-78d0d23b-59fe-4c82-be1e-687d9c40fd6f`, Capacity `1Gi`, StorageClass `local-path`.

All three PVC volume attachments remained continuous and unmodified.

---

## 7. Errors, Retries, Rollback Actions & Deviations

1. **Rollback Actions:** Zero. The rollout succeeded cleanly on the initial attempt; no rollback was required.
2. **Rollout Failures / Retries:** Zero. All three target deployments transitioned from old to new replicas within standard rollout timeouts.
3. **Values Handling Justification:** In accordance with Stage B inspection, the deployment used `--reuse-values` to preserve deployed release values and avoid modifying `TRUSTED_PROXIES` in `urumi-gateway`. This ensured that the Gateway did not undergo an unnecessary rollout and remained completely stable.
4. **Deviations from Authorized Scope:** Zero. No extra infrastructure changes, no network policy adjustments, and no application code changes were made.

---

## 8. Epistemological Classification of Evidence

To maintain rigorous accountability, all claims in this report are classified into distinct categories:

1. **Direct Command Output:** Verifiable CLI strings and raw terminal output captured directly from the execution environment (e.g., `helm upgrade`, `kubectl get pods`, `kubectl exec`, `npm run test`).
2. **Runtime Verification Evidence:** Empirical probes executed against live Linux kernel interfaces and active networking sockets in the running cluster (e.g., `/proc/1/status` showing `CapEff: 0000000000000000` and `Seccomp: 2`, `/proc/mounts` showing `overlay ro` and `/tmp ext4 rw`, `touch /test-root` returning `Read-only file system`, `ls /var/run/secrets/...` returning `No such file or directory`, WP-CLI queries against MariaDB).
3. **Static Manifest Inspection:** Evaluation of unapplied source templates or rendered YAML files (e.g., `helm lint`, `helm template` diff analysis).
4. **Worker-Reported Observations:** Analytical conclusions and operational inferences made by the implementation worker connecting observed data points to requirement statements.

---

## 9. Recommendation for Technical Head Acceptance

Based on the empirical evidence gathered in this gate:
1. WooCommerce MCP container filesystem hardening is active, functional, and verified at runtime.
2. ServiceAccount token isolation for CRM and Tasks MCP is active and verified at runtime.
3. Gateway identity, ServiceAccount, token automount, and Secret-management RBAC are completely preserved.
4. All six platform workloads are healthy and operational.
5. All persistent data (SQLite database, products 10–12, order #14, PVCs) are 100% intact.

It is recommended that the Technical Head formally **ACCEPT Gate P7-G2**.

---

## 10. Gate Boundary Sign-Off

**P7-G2 submitted for Technical Head review. P7-G3 pod-replacement recovery testing remains unauthorized pending explicit approval.**
