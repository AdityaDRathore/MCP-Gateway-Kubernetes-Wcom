# Urumi Platform — Phase 5: Gate P5-G3 Implementation Plan
## Upstream & Tool Management (Browser API Façade over Phase 4 Services)

> [!IMPORTANT]
> **Authority & Execution Boundary:**
> - **Technical Head Decision:** P5-G2 is ACCEPTED WITH RESIDUAL RISKS. Gate P5-G3 is RELEASED FOR LOCAL IMPLEMENTATION AND VERIFICATION ONLY.
> - **Execution Mode:** Strictly local and offline.
> - **Prohibited Actions:** Zero image pushes, zero live database migrations or restores, zero Kubernetes cluster mutations, zero Helm upgrades, zero pod restarts, zero production/VPS deployments.
> - **Deferred Scope:** Member invitations, deactivation, and API key self-service remain deferred to Gate P5-G4. Audit read API remains deferred to Gate P5-G5.

---

## 1. Goal Description

Gate **P5-G3** delivers the secure **Upstream & Tool Management** browser API façade on Port 3001 (`/api/v1/browser/upstreams/*`), bridging authenticated browser dashboard sessions to the battle-tested, existing Phase 4 services (`AdminService`, `CatalogService`, `UpstreamManager`, `SecretManager`).

This gate enables team operators (both Admins and Members) to inspect registered upstream services and their live tool catalog without exposing secret references, while restricting mutating operations (upstream creation, configuration updates, credential rotation, enable/disable, deletion, and cleanup retry) strictly to authenticated Admins protected by session CSRF tokens and canonical origin allowlisting.

---

## 2. Current Verification Baseline & Repository State

| Parameter | Observed State | Evidence / Reference |
|---|---|---|
| **Repository Branch** | `main` | `git status --short --branch` |
| **Current HEAD SHA** | `48a4422bfec5fe0b4dad73a25848f6c6f11f5310` | `git rev-parse HEAD` (Accepted P5-G2 correction commit) |
| **Working Tree Status** | Clean (`nothing to commit, working tree clean`) | `git status` |
| **Monorepo Test Baseline** | **415 tests passing, 0 failing, 0 skipped** | Gateway: 273 (263 unit + 10 protocol), WC MCP: 81, CRM MCP: 26, Tasks MCP: 35 |
| **Live Cluster Pod State** | `urumi-gateway-55f57bddc7-7f8q5` at **0 restarts** (uptime 8h+) | `kubectl get pods -n urumi` (offline/read-only) |
| **Relevant Design Freeze** | `phase_5_g1_design_freeze_package.md` | Sections 4.4, 8 (`THREAT-09`, `THREAT-10`), 9.2, 10 (`DEC-10`, `DEC-11`) |

---

## 3. Exact P5-G3 Scope & Acceptance Criteria

### 3.1 Scope Definition (From Approved Plan & Frozen G1 Contract)

1. **Role Authorization Middleware (`requireRole`):**
   - Implement role-based access control middleware for browser requests.
   - Restrict mutating upstream endpoints (`POST`, `PATCH`, `DELETE`) strictly to `admin`.
   - Permit read-only inspection endpoints (`GET /upstreams`, `GET /upstreams/:id`, `GET /upstreams/:id/tools`) for both `admin` and `member`.

2. **Upstream List & Detail Endpoints:**
   - `GET /api/v1/browser/upstreams`: Authenticated (Admin/Member). Calls `AdminService.listUpstreams()`. Returns list of upstreams with safe metadata, operational status, and health tool count.
   - `GET /api/v1/browser/upstreams/:id`: Authenticated (Admin/Member). Calls `AdminService.getUpstreamById(id)` (or lookup by slug). Returns single upstream detail or 404.
   - **Safe DTO Projection Invariant:** `secretRefName`, `secretRefKey`, and raw credentials are fundamentally omitted from browser responses (`THREAT-09`).

3. **Tool Catalog Inspection Endpoint:**
   - `GET /api/v1/browser/upstreams/:id/tools`: Authenticated (Admin/Member).
   - Looks up upstream to resolve `upstream.slug`.
   - Queries live catalog snapshot via `CatalogService.getSnapshot()`.
   - Filters tools by `upstreamSlug === upstream.slug`.
   - Returns `{ upstreamSlug, toolCount, tools: [{ name, publicName, description, inputSchema }] }`.

4. **Upstream Administrative Mutations (Admin Only + CSRF):**
   - `POST /api/v1/browser/upstreams`: Calls `AdminService.createUpstream()`. Reuses Phase 4 SSRF validation (`validateAndNormalizeUpstreamUrl`), saga, and Kubernetes Secret creation.
   - `PATCH /api/v1/browser/upstreams/:id`: Standardized route reconciling `DEC-11`. Calls `AdminService.updateUpstream()`. Reuses configuration updates and credential rotation.
   - `POST /api/v1/browser/upstreams/:id/enable`: Calls `AdminService.enableUpstream()`.
   - `POST /api/v1/browser/upstreams/:id/disable`: Calls `AdminService.disableUpstream()`.
   - `DELETE /api/v1/browser/upstreams/:id`: Calls `AdminService.deleteUpstream()`. Purges Kubernetes Secret and catalog entries.
   - `POST /api/v1/browser/upstreams/:id/retry-cleanup`: Calls `AdminService.retryCleanup()`.

5. **Security Perimeter & Invariants:**
   - External requests to `/admin/v1/*` continue to return `HTTP 404` on Port 3001 (`THREAT-01`).
   - Bearer API keys rejected on `/api/v1/browser/*` (`HTTP 401: SESSION_MISSING`).
   - Session cookies rejected on `/mcp` (`HTTP 401: UNAUTHORIZED`).
   - All mutating calls require valid `X-Urumi-CSRF` header and approved `Origin` or `Referer` (`THREAT-03`).

### 3.2 Acceptance Criteria Matrix

| Criteria ID | Scenario / Endpoint | Expected HTTP Status | Key Assertion / Evidence |
|---|---|---|---|
| **AC-G3-01** | Member calls `GET /api/v1/browser/upstreams` | `200 OK` | Returns array of registered upstreams. Response contains `health` object; omits `secretRefName`. |
| **AC-G3-02** | Member calls `GET /api/v1/browser/upstreams/:id/tools` | `200 OK` | Returns tools belonging strictly to specified upstream slug; includes `inputSchema`. |
| **AC-G3-03** | Member calls `POST /api/v1/browser/upstreams` | `403 Forbidden` | `code: "FORBIDDEN"`. Mutating action blocked. SQLite and K8s untouched (`ROLE-NEG-01`). |
| **AC-G3-04** | Member calls `PATCH /api/v1/browser/upstreams/:id` | `403 Forbidden` | `code: "FORBIDDEN"`. Credential update / config mutation blocked. |
| **AC-G3-05** | Member calls `DELETE /api/v1/browser/upstreams/:id` | `403 Forbidden` | `code: "FORBIDDEN"`. Upstream deletion blocked. |
| **AC-G3-06** | Admin creates upstream without `X-Urumi-CSRF` | `403 Forbidden` | `code: "CSRF_TOKEN_INVALID"`. Mutation blocked (`CSRF-NEG-01`). |
| **AC-G3-07** | Admin creates upstream with unapproved Origin | `403 Forbidden` | `code: "CSRF_ORIGIN_FORBIDDEN"`. Mutation blocked (`CSRF-NEG-02`). |
| **AC-G3-08** | Admin registers upstream with loopback / SSRF URL | `400 Bad Request` | Fails `validateAndNormalizeUpstreamUrl()`; returns `VALIDATION_ERROR` (`THREAT-10`). |
| **AC-G3-09** | Admin registers upstream with canary secret | `201 Created` | Upstream created; canary secret stored in K8s Secret. Regex scan across HTTP response confirms **0 matches** of raw canary secret (`THREAT-09`, `SECR-SCAN-01`). |
| **AC-G3-10** | Admin updates upstream via `PATCH /upstreams/:id` | `200 OK` | Display name / timeout updated cleanly; returns updated DTO. |
| **AC-G3-11** | Admin toggles enable/disable & deletes upstream | `200 OK` | State transitions verified; deletion removes upstream and cascades cleanly. |

---

## 4. Dependencies, Security Boundaries & Stop Conditions

### 4.1 System Dependencies
- **Phase 4 Services (Reused Unchanged):**
  - `AdminService` (`apps/gateway/src/admin/admin-service.ts`)
  - `CatalogService` (`apps/gateway/src/upstream/catalog-service.ts`)
  - `UpstreamManager` (`apps/gateway/src/upstream/upstream-manager.ts`)
  - `SecretManager` (`apps/gateway/src/k8s/secret-manager.ts`)
  - `validateAndNormalizeUpstreamUrl` (`apps/gateway/src/upstream/url-validator.ts`)
- **Phase 5 Services (Reused from G2):**
  - `SessionService` & `sessionAuthMiddleware` (`apps/gateway/src/auth/session-service.ts`)
  - `createCsrfMiddleware` & `createOriginMiddleware` (`apps/gateway/src/http/browser-middleware.ts`)

### 4.2 Security Boundaries & Non-Negotiable Invariants
1. **Zero Secret Exposure:** Upstream authentication tokens (bearer tokens, basic auth credentials) reside in Kubernetes Secrets (`urumi-gateway-secrets` namespace). They must **never** be projected into browser response bodies, browser error messages, or application logs.
2. **SSRF Guardrail:** All URL inputs must undergo canonical URL parsing and validation. Private IP literals (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`), AWS/cloud metadata IPs (`169.254.169.254`), and unapproved hostnames are rejected immediately before any network socket is opened.
3. **Session vs. MCP Key Separation:** Browser session cookies are strictly prohibited on Port 3000 `/mcp`. Bearer API keys are strictly prohibited on Port 3001 `/api/v1/browser/*`.
4. **Single SQLite Owner:** Database ownership remains strictly with the single gateway process (`replicas: 1`).
5. **No Data Mutation on Protected WooCommerce Store:** Baseline products (10, 11, 12) and Order #14 are never touched.

### 4.3 Stop Conditions
Execution must immediately halt, revert, and report to the Technical Head upon encountering any of:
- Any occurrence of canary secret leakage in HTTP responses, logs, or error payloads (`THREAT-09`).
- Any SSRF bypass allowing registration of prohibited/internal endpoints (`THREAT-10`).
- Any regression in the downstream MCP protocol tests (10 baseline tools must remain 100% operational).
- Any attempt to run live database migrations, live backup/restore, image pushes, or cluster mutations.

---

## 5. Scope Reconciliation & Clarifications with G1

> [!NOTE]
> **Clarification 1: Route Standardization (`DEC-11`):**  
> In the Phase 4 G9 report, a route was described as `PUT .../credential`. As reconciled in G1 (`DEC-11`), `AdminService.updateUpstream()` implements `PATCH /api/v1/browser/upstreams/:id`. We standardize on `PATCH` for all upstream updates (including credential rotation).

> [!NOTE]
> **Clarification 2: Safe Upstream DTO vs. Admin Upstream DTO:**  
> `AdminService.toDTO()` includes `secretRefName: string | null`. While `secretRefName` is an internal Kubernetes Secret object name (not the secret value itself), the frozen G1 contract specifies:
> *"Security Invariant: secretRefName and secretRefKey are omitted or sanitized; raw credentials are never present."*  
> Therefore, the browser façade projects a dedicated `BrowserUpstreamDTO` omitting `secretRefName` entirely, returning only safe operational metadata (`id`, `slug`, `displayName`, `endpointUrl`, `timeoutMs`, `isEnabled`, `status`, `health`, `createdAt`, `updatedAt`).

> [!NOTE]
> **Clarification 3: Deferred Features (Strictly Excluded from P5-G3):**  
> In accordance with the Technical Head's work order, Gate P5-G3 includes **Upstream & Tool Management only**.  
> The following features are strictly deferred to subsequent gates:
> - Member Invitations & Token Delivery $\rightarrow$ **Gate P5-G4**
> - Member Account Deactivation/Reactivation & Last-Admin Protection $\rightarrow$ **Gate P5-G4**
> - Member API Key Self-Service & IDOR Checks $\rightarrow$ **Gate P5-G4**
> - Audit Log Query & Paginated Table $\rightarrow$ **Gate P5-G5**

---

## 6. Proposed Changes

```
apps/gateway/
├── src/
│   ├── http/
│   │   ├── browser-middleware.ts    [MODIFY] Add requireRole() middleware
│   │   ├── browser.ts               [MODIFY] Mount /api/v1/browser/upstreams/* routes with safe DTO projection
│   ├── server.ts                    [MODIFY] Wire adminService and catalogService into createBrowserApp
└── test/
    └── unit/
        └── browser-upstreams-facade.test.ts [NEW] Comprehensive unit test suite for G3 endpoints (11+ tests)
```

---

### Component 1: Role Authorization Middleware (`browser-middleware.ts`)

#### [MODIFY] `apps/gateway/src/http/browser-middleware.ts`
Add `requireRole(...allowedRoles: ('admin' | 'member')[])`:
- Inspects `req.sessionContext?.user.role`.
- If missing or not in `allowedRoles`, returns `HTTP 403 Forbidden: { error: "Forbidden: Insufficient privileges", code: "FORBIDDEN" }`.
- Fails closed on unauthenticated calls with `HTTP 401 Unauthorized: { error: "Unauthorized: Session required", code: "SESSION_REQUIRED" }`.

---

### Component 2: Browser Upstreams & Tools Façade (`browser.ts`)

#### [MODIFY] `apps/gateway/src/http/browser.ts`
1. Update `BrowserRouterOptions` to include:
   ```ts
   export interface BrowserRouterOptions {
     sessionService: SessionService;
     userRepo: UserRepository;
     passwordService: ScryptPasswordService;
     cookieSecure: boolean;
     trustedProxies?: string[];
     rateLimiter?: LoginRateLimiter;
     adminService?: AdminService;
     catalogService?: CatalogService;
   }
   ```
2. Implement `toBrowserUpstreamDTO()`:
   ```ts
   function toBrowserUpstreamDTO(upstream: UpstreamResponseDTO) {
     return {
       id: upstream.id,
       slug: upstream.slug,
       displayName: upstream.displayName,
       endpointUrl: upstream.endpointUrl,
       timeoutMs: upstream.timeoutMs,
       isEnabled: upstream.isEnabled,
       status: upstream.status,
       health: {
         state: upstream.health?.healthState ?? 'connecting',
         toolCount: upstream.health?.toolCount ?? 0,
         lastCheck: upstream.health?.lastCheckedAt ?? 0,
         lastError: upstream.health?.lastError ?? null,
       },
       createdAt: upstream.createdAt,
       updatedAt: upstream.updatedAt,
     };
   }
   ```
3. Mount the 8 Upstream & Tool endpoints:
   - `GET /upstreams`: `sessionAuth`, `requireRole('admin', 'member')`
   - `GET /upstreams/:id`: `sessionAuth`, `requireRole('admin', 'member')`
   - `GET /upstreams/:id/tools`: `sessionAuth`, `requireRole('admin', 'member')`
   - `POST /upstreams`: `sessionAuth`, `requireRole('admin')`, `csrfAuth`
   - `PATCH /upstreams/:id`: `sessionAuth`, `requireRole('admin')`, `csrfAuth`
   - `POST /upstreams/:id/enable`: `sessionAuth`, `requireRole('admin')`, `csrfAuth`
   - `POST /upstreams/:id/disable`: `sessionAuth`, `requireRole('admin')`, `csrfAuth`
   - `DELETE /upstreams/:id`: `sessionAuth`, `requireRole('admin')`, `csrfAuth`
   - `POST /upstreams/:id/retry-cleanup`: `sessionAuth`, `requireRole('admin')`, `csrfAuth`
4. Error mapping:
   - `AdminValidationError` $\rightarrow$ `400 Bad Request: { error, code: 'VALIDATION_ERROR' }`
   - `AdminNotFoundError` $\rightarrow$ `404 Not Found: { error, code: 'NOT_FOUND' }`
   - `AdminConflictError` $\rightarrow$ `409 Conflict: { error, code: 'CONFLICT' }`
   - `AdminDependencyError` $\rightarrow$ `502 Bad Gateway: { error, code: 'DEPENDENCY_ERROR' }`
   - `CleanupRequiredError` $\rightarrow$ `502 Bad Gateway: { error, code: 'CLEANUP_REQUIRED' }`

---

### Component 3: Server Wiring (`server.ts`)

#### [MODIFY] `apps/gateway/src/server.ts`
- Pass `adminService` and `catalogService` to `createBrowserRouter()` within `createBrowserApp()`.
- Ensure unified server factory functions provide these dependencies cleanly during testing and runtime startup.

---

### Component 4: Test Suite (`browser-upstreams-facade.test.ts`)

#### [NEW] `apps/gateway/test/unit/browser-upstreams-facade.test.ts`
Implement comprehensive automated tests for all P5-G3 requirements:
1. `GET /upstreams`: Admin lists upstreams $\rightarrow$ verifies safe DTO projection, health state, and zero `secretRefName`.
2. `GET /upstreams`: Member lists upstreams $\rightarrow$ succeeds identically.
3. `GET /upstreams/:id`: Returns single upstream; returns 404 for nonexistent ID/slug.
4. `GET /upstreams/:id/tools`: Retrieves tools from live catalog snapshot filtered by upstream slug; returns 404 for unknown upstream.
5. `ROLE-NEG-01`: Member calls `POST /upstreams` $\rightarrow$ returns 403 Forbidden (`FORBIDDEN`).
6. `ROLE-NEG-01`: Member calls `PATCH /upstreams/:id` $\rightarrow$ returns 403 Forbidden (`FORBIDDEN`).
7. `ROLE-NEG-01`: Member calls `DELETE /upstreams/:id` $\rightarrow$ returns 403 Forbidden (`FORBIDDEN`).
8. `CSRF-NEG-01`: Admin calls `POST /upstreams` without `X-Urumi-CSRF` $\rightarrow$ returns 403 Forbidden (`CSRF_TOKEN_INVALID`).
9. `CSRF-NEG-02`: Admin calls `POST /upstreams` with unapproved Origin $\rightarrow$ returns 403 Forbidden (`CSRF_ORIGIN_FORBIDDEN`).
10. `THREAT-10`: Admin calls `POST /upstreams` with loopback/SSRF endpoint (`http://169.254.169.254`) $\rightarrow$ rejected with 400 (`VALIDATION_ERROR`).
11. `THREAT-09 & SECR-SCAN-01`: Admin creates upstream with canary secret (`CANARY_SEC_XYZ123`). Canary regex scan across all response headers, body, and audit records verifies **0 matches**.
12. Admin executes `PATCH /upstreams/:id`, `enable`, `disable`, `delete`, and `retry-cleanup` $\rightarrow$ verifies successful execution and clean state transitions.

---

## 7. Verification Plan

### 7.1 Automated Tests (Local & Offline)

```bash
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"

# 1. Run new P5-G3 Upstreams & Tools Façade suite
npx tsx --test apps/gateway/test/unit/browser-upstreams-facade.test.ts

# 2. Run all Gateway Unit Tests (expected: 274+ tests)
npm --prefix apps/gateway run test:unit

# 3. Run Gateway Protocol Tests (10 tests)
npm --prefix apps/gateway run test:protocol

# 4. Run Full Monorepo Regression (415+ tests across all 4 workspaces)
npm test

# 5. Run TypeScript Compilation Build
npm --prefix apps/gateway run build
```

### 7.2 Invariant & Non-Regression Checks
- Verify `apps/woocommerce-mcp` unit and protocol tests remain 100% passing (81 tests).
- Verify `apps/mcp-crm` unit and protocol tests remain 100% passing (26 tests).
- Verify `apps/mcp-tasks` unit and protocol tests remain 100% passing (35 tests).
- Verify git working tree status and obtain clean commit SHA.
- Confirm zero pod restarts or cluster mutations on `k3d-urumi`.

---

## 8. User Review & Approval Request

Please review this implementation plan. Upon your approval, implementation will proceed locally and offline in `apps/gateway` following the exact steps above, concluding with the submission of the P5-G3 verification report and commit SHA.
