# Phase 7 Gate P7-G0: Repository, Requirements & Environment Preflight Report

**Project:** Urumi Enterprise AI Gateway & Multi-Tenant Management Platform  
**Gate:** Phase 7 Gate P7-G0 (Preflight Baseline & Hardening Reconciliation)  
**Author:** Implementation Worker reporting to Technical Head  
**Date:** October 22, 2026  
**Status:** **SUBMITTED FOR TECHNICAL HEAD REVIEW & GATE APPROVAL**  
**Gate Authority:** Technical Head  
**Operational Status:** Read-only inspection and evidence collection completed. Zero implementation, zero mutations, zero commits, zero pushes performed.

---

## 1. Executive Summary

Phase 7 of the Urumi Enterprise AI Gateway project is a bounded reliability, hardening, and deployment verification phase. Under strict authorization for read-only inspection, **Gate P7-G0 (Repository, Requirements & Environment Preflight)** has been executed.

### Core Objectives Established in P7-G0:
1. **Repository Baseline Frozen:** Current branch `main` @ commit SHA `a58d2681f3baffcf539924ded0e598da3d3c38d5` (`a58d268`). Working tree contains uncommitted Phase 7 planning package in `Context/phase-7-planning-package/` which has been strictly preserved.
2. **Phase 6 Handoff Reconciled:** The Phase 6 final report (`docs/phase-6/p6-g7-final-acceptance-and-handoff-report.md`) was submitted at commit `a58d268`. Gates P6-G0 through P6-G6 are accepted; P6-G7 was formally submitted and remains pending explicit Technical Head closeout.
3. **Protected Store Baseline Empirically Verified (Zero Drift):** Using read-only WP-CLI execution (`php /var/www/html/wp-cli.phar`), WooCommerce baseline Product IDs 10, 11, 12 and Order #14 were verified 100% intact with zero state drift and zero dangling fixtures.
4. **Environment Health & Headroom:** Local cluster `k3d-urumi` (v1.37.1+k3s1) on node `k3d-urumi-server-0` is fully healthy (Node CPU: 5%, Memory: 15% / ~1.2 GiB used of ~7.6 GiB allocatable). All 6 platform workloads are 1/1 Running & Ready across namespace `urumi`.
5. **Gateway Persistence & SQLite Integrity:** Database `/data/gateway.db` in `urumi-gateway` pod verified with `PRAGMA integrity_check = 'ok'` and `PRAGMA foreign_key_check = []` (0 violations). Row counts: 3 migrations, 3 upstreams, 4 users, 27 api_keys, 483 audit logs.
6. **Network Boundaries Empirically Enforced:** Egress from `urumi-gateway` reaches all 3 upstream MCP servers (`woocommerce:3000`, `crm:3000`, `tasks:3000`), but is actively blocked with `ECONNREFUSED` to MariaDB (`3306`) and WordPress (`80`). Egress from `urumi-woocommerce-mcp` reaches WordPress (`80`) but is actively blocked to MariaDB (`3306`).
7. **Node.js Environment Discrepancy Resolved:** Discovered that host `/usr/bin/node` is v18.19.1 (lacking `node:sqlite`), whereas Node 24 LTS (`v24.20.0`) is installed in `/home/rathore/.nvm/versions/node/v24.20.0/bin/node`. All Node tests require prepending Node 24 to `PATH`.
8. **Hardening Gap Identified:** `urumi-woocommerce-mcp` has `readOnlyRootFilesystem: false` hardcoded in `mcp-deployment.yaml` and live pod runtime, and lacks an emptyDir `/tmp` volume mount, whereas `gateway`, `crm`, and `tasks` enforce `readOnlyRootFilesystem: true`.

---

## 2. Repository Baseline

| Property | Recorded Value | Evidence Status | Notes |
|:---|:---|:---:|:---|
| **Repository Root** | `/home/rathore/Documents/Urumi Assignment` | Verified in this run | Canonical working directory. |
| **Current Branch** | `main` | Verified in this run | Up to date with `origin/main`. |
| **Exact Commit SHA** | `a58d2681f3baffcf539924ded0e598da3d3c38d5` (`a58d268`) | Verified in this run | Verified via `git rev-parse HEAD`. |
| **Working-Tree Status** | Clean tracked files; 1 untracked directory | Verified in this run | `Context/phase-7-planning-package/` present and uncommitted. Zero tracked files modified or staged. |
| **Phase 7 Planning Package** | Present in working tree, uncommitted | Verified in this run | 6 files in `Context/phase-7-planning-package/docs/phase-7/`. Preserved without modification. |
| **Phase 6 Handoff Location** | `docs/phase-6/p6-g7-final-acceptance-and-handoff-report.md` | Repository evidence | Added in commit `a58d268`. |
| **Phase 6 Acceptance Status** | P6-G0..G6 Accepted; P6-G7 Submitted | Repository evidence | Marked: `Status: SUBMITTED FOR TECHNICAL HEAD FINAL REVIEW & FORMAL ACCEPTANCE`. No subsequent sign-off commit. |

---

## 3. Authoritative Source Inventory

The following authoritative documents were located and inspected in the repository:

1. **Original Assignment Brief & Definition of Done:**
   - Path: `Context/Assignment Overview).md`
   - Defines: 4 platform layers, Admin/Member user stories, testable Definition of Done, mandatory requirements (Kubernetes/Helm, WooCommerce MCP, Gateway, Team Access, Chat Agent), bonus multi-store provisioning, and differentiator #6 (Security Hardening: non-root, NetworkPolicies, SSRF protection, least-privilege RBAC).
2. **Canonical Master Roadmaps:**
   - `Context/phase_4_master_technical_roadmap_and_checklist.md`: Documents SEC-REG-01 target Phase 7, pod kill resilience, failure isolation.
   - `Context/phase_3_custom_woocommerce_mcp_roadmap.md`: Five-tool MCP contract, OAuth 1.0a, Streamable HTTP.
   - `Context/phase_2_stateful_woocommerce_store_roadmap.md`: Stateful WordPress & MariaDB storage, seed baseline.
   - `Context/phase 1 roadmap.md`: Initial architecture spikes and tooling.
3. **Traceability Matrix:**
   - Path: `docs/requirements-traceability.md`
   - Maps 40 atomic requirements across categories A through H (`INF-01..06`, `STR-01..05`, `WMC-01..08`, `GTW-01..11`, `SEC-01..06`, `AUD-01..04`, `CHT-01..04`, `EXT-01..03`).
4. **Phase 7 Planning Package (Uncommitted Proposal):**
   - `Context/phase-7-planning-package/docs/phase-7/phase-7-product-plan.md`
   - `Context/phase-7-planning-package/docs/phase-7/phase-7-execution-roadmap.md`
   - `Context/phase-7-planning-package/docs/phase-7/phase-7-risk-and-decision-register.md`
   - `Context/phase-7-planning-package/docs/phase-7/phase-7-traceability-and-acceptance-checklist.md`
   - `Context/phase-7-planning-package/docs/phase-7/phase-7-handoff-and-open-questions.md`
   - `Context/phase-7-planning-package/docs/phase-7/README.md`
5. **Phase Acceptance & Completion Reports:**
   - `docs/phase-6/p6-g7-final-acceptance-and-handoff-report.md` (Commit `a58d268`)
   - `docs/phase-6/p6-g6-documentation-and-demo-report.md` (Commit `db82863`)
   - `docs/phase-6/p6-g5-cross-path-security-and-regression-report.md` (Commit `8cfce08`)
   - `docs/phase-6/p6-g4-external-mcp-acceptance-report.md` (Commit `d5be9a1`)
   - `Resource/implementation/phase_5_g7_final_completion_report.md` / `docs/phase-5/phase-5-completion-report.md` (Commit `654c2e6`)
   - `Resource/implementation/phase_4_gate_g9_implementation_plan.md` / `docs/phase-4/g9-e2e-acceptance-runbook.md` (Phase 4 completion)
6. **Architecture & Decisions:**
   - `docs/architecture.md`: Comprehensive system architecture.
   - `docs/decisions/`: 21 indexed ADRs (`ADR-001` through `ADR-021`).
7. **Operational Runbooks:**
   - `docs/phase-4/g4-recovery-runbook.md`: SQLite persistence, WAL companion files, backup and disaster recovery.
   - `docs/phase-4/g9-e2e-acceptance-runbook.md`: End-to-end acceptance and store baseline verification.
   - `docs/phase-5/operational-runbook.md`: Platform operational guide.
   - `docs/phase-6/p6-operational-and-user-guide.md`: Chat and external client guide.
   - `docs/phase-6/p6-demo-runbook.md`: 10-step repeatable demo runbook.

---

## 4. Requirements Reconciliation

The provisional Phase 7 requirement IDs (`P7-F1` to `P7-F5`) proposed in `phase-7-product-plan.md` are mapped directly to canonical requirement IDs from authoritative repository sources:

| Phase 7 Planning ID | Canonical Requirement ID | Authoritative Source Document | Verbatim Requirement Statement | Current Traceability Status | Verification Method for Phase 7 |
|:---|:---|:---|:---|:---:|:---|
| **P7-F1** | **GTW-11**, **AUD-03**, **STR-05** | `docs/requirements-traceability.md`, `Assignment Overview).md` | Gateway persistence: SQLite with WAL mode on PVC (`/data/gateway.db`). Pod restart retains users, API keys, upstream configs, and audit logs. | Verified (Ph 4/5); Needs fresh P7 run | Controlled gateway pod replacement test; verify new pod UID, identical PVC identity, `PRAGMA integrity_check = 'ok'`, and identical table row counts. |
| **P7-F2** | **WMC-08**, **INF-01**, **ADR-009** | `docs/requirements-traceability.md`, `ADR-009` | Cluster-internal service isolation: exposed via `ClusterIP` only, no external Ingress. Downstream clients cannot reach upstream services or store/database directly. | Verified (Ph 3/4); Validated in G0 | Egress TCP checks from gateway pod and upstream pods; confirm `allowTestClient: false` in `values-prod.yaml` strips test-client exceptions. |
| **P7-F3** | **INF-04**, **INF-05**, **ADR-006** | `docs/requirements-traceability.md`, `Assignment Overview).md` | Containers run as non-root; drop ALL capabilities; RuntimeDefault seccomp; read-only rootfs where supported; explicit resource requests/limits. | Partial (Defect in woocommerce-mcp) | Live inspection: Gateway, CRM, Tasks enforce non-root, dropped caps, and read-only rootfs. Gap: WooCommerce MCP has `readOnlyRootFilesystem: false`. Remediate in P7-G1. |
| **P7-F4** | **INF-02**, **INF-03**, **ADR-010** | `docs/requirements-traceability.md`, `values-prod.yaml` | Unified Helm chart deploying entire platform; environment values files `values-local.yaml` and `values-prod.yaml` render valid distinct configs. | Partial (Traceability outdated) | `helm lint` and `helm template` executed cleanly on both profiles. Traceability `INF-02` must be updated from "Partial" to "Verified". |
| **P7-F5** | **STR-03**, **STR-04**, **SEC-01..04**, **AUD-01..04**, **CHT-02..04**, **EXT-01..03** | `docs/requirements-traceability.md`, `Assignment Overview).md` | Full regression pass across gateway unit/protocol suites, dashboard build, external MCP client, and chat agent, maintaining 100% store baseline preservation. | Verified (Ph 5/6); Needs targeted P7 rerun | Execute targeted test suites with Node 24 LTS; confirm Products 10, 11, 12 and Order #14 are completely unmodified before and after all tests. |

---

## 5. Live Environment & Deployment Inventory

### 5.1 Cluster Topology & Resource Headroom
- **Kubernetes Context:** `k3d-urumi`
- **Control Plane Node:** `k3d-urumi-server-0` (v1.37.1+k3s1, containerd://2.3.4-k3s1, Linux 7.0.0-38-generic amd64)
- **Node Resource Allocation:**
  - CPU: 232m / 5% utilization
  - Memory: 1224Mi / 15% utilization (~6.4 GiB free out of ~7.6 GiB allocatable)
  - Headroom: **EXCELLENT / STABLE**

### 5.2 Active Workloads in Namespace `urumi`

| Workload Name | Kind | Replicas | Status | Restarts | Pod UID | Image Reference | CPU/Memory (Live) |
|:---|:---:|:---:|:---:|:---:|:---:|:---|:---:|
| `urumi-gateway` | Deployment | 1/1 | Running | 1 | `eaa47adc-1744-4e9a-889c-26786e132e62` | `urumi-gateway:1.0.0` | 1m / 48Mi |
| `urumi-mariadb` | StatefulSet | 1/1 | Running | 1 | `e0d6929c-7e63-4993-8362-827d372a8572` | `mariadb:11.4.5@sha256:49117dcc...` | 55m / 180Mi |
| `urumi-mcp-crm` | Deployment | 1/1 | Running | 1 | `2bce4429-afdd-49ac-9399-069c9a853c5e` | `mcp-crm:1.0.0` | 1m / 37Mi |
| `urumi-mcp-tasks` | Deployment | 1/1 | Running | 1 | `576d50ea-bfd3-4764-b3c0-17c78546c8c4` | `mcp-tasks:1.0.0` | 1m / 39Mi |
| `urumi-woocommerce-mcp` | Deployment | 1/1 | Running | 1 | `ababb14d-4b5a-49d0-948c-a470b7d30cb4` | `urumi-woocommerce-mcp:1.0.0` | 1m / 41Mi |
| `urumi-wordpress` | Deployment | 1/1 | Running | 1 | `wordpress:7.1.3-php8.3-apache@sha256:8ecd8d8e...` | 16m / 136Mi |

*(Note: Restarts = 1 across all pods occurred simultaneously ~61 minutes ago due to a local k3d container daemon restart).*

### 5.3 Storage Inventory (Persistent Volumes & PVCs)

| PVC Name | Bound Volume | Capacity | Access Mode | StorageClass | Mount Path | Live Verification |
|:---|:---|:---:|:---:|:---:|:---|:---:|
| `urumi-gateway-pvc` | `pvc-801dc6cb-076b-479a-8475-e77c905797f9` | 500Mi | RWO | `local-path` | `/data` (`gateway.db`, `-wal`, `-shm`) | Bound / Healthy |
| `urumi-mariadb-pvc` | `pvc-58d7357d-5671-476d-904a-cda0a12cf269` | 1Gi | RWO | `local-path` | `/var/lib/mysql` | Bound / Healthy |
| `urumi-wordpress-pvc` | `pvc-78d0d23b-59fe-4c82-be1e-687d9c40fd6f` | 1Gi | RWO | `local-path` | `/var/www/html` | Bound / Healthy |

### 5.4 Helm Release Status
- **Release Name:** `urumi-store`
- **Namespace:** `urumi`
- **Revision:** `10`
- **Chart:** `urumi-platform-0.1.0`
- **Updated:** `2026-10-21 18:16:20 IST`
- **Status:** `deployed`

### 5.5 Ingress & Service Topology
- **Ingress Controller:** Traefik 3.7.12 (via K3s helm chart `traefik-41.4.2+up41.4.0`)
- **Ingress Rules:**
  - `dashboard.127.0.0.1.nip.io:8080/mcp` -> `service/urumi-gateway:3000` (Protocol Plane)
  - `dashboard.127.0.0.1.nip.io:8080/` -> `service/urumi-gateway:3001` (Browser Plane)
  - `shop.127.0.0.1.nip.io:8080/` -> `service/urumi-wordpress:80` (WooCommerce Storefront)
- **Internal Services:** All 3 upstream MCP servers (`urumi-woocommerce-mcp`, `urumi-mcp-crm`, `urumi-mcp-tasks`) and `urumi-mariadb` are exposed strictly via internal `ClusterIP` with zero Ingress routes.

---

## 6. Protected-Data Baseline (WooCommerce Store)

Using the documented read-only mechanism (`php /var/www/html/wp-cli.phar wc ... --allow-root`) inside `deployment/urumi-wordpress`, the store baseline was inspected:

### 6.1 Protected Products

```
$ kubectl exec -n urumi deployment/urumi-wordpress -- php /var/www/html/wp-cli.phar wc product list --user=1 --fields=id,name,sku,price,status --allow-root

id	name	sku	price	status
12	Notebook Demo	URUMI-NOTE-001	149	publish
11	Wireless Mouse Demo	URUMI-MOUSE-001	799	publish
10	Urumi Test Mug	URUMI-MUG-001	299	publish
```

### 6.2 Protected Order #14 (Customer PII Omitted)

```
$ kubectl exec -n urumi deployment/urumi-wordpress -- php /var/www/html/wp-cli.phar wc shop_order get 14 --user=1 --fields=id,status,total,currency,date_created,payment_method --allow-root

Field	Value
id	14
status	processing
currency	INR
date_created	2026-10-11T18:23:04
total	299.00
payment_method	cod
```

### 6.3 Store Cleanliness & Invariants
- Total Products in Store: **Exactly 3** (IDs 10, 11, 12).
- Total Orders in Store: **Exactly 1** (Order #14).
- Dangling / Orphaned Test Fixtures: **Zero** (0).
- Baseline Preservation Status: **VERIFIED INTACT & UNMUTATED**.

> [!IMPORTANT]
> **Documentation Discrepancy Correction:**  
> Section 8 of historical report `docs/phase-6/p6-g0-baseline-and-requirements-reconciliation.md` cited generic WooCommerce sample names ("V-Neck T-Shirt", "Hoodie with Logo", "Beanie"). Empirical verification confirms that the real, authentic database records created in Phase 2 are:
> - Product 10: `Urumi Test Mug` (SKU `URUMI-MUG-001`, ₹299.00)
> - Product 11: `Wireless Mouse Demo` (SKU `URUMI-MOUSE-001`, ₹799.00)
> - Product 12: `Notebook Demo` (SKU `URUMI-NOTE-001`, ₹149.00)

---

## 7. Reliability, Network & Runtime Security Audit

### 7.1 Area A: Gateway Persistence & SQLite Health
- **Database File:** `/data/gateway.db` on persistent volume `urumi-gateway-pvc` (500Mi RWO).
- **Companion WAL Files:** `/data/gateway.db-wal` (2.79 MB), `/data/gateway.db-shm` (32 KB).
- **Integrity Check:** Executed read-only check via `node:sqlite`:
  ```
  integrity: { integrity_check: 'ok' }
  fk_check: [] (0 foreign key violations)
  ```
- **Table Row Counts:**
  - `schema_migrations`: 3
  - `upstreams`: 3 (`woocommerce`, `crm`, `tasks`)
  - `users`: 4 (1 active admin, 1 active member, 2 deactivated members)
  - `user_credentials`: 4
  - `api_keys`: 27
  - `user_invitations`: 4
  - `browser_sessions`: 27
  - `audit_logs`: 483
- **Synthetic Persistence Markers for P7-G3 Pod Replacement:**
  - Migration version count = 3
  - Registered upstream slugs = `[woocommerce, crm, tasks]`
  - Admin user ID = `b590e714-c575-4bab-862c-f74cb9a47b01`
  - Total audit log count = 483 (must be $\ge 483$ with zero historical data loss)

### 7.2 Area B: Network Policy Boundaries & Live Connectivity
Live TCP connection probes were executed from existing pods without modifying policies or launching test pods:

| Source Pod | Target Destination | Port | Result | Policy Enforcement Status |
|:---|:---|:---:|:---:|:---:|
| `urumi-gateway` | `urumi-woocommerce-mcp` | 3000 | **CONNECTED** | **ALLOWED** (Required upstream path) |
| `urumi-gateway` | `urumi-mcp-crm` | 3000 | **CONNECTED** | **ALLOWED** (Required upstream path) |
| `urumi-gateway` | `urumi-mcp-tasks` | 3000 | **CONNECTED** | **ALLOWED** (Required upstream path) |
| `urumi-gateway` | `urumi-mariadb` | 3306 | **ERROR (ECONNREFUSED)** | **BLOCKED** (Prohibited path enforced) |
| `urumi-gateway` | `urumi-wordpress` | 80 | **ERROR (ECONNREFUSED)** | **BLOCKED** (Prohibited path enforced) |
| `urumi-woocommerce-mcp` | `urumi-wordpress` | 80 | **CONNECTED** | **ALLOWED** (Required REST API path) |
| `urumi-woocommerce-mcp` | `urumi-mariadb` | 3306 | **ERROR (ECONNREFUSED)** | **BLOCKED** (Prohibited path enforced) |

### 7.3 Area C: Runtime Security Posture

| Workload | Configured UID/GID | Effective Runtime UID | Capabilities (CapEff) | Seccomp Profile | Root Filesystem | Writable Paths | Security Assessment |
|:---|:---:|:---:|:---:|:---:|:---:|:---|:---:|
| `urumi-gateway` | 10001:10001 | `uid=10001(mcpuser)` | `0000000000000000` (ALL dropped) | `RuntimeDefault` (mode 2) | **Read-only (`ro`)** | `/data` (pvc), `/tmp` (emptyDir) | **HARDENED** |
| `urumi-mcp-crm` | 10001:10001 | `uid=10001(mcpuser)` | `0000000000000000` (ALL dropped) | `RuntimeDefault` (mode 2) | **Read-only (`ro`)** | `/tmp` (emptyDir) | **HARDENED** |
| `urumi-mcp-tasks` | 10001:10001 | `uid=10001(mcpuser)` | `0000000000000000` (ALL dropped) | `RuntimeDefault` (mode 2) | **Read-only (`ro`)** | `/tmp` (emptyDir) | **HARDENED** |
| `urumi-woocommerce-mcp` | 10001:10001 | `uid=10001(mcpuser)` | `0000000000000000` (ALL dropped) | `RuntimeDefault` (mode 2) | **Writable (`rw`)** | Root overlay | **DEFECT / GAP** |
| `urumi-wordpress` | default (root) | `uid=0(root)` | Default set | None (0) | Writable (`rw`) | `/var/www/html` (pvc) | Known 3rd-party image limitation |
| `urumi-mariadb` | default (root) | `uid=0(root)` | Drops privs internally | None (0) | Writable (`rw`) | `/var/lib/mysql` (pvc) | Known 3rd-party image limitation |

**Concrete Finding:** `urumi-woocommerce-mcp` runs non-root and has dropped capabilities, but its root filesystem is writable (`readOnlyRootFilesystem: false` hardcoded in `mcp-deployment.yaml`) and it lacks an `emptyDir` mount for `/tmp`. This is inconsistent with the hardened posture of `gateway`, `crm`, and `tasks`.

### 7.4 Area D: Helm Configuration & Profile Verification
- `helm lint infra/helm/urumi-platform -f .../values-local.yaml`: **PASSED (0 errors, 1 chart linted)**
- `helm lint infra/helm/urumi-platform -f .../values-prod.yaml`: **PASSED (0 errors, 1 chart linted)**
- `helm template` (local profile): Renders 5 NetworkPolicies containing `app.kubernetes.io/component: test-client` for automated local testing.
- `helm template` (prod profile): **Zero (0) test-client occurrences** rendered; TLS enabled with `letsencrypt-prod` cert-manager annotations; replica count strictly 1 with `Recreate` strategy.
- Image Digests in `values-prod.yaml`: Third-party images (`wordpress`, `mariadb`) have pinned sha256 digests. Custom platform images (`gateway`, `woocommerce-mcp`, `crm`, `tasks`) have `digest: ""` because remote registry publication is a deferred qualification (`SEC-REG-01`).

---

## 8. Test Inventory & Execution Evidence

### 8.1 Node.js Runtime Precondition
- Host default `/usr/bin/node` is **Node.js v18.19.1**.
- Running gateway tests with `/usr/bin/node` fails with `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite` and `ReferenceError: crypto is not defined`.
- **Node.js v24 LTS (`v24.20.0`)** is installed at `/home/rathore/.nvm/versions/node/v24.20.0/bin/node`.
- **Precondition Rule:** All test execution commands for the gateway workspace MUST run with:
  ```bash
  export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"
  ```

### 8.2 Tests Executed in this Run

| Test / Command | Scope | Result | Output Summary |
|:---|:---|:---:|:---|
| `npm --prefix apps/gateway run typecheck` | Gateway TypeScript compilation | **PASS** | Clean exit (code 0), 0 type errors. |
| `npm --prefix apps/dashboard run build` | Dashboard Vite production build | **PASS** | Built in 3.28s, 38 modules transformed, 269 kB JS, 4.93 kB CSS. |
| `apps/gateway/test/unit/db-connection.test.ts` (Node 24) | SQLite WAL & POSIX permissions | **PASS** | 7 passed, 0 failed (WAL mode, 0700/0600 permissions, corruption fail-closed). |
| `helm lint` (local & prod profiles) | Helm chart syntax & structure | **PASS** | 0 errors across both values profiles. |
| `helm template` (local & prod profiles) | Render validation | **PASS** | Valid manifests generated; prod profile cleanly strips test-client selectors. |
| In-cluster SQLite Integrity Check | Live SQLite database on PVC | **PASS** | `integrity_check: 'ok'`, 0 foreign key violations. |
| In-cluster Network Policy Probes | TCP connectivity (gateway/mcp) | **PASS** | Allowed paths connected; denied paths return `ECONNREFUSED`. |
| In-cluster WooCommerce Read-only Audit | Products 10–12, Order #14 | **PASS** | Products 10, 11, 12 and Order #14 intact; 0 extraneous records. |

---

## 9. Hardening Gap Matrix

| Hardening Objective | Classification | Current Evidence | Required Phase 7 Action |
|:---|:---:|:---|:---|
| **Gateway Pod-Replacement Recovery** | **Existing implementation requiring fresh evidence** | Gateway Deployment configured with `replicas: 1`, `strategy.type: Recreate`, PVC bound to `urumi-gateway-pvc`. WAL mode active. Runbook exists (`ADR-012`, `g4-recovery-runbook.md`). | Execute non-destructive pod replacement test in P7-G3; capture before/after pod UIDs, verify PVC preservation, verify SQLite integrity, and verify synthetic audit log persistence. |
| **NetworkPolicy Boundaries** | **Existing implementation with adequate current evidence** | Live TCP probes in G0 confirmed gateway reaches all 3 upstreams and is blocked from MariaDB/WordPress. Template audit confirmed prod profile strips test-client exceptions. | Formally document full allowed/denied matrix in P7-G4; verify across all pod-to-pod permutations. |
| **WooCommerce MCP Read-Only Root Filesystem** | **Concrete defect / gap requiring proposed remediation** | `mcp-deployment.yaml` hardcodes `readOnlyRootFilesystem: false` and lacks `/tmp` emptyDir mount. Live container has `overlay / overlay rw`. | Propose Helm template fix in P7-G1: update `mcp-deployment.yaml` to configure `readOnlyRootFilesystem: true` and mount `emptyDir` at `/tmp`. Validate in P7-G4. |
| **Upstream Component ServiceAccounts** | **Concrete defect / gap requiring proposed remediation** | `crm-deployment.yaml` and `tasks-deployment.yaml` do not specify `serviceAccountName`, falling back to `default` with auto-mounted API tokens. | Propose adding dedicated ServiceAccounts with `automountServiceAccountToken: false` in P7-G1. |
| **Traceability Matrix INF-02 Status** | **Concrete defect / gap requiring proposed remediation** | `docs/requirements-traceability.md` line 23 lists `INF-02` as "Partial (Store Workloads Verified)" because it was not updated after Phase 4/5 added Gateway and Upstreams. | Update `INF-02` status to "Verified" in P7-G1/G6. |
| **Production Helm Values Qualification** | **Existing implementation requiring fresh evidence** | `values-prod.yaml` renders cleanly with TLS and single replica; image digests for custom images are empty strings. | Document remote registry publication (`SEC-REG-01`) as a deferred qualification in P7-G2. |
| **Targeted Regression Suite** | **Existing implementation requiring fresh evidence** | Unit and protocol suites exist across monorepo; passed in Phase 5/6. | Execute targeted regression run under Node 24 in P7-G5; verify zero store baseline drift. |
| **Remote VPS Deployment** | **Deferred production qualification** | Single-node k3d cluster satisfies assignment requirement ("Must run on local Kubernetes... VPS is fine using same Helm charts, with configuration changes only"). | Formalize as deferred differentiator per assignment brief. |

---

## 10. Risk and Discrepancy Register

| ID | Category | Discrepancy / Risk | Impact | Preflight Resolution / Recommendation |
|:---:|:---:|:---|:---|:---|
| **DISC-01** | Repository | Phase 7 planning package placed in untracked `Context/phase-7-planning-package/` (capital C). | Potential for accidental deletion or path confusion with prompt's suggested `context/phase-7-planning/`. | Preserved existing untracked files in `Context/phase-7-planning-package/`. Created P7-G0 deliverables within that structure. |
| **DISC-02** | Environment | Host default `/usr/bin/node` is Node v18.19.1. Lacks `node:sqlite` and native Web Crypto. | Test runs fail with `ERR_UNKNOWN_BUILTIN_MODULE` if executed with default PATH. | Mandatory precondition established: Prepend `/home/rathore/.nvm/versions/node/v24.20.0/bin` to `PATH` for all test execution. |
| **DISC-03** | Documentation | Phase 6 P6-G0 report cited generic WooCommerce demo names (V-Neck T-Shirt, etc.). | Misleading documentation regarding baseline products. | Verified real database records: Product 10 (Mug, ₹299), 11 (Mouse, ₹799), 12 (Notebook, ₹149), Order #14 (₹299.00). |
| **DISC-04** | Tooling | Running `wp` directly inside `urumi-wordpress` fails (`exec: "wp": executable file not found in $PATH`). | Prevents naive WP-CLI command execution. | Established canonical command: `php /var/www/html/wp-cli.phar ... --allow-root`. |
| **DISC-05** | Governance | Phase 6 final report (`p6-g7-final-acceptance-and-handoff-report.md`) is submitted, but lacks formal written Technical Head sign-off commit. | Formal acceptance status of Phase 6 remains technically unclosed. | Documented as "SUBMITTED / PENDING FORMAL ACCEPTANCE". Raised for Technical Head decision. |
| **RISK-01** | Operational | Gateway pod replacement on RWO volume could encounter volume lock contention if replica count $> 1$. | Pod crash loop or database locking. | Maintain strict `replicas: 1` and `strategy.type: Recreate`. Pod must fully terminate before replacement pod claims volume. |

---

## 11. Recommended Prioritized P7-G1 Worklist

The following minimal, prioritized worklist is submitted for Technical Head review and authorization under **Phase 7 Gate P7-G1**:

### Work Item 1: Harden WooCommerce MCP Root Filesystem
- **Requirement ID:** `INF-04`, `INF-05`, `ADR-006`
- **Affected Files:** `infra/helm/urumi-platform/templates/mcp-deployment.yaml`
- **Evidence of Gap:** Hardcoded `readOnlyRootFilesystem: false` and lack of `/tmp` emptyDir volume mount.
- **Proposed Change:** Set `readOnlyRootFilesystem: true`, add `emptyDir` volume for `/tmp`, mount at `/tmp`.
- **Validation Test:** `helm lint`, `helm template`, rollout restart, and test tool discovery/call.
- **Risk & Rollback:** Low risk. Rollback by reverting YAML to `readOnlyRootFilesystem: false`.

### Work Item 2: Upstream Component ServiceAccount Least-Privilege
- **Requirement ID:** `INF-06`, Assignment Stand Out #6 (Least-Privilege RBAC)
- **Affected Files:** `infra/helm/urumi-platform/templates/crm-deployment.yaml`, `tasks-deployment.yaml`, new SA templates or config.
- **Evidence of Gap:** Deployments omit `serviceAccountName`, mounting default K8s API token.
- **Proposed Change:** Set `automountServiceAccountToken: false` on CRM and Tasks pods (or create dedicated unprivileged ServiceAccounts).
- **Validation Test:** Rollout restart and verify upstream connectivity.
- **Risk & Rollback:** Zero risk to application functionality (upstreams do not use K8s API).

### Work Item 3: Update Traceability Matrix for INF-02
- **Requirement ID:** `INF-02`
- **Affected Files:** `docs/requirements-traceability.md`
- **Evidence of Gap:** Line 23 lists `INF-02` as "Partial (Store Workloads Verified)".
- **Proposed Change:** Update status to "Verified" with evidence referencing unified deployment of Gateway, Upstreams, Store, and Ingress under `urumi-platform-0.1.0`.
- **Validation Test:** Markdown link and table check.
- **Risk & Rollback:** Documentation only.

### Work Item 4: Script Non-Destructive Pod-Replacement Recovery Procedure (P7-G3 Plan)
- **Requirement ID:** `GTW-11`, `AUD-03`, `STR-05`
- **Affected Resources:** Deployment `urumi-gateway`, PVC `urumi-gateway-pvc`
- **Plan:** Record pod UID, record database row counts, execute `kubectl delete pod -l app.kubernetes.io/component=gateway -n urumi`, wait for new pod Ready, verify new UID != old UID, verify PVC UID identical, run read-only SQLite integrity check, and verify row counts match exactly.

### Work Item 5: Targeted Regression Test Plan (P7-G5 Plan)
- **Requirement ID:** `SEC-01..04`, `AUD-01..04`, `CHT-02..04`, `EXT-01..03`
- **Plan:** Execute gateway protocol tests (`p6-g5-cross-path-security.test.ts`, `browser-chat.test.ts`, `mcp-protocol.test.ts`) under Node 24. Verify zero mutation on Product IDs 10, 11, 12 and Order #14.

---

## 12. Stop Conditions & Decisions Requiring Technical Head Approval

Before proceeding to implementation or next gates, the following decisions are escalated to the Technical Head:

1. **Formal Phase 6 Closeout:** Does the Technical Head formally accept Phase 6 Gate P6-G7 based on the submitted report `p6-g7-final-acceptance-and-handoff-report.md`?
2. **Authorization for P7-G1 Implementation Plan:** Is the prioritized worklist in Section 11 approved for detailed planning under Gate P7-G1?
3. **WooCommerce MCP Root Filesystem Remediation:** Is changing `readOnlyRootFilesystem: true` in `mcp-deployment.yaml` approved for deployment during Phase 7?
4. **Scope Boundaries:** Confirm that remote VPS deployment and authenticated OCI registry publishing remain documented deferred production qualifications, not blocking local Phase 7 acceptance.

---

## 13. Completion & Gate Disposition

All read-only preflight inspection activities for Gate P7-G0 are complete. Zero code, tests, manifests, or databases were mutated. Zero credentials were exposed.

**P7-G0 submitted for Technical Head review. P7-G1 and all implementation work remain unauthorized pending explicit approval.**
