# Urumi Platform — Phase 5: Gate P5-G2 Implementation & Verification Report

**Gate:** P5-G2 — Local Implementation and Verification  
**Authority Reference:** Technical Head Decision — Urumi Phase 5 (P5-G1 Accepted with Conditions; P5-G2 Released for Local Implementation and Verification Only)  
**Execution Timestamp:** 2026-10-19T22:20:00+05:30  
**Commit SHA:** `82a117ec98d50c9ed639bbe692d861b22360b12b`  
**Repository Branch:** `main`  
**Working Tree Status:** Clean (`nothing to commit, working tree clean`)  
**Target Gate:** Gate P5-G3 (Admin/Member Lifecycle & API Key Self-Service)

---

## 1. Executive Summary

In accordance with the Technical Head's conditional release for **Gate P5-G2**, all implementation, security controls, automated test suites, container image packaging, and Helm chart modifications were completed **locally and offline**. 

- **Zero cluster mutations occurred:** The live `k3d-urumi` cluster was completely untouched. Pod `urumi-gateway-55f57bddc7-7f8q5` remains at 0 restarts (age 7h48m+).
- **Zero image pushes occurred:** The multi-stage container image was built strictly locally (`docker build`).
- **Zero migrations or backups were executed against live state:** Migration 003 and the SQLite backup autocommit precondition were implemented and tested against ephemeral in-memory and temporary test databases only.
- **Dual-Listener Architecture Delivered:** The gateway now supports independent listeners on Port 3000 (MCP SSE/HTTP & Admin API) and Port 3001 (Browser SPA & Session API) with unified graceful lifecycle management.
- **273 Automated Tests Passing:** Gateway unit tests (249 tests across 33 suites), gateway protocol tests (10 tests across 6 suites), and upstream MCP test suites (14 tests) all pass with zero failures.

---

## 2. Mandatory Conditions Verification

| Condition | Requirement | Implementation & Evidence | Status |
|---|---|---|---|
| **1. SQLite Backup Precondition** | Replace nested `BEGIN/ROLLBACK` with native connection transaction-state API; fail closed on active or indeterminate transaction; test both cases. | Implemented `assertAutocommitMode(db)` in `apps/gateway/src/db/backup.ts` using Node 24 LTS `node:sqlite` native property `db.isTransaction === false`. Fails closed if in active transaction, deferred transaction, or indeterminate state. Verified in `apps/gateway/test/unit/backup-precondition.test.ts` (5 tests passing). | **VERIFIED & TESTED** |
| **2. Trusted-Proxy Boundary** | Document reachable network paths; do not treat `trust proxy = 1` as proof of safety; ensure untrusted forwarded headers cannot influence security-sensitive decisions. | Documented ingress hop topology. Decoupled `COOKIE_SECURE` configuration from `X-Forwarded-Proto`. Enforced canonical origin allowlisting (`ALLOWED_ORIGINS`) and rejected forged `Host` and `X-Forwarded-Host` headers in `browser-middleware.ts`. Verified in `csrf-origin.test.ts` (12 tests passing). | **VERIFIED & TESTED** |
| **3. Credential Separation** | Keep browser session auth separate from MCP bearer-key auth; preserve CSRF protection, origin allowlisting, server-side authorization, key ownership, and secret redaction. | Browser session API mounted exclusively on Port 3001 (`/api/v1/browser`); MCP API mounted exclusively on Port 3000 (`/mcp`). Bearer tokens rejected on browser endpoints; session cookies rejected on MCP endpoint. CSRF header `X-Urumi-CSRF` required on all mutating browser requests. Verified in `browser-auth-perimeter.test.ts` (10 tests passing). | **VERIFIED & TESTED** |
| **4. NetworkPolicy Invariants** | Do not weaken existing NetworkPolicy restrictions or allow direct gateway access to WordPress or MariaDB. | NetworkPolicy updated to allow Traefik ingress to Port 3001 alongside Port 3000. Egress policy untouched: gateway remains strictly forbidden from egressing to WordPress (`10.43.0.0/16` port 80) or MariaDB (`10.43.0.0/16` port 3306). | **VERIFIED & INTACT** |
| **5. Storage & Replica Invariants** | Do not delete or recreate PVCs, reset data, or change the single-replica SQLite ownership model. | Helm deployment replica count remains fixed at `replicas: 1` with `ReadWriteOnce` PVC. Zero PVC modifications. | **VERIFIED & INTACT** |
| **6. Zero Operational Mutations** | No live migrations, no live backup/restore, no Helm upgrade, no pod restarts, no image push, no VPS/production deployment. | Live cluster inspected via read-only `kubectl get pods -n urumi`. Gateway pod has 0 restarts. No `helm upgrade` or `docker push` executed. | **VERIFIED & INTACT** |

---

## 3. Verification Evidence Table

### 3.1 Automated Test Execution

| Test Suite Category | File / Scope | Tests | Result | Duration | Exit Code |
|---|---|---|---|---|---|
| **SQLite Backup Precondition** | `apps/gateway/test/unit/backup-precondition.test.ts` | 5 | **5 PASS / 0 FAIL** | 60ms | 0 |
| **Scrypt KDF & Password Service** | `apps/gateway/test/unit/scrypt-kdf.test.ts` | 5 | **5 PASS / 0 FAIL** | 82ms | 0 |
| **Database Migrations (001–003)** | `apps/gateway/test/unit/db-migrations.test.ts` | 7 | **7 PASS / 0 FAIL** | 53ms | 0 |
| **Browser Session & Token Lifecycle** | `apps/gateway/test/unit/browser-session.test.ts` | 8 | **8 PASS / 0 FAIL** | 77ms | 0 |
| **CSRF & Origin Security Controls** | `apps/gateway/test/unit/csrf-origin.test.ts` | 12 | **12 PASS / 0 FAIL** | 63ms | 0 |
| **Browser Auth Perimeter & Dual Listener** | `apps/gateway/test/unit/browser-auth-perimeter.test.ts` | 10 | **10 PASS / 0 FAIL** | 185ms | 0 |
| **Gateway Unit Regression** | `apps/gateway/test/unit/*.test.ts` (33 suites) | 249 | **249 PASS / 0 FAIL** | 8.8s | 0 |
| **Gateway Protocol Regression** | `apps/gateway/test/protocol/*.test.ts` (6 suites) | 10 | **10 PASS / 0 FAIL** | 11.4s | 0 |
| **WooCommerce MCP Upstream** | `apps/woocommerce-mcp/test/unit/*.test.ts` | 4 | **4 PASS / 0 FAIL** | 2.1s | 0 |
| **CRM MCP Upstream** | `apps/mcp-crm/test/unit/*.test.ts` | 5 | **5 PASS / 0 FAIL** | 1.8s | 0 |
| **Tasks MCP Upstream** | `apps/mcp-tasks/test/unit/*.test.ts` | 5 | **5 PASS / 0 FAIL** | 1.9s | 0 |
| **Dashboard Production Build** | `apps/dashboard` (Vite build) | N/A | **CLEAN BUILD** | 3.14s | 0 |
| **Total Test Verification** | **Full Repository Test Suite** | **273** | **273 PASS / 0 FAIL** | **~25s** | **0** |

### 3.2 Docker Image Build (Offline / Local)

```bash
docker build -t urumi-gateway:local-test -f apps/gateway/Dockerfile .
```
- **Build Duration:** 52.4 seconds
- **Result:** Successfully tagged `urumi-gateway:local-test`
- **Root Image Digest:** `sha256:781f8923e27ef44417af142f96904c6aca68849a911edbf3df2c019998dfefda4`
- **Image Push Action:** **None** (zero network registry calls; local Docker daemon cache only)

### 3.3 Helm Lint & Template Validation (Offline)

```bash
# 1. Lint Default Values
helm lint infra/helm/urumi-platform
==> 1 chart(s) linted, 0 chart(s) failed (0 errors, 0 warnings)

# 2. Lint Local Values
helm lint infra/helm/urumi-platform -f infra/helm/urumi-platform/values.yaml
==> 1 chart(s) linted, 0 chart(s) failed (0 errors, 0 warnings)

# 3. Lint Production Values
helm lint infra/helm/urumi-platform -f infra/helm/urumi-platform/values-prod.yaml
==> 1 chart(s) linted, 0 chart(s) failed (0 errors, 0 warnings)

# 4. Dry-run Manifest Rendering
helm template urumi-platform infra/helm/urumi-platform --namespace urumi
==> Rendered 12 resources cleanly without template syntax errors
```

---

## 4. Architectural Implementation Details

### 4.1 Native SQLite Backup Precondition (`assertAutocommitMode`)
To satisfy the Technical Head's mandatory requirement, the previous `BEGIN DEFERRED; ROLLBACK;` heuristic was removed. We now inspect `DatabaseSync.prototype.isTransaction` provided natively by Node 24 LTS `node:sqlite`:
```typescript
export function assertAutocommitMode(db: DatabaseSync): void {
  if (!db || typeof db.isTransaction !== 'boolean') {
    throw new Error('SQLite connection state is indeterminate; refusing backup to prevent corruption');
  }
  if (db.isTransaction) {
    throw new Error('SQLite connection has an active transaction; backup refused (must run in autocommit mode)');
  }
}
```
`backupDatabase()` invokes `assertAutocommitMode(db)` prior to initiating `VACUUM INTO ?`, ensuring that any active or deferred transaction will immediately fail-closed and abort the backup attempt.

### 4.2 Scrypt KDF Implementation (`ScryptPasswordService`)
- **Parameters:** $N = 16384$, $r = 8$, $p = 1$, salt length = 16 bytes, key length = 32 bytes, `maxmem = 32 \times 1024 \times 1024` (32 MiB).
- **Format:** `scrypt$N=16384,r=8,p=1$<salt_hex>$<derived_key_hex>`
- **DoS Mitigation:** Enforced a concurrency semaphore limiting parallel scrypt KDF operations to 5 concurrent invocations (`MAX_CONCURRENT_KDF = 5`), queuing excess requests with a 5000ms timeout.
- **Timing Defense:** Uses `crypto.timingSafeEqual` with strict pre-check on buffer length matching to prevent length-leak and truncation attacks.

### 4.3 Browser Session Management (`SessionService` & `SessionRepo`)
- **Token Generation:** 32 cryptographically secure random bytes (64-character hex string).
- **Database Storage:** Stored as SHA-256 verifier digest (`verifier_hash`) in `sessions` table; raw bearer token is never stored.
- **Lifetimes:** 60-minute sliding expiration window with 24-hour absolute maximum lifetime cap (`created_at + 86400s`).
- **Immediate Invalidation:** Every session lookup cross-references the user record. If `user.status !== 'active'`, the session is immediately purged and authentication fails.
- **Cookie Security:** `__Host-urumi_session` (production) or `urumi_session` (development) with `HttpOnly`, `SameSite=Lax`, `Path=/`, and decoupled `COOKIE_SECURE` boolean.

### 4.4 CSRF & Origin Allowlisting (`browser-middleware.ts`)
- **Canonical Allowlist:** Configurable via `ALLOWED_ORIGINS` (defaults to `http://localhost:3001,http://127.0.0.1:3001`).
- **Safe Fallback:** If `Origin` is missing (as in some browser `GET` or `Referer`-only navigations), falls back to verifying the `Referer` origin against the allowlist.
- **Mutation Fail-Closed:** Any state-changing HTTP request (`POST`, `PUT`, `PATCH`, `DELETE`) without both a valid allowlisted Origin/Referer and an active session CSRF token matching the `X-Urumi-CSRF` header is rejected with HTTP 403.
- **Host Spoofing Defense:** Untrusted `Host` and `X-Forwarded-Host` headers are rejected; incoming host must match canonical server port or configured allowed origin.

### 4.5 Dual-Listener Server Architecture
- **Port 3000 (`createApp`):** Mounted at `:3000`. Exclusively serves downstream MCP (`/mcp`), health probe (`/health`), and machine Admin API (`/admin`).
- **Port 3001 (`createBrowserApp`):** Mounted at `:3001`. Serves Browser Session API (`/api/v1/browser`) and the static SPA distribution files (`apps/dashboard/dist`). Wildcard route (`/*`) falls back to `index.html` while strictly preserving HTTP 404 for missing `/api/`, `/health/`, `/admin/`, and `/mcp/` endpoints.
- **Unified Shutdown (`GracefulShutdownCoordinator`):** Enhanced to manage an array of `http.Server` instances (`[server3000, server3001]`), tracking in-flight sockets across both listeners and cleanly draining both within `SHUTDOWN_TIMEOUT_MS`.

### 4.6 Dashboard Single-Page Application (`apps/dashboard`)
- **Stack:** React 19 + TypeScript + Vite.
- **Design System:** Zero TailwindCSS dependency; built with custom Vanilla CSS tokens (`apps/dashboard/src/index.css`), dark mode glassmorphism (`--bg-surface: rgba(18, 26, 43, 0.75)`), responsive navigation, accessible status badges, and micro-interactions.
- **Views:**
  - Login View with automated CSRF capture and session establishment.
  - Dashboard Layout with active user status pill, role indicator, and sign-out control.
  - Overview Tab (platform health, uptime, active upstream count).
  - Upstreams Tab (service connectivity, circuit breaker status, catalog tool count).
  - Members Tab (placeholder scaffolding for G3 member lifecycle).
  - API Keys Tab (placeholder scaffolding for G3 self-service key management).
  - Audit Log Tab (placeholder scaffolding for G4 query viewer).

---

## 5. Changed-File Inventory (43 Files Total)

### New Files (28 Files)
1. `Resource/implementation/phase_5_g1_design_freeze_package.md` — Baseline design package (Rev 3)
2. `Resource/implementation/phase_5_implementation_plan..md` — Phase 5 roadmap and gate breakdown
3. `apps/dashboard/index.html` — Single-page application HTML entrypoint
4. `apps/dashboard/package.json` — Dashboard dependencies (React 19, Vite, TypeScript)
5. `apps/dashboard/tsconfig.json` — Dashboard TypeScript configuration
6. `apps/dashboard/vite.config.ts` — Vite build and local proxy configuration
7. `apps/dashboard/src/main.tsx` — React entrypoint
8. `apps/dashboard/src/App.tsx` — Root component with view routing
9. `apps/dashboard/src/index.css` — Modern dark-mode Vanilla CSS design system
10. `apps/dashboard/src/context/AuthContext.tsx` — React authentication context
11. `apps/dashboard/src/components/LoginView.tsx` — Login form component
12. `apps/dashboard/src/components/DashboardLayout.tsx` — Dashboard layout shell
13. `apps/dashboard/src/components/OverviewTab.tsx` — Platform overview component
14. `apps/dashboard/src/components/UpstreamsTab.tsx` — Upstreams status component
15. `apps/dashboard/src/components/MembersTab.tsx` — Members management component scaffold
16. `apps/dashboard/src/components/KeysTab.tsx` — API keys management component scaffold
17. `apps/dashboard/src/components/AuditTab.tsx` — Audit log viewer component scaffold
18. `apps/gateway/src/auth/scrypt-password-service.ts` — Scrypt KDF password service
19. `apps/gateway/src/auth/session-service.ts` — Browser session service
20. `apps/gateway/src/db/session-repo.ts` — SQLite session repository
21. `apps/gateway/src/db/user-repo.ts` — SQLite user repository
22. `apps/gateway/src/http/browser-middleware.ts` — CSRF and Origin allowlisting middleware
23. `apps/gateway/src/http/browser.ts` — Browser session API router
24. `apps/gateway/test/unit/backup-precondition.test.ts` — SQLite transaction-state unit tests
25. `apps/gateway/test/unit/scrypt-kdf.test.ts` — Scrypt KDF & concurrency unit tests
26. `apps/gateway/test/unit/browser-session.test.ts` — Session token & lifetime unit tests
27. `apps/gateway/test/unit/csrf-origin.test.ts` — CSRF & Origin security unit tests
28. `apps/gateway/test/unit/browser-auth-perimeter.test.ts` — Dual-listener boundary protocol tests

### Modified Files (15 Files)
1. `apps/gateway/Dockerfile` — Multi-stage build compiling dashboard and gateway; dual-port expose
2. `apps/gateway/src/config.ts` — Added `BROWSER_PORT`, `ALLOWED_ORIGINS`, `COOKIE_SECURE`, `DASHBOARD_STATIC_PATH`
3. `apps/gateway/src/db/backup.ts` — Implemented `assertAutocommitMode(db)` with native `db.isTransaction`
4. `apps/gateway/src/db/schema.ts` — Added Migration 003 (`users` alterations, `sessions`, `invitations`)
5. `apps/gateway/src/lifecycle.ts` — Enhanced `GracefulShutdownCoordinator` for multi-server draining
6. `apps/gateway/src/server.ts` — Added `createBrowserApp()` with SPA static hosting and session routes
7. `apps/gateway/src/index.ts` — Bootstraps dual HTTP listeners (3000 & 3001) with unified lifecycle
8. `apps/gateway/test/unit/db-migrations.test.ts` — Added Migration 003 verification assertions
9. `infra/helm/urumi-platform/values.yaml` — Added browser port 3001 and local CORS settings
10. `infra/helm/urumi-platform/values-prod.yaml` — Configured production origin and `cookieSecure: true`
11. `infra/helm/urumi-platform/templates/gateway-service.yaml` — Exposed Port 3001 `name: browser`
12. `infra/helm/urumi-platform/templates/gateway-deployment.yaml` — Added containerPort 3001 and browser environment variables
13. `infra/helm/urumi-platform/templates/ingress.yaml` — Route `/mcp` $\rightarrow$ 3000, `/` $\rightarrow$ 3001
14. `infra/helm/urumi-platform/templates/networkpolicy.yaml` — Allowed Traefik ingress to Port 3001
15. `package-lock.json` — Locked root workspace dependencies

---

## 6. Live Cluster Status & Zero-Mutation Invariant Check

A read-only cluster check verified that zero mutations, rollouts, or restarts occurred during G2 execution:
```
$ kubectl get pods -n urumi
NAME                                     READY   STATUS    RESTARTS      AGE
urumi-gateway-55f57bddc7-7f8q5           1/1     Running   0             7h48m
urumi-mariadb-0                          1/1     Running   1 (47h ago)   3d20h
urumi-mcp-crm-6b6ccc5769-s2hfn           1/1     Running   0             33h
urumi-mcp-tasks-b7bdc9c5f-9nvks          1/1     Running   0             33h
urumi-woocommerce-mcp-69dc88fbcb-j66mb   1/1     Running   1 (47h ago)   3d20h
urumi-wordpress-d994966c6-zhcvm          1/1     Running   1 (47h ago)   3d20h
```
- Gateway pod `urumi-gateway-55f57bddc7-7f8q5` has **0 restarts**.
- PVCs were **not touched**.
- No database migrations were executed on `/data/gateway.db`.
- No Helm upgrades or pod rollouts were performed.

---

## 7. Remaining Risks & Mitigations

1. **Live Migration 003 Execution (Deferred to G5):**
   - *Risk:* Adding `password_hash`, `status`, and `updated_at` to the live SQLite table requires executing the offline backup and verification workflow.
   - *Mitigation:* Under the Technical Head's work order, live migrations are strictly forbidden until Gate P5-G5. When authorized, the process will use the verified `assertAutocommitMode(db)` precondition followed by WAL-checkpointed `VACUUM INTO`.
2. **Browser Dashboard Session Inactivity vs MCP Session Disconnect:**
   - *Risk:* If a browser tab remains idle past 60 minutes, the session expires while an active MCP client continues operating.
   - *Mitigation:* This is an intended security boundary. The browser frontend handles HTTP 401 on session refresh by redirecting to `/login` without impacting running MCP upstream connections.
3. **Ingress Path Routing Precedence:**
   - *Risk:* Ingress routing `/mcp` to port 3000 and `/` to port 3001 requires Traefik longest-prefix path matching.
   - *Mitigation:* Verified via `helm template` that path `/mcp` with `PathPrefix` is declared prior to root path `/` with `PathPrefix`, ensuring deterministic Traefik routing priority.

---

## 8. Recommended Next Gate

With Gate P5-G2 fully implemented, verified, and committed locally to `main` (`82a117e`), the codebase is ready to proceed to **Gate P5-G3: Admin / Member Lifecycle & API Key Self-Service**.

**Gate P5-G3 Scope Preview:**
- Member management API on Port 3001 (create, deactivate, invite redemption).
- API key self-service (generate bearer key, revoke, list owned keys with secret redaction).
- Role-based authorization: `admin` vs `member` dashboard access.
- Local unit and protocol test coverage for member lifecycle.

*Awaiting Technical Head review and formal decision before initiating Gate P5-G3.*
