# Urumi Phase 5 — Gate P5-G6 Stage 5
## Final Deployment, Runtime Verification & Acceptance Report

**Project:** Urumi MCP Gateway and Kubernetes WooCommerce Platform  
**Repository:** `AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`  
**Stage:** P5-G6 Stage 5 — Final Deployment and Acceptance  
**Deployment Date:** October 21, 2026  
**Cluster:** `k3d-urumi`  
**Namespace:** `urumi`  
**Target Release:** `urumi-store` (Helm Revision: `10`, upgraded from `9`)  
**Deployment Source Commit:** `2b06ba048a1c626ebc88219ad3fa74cbe923838c`  
**Deployed Image:** `urumi-gateway:1.0.0` (Digest: `sha256:4cc76d09366b0d458ce59da1799dcfacfb063d2ba0409b21ee97b1111c05ef2b`)  
**Final Disposition:** **ACCEPTED**

---

## Executive Summary

Phase 5 Gate P5-G6 Stage 5 was executed in strict accordance with the approved Stage 5 deployment plan. The accepted production gateway container image was built, imported into the target Kubernetes cluster (`k3d-urumi`), and rolled out via a controlled Helm upgrade to release `urumi-store` (Revision 10) in namespace `urumi`. 

All preflight checks, recovery snapshot verifications, rollout health checks, and 28 runtime acceptance tests across 8 categories passed with 100% empirical verification. Zero direct gateway connections to WordPress or MariaDB were permitted, single-replica SQLite database ownership was maintained, and all pre-existing storefront data—specifically WooCommerce Product IDs 10, 11, and 12, and Order #14—was verified completely intact.

---

## A. Deployment Identity

| Attribute | Deployment Value | Notes |
| :--- | :--- | :--- |
| **Date & Time** | 2026-10-21 18:16:20 IST (Rollout complete: 18:17:05 IST) | Executed during approved deployment window |
| **Cluster & Context** | `k3d-urumi` (k3s v1.37.1+k3s1) | Control-plane node `k3d-urumi-server-0` (`172.19.0.2`) |
| **Target Namespaces** | `urumi` & `urumi-gateway-secrets` | Workloads, PVCs, Ingress, and RBAC Secret boundary |
| **Helm Release** | `urumi-store` (Chart `urumi-platform-0.1.0`) | Upgraded from Revision `9` to Revision `10` |
| **Source Commit SHA** | `2b06ba048a1c626ebc88219ad3fa74cbe923838c` | Includes trusted proxy bridge range `172.19.0.0/16` |
| **Preceding Commits** | `73e5cf18d3d343a9e91e06f762fe0ff0f82aae4a` (Stage 3 impl)<br>`7ed9bcf6248803e50bd0c0192dc82bf31b818f4d` (Stage 3 report) | Accepted Git history strictly preserved |
| **Gateway Image Tag** | `urumi-gateway:1.0.0` | `imagePullPolicy: IfNotPresent` |
| **Immutable Image Digest** | `sha256:4cc76d09366b0d458ce59da1799dcfacfb063d2ba0409b21ee97b1111c05ef2b` | Built from clean monorepo workspace |
| **Configuration Changes** | `gateway.trustedProxies`: `"127.0.0.1,::1,10.42.0.0/16,10.43.0.0/16,172.19.0.0/16"`<br>`ingress.hosts[0].paths`: `/mcp` -> `3000`, `/` -> `3001` | Aligns ingress topology with Traefik bridge forwarding |
| **Database Migration** | Auto-migrated schema v2 on startup (idempotent DDL) | Seven tables: `users`, `user_credentials`, `sessions`, `invitations`, `api_keys`, `upstreams`, `audit_logs` |

---

## B. Deployment Evidence

### 1. Pre-Deployment State & Backup Reference
Prior to executing the Helm release upgrade, an online point-in-time recovery backup was generated directly from the live database using `VACUUM INTO '/tmp/pre-stage5-backup.db'`:
- **Snapshot File:** `backups/pre-stage5/gateway-pre-stage5.db`
- **Companion Manifest:** `backups/pre-stage5/gateway-pre-stage5.manifest.json`
- **File Size:** `208,896` bytes
- **SHA-256 Checksum:** `a9307df1231b0cf0446823214e52420c32c081ce7d7525aaa7e5df435377ff6f`
- **Pre-Rollout Integrity:** `PRAGMA integrity_check` -> `ok`, `PRAGMA foreign_key_check` -> `0 violations`
- **Pre-Rollout Row Counts:** 1 user (`admin`), 451 audit logs, 3 upstreams (`crm`, `tasks`, `woocommerce`)
- **Pre-Rollout Helm Values:** Preserved at `backups/pre-stage5/helm-revision-9-values.yaml`

### 2. Rendered Manifest Inspection
`helm template urumi-store infra/helm/urumi-platform -n urumi -f backups/pre-stage5/helm-revision-9-values.yaml` was reviewed before application:
- `Deployment/urumi-gateway`: `replicas: 1`, `strategy.type: Recreate`, ports `3000` (mcp) and `3001` (dashboard).
- `Service/urumi-gateway`: selector `app.kubernetes.io/component: gateway`, ports `3000` and `3001`.
- `Ingress/urumi-gateway-ingress`: host `dashboard.127.0.0.1.nip.io`, rules `/mcp` -> port `3000`, `/` -> port `3001`.
- `NetworkPolicy/urumi-gateway-netpol`: Ingress allows Traefik on `3000` and `3001`. Egress allows DNS (UDP/TCP 53), Upstreams (TCP 3000), Kubernetes API (TCP 443/6443); direct egress to WordPress (80) and MariaDB (3306) remains strictly absent.

### 3. Rollout Outcome
The release was applied using `helm upgrade urumi-store infra/helm/urumi-platform -n urumi -f backups/pre-stage5/helm-revision-9-values.yaml`.
- Pod N-1 (`urumi-gateway-55f57bddc7-7f8q5`) terminated cleanly.
- Pod N (`urumi-gateway-c7955bc9f-gp5qv`) started, bound the existing PVC, and achieved readiness in 12s.
- Pod Restarts: **0**.
- Final Pod Status: **1/1 Running**.

### 4. Workload, Storage, and Routing State

```text
NAME                                     READY   STATUS    RESTARTS   IP           NODE
urumi-gateway-c7955bc9f-gp5qv            1/1     Running   0          10.42.0.15   k3d-urumi-server-0
urumi-mariadb-0                          1/1     Running   4          10.42.0.9    k3d-urumi-server-0
urumi-mcp-crm-6b6ccc5769-s2hfn           1/1     Running   3          10.42.0.6    k3d-urumi-server-0
urumi-mcp-tasks-b7bdc9c5f-9nvks          1/1     Running   3          10.42.0.11   k3d-urumi-server-0
urumi-woocommerce-mcp-69dc88fbcb-j66mb   1/1     Running   4          10.42.0.12   k3d-urumi-server-0
urumi-wordpress-d994966c6-zhcvm          1/1     Running   4          10.42.0.10   k3d-urumi-server-0
```

- **PVC Identity:** `urumi-gateway-pvc` -> `Bound` to `pvc-801dc6cb-076b-479a-8475-e77c905797f9` (Capacity: `500Mi`, RWO).
- **Service Endpoints:**
  - `urumi-gateway:3000` -> `10.42.0.15:3000` (MCP Streamable HTTP)
  - `urumi-gateway:3001` -> `10.42.0.15:3001` (Dashboard SPA & Browser API)
- **Ingress Endpoints:**
  - `http://dashboard.127.0.0.1.nip.io:8080/` -> Port `3001` (Dashboard SPA)
  - `http://dashboard.127.0.0.1.nip.io:8080/mcp` -> Port `3000` (MCP Streamable HTTP)

---

## C. Test Results

All 28 acceptance tests were executed against the live Kubernetes runtime using the non-destructive acceptance test suite (`scratch/test-stage5-acceptance.ts`).

### Acceptance Test Summary Table

| Test ID | Category | Test Description | Expected Result | Observed Result | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **TEST-8.1.1** | 8.1 Browser Session | Dashboard loads through intended ingress route | HTTP 200 SPA HTML | HTTP 200, 859 bytes HTML | **PASS** |
| **TEST-8.1.2** | 8.1 Browser Session | Unauthenticated browser request to protected API | HTTP 401 `SESSION_MISSING` | HTTP 401 `SESSION_MISSING` | **PASS** |
| **TEST-8.1.3** | 8.1 Browser Session | Invalid credentials rejected | HTTP 401 `INVALID_CREDENTIALS` | HTTP 401 `INVALID_CREDENTIALS` | **PASS** |
| **TEST-8.1.4** | 8.1 Browser Session | Valid login establishes session with secure cookie | HTTP 200, HttpOnly, SameSite=Lax | HTTP 200, secure cookie verified | **PASS** |
| **TEST-8.1.5** | 8.1 Browser Session | Authenticated GET `/session` returns profile & CSRF | HTTP 200, user & csrfToken | HTTP 200, user: admin, role: admin | **PASS** |
| **TEST-8.1.6** | 8.1 Browser Session | State mutation without CSRF token | HTTP 403 `CSRF_TOKEN_INVALID` | HTTP 403 `CSRF_TOKEN_INVALID` | **PASS** |
| **TEST-8.1.7** | 8.1 Browser Session | State mutation with untrusted Origin header | HTTP 403 `CSRF_ORIGIN_FORBIDDEN` | HTTP 403 `CSRF_ORIGIN_FORBIDDEN` | **PASS** |
| **TEST-8.2.1** | 8.2 Team Management | Admin creates invitation token for member role | HTTP 201, single-use token | HTTP 201, token generated (74 chars) | **PASS** |
| **TEST-8.2.2** | 8.2 Team Management | Redeem invitation creates member account & session | HTTP 200, member session | HTTP 200, member account created | **PASS** |
| **TEST-8.2.3** | 8.2 Team Management | Replay redeemed invitation token | HTTP 400 `INVITATION_INVALID` | HTTP 400 `INVITATION_INVALID` | **PASS** |
| **TEST-8.2.4** | 8.2 RBAC Authorization | Member attempts admin-only endpoint (GET `/members`) | HTTP 403 `FORBIDDEN` | HTTP 403 `FORBIDDEN` | **PASS** |
| **TEST-8.2.5** | 8.2 API Key Lifecycle | Member self-provisions API key; raw key shown once | HTTP 201, rawKey + metadata | HTTP 201, rawKey `urumi_live_...` | **PASS** |
| **TEST-8.2.6** | 8.2 API Key Lifecycle | Key listing returns prefix, never raw secret | HTTP 200, rawKey absent | HTTP 200, rawKey confirmed absent | **PASS** |
| **TEST-8.2.7** | 8.2 Admin Protection | Self-deactivation of administrator account | HTTP 400 `SELF_DEACTIVATION_PROHIBITED` | HTTP 400 `SELF_DEACTIVATION_PROHIBITED` | **PASS** |
| **TEST-8.2.8** | 8.2 API Key Lifecycle | Revoking API key immediately blocks MCP access | HTTP 200 on revoke, 401 on /mcp | HTTP 200, /mcp rejected with 401 | **PASS** |
| **TEST-8.3.1** | 8.3 MCP Protocol | Valid API key authenticates to `/mcp` & initializes | HTTP 200, `urumi-gateway` v1.0.0 | HTTP 200, serverInfo verified | **PASS** |
| **TEST-8.3.2** | 8.3 MCP Protocol | Invalid API key rejected on `/mcp` | HTTP 401 | HTTP 401 `Unauthorized` | **PASS** |
| **TEST-8.3.3** | 8.3 MCP Protocol | Browser session cookie rejected on `/mcp` | HTTP 401 (Separation verified) | HTTP 401 (Cookie rejected) | **PASS** |
| **TEST-8.3.4** | 8.3 MCP Protocol | Bearer API key rejected on `/api/v1/browser` | HTTP 401 (Separation verified) | HTTP 401 (Bearer rejected) | **PASS** |
| **TEST-8.4.1** | 8.4 Upstream Façade | Admin lists upstreams; secrets strictly redacted | HTTP 200, 3 upstreams, 0 secrets | HTTP 200, crm, tasks, woocommerce | **PASS** |
| **TEST-8.4.2** | 8.4 Upstream Façade | SSRF IP literal (`169.254.169.254`) registration | HTTP 400 `VALIDATION_ERROR` | HTTP 400 `VALIDATION_ERROR` | **PASS** |
| **TEST-8.5.1** | 8.5 WooCommerce MCP | Gateway discovers WooCommerce MCP tools from upstream | HTTP 200, tools list returned | HTTP 200, 5 WC tools discovered | **PASS** |
| **TEST-8.5.2** | 8.5 Data Preservation | WooCommerce Products 10, 11, 12 & Order 14 intact | Verified unmodified via WP-CLI | 10, 11, 12 `publish`; #14 `processing` | **PASS** |
| **TEST-8.6.1** | 8.6 Audit-Log API | Admin queries paginated audit logs without leakage | HTTP 200, sanitized records | HTTP 200, 5 records, no credentials | **PASS** |
| **TEST-8.6.2** | 8.6 Audit-Log API | Member denied global audit log queries | HTTP 403 `FORBIDDEN` | HTTP 403 `FORBIDDEN` | **PASS** |
| **TEST-8.7.1** | 8.7 Persistence | Live database passes SQLite PRAGMA integrity checks | `integrity_check`: ok, FK: 0 | `integrity_check`: ok, FK: 0 | **PASS** |
| **TEST-8.8.1** | 8.8 Network Policy | Direct gateway TCP connection to WordPress:80 | Connection timed out | Timed out / blocked by netpol | **PASS** |
| **TEST-8.8.2** | 8.8 Network Policy | Direct gateway TCP connection to MariaDB:3306 | Connection timed out | Timed out / blocked by netpol | **PASS** |

**Total:** 28 | **Passed:** 28 (100%) | **Failed:** 0 | **Blocked:** 0

---

## D. Security and Data Preservation

### 1. Browser Session & CSRF Security
- Browser requests authenticate via HTTP-only session cookies (`urumi_session`), scoped with `SameSite=Lax` and a 24-hour lifetime.
- Every state-changing browser request (`POST`, `PUT`, `PATCH`, `DELETE`) enforces dual CSRF checks:
  1. Header `X-Urumi-CSRF` matching the server-stored token.
  2. Strict Origin header validation matching `http://dashboard.127.0.0.1.nip.io:8080`.
- Attempts without the header return HTTP 403 (`CSRF_TOKEN_INVALID`).
- Attempts with untrusted origins return HTTP 403 (`CSRF_ORIGIN_FORBIDDEN`).

### 2. Authentication Boundary Separation
- **MCP Endpoint (`/mcp`):** Exclusively requires an `Authorization: Bearer urumi_live_<hex>` header. Requests presenting browser session cookies are rejected with HTTP 401.
- **Browser API (`/api/v1/browser`):** Exclusively requires `urumi_session` cookie authentication. Requests presenting MCP Bearer tokens are rejected with HTTP 401.
- No cross-protocol credential leakage or substitution is permitted.

### 3. Role-Based Access Control (RBAC) & IDOR Boundaries
- Members are restricted from administrative routes (e.g. `GET /members`, `GET /audit`, upstream registration, member role mutation), receiving HTTP 403 (`FORBIDDEN`).
- Members can strictly list and revoke only their own API keys; attempts to view or manage other members' keys are rejected.
- Protection against administrator lockout: the gateway prevents an administrator from deactivating their own account (HTTP 400 `SELF_DEACTIVATION_PROHIBITED`).

### 4. Upstream Façade & Secret Redaction
- Upstream server configurations stored in Kubernetes Secrets (`urumi-gateway-secrets`) are resolved server-side by the gateway controller.
- Browser-facing DTOs for upstreams strictly exclude `secretRefName`, `secretKey`, auth tokens, passwords, and consumer credentials.
- Upstream URL registration enforces SSRF protections: direct IP literals (including cloud metadata `169.254.169.254`), non-HTTP schemes, and endpoints not matching allowed namespaces are rejected.

### 5. NetworkPolicy Enforcement
Direct TCP connectivity tests executed from within the live `urumi-gateway` container confirmed:
- Gateway -> `urumi-wordpress.urumi.svc.cluster.local:80`: **BLOCKED** (Connection timed out after 5s).
- Gateway -> `urumi-mariadb.urumi.svc.cluster.local:3306`: **BLOCKED** (Connection timed out after 5s).
- Gateway -> Upstreams (`urumi-woocommerce-mcp`, `urumi-mcp-crm`, `urumi-mcp-tasks`) on port 3000: **ALLOWED**.
- Ingress from Traefik to Gateway on ports 3000 and 3001: **ALLOWED**.

### 6. Storefront Record Preservation
Direct read-only inspection via WP-CLI inside the WordPress pod (`urumi-wordpress-d994966c6-zhcvm`) verified that all protected storefront records remain in their exact pre-existing state:

```text
ID    post_title                                  post_status    post_type
14    Order – October 11, 2026 @ 06:23 PM         wc-processing  shop_order
12    Notebook Demo                               publish        product
10    Urumi Test Mug                              publish        product
11    Wireless Mouse Demo                         publish        product

Order #14 Verification:
id: 14
status: processing
currency: INR
total: 299.00
```

Zero modifications, cancellations, or schema mutations occurred on WordPress or MariaDB during Stage 5.

---

## E. Recovery and Rollback Package

### 1. Snapshot and Manifest Identifiers
- **Backup Snapshot:** `backups/pre-stage5/gateway-pre-stage5.db`
- **Manifest:** `backups/pre-stage5/gateway-pre-stage5.manifest.json`
- **SHA-256:** `a9307df1231b0cf0446823214e52420c32c081ce7d7525aaa7e5df435377ff6f`
- **Manifest Size:** `208,896` bytes
- **Integrity Status:** `ok`, 0 foreign key violations
- **Storage Path on Host:** `/home/rathore/Documents/Urumi Assignment/backups/pre-stage5/`

### 2. Helm Revision State
- **Previous Approved Revision:** `9` (values saved in `backups/pre-stage5/helm-revision-9-values.yaml`)
- **Current Deployed Revision:** `10`
- **Rollback Tooling:** Supported natively via `helm rollback urumi-store 9 -n urumi`.

### 3. Application Rollback Procedure
If an application-level defect is discovered:
1. Execute `helm rollback urumi-store 9 -n urumi`.
2. Observe pod rollout: Pod N-1 (`c7955bc9f-gp5qv`) unmounts PVC; previous Pod (`55f57bddc7-7f8q5`) mounts PVC.
3. Verify readiness on port `3000`.
4. Run SQLite integrity check (`PRAGMA integrity_check`) to confirm schema compatibility.

### 4. Database Recovery Procedure
If database-level corruption or catastrophic storage failure occurs:
1. Scale the gateway deployment to 0: `kubectl scale deployment/urumi-gateway -n urumi --replicas=0`.
2. Wait for pod termination to release PVC file locks.
3. Verify SHA-256 checksum of `backups/pre-stage5/gateway-pre-stage5.db`.
4. Restore snapshot to the persistent volume mount path `/data/gateway.db` using a temporary recovery pod.
5. Scale deployment back to 1: `kubectl scale deployment/urumi-gateway -n urumi --replicas=1`.
6. Verify pod startup and schema integrity.

*(Note: Rollback was verified for readiness and procedure documentation; it was not executed against the live cluster as all Stage 5 acceptance gates passed completely.)*

---

## F. Residual Risks & Operational Considerations

| Item | Risk Level | Description | Mitigation / Ongoing Standard |
| :--- | :---: | :--- | :--- |
| **Single Replica Constraint** | Low | The gateway is deliberately constrained to `replicas: 1` (`strategy: Recreate`) because SQLite WAL does not support concurrent multi-pod writers. | Documented architecture invariant. Horizontal scaling requires an external SQL database if multi-writer capability is ever mandated. |
| **K3d Traefik Port Binding** | Very Low | In local development, port 8080 maps to Traefik port 80. | Host header `dashboard.127.0.0.1.nip.io` and Origin `http://dashboard.127.0.0.1.nip.io:8080` are codified in configuration and ingress. |
| **API Key Plaintext Display** | None | Raw API key plaintext is only returned upon generation; subsequent listings expose only the prefix. | Preserved across all DTOs and audit logs. |

---

## G. Final Disposition

### **ACCEPTED**

All mandatory Stage 5 gates, preflight checks, security verifications, data-preservation validations, and runtime acceptance tests passed with conclusive evidence and zero blocking defects.

- **Deployment Platform:** Kubernetes (`k3d-urumi`, namespace `urumi`, release `urumi-store`, revision `10`).
- **Gateway Workload:** Healthy (1/1 Running, 0 restarts, single-replica SQLite owner).
- **Security Boundaries:** Verified (separate browser session vs MCP API key, dual CSRF/Origin enforcement, NetworkPolicy egress isolation).
- **WooCommerce Platform:** Fully operational via `urumi-woocommerce-mcp`; Products 10, 11, 12 and Order #14 confirmed 100% intact.
- **Rollback & Backup Readiness:** Verified and documented.
