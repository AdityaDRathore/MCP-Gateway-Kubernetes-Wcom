# Phase 5 Technical Gap Reconciliation Report (GAP-C01 through GAP-C10)

**Project**: Urumi Enterprise MCP Gateway & Store Platform  
**Scope**: Verification and reconciliation of architectural, security, and operational gaps identified during Phase 4 review and resolved throughout Phase 5.  
**Baseline Git Commit**: `73c3bcb`  
**Accepted Runtime Evidence**: Phase 5 Gate P5-G6 Stage 5 Acceptance Suite (28/28 checks passed)

---

## Executive Summary

During the transition from Phase 4 (automated MCP proxy) to Phase 5 (human management dashboard, browser identity, and dynamic upstream lifecycle), ten critical technical gaps (`GAP-C01` through `GAP-C10`) were identified across authentication, network isolation, persistence, fault tolerance, and compliance.

This report establishes the conclusive, evidence-backed disposition for all ten gaps. **Every gap has been fully resolved, implemented in code, documented in ADRs, and empirically verified in runtime acceptance testing.**

---

## Detailed Gap Reconciliations

### GAP-C01: Separation of Machine API Keys vs Human Browser Sessions
- **Original Gap & Risk**: In Phase 4, the Gateway only supported Bearer API keys. Attempting to authenticate browser users with long-lived bearer tokens stored in browser `localStorage` creates severe XSS token-theft vulnerabilities, or conversely, attempting to use cookies for automated MCP clients exposes tool execution to CSRF attacks.
- **Architectural Resolution**:
  - Full architectural separation into two identity models.
  - Human users utilize opaque 256-bit session tokens stored in `browser_sessions` table and delivered via `HttpOnly`, `SameSite=Lax` cookies.
  - Automated AI agents utilize scoped `mcp_live_...` Bearer API keys.
  - Dual HTTP listeners (Port 3000 vs 3001) enforce protocol separation: Port 3000 rejects cookies entirely; Port 3001 rejects Bearer API keys for browser UI actions.
- **Source Artifacts**: [`apps/gateway/src/auth/session-service.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/auth/session-service.ts), [`apps/gateway/src/http/browser.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/http/browser.ts), [`ADR-019`](../decisions/ADR-019-browser-identity-session-and-csrf.md), [`ADR-020`](../decisions/ADR-020-dual-listener-and-ingress-perimeter.md).
- **Empirical Evidence**: Stage 5 Tests `TEST-8.2.1` (Session establishment), `TEST-8.6.1` (Port 3000 cookie rejection), `TEST-8.6.2` (Port 3001 session cookie validation).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

### GAP-C02: Secure Password Storage via Node Core Scrypt KDF
- **Original Gap & Risk**: Human user onboarding requires password storage. Using weak algorithms (MD5, SHA-256) risks credential compromise via rainbow tables, while external packages (`bcrypt`, `argon2`) require native C++ compilers that break zero-compilation container baselines.
- **Architectural Resolution**:
  - Implemented Node.js 24 LTS core `crypto.scrypt` with cryptographic parameters: $N = 16384$, $r = 8$, $p = 1$, key length 64 bytes.
  - Every user credential generated with a distinct 32-byte cryptographically secure salt.
  - Password verification uses `crypto.timingSafeEqual` over the derived buffer to prevent timing side-channel analysis.
  - Stored in `user_credentials` table with explicit `algo = 'scrypt'` tracking.
- **Source Artifacts**: [`apps/gateway/src/auth/scrypt-password-service.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/auth/scrypt-password-service.ts), [`apps/gateway/src/db/schema.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/db/schema.ts), [`ADR-019`](../decisions/ADR-019-browser-identity-session-and-csrf.md).
- **Empirical Evidence**: Integration test suite `stage1-auth.test.ts`; Stage 5 Tests `TEST-8.1.1` (Password derivation & verification), `TEST-8.1.2` (Invalid password rejection).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

### GAP-C03: Cross-Site Request Forgery (CSRF) & Ambient Auth Neutralization
- **Original Gap & Risk**: Browser session cookies are automatically submitted by browsers on cross-origin requests. An attacker could craft a malicious website executing state-mutating actions (e.g., revoking keys, adding malicious upstreams) against the Gateway dashboard.
- **Architectural Resolution**:
  - Multi-tiered defense:
    1. Browser cookies configured with `SameSite=Lax` and `HttpOnly`.
    2. All mutating browser endpoints (`POST`, `PATCH`, `DELETE` under `/api/v1/browser/*`) validate the `Origin` and `Referer` headers against `DASHBOARD_ORIGIN` / `PUBLIC_ORIGIN`.
    3. Custom request header check: mutating endpoints mandate custom frontend headers (e.g. `X-Requested-With: XMLHttpRequest`), which standard browser HTML forms cannot forge without CORS preflight.
    4. The MCP execution plane on Port 3000 does not parse or accept session cookies under any circumstances.
- **Source Artifacts**: [`apps/gateway/src/http/browser.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/http/browser.ts), [`apps/dashboard/src/context/AuthContext.tsx`](file:///home/rathore/Documents/Urumi%20Assignment/apps/dashboard/src/context/AuthContext.tsx), [`ADR-019`](../decisions/ADR-019-browser-identity-session-and-csrf.md).
- **Empirical Evidence**: Stage 5 Tests `TEST-8.2.3` (CSRF Origin mismatch rejection), `TEST-8.6.1` (Zero cookie ambient auth on MCP port).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

### GAP-C04: Dynamic Upstream Tool Registration & Catalog Snapshot Aggregation
- **Original Gap & Risk**: In Phase 4, upstream tool definitions were static or required restarting the Gateway process to discover new tools.
- **Architectural Resolution**:
  - Implemented dynamic `UpstreamManager` in `apps/gateway/src/upstream/upstream-manager.ts`.
  - Upstreams can be registered, enabled, disabled, updated, or removed at runtime via authenticated Admin REST endpoints (`/api/v1/browser/upstreams/*`).
  - Active tool catalog is dynamically aggregated from all enabled, healthy upstreams and published via standard MCP `tools/list`.
  - Disabling an upstream immediately evicts its tools from the MCP catalog without dropping existing client sessions.
- **Source Artifacts**: [`apps/gateway/src/upstream/upstream-manager.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/upstream/upstream-manager.ts), [`apps/gateway/src/http/browser.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/http/browser.ts), [`ADR-016`](../decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md).
- **Empirical Evidence**: Stage 5 Tests `TEST-8.3.1` (Catalog aggregation across WooCommerce, CRM, Tasks), `TEST-8.3.2` (Dynamic disable tool unpublishing), `TEST-8.3.3` (Dynamic re-enable tool republishing).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

### GAP-C05: Upstream Fault Isolation & Circuit Breaking
- **Original Gap & Risk**: When an upstream service (such as WooCommerce or Mock CRM) experiences high latency or outages, unbounded concurrent agent requests can exhaust Gateway sockets, crash the Node event loop, and cause cascading failure across healthy upstreams.
- **Architectural Resolution**:
  - Integrated `CircuitBreaker` pattern per registered upstream.
  - Tracks consecutive failures; after 5 failures/timeouts, status transitions to `OPEN` / `UNHEALTHY`.
  - While `OPEN`, calls to tools provided by the failing upstream are rejected immediately with descriptive errors, protecting the Gateway event loop.
  - Background periodic health check attempts canary probes; successful probes reset the circuit to `CLOSED`.
  - Admin `POST /api/v1/browser/upstreams/:id/retry-cleanup` endpoint forces immediate circuit reset and cache eviction.
- **Source Artifacts**: [`apps/gateway/src/upstream/circuit-breaker.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/upstream/circuit-breaker.ts), [`apps/gateway/src/upstream/upstream-manager.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/upstream/upstream-manager.ts), [`ADR-015`](../decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md).
- **Empirical Evidence**: Stage 3 stress tests; Stage 5 Tests `TEST-8.7.1` (Upstream timeout detection), `TEST-8.7.2` (Circuit breaker tripping & isolated degradation), `TEST-8.7.3` (Retry-cleanup circuit reset).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

### GAP-C06: Team Member Onboarding, Invitation Lifecycle & Access Revocation
- **Original Gap & Risk**: Manual database seeding of team accounts is error-prone, insecure, and lacks onboarding traceability. Deleting users could break foreign-key relationships in historical audit trails.
- **Architectural Resolution**:
  - Implemented invitation workflow via `user_invitations` table.
  - Administrators generate cryptographically random, single-use invitation tokens with designated roles (`admin` or `member`) and 7-day expiration.
  - Prospective members redeem invitations via `POST /api/v1/browser/invitations/redeem`, securely establishing their own username and password.
  - Account deactivation is implemented via `is_active = 0` flag on `users` table: immediately terminates all active sessions in `browser_sessions` while fully preserving user ID attribution in `audit_logs`.
- **Source Artifacts**: [`apps/gateway/src/auth/invitation-service.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/auth/invitation-service.ts), [`apps/gateway/src/http/browser.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/http/browser.ts), [`ADR-019`](../decisions/ADR-019-browser-identity-session-and-csrf.md).
- **Empirical Evidence**: Stage 5 Tests `TEST-8.1.3` (Invitation generation), `TEST-8.1.4` (Invitation redemption), `TEST-8.2.2` (Deactivation & session eviction).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

### GAP-C07: Scoped API Key Issuance, Constant-Time Comparison & Instant Revocation
- **Original Gap & Risk**: Unscoped machine API keys or keys stored in plaintext expose the system to catastrophic credential leaks. Vulnerabilities in string equality comparison (`===`) allow timing attacks.
- **Architectural Resolution**:
  - Keys use distinct format `mcp_live_<32 hex chars>`.
  - Raw key token is returned strictly once upon creation; only its SHA-256 hash is persisted in `api_keys(key_hash)`.
  - Key validation computes SHA-256 of incoming Bearer token and performs constant-time buffer comparison via `crypto.timingSafeEqual`.
  - Granular scopes: `mcp:tools:read` (listing tools) and `mcp:tools:execute` (invoking tools).
  - Revocation updates `revoked_at` timestamp; revoked keys fail validation instantly.
- **Source Artifacts**: [`apps/gateway/src/auth/api-key-service.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/auth/api-key-service.ts), [`apps/gateway/src/server.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/server.ts), [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md).
- **Empirical Evidence**: Stage 5 Tests `TEST-8.4.1` (API key creation & single-reveal), `TEST-8.4.2` (Scope enforcement), `TEST-8.4.3` (Timing-safe authentication), `TEST-8.4.4` (Immediate revocation).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

### GAP-C08: Two-Phase Tamper-Evident Audit Logging with PII Redaction
- **Original Gap & Risk**: Logging after execution fails to record crashed or aborted requests. Logging raw tool arguments exposes sensitive customer PII (credit cards, email, phone, physical addresses) in violation of GDPR and PCI-DSS.
- **Architectural Resolution**:
  - Implemented two-phase audit logging in `apps/gateway/src/audit/audit-service.ts`:
    - Phase 1 (Pre-execution): Inserts audit record with status `IN_PROGRESS`, tool name, correlation ID, timestamp, and authenticated caller identity.
    - Phase 2 (Post-execution): Updates record with final status (`SUCCESS` / `ERROR`), execution duration (ms), and response metadata.
  - PII Redaction Engine: Automatically parses tool arguments and redacts known sensitive fields (`email`, `billing_address`, `phone`, `password`, `token`) using regex and property name filtering before SQLite insertion.
  - Query API (`GET /api/v1/browser/audit`) restricted strictly to users with `admin` role.
- **Source Artifacts**: [`apps/gateway/src/audit/audit-service.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/audit/audit-service.ts), [`apps/gateway/src/http/browser.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/http/browser.ts), [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md).
- **Empirical Evidence**: Stage 5 Tests `TEST-8.5.1` (Two-phase audit record creation & update), `TEST-8.5.2` (PII masking verification), `TEST-8.5.3` (Audit log pagination & admin RBAC).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

### GAP-C09: Resilient Single-Replica SQLite Persistence & WAL Concurrency
- **Original Gap & Risk**: Distributed multi-pod SQLite deployments cause database corruption due to concurrent writer file-lock conflicts. Pod eviction without proper unmounting can cause stale locks and data loss.
- **Architectural Resolution**:
  - Enforced single-replica deployment architecture: Kubernetes Deployment configured with `replicas: 1` and `strategy: { type: Recreate }`.
  - SQLite initialized with WAL mode (`PRAGMA journal_mode = WAL;`) and busy timeout of 5000ms (`PRAGMA busy_timeout = 5000;`).
  - Online backups utilize SQLite's native `VACUUM INTO` command, guaranteeing consistent snapshots without locking active readers.
  - Dedicated PVC `urumi-gateway-pvc` with strict file permissions (`0600` for `.db` files, owned by UID `10001:10001`).
- **Source Artifacts**: [`apps/gateway/src/db/connection.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/db/connection.ts), [`apps/gateway/src/db/backup.ts`](file:///home/rathore/Documents/Urumi%20Assignment/apps/gateway/src/db/backup.ts), [`infra/helm/urumi-platform/templates/gateway-deployment.yaml`](file:///home/rathore/Documents/Urumi%20Assignment/infra/helm/urumi-platform/templates/gateway-deployment.yaml), [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md).
- **Empirical Evidence**: Stage 5 Tests `TEST-8.8.1` (SQLite WAL mode & PRAGMA verification), `TEST-8.8.2` (Database integrity & pre-Stage-5 backup verification).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

### GAP-C10: Physical Ingress Perimeter Separation & Host-Based Routing
- **Original Gap & Risk**: Exposing management APIs on the same public hostname and port as the MCP tool proxy creates accidental discovery risks and complicates network perimeter firewalling.
- **Architectural Resolution**:
  - Traefik Ingress configured with distinct virtual hostnames:
    - `urumi-gateway.local`: Ingress routes exclusively to Service port `http-mcp` (3000). Requests to `/api/v1/browser/*` return HTTP 404.
    - `urumi-dashboard.local`: Ingress routes exclusively to Service port `http-browser` (3001). Requests to `/mcp` return HTTP 404.
  - Kubernetes NetworkPolicy enforces pod-level egress isolation, allowing traffic only to internal DNS, WooCommerce WordPress, and Mock upstream services.
- **Source Artifacts**: [`infra/helm/urumi-platform/templates/ingress.yaml`](file:///home/rathore/Documents/Urumi%20Assignment/infra/helm/urumi-platform/templates/ingress.yaml), [`infra/helm/urumi-platform/templates/gateway-service.yaml`](file:///home/rathore/Documents/Urumi%20Assignment/infra/helm/urumi-platform/templates/gateway-service.yaml), [`infra/helm/urumi-platform/templates/networkpolicy.yaml`](file:///home/rathore/Documents/Urumi%20Assignment/infra/helm/urumi-platform/templates/networkpolicy.yaml), [`ADR-020`](../decisions/ADR-020-dual-listener-and-ingress-perimeter.md).
- **Empirical Evidence**: Stage 5 Tests `TEST-8.6.1` (Port 3000 MCP routing), `TEST-8.6.2` (Port 3001 Dashboard routing), `TEST-8.6.3` (Host-based Ingress perimeter separation).
- **Disposition**: **RESOLVED & EMPIRICALLY VERIFIED**

---

## 3. Gap Status Summary Matrix

| Gap ID | Description | Resolution Strategy | ADR | Status |
|:---|:---|:---|:---:|:---:|
| **GAP-C01** | API Key vs Session Separation | Dual-listener & independent auth flows | ADR-019, ADR-020 | **RESOLVED** |
| **GAP-C02** | Secure Password KDF | Node core Scrypt ($N=16384, r=8, p=1$) | ADR-019 | **RESOLVED** |
| **GAP-C03** | CSRF & Ambient Auth Defense | SameSite=Lax, Origin & custom header check | ADR-019 | **RESOLVED** |
| **GAP-C04** | Dynamic Upstream Tool Publishing | UpstreamManager runtime aggregation | ADR-016 | **RESOLVED** |
| **GAP-C05** | Circuit Breaker & Fault Isolation | 5-failure threshold & isolated degradation | ADR-015 | **RESOLVED** |
| **GAP-C06** | Member Invitations & Onboarding | Opaque token redemption & active status flag | ADR-019 | **RESOLVED** |
| **GAP-C07** | Scoped API Keys & Timing Defense | SHA-256 hash & `timingSafeEqual` comparison | ADR-013 | **RESOLVED** |
| **GAP-C08** | Two-Phase Audit with PII Redaction | Correlation ID chaining & argument masking | ADR-014 | **RESOLVED** |
| **GAP-C09** | Resilient SQLite Persistence & WAL | Single-replica, Recreate & VACUUM INTO | ADR-012 | **RESOLVED** |
| **GAP-C10** | Ingress Perimeter & Host Routing | Traefik virtual hosts & dual Service ports | ADR-020 | **RESOLVED** |
