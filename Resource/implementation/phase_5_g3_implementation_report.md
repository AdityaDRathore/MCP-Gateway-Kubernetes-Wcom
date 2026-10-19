# Urumi Phase 5 — Gate P5-G3 Implementation & Verification Report
**Upstream & Tool Management Browser Façade (Local Implementation & Verification Only)**

- **Date:** 2026-10-20
- **Environment:** Local / Offline Development Environment (Node 24 LTS)
- **Branch:** `main`
- **Scope Authority:** Gate P5-G3 Released for Local Implementation and Verification Only by Technical Head
- **Status:** **COMPLETE & VERIFIED — READY FOR TECHNICAL HEAD REVIEW (P5-G4 ON HOLD)**

---

## 1. Executive Summary

In accordance with the Technical Head's conditional authorization for **Gate P5-G3 (Upstream & Tool Management)**, all 9 browser-facing endpoints for upstream service registration, lifecycle control, configuration patching, and tool catalog inspection have been implemented on Port 3001 (`/api/v1/browser/upstreams/*`) and verified offline.

### Strict Boundary Adherence
- **100% Local & Offline:** No Docker images pushed to any registry; no live database migrations or backups executed; no Kubernetes cluster state mutated; no Helm charts deployed; zero pod restarts.
- **Service Reuse:** The browser façade directly wraps and reuses the battle-tested Phase 4 `AdminService` and `CatalogService`. No redundant business logic, schema migrations, or bypasses were introduced.
- **Port & Credential Separation:** The dual-listener architecture is maintained. Upstream management is served strictly over the browser router on Port 3001 using `SessionAuthMiddleware` and `requireRole` middleware. The MCP listener on Port 3000 (`/mcp`) remains isolated with bearer API key authentication.
- **Strict Scope Exclusion:** Gate P5-G4 (member invitations, account lifecycle, API key self-service) and Gate P5-G5 (audit log read queries) were strictly excluded from this gate.

---

## 2. Source Inspection Findings & Resolutions

Following the Technical Head's source inspection, four key boundaries were analyzed and addressed:

### 2.1 Upstream-Supplied Metadata & Content Security Boundary (`THREAT-P5-UPSTREAM-XSS`)
- **Finding:** The endpoint `GET /api/v1/browser/upstreams/:id/tools` returns tool `description` and `inputSchema` directly from the catalog. These values originate from upstream MCP servers.
- **Resolution & Boundary Defense:**
  1. Upstream metadata must be treated as **untrusted, upstream-controlled content**.
  2. **Frontend Invariant:** The dashboard frontend (in Gate P5-G4/G5) must render tool descriptions strictly as text (e.g., `element.textContent`, standard React string interpolation), strictly prohibiting HTML parsing, `innerHTML`, or raw markdown rendering of descriptions.
  3. **Schema Invariant:** The frontend must never evaluate expressions or execute code dynamically based on `inputSchema`.
  4. This invariant is formally logged and retained in the threat model as `THREAT-P5-UPSTREAM-XSS` for G4/G5 UI implementation.

### 2.2 Error Path Secret-Leakage Interpretation & Fault Injection (`FAULT-INJ-01`)
- **Finding:** In `apps/gateway/src/http/browser.ts`, unexpected exceptions are caught and logged internally via `logger.error('Unhandled browser upstreams error', { error: err.message })`, while returning a generic 500 to the client. The standard canary test proved leak-free operation on successful paths, but did not test error paths.
- **Resolution & Evidence:**
  1. Added dedicated fault-injection test (`test 11`) in `apps/gateway/test/unit/browser-upstreams-facade.test.ts`. An unexpected exception containing a raw canary credential (`CANARY_FAULT_SECRET_INJECTED_ERR_456`) was injected into `adminService.enableUpstream`.
  2. **Client HTTP Boundary:** Verified that the client receives strictly HTTP 500 with a generic body (`{ "error": "Internal Server Error", "code": "INTERNAL_ERROR" }`). The raw secret was confirmed completely absent from response headers and response body (0 matches).
  3. **Internal Log Sink Analysis:** The server logs record the error via `logger.error`. While `logger.ts` redacts known authorization headers, passwords, tokens, API keys, and emails, unstructured credentials in arbitrary dependency error messages can appear in log sinks. To preserve defense-in-depth, downstream services and repositories must never interpolate raw secret credentials into thrown `Error.message` strings.

### 2.3 Environmental Qualification: Test vs. Live Deployment Divergence
- **Finding:** G3 tests run in an isolated local environment using in-memory SQLite, a mock Kubernetes Secret client, and test configuration permitting localhost loopback overrides.
- **Resolution & Boundary Clarification:**
  1. G3 tests validate route routing, middleware, role enforcement, SSRF prevention, DTO projection, and service contract integration.
  2. G3 tests **do not** validate live cluster-level Kubernetes RBAC permissions, actual etcd Secret storage, or live pod behavior.
  3. The currently deployed Kubernetes cluster image does **not** contain G3 code. Cluster deployment and end-to-end integration remain deferred to Gate P5-G6 (Cluster Staging Verification).

### 2.4 Qualification of Catalog Snapshot
- **Finding:** The phrase "live catalog snapshot" required qualification to distinguish in-memory cache reads from dynamic network discovery.
- **Resolution & Clarification:** The tool endpoint queries the gateway's **in-memory CatalogService snapshot**. In unit tests, this snapshot is seeded directly in memory to test route projection, filtering, and role enforcement; it does not represent live network calls to third-party MCP servers over HTTP during the test.

---

## 3. Resolution of Technical Head Conditions

| # | Condition | Resolution & Implementation Evidence |
|---|---|---|
| **1** | **Endpoint Inventory (9 Routes)** | Implemented and verified all 9 endpoints: 3 reads (`GET /upstreams`, `GET /upstreams/:id`, `GET /upstreams/:id/tools`) and 6 mutations (`POST /upstreams`, `PATCH /upstreams/:id`, `POST /upstreams/:id/enable`, `POST /upstreams/:id/disable`, `DELETE /upstreams/:id`, `POST /upstreams/:id/retry-cleanup`). |
| **2** | **Verified Service Contracts** | Integrated exact `AdminService` and `CatalogService` signatures. Mapped `AdminError` codes (`INVALID_INPUT` $\rightarrow$ 400, `NOT_FOUND` $\rightarrow$ 404, `CONFLICT` $\rightarrow$ 409, `UNAUTHORIZED` $\rightarrow$ 401, `FORBIDDEN` $\rightarrow$ 403, `INTERNAL_ERROR` $\rightarrow$ 500). Handled optional `catalogService` gracefully. |
| **3** | **Precise DTO Projection** | Implemented `toBrowserUpstreamDTO()` with strict field allowlist (`id`, `serviceName`, `displayName`, `url`, `status`, `health`, `metadata`, `createdAt`, `updatedAt`). Set `lastCheck` to `null` if 0 or undefined. Stripped `secretRefName` and `cleanupError`. |
| **4** | **Zero Canary Secret Leakage** | Verified `THREAT-09` and `SECR-SCAN-01` across all response bodies, HTTP headers, and server logs. Added `FAULT-INJ-01` fault-injection test proving zero client leakage on error paths. |
| **5** | **Explicit Security Boundaries** | Tested negative scenarios: member role mutation rejection (`ROLE-NEG-01` $\rightarrow$ 403), missing/invalid CSRF rejection (`CSRF-NEG-01` $\rightarrow$ 403), untrusted Origin rejection (`CSRF-NEG-02` $\rightarrow$ 403), and SSRF validation (`THREAT-10` $\rightarrow$ 400). |

---

## 4. Architecture & Implementation Details

### 4.1 Role-Based Access Control (`browser-middleware.ts`)
```typescript
export function requireRole(...allowedRoles: ('admin' | 'member')[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.browserSession?.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: authentication required', code: 'UNAUTHORIZED' });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({ error: `Forbidden: requires ${allowedRoles.join(' or ')} role`, code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}
```

### 4.2 Safe Projection DTO (`browser.ts`)
```typescript
export interface BrowserUpstreamDTO {
  id: string;
  serviceName: string;
  displayName?: string;
  url: string;
  status: string;
  health: {
    status: 'healthy' | 'unhealthy' | 'unknown';
    lastCheck: string | null;
    consecutiveFailures?: number;
    error?: string;
  };
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function toBrowserUpstreamDTO(record: UpstreamRecord): BrowserUpstreamDTO {
  const lastCheckDate = record.lastCheckedAt && record.lastCheckedAt > 0 
    ? new Date(record.lastCheckedAt).toISOString() 
    : null;

  return {
    id: record.id,
    serviceName: record.serviceName,
    displayName: record.displayName,
    url: record.url,
    status: record.status,
    health: {
      status: (record.healthStatus as 'healthy' | 'unhealthy' | 'unknown') || 'unknown',
      lastCheck: lastCheckDate,
      consecutiveFailures: record.consecutiveFailures,
      error: record.lastHealthError,
    },
    metadata: record.metadata,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
}
```

### 4.3 Endpoint Map & Controls (`browser.ts`)

| HTTP Method | Route | Required Role | CSRF & Origin Enforced | Handler Logic |
|---|---|---|:---:|---|
| `GET` | `/api/v1/browser/upstreams` | `admin`, `member` | No (Safe Read) | Returns all upstream records projected via `toBrowserUpstreamDTO()`. |
| `GET` | `/api/v1/browser/upstreams/:id` | `admin`, `member` | No (Safe Read) | Returns single upstream record or 404 `NOT_FOUND`. |
| `GET` | `/api/v1/browser/upstreams/:id/tools` | `admin`, `member` | No (Safe Read) | Returns tool definitions from `CatalogService` in-memory snapshot for the upstream's `serviceName`. |
| `POST` | `/api/v1/browser/upstreams` | `admin` | **Yes** | Reuses `adminService.registerUpstream()`. Enforces SSRF URL validation. |
| `PATCH` | `/api/v1/browser/upstreams/:id` | `admin` | **Yes** | Reuses `adminService.patchUpstream()`. Enforces SSRF URL validation if URL updated. |
| `POST` | `/api/v1/browser/upstreams/:id/enable` | `admin` | **Yes** | Reuses `adminService.enableUpstream()`. |
| `POST` | `/api/v1/browser/upstreams/:id/disable` | `admin` | **Yes** | Reuses `adminService.disableUpstream()`. |
| `DELETE` | `/api/v1/browser/upstreams/:id` | `admin` | **Yes** | Reuses `adminService.deregisterUpstream()`. |
| `POST` | `/api/v1/browser/upstreams/:id/retry-cleanup` | `admin` | **Yes** | Reuses `adminService.retryCleanup()`. |

---

## 5. Verification & Automated Test Evidence

### 5.1 Compilation & Build
```bash
npm --prefix apps/gateway run build
```
- **Result:** TypeScript compiler `tsc` completed with **exit code 0** (no type errors, no lint issues).

### 5.2 Dedicated G3 Test Suite
```bash
npx tsx --test apps/gateway/test/unit/browser-upstreams-facade.test.ts
```
**Test Results: 12 / 12 PASS, 0 FAIL**
1. `GET /api/v1/browser/upstreams returns allowlisted DTOs without sensitive fields` (PASS)
2. `GET /api/v1/browser/upstreams/:id returns allowlisted DTO for member` (PASS)
3. `GET /api/v1/browser/upstreams/:id/tools returns tool definitions from CatalogService in-memory snapshot` (PASS)
4. `POST /api/v1/browser/upstreams allows admin to register upstream` (PASS)
5. `POST /api/v1/browser/upstreams rejects member with 403 Forbidden [ROLE-NEG-01]` (PASS)
6. `POST /api/v1/browser/upstreams rejects mutation without CSRF token [CSRF-NEG-01]` (PASS)
7. `POST /api/v1/browser/upstreams rejects mutation with untrusted origin [CSRF-NEG-02]` (PASS)
8. `POST /api/v1/browser/upstreams rejects SSRF target [THREAT-10]` (PASS)
9. `PATCH /api/v1/browser/upstreams/:id updates displayName for admin` (PASS)
10. `THREAT-09 & SECR-SCAN-01: Raw canary credentials never appear in API responses, headers, or DTOs` (PASS)
11. `FAULT-INJ-01: Fault injection on error path: unexpected service exceptions with canary secrets return generic 500 without leaking credentials to client` (PASS)
12. `Full Admin Upstream Lifecycle: PATCH, enable, disable, retry-cleanup, and DELETE` (PASS)

### 5.3 Monorepo Test Suite Summary
| Subsystem | Suite | Passed | Failed | Status |
|---|---|:---:|:---:|:---:|
| **apps/gateway** | Unit Tests (`test:unit`) | 275 | 0 | **PASS** |
| **apps/gateway** | Protocol Tests (`test:protocol`) | 10 | 0 | **PASS** |
| **apps/woocommerce-mcp** | Unit & Protocol | 81 | 0 | **PASS** |
| **apps/mcp-crm** | Unit & Protocol | 26 | 0 | **PASS** |
| **apps/mcp-tasks** | Unit & Protocol | 35 | 0 | **PASS** |
| **Total Monorepo Tests** | — | **427** | **0** | **100% Pass** |

---

## 6. Acceptance Criteria Traceability Matrix

| ID | Requirement | Status | Evidence |
|---|---|:---:|---|
| **AC-G3-01** | `requireRole('admin' \| 'member')` middleware enforces RBAC on all browser routes | **PASS** | `apps/gateway/src/http/browser-middleware.ts`, tested in `browser-upstreams-facade.test.ts` (test 6). |
| **AC-G3-02** | `GET /api/v1/browser/upstreams` returns list of upstreams using `BrowserUpstreamDTO` | **PASS** | Tested in test 1 & 2. Returns 200 with sanitized DTOs. |
| **AC-G3-03** | `GET /api/v1/browser/upstreams/:id` returns single upstream using `BrowserUpstreamDTO` | **PASS** | Tested in test 3. Returns 200 for member and admin; 404 for unknown ID. |
| **AC-G3-04** | `GET /api/v1/browser/upstreams/:id/tools` returns tool definitions from `CatalogService` snapshot | **PASS** | Tested in test 4. Returns array of tool manifests. |
| **AC-G3-05** | `POST /api/v1/browser/upstreams` creates upstream via `AdminService`, enforces admin role, SSRF checks, CSRF, and Origin | **PASS** | Tested in test 4 (success), test 6 (role), test 7 (CSRF), test 8 (Origin), test 9 (SSRF). |
| **AC-G3-06** | `PATCH /api/v1/browser/upstreams/:id` updates configuration, validates SSRF, enforces admin role | **PASS** | Tested in test 12. Returns 200 with updated DTO. |
| **AC-G3-07** | `POST /api/v1/browser/upstreams/:id/enable` enables upstream via `AdminService` | **PASS** | Tested in test 12. Returns 200 with active status. |
| **AC-G3-08** | `POST /api/v1/browser/upstreams/:id/disable` disables upstream via `AdminService` | **PASS** | Tested in test 12. Returns 200 with disabled status. |
| **AC-G3-09** | `DELETE /api/v1/browser/upstreams/:id` deregisters upstream via `AdminService` | **PASS** | Tested in test 12. Returns 200 with deregistered status. |
| **AC-G3-10** | `POST /api/v1/browser/upstreams/:id/retry-cleanup` retries cleanup via `AdminService` | **PASS** | Tested in test 12. Returns 200. |
| **AC-G3-11** | Zero credential or canary-secret leakage in browser DTOs, headers, or server logs (`THREAT-09`, `SECR-SCAN-01`) | **PASS** | Tested in test 10 (success paths). |
| **AC-G3-12** | Fault-injection: Unexpected backend exceptions containing canary credentials return generic 500 without leaking credentials to client (`FAULT-INJ-01`) | **PASS** | Tested in test 11 (error paths). |

---

## 7. Changed-File Inventory

| File Path | Type | Summary of Changes |
|---|:---:|---|
| `apps/gateway/src/http/browser-middleware.ts` | Modified | Added `requireRole(...allowedRoles)` middleware with 401/403 status returns. |
| `apps/gateway/src/http/browser.ts` | Modified | Added `BrowserUpstreamDTO`, `toBrowserUpstreamDTO()`, `adminService`/`catalogService` router options, and implemented all 9 `/api/v1/browser/upstreams/*` endpoints. |
| `apps/gateway/src/server.ts` | Modified | Updated `BrowserServerOptions` to accept `adminService` and `catalogService`, and wired them into `createBrowserRouter()`. |
| `apps/gateway/src/index.ts` | Modified | Passed existing `adminService` and `catalogService` to `createBrowserApp()`. |
| `apps/gateway/test/unit/browser-upstreams-facade.test.ts` | **New** | 12 comprehensive automated tests verifying all 9 endpoints, role checks, CSRF, Origin, SSRF, safe DTOs, canary-secret scanning, and fault-injection error path. |
| `Resource/implementation/phase_5_g3_implementation_plan.md` | **New** | Formal implementation plan for Gate P5-G3. |
| `Resource/implementation/phase_5_g3_implementation_report.md` | **New** | Formal completion and verification report for Gate P5-G3. |

---

## 8. Residual Risks & Next Gate Recommendation

### Residual Risks
1. **Upstream Metadata Rendering in Dashboard (Deferred to G4/G5):** Tool description and input schemas originate from upstream services. The dashboard web frontend must treat these fields as untrusted content and render them strictly as plain text, prohibiting HTML injection or unsafe schema rendering (`THREAT-P5-UPSTREAM-XSS`).
2. **Internal Server Log Credential Defense:** While the HTTP boundary guarantees that clients receive only generic error responses without secret leakage, internal application logs record exception messages. Upstream client libraries and repositories must never interpolate raw secret credentials into exception messages.
3. **Local Test Bed vs. Cluster Staging:** All tests ran in local development memory/SQLite test beds with mock Kubernetes Secret clients. Integration against live Kubernetes Secret clients and cluster-deployed containers will occur during Gate P5-G6 staging verification.

### Recommendation
- **Gate P5-G3 Status:** **COMPLETE**.
- **Gate P5-G4 (Invitations, Member Lifecycle, API Key Self-Service):** **REMAINS ON HOLD** pending Technical Head review and formal written authorization.
