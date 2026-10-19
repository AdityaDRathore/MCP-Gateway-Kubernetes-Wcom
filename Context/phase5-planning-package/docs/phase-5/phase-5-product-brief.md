# Phase 5 Product Brief — Team Platform and Dashboard

**Project:** Urumi AI FDE Internship — Team MCP Gateway on Kubernetes  
**Planning date:** 19 October 2026  
**Target submission deadline:** 26 October 2026, 11:59 PM IST  
**Status:** DRAFT — submitted for Technical Head review; implementation HOLD remains in effect  
**Mandatory Phase 4 input:** `Phase-4-—-Gate-G9-Implementation-&-Acceptance-Report.txt` and `docs/phase-4/phase-4-execution-log.md`  
**Recommendation:** READY FOR PHASE 5 IMPLEMENTATION PLANNING APPROVAL. This is not implementation authorization or Phase 4 acceptance.

## 1. Product objective

Phase 5 turns the already-reported Phase 4 gateway core into a team-manageable product. An administrator should not need to use raw administrative HTTP calls or inspect SQLite/Kubernetes objects for normal workflows. Team members should have a distinct browser identity, see the shared tools they are permitted to use, obtain and revoke their own gateway API keys, and never receive upstream credentials. The dashboard must show the gateway's real state—including disabled or unreachable upstreams, partial failures, and audit degradation—instead of inventing optimistic status.

The dashboard is a management surface for the existing gateway, not a replacement gateway. MCP clients continue to call the single downstream MCP endpoint. WooCommerce operations continue through `urumi-woocommerce-mcp`; the gateway/dashboard must not call WordPress or MariaDB directly. The gateway continues to own SQLite, the dynamic upstream catalog, upstream credentials in Kubernetes Secrets, and tool-call audit writing.

## 2. Evidence baseline and product boundary

The G9 report is a worker completion recommendation marked `READY FOR TECHNICAL HEAD ACCEPTANCE`; formal Technical Head acceptance was not supplied with the report. The report records ten tools in the deployed catalog, upstream lifecycle tests, key-revocation and role checks, private ingress behavior, audit redaction, SQLite integrity after pod replacement, and regression/performance evidence. Treat these as reported results until the Technical Head accepts G9 and the evidence is reconciled with current source.

Repository paths reviewed for this brief include:

- `apps/gateway/src/http/admin.ts` — existing authenticated Admin REST router and upstream routes.
- `apps/gateway/src/admin/admin-service.ts` and `apps/gateway/src/admin/admin-types.ts` — upstream lifecycle logic, SSRF/validation contract, status/health DTO, and secret-safe upstream response model.
- `apps/gateway/src/auth/api-key-service.ts`, `apps/gateway/src/auth/database-authenticator.ts`, `apps/gateway/src/db/api-key-repo.ts` — key generation, verifier hashing, expiry/revocation checks, and user/key repository primitives.
- `apps/gateway/src/audit/audit-service.ts`, `apps/gateway/src/db/audit-repo.ts`, and `apps/gateway/src/db/schema.ts` — two-phase audit writes, redacted argument hashes, and persistence schema.
- `infra/helm/urumi-platform/templates/ingress.yaml`, `infra/helm/urumi-platform/templates/gateway-deployment.yaml`, `apps/gateway/Dockerfile` — existing ingress, SQLite deployment, and gateway image packaging.
- `docs/decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md`, `docs/decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md`, `docs/phase-4/g9-e2e-acceptance-runbook.md`, `docs/phase-4/phase-4-execution-log.md`, and `docs/requirements-traceability.md`.

The repository contains no `apps/dashboard/package.json`, Vite entry point, or dashboard source at the inspected paths. `apps/gateway/Dockerfile` builds the gateway but does not copy dashboard assets. Current ingress sends `/mcp` to the gateway on port 3000; it does not evidence a deployed browser UI. User, key, and audit persistence primitives exist, but the inspected Admin router exposes upstream management only. There is no implemented browser session/login route, member-management route, API-key management route, or audit list route in that router.

## 3. Primary users and permission model

### Admin

An Admin can authenticate to the browser dashboard; list and inspect upstreams and discovered tools; add, edit, enable, disable, rotate credentials for, retry cleanup on, and remove an approved upstream; invite/list/manage team members; issue/revoke keys for a specific member; and view a global audit table. The Admin may see key metadata and a key's short identifier/prefix, but never retrieve a persisted raw key or upstream credential. A generated MCP API key is displayed once at issuance.

### Member

A Member can authenticate to the dashboard; see the shared upstreams and tools/status permitted by the approved policy; generate a gateway MCP API key tied to their own immutable user ID; list metadata for their own keys; and revoke only their own keys. Members cannot manage upstreams, create/promote/deactivate other members, issue a key for another user, read global audit history, see upstream credentials, or obtain an Admin API key. Any member-owned key workflow depends on an explicit approved authorization policy; it must not be inferred from UI visibility.

### Authorization matrix

| Capability | Admin | Member | Enforcement point |
|---|---|---|---|
| Sign in / sign out / view own identity | Yes | Yes | Browser session service; not MCP API-key authentication |
| View shared upstream list and tool catalog | Yes | Yes, read-only by default | Browser API plus backend authorization |
| Create/update/enable/disable/delete upstreams; rotate upstream credential | Yes | No | Server-side Admin authorization; UI hiding is insufficient |
| Retry upstream cleanup | Yes | No | Server-side Admin authorization |
| List members/invite member/change member role | Yes | No | Server-side Admin authorization |
| Issue a key for any member | Yes | No | Server-side Admin authorization and target-user validation |
| Issue/list/revoke own gateway key | Yes | Yes, own keys only | Server-side subject/ownership check in every request |
| Revoke another user's key | Yes | No | Server-side Admin authorization |
| Read global audit events | Yes | No | Server-side Admin authorization |
| Read own audit events | Deferred/decision required | Deferred/decision required | Add only if approved and backed by a user-scoped query |
| View/retrieve upstream credential values | No browser role | No browser role | Never returned by any browser/API response |
| Invoke MCP tools using gateway API key | Yes | Yes, subject to current gateway behavior | Existing `/mcp` bearer-key auth; not the browser session |

## 4. Required user journeys and capability mapping

### Journey A — Admin signs in and reviews gateway state

1. Open the dashboard URL and authenticate using the approved browser identity mechanism.
2. The dashboard calls a browser-facing session endpoint and renders the authenticated identity/role.
3. The upstream table loads from the existing upstream service/DTO, including enabled state, operational status, last reachability state, tool count, timeout, and a safe error summary where available.
4. A selected upstream detail shows its discovered tools. If an upstream is unreachable, the UI identifies it as unreachable and permits retry/refresh; it does not mark the entire gateway down or hide healthy upstreams.

**Reuse:** `AdminService.listUpstreams()` and `getUpstream()` expose the upstream DTO and health fields; Phase 4 reports dynamic catalog updates and fault isolation.  
**Gap:** Browser session identity, browser-safe API contract, discoverable per-upstream tool-list response, SPA, and ingress path. 
**Acceptance:** A deployed browser login can load the three baseline upstreams; tool counts and reachability match a fresh backend response; killing a disposable upstream changes only its status/tool availability and leaves the other two usable.

### Journey B — Admin adds and manages an isolated upstream

1. Enter slug/name, endpoint URL, timeout, and optional credential in a protected form.
2. Submit through the browser API. The server reuses the current URL/SSRF validation and secret-manager lifecycle; the browser receives only safe metadata.
3. Show provisioning/result/error state, then discovered tools and health. Permit configuration update, enable/disable, credential rotation, retry cleanup, and deletion with clear confirmations.
4. The credential input is cleared after submission; the raw value is never redisplayed. A delete is followed by a re-fetch so the UI reports actual backend state, including `cleanup_required` if compensation did not finish.

**Reuse:** existing internal routes mounted at `/admin/v1`: `GET/POST /upstreams`, `GET/PATCH /upstreams/:id`, `POST /upstreams/:id/enable`, `/disable`, `/retry-cleanup`, and `DELETE /upstreams/:id`. These routes use API-key authentication and Admin role enforcement; their handlers dispatch to `AdminService`. Existing service handles URL policy, credential Secret lifecycle, catalog registration and compensation.  
**Gap:** React form/table, browser session façade, ingress reachability, and a tools-by-upstream browser contract.  
**Acceptance:** All mutations operate only against a uniquely named disposable test upstream; secret scans of responses, browser logs, audit rows, and screenshots show no credential. Existing WooCommerce/CRM/Tasks registrations and protected store records are unchanged.

### Journey C — Admin invites a Member and issues/revokes a key

1. Admin creates a member identity/invitation without granting Admin role by default.
2. Member completes the approved one-time enrollment and authenticates independently in the browser.
3. Admin may issue a gateway MCP key for the Member. The Member may issue an additional key for their own user if the Technical Head retains that user story.
4. The plaintext key is shown exactly once in page memory with copy/warning controls. No browser persistent storage, analytics, console output, server log, or audit payload receives the raw key.
5. Admin or Member revokes a permitted key. The next `/mcp` request using the revoked key must return HTTP 401; other keys remain valid.

**Reuse:** SQLite `users` and `api_keys` tables; `ApiKeyService.createUser()`, `generateApiKey()`, `revokeKey()`, and `verifyKey()`; repository `listApiKeysByUser()` and revocation support. Existing keys use 32 bytes of random entropy, a `urumi_live_` prefix, SHA-256 verifier storage, optional expiry, and immediate revocation checks.  
**Gap:** Browser login/password/session, safe invite lifecycle, HTTP endpoints, ownership enforcement, safe DTO projection, member role management, and browser UI. `ApiKeyRepository.listApiKeysByUser()` returns records containing `key_hash`; a new API must deliberately project a metadata-only DTO and must never serialize repository records directly.  
**Acceptance:** Admin can invite a Member and issue/revoke that Member's key. Member A cannot query/revoke Member B's keys by changing IDs or request parameters. Member cannot create an Admin. Raw key appears in the issuance response exactly once and is absent from persisted DB rows/logs; revocation rejects the next MCP request.

### Journey D — Authorized audit review

1. Admin opens an audit table and sees actor, upstream, tool, time, duration, outcome, and a safe error classification.
2. Admin can page through results and filter by user/upstream/tool/status/time where supported and approved.
3. The UI never shows raw arguments or raw results. Audit input is a non-reversible hash, and errors must be sanitized before display.
4. If audit finalization is degraded, the UI presents that state truthfully; it never implies full audit success.

**Reuse:** `AuditService` writes pending records before dispatch and finalizes outcome; failed start writes fail closed, while finalization failure is marked degraded. `AuditRepository.listAudits()` already supports limit/offset and optional status/userId filters. The persisted `audit_logs` columns include user ID, upstream slug, tool name, argument hash, status, duration, error code/message, and created timestamp.  
**Gap:** A public-to-the-browser, session-authenticated read service/route; safe pagination/filter validation; actor display-name join; an API response DTO with safe error fields; table UI. The existing schema records `created_at` and `duration_ms` rather than separate start/end timestamps; the UI must not fabricate separate values.
**Acceptance:** Create successful, failed, timed-out, and `unconfirmed_outcome` records using disposable/mock calls; compare the browser table with redacted SQLite read-only evidence. Admin sees global events; Member cannot read global events. If “Member sees own usage” is adopted, verify the server always binds the query's `userId` to the session subject.

## 5. Recommended Phase 5 architecture

The preferred design is a small React/Vite SPA plus a browser-only HTTP surface that reuses the existing Gateway services in-process. Keep a single Node gateway process, a single SQLite connection/owner, the existing one-replica `Recreate` Deployment, existing PVC and namespace boundaries, and current upstream credential storage. Do not create a second application process that opens `/data/gateway.db`, introduce a multi-writer arrangement, or copy the database to a separate dashboard service.

Proposed listener/ingress split, pending Technical Head approval:

- Keep the existing MCP/control-plane listener on container port 3000. The MCP ingress route stays on `/mcp`; the private `/admin/v1/*` router remains on this listener for internal operational/admin use, protected by bearer-key authentication and role checks.
- Add a browser listener on a separate container/Service port (proposed 3001) that serves only the built SPA, browser session endpoints, and explicitly defined browser-safe management endpoints. It must not mount or proxy arbitrary `/admin/v1/*` paths.
- Add an Ingress `/mcp` path to service port 3000 and a `/` catch-all path to port 3001. The browser listener returns 404 for `/admin/v1/*`, preserving the G9 perimeter test even after the dashboard root is exposed. Verify the rendered and live Ingress precedence for `/mcp` versus `/` before acceptance. If this port split is rejected, an alternative must demonstrate the same externally observed `404` for `/admin/v1/upstreams` and cannot make the private Admin router reachable through a broad `/` route.
- Build `apps/dashboard` using the existing free/open-source React/Vite stack. Copy its static build assets into the gateway image in a multi-stage Docker build, or document a separately deployed frontend only if that alternative preserves SQLite ownership and the same boundaries. Do not add a second process that opens the SQLite PVC.
- Browser API uses a dedicated server-side session, not the gateway MCP API key. Keep browser routes same-origin to avoid broad CORS. Cookie-authenticated state changes require CSRF protection and Origin validation. The MCP endpoint continues to require an explicit bearer API key and never accepts a browser cookie as MCP identity.

This is a recommendation, not an accepted ADR. G1 must freeze listener topology, session design, browser endpoint prefixes, and ingress behavior before implementation.

## 6. Browser authentication and team model proposal

The existing `users` table contains `id`, `username`, `role`, and `created_at`; it does not contain a password verifier, invitation state, session, or browser identity fields. The existing bootstrap CLI creates the initial Admin and issues a one-time MCP API key; it does not establish browser login credentials. Consequently, an API key is not a valid substitute for browser identity.

Recommended MVP for Technical Head approval:

- Password-based browser login using Node's built-in password-hashing primitive with per-user salt and explicit versioned parameters; no paid identity provider or OAuth service is required. A browser session is a random opaque token with only its hash stored server-side in the existing SQLite database. No session token is stored in `localStorage` or `sessionStorage`.
- Cookie is `HttpOnly`, `SameSite=Lax`, scoped narrowly to the dashboard path where practical, and `Secure` in TLS-enabled deployments. Any local plain-HTTP exception is development-only and documented. Add idle/absolute expiry, explicit logout, and invalidation after password/role/member revocation. Store session rows in the same SQLite database with a schema migration.
- Enforce CSRF controls for cookie-authenticated mutations: synchronizer token or equivalent approved pattern plus strict Origin checking. Do not enable wildcard CORS. Rate-limit repeated login failures and return generic authentication errors.
- Because no mail service is required or budgeted, Admin can issue a single-use invitation/enrollment token to deliver out of band. Store only a verifier for the token, apply expiry and one-time redemption, and require the invited Member to establish their browser credential before use. This is a proposed workflow and needs Technical Head approval.
- Bootstrap: extend the operator-only, idempotent CLI (or add a sibling bootstrap action) to provision the first Admin's browser credential/session-enrollment path without hardcoded defaults or logging the token. It must not destroy, recreate, or reset the existing admin/user/key rows on repeat runs. Recovery must be an explicit operator action with audit/evidence, not a web backdoor.
- Role authority stays in the backend. Any role change or user disablement must be reflected by the next request and must not rely on stale frontend state.

## 7. Success measures

### Mandatory product acceptance

1. An Admin can sign in, see the three baseline upstreams and current status/tool counts, and manage a disposable upstream from the dashboard.
2. An Admin can create/invite a Member and issue/revoke keys using the approved user-management model.
3. A Member can sign in, view permitted upstream/tool information, generate/list/revoke only their own API keys if self-service remains in the approved scope, and cannot reach Admin-only functionality by direct HTTP call.
4. Invalid, expired, and revoked MCP keys are rejected by `/mcp`; a revoked key fails on the next request.
5. Upstream credentials and raw API keys are never returned in list/detail responses or written to browser persistent storage, console logs, server logs, or audit records. API key plaintext is presented once at issuance only.
6. Audit reads are authorized, paginated, redacted, and truthful about degraded/unknown outcomes.
7. Dashboard status reflects the backend rather than frontend-only state; a disposable unreachable upstream is shown as unavailable without affecting healthy siblings.
8. Dashboard and gateway deploy through the existing Helm chart/k3d setup while preserving one SQLite writer, `urumi-gateway-pvc`, Secret namespace/RBAC, NetworkPolicy, and protected WooCommerce records.
9. `/admin/v1/*` continues to return an external 404 on the public ingress route; `/mcp` remains the downstream MCP endpoint; internal upstream MCP Services remain unexposed.
10. A downstream MCP client can continue using the same gateway URL/key protocol after Phase 5, enabling Phase 6 without reworking the gateway contract.

### Proposed usability measures (not grading KPIs)

- Common Admin tasks can be completed without direct database or `kubectl` modification.
- All forms have inline validation, pending/success/error state, and destructive confirmation where appropriate.
- Core flows work with keyboard navigation and at a practical mobile/tablet viewport.
- A novice operator can identify `Connected`, `Unreachable`, `Disabled`, `Provisioning`, `Failed`, and `Cleanup required` states without reading server logs.

## 8. Scope and non-goals

### Mandatory Phase 5

- React/Vite management UI and safe deployment/Ingress integration.
- Browser identity/session; role-aware routes and backend authorization.
- Upstream list/detail/status/tool display and lifecycle forms wired to existing backend services.
- Member creation/invitation and Admin/Member management consistent with the approved model.
- API key issue/list/revoke workflows with ownership and display-once safety.
- Audit read API, pagination/filtering as justified, and an audit table with redacted metadata.
- Tests for server-side authorization, cookie/CSRF behavior, secret/key redaction, errors, persistence, and complete Admin/Member journeys.

### Explicit non-goals / deferred

- OAuth/OIDC replacement, external identity provider, email-delivery service, paid SaaS, or paid UI component library.
- Multi-store provisioning, per-tool fine-grained permissions, distributed gateway scaling, multi-writer SQLite, or migration to a network database.
- A sophisticated design system, broad analytics, heavyweight observability stack, chat agent, LLM provider integration, MCP Inspector demonstration, or final submission packaging. Chat agent and external MCP-client demonstration stay Phase 6; reliability hardening stays Phase 7; final acceptance/demo/submission stay Phase 8.
- Production/VPS rollout or destructive infrastructure operations as part of planning. `values-prod.yaml` must remain valid, but VPS deployment is not assumed mandatory unless the original assignment/Technical Head makes it so.

## 9. Dependencies, risks and decision ownership

The Phase 5 critical path is: formal Phase 4 acceptance and clean baseline → approved browser identity/ingress/role design → SPA + authenticated browser APIs → upstream management → member/key lifecycle → audit reads/UI → full regression and Phase 5 acceptance → Phase 6 chat and external MCP client.

The largest delivery risk is not CRUD form work; it is introducing secure browser identity while keeping the MCP API-key identity, private Admin routes, Secret RBAC, and single-writer SQLite model separate. Other high risks are the missing per-upstream tool-view contract, key ownership enforcement, audit-read authorization/redaction, stale traceability statuses, and the short remaining schedule.

The accompanying `phase-5-gap-analysis.md`, `phase-5-master-roadmap.md`, and `phase-5-risk-and-decision-register.md` contain the full requirement-to-test matrix, gate exits, and proposed Technical Head decisions.

## 10. Phase 5 done definition

Phase 5 is ready to recommend for Technical Head acceptance only when: all mandatory stories are demonstrated against the deployed local cluster; Admin and Member authorization tests pass through direct API calls as well as the UI; key issuance is display-once and ownership-scoped; upstream credentials are unobservable from browser outputs; audit records are queryable and redacted; the public ingress perimeter remains valid; protected store data/PVCs are unchanged; existing Phase 4 gateway, upstream, protocol, and regression suites pass; and the runbook/requirements matrix/master roadmap include evidence and known exceptions.

A green UI build by itself is not Phase 5 acceptance, and Phase 5 completion does not complete the whole assignment. Phases 6–8 remain separate deliverables.
