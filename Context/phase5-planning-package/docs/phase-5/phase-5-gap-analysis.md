# Phase 5 Technical Discovery and Gap Analysis

**Planning date:** 19 October 2026  
**Status:** DRAFT — evidence-led; no implementation authorized  
**Mandatory Phase 4 input:** Gate G9 Implementation & Acceptance Report and Phase 4 execution log  
**Recommendation:** READY FOR PHASE 5 IMPLEMENTATION PLANNING APPROVAL, subject to the decisions listed here. Phase 4 formal acceptance remains unconfirmed.

## 1. Executive finding

Phase 4 has materially reduced the backend scope of Phase 5. The upstream lifecycle is not a greenfield feature, and neither is API-key hashing/revocation or audit writing. The immediate task is to expose those capabilities safely to a browser and implement the missing human-identity/team workflows. Do not rebuild the upstream manager, credential storage, tool catalog, authentication verifier, or audit writer merely because the dashboard needs them.

The G9 report is the primary record of reported integration evidence. Repository implementation corroborates important parts: upstream CRUD and role middleware in `apps/gateway/src/http/admin.ts`; the upstream lifecycle in `apps/gateway/src/admin/admin-service.ts`; current API-key primitives in `apps/gateway/src/auth/api-key-service.ts` and `apps/gateway/src/db/api-key-repo.ts`; the audit writer and query primitive in `apps/gateway/src/audit/audit-service.ts` and `apps/gateway/src/db/audit-repo.ts`; SQLite schema and migrations in `apps/gateway/src/db/schema.ts`; and chart/deployment/Ingress in `infra/helm/urumi-platform/`.

The main P5 gaps confirmed in the inspected source are: no `apps/dashboard/` frontend package/entry point; no browser login/session mechanism; no HTTP endpoints to manage users, invite Members, issue/list/revoke API keys, or read audit events; no browser-safe per-upstream tool listing; and no browser route/Ingress for the SPA. Backend primitives alone are not user journeys.

## 2. Source inspection method and evidence limits

Repository files were read from the GitHub-connected default branch, including exact source under `apps/gateway`, Helm templates, ADRs, Phase 4 runbook/execution log, README, and `docs/requirements-traceability.md`. Attempts to fetch the expected frontend entry points (`apps/dashboard/package.json`, `apps/dashboard/src/main.tsx`, and `apps/dashboard/vite.config.ts`) returned repository 404s. `apps/gateway/Dockerfile` only builds/copies the gateway TypeScript output and does not include dashboard assets.

The Phase 4 worker's reported test/deployment results are not relabeled as independently rerun in this planning task. No local `git status`, local branch/HEAD comparison, live cluster read, actual current HTTP request, or live database query was performed during this document preparation. Those must happen at P5-G0 before any implementation work. This is especially important because the report identifies the implementation baseline commit as `210d589f2a2658d16766da12617fa03adcab5f56`, while the report itself does not establish that this is the current repository HEAD.

## 3. Existing API and capability inventory

### 3.1 Existing MCP endpoint and upstream integration

| Capability | Current implementation / API | Status for P5 | Notes |
|---|---|---|---|
| One downstream MCP endpoint | `POST /mcp` in `apps/gateway/src/server.ts`, Streamable HTTP, bearer-key auth | Reuse | Existing MCP protocol surface; G9 reports ten tools from CRM, Tasks, WooCommerce. Do not replace it with browser endpoints. |
| Aggregate catalog and tool invocation | `CatalogService`, `UpstreamManager`, `ToolRouter`, gateway MCP server | Reuse | Dynamic namespaced tools and routing are Phase 4 assets. The dashboard should not implement a second MCP aggregation path. |
| List upstreams | `GET /admin/v1/upstreams` | Reuse through browser façade | Implemented in `apps/gateway/src/http/admin.ts`; requires gateway API-key authentication and Admin role. The public ingress currently routes `/mcp`, not this path. |
| Get upstream detail/status | `GET /admin/v1/upstreams/:id` | Reuse through browser façade | DTO provides `status`, `isEnabled`, timeout, tool count, health state, last check, and last error. Browser response needs safe projection and consistent display mapping. |
| Create upstream | `POST /admin/v1/upstreams` | Reuse through browser façade | Zod validation and existing `AdminService` lifecycle are present, including endpoint URL/SSRF policy, optional credential, Kubernetes Secret creation, catalog discovery, audit start/finalize, and compensation. |
| Update upstream / rotate credential | `PATCH /admin/v1/upstreams/:id` | Reuse through browser façade | `UpdateUpstreamSchema` permits configuration and credential fields; secret values must not return to the browser. Do not create another credential store. |
| Enable/disable upstream | `POST /admin/v1/upstreams/:id/enable`, `POST /admin/v1/upstreams/:id/disable` | Reuse | G9 reports catalog grows/shrinks immediately after the isolated lifecycle drill. |
| Delete upstream / retry cleanup | `DELETE /admin/v1/upstreams/:id`, `POST /admin/v1/upstreams/:id/retry-cleanup` | Reuse | Delete and Kubernetes Secret lifecycle already have cleanup/compensation behavior. UI must display `cleanup_required` truthfully instead of treating every HTTP error as rollback success. |
| Per-upstream tools | Aggregate `tools/list` over `/mcp`; upstream status DTO exposes `health.toolCount` | Partial | No browser route returning a selected upstream's actual discovered tool list was found in the inspected Admin router. Reuse the catalog/runtime registry and add a bounded read façade; do not re-discover upstreams in React. |
| Reachability/failure state | `AdminService.toDTO()` merges `UpstreamManager.getUpstreamStatus()` with stored state; tools carry reachability metadata | Reuse with UI mapping | Health enum is `connecting`, `available`, `unavailable`, `disabled`; persisted state includes provisioning/active/disabled/deleting/cleanup_required/failed. Define display mapping and refresh semantics. |

### 3.2 Authentication, users and API keys

| Capability | Current implementation / API | Status for P5 | Notes |
|---|---|---|---|
| Authenticate MCP clients | `POST /mcp` uses `createAuthMiddleware()` and `DatabaseAuthenticator` | Reuse, keep distinct | Expects bearer gateway API key. Browser login must not be implemented by placing an Admin key in `localStorage`. |
| Generate random keys/hash verifier | `ApiKeyService.generateApiKey()` | Reuse primitive | 32 bytes random entropy, `urumi_live_` prefix, SHA-256 verifier, optional expiry, and `rawKey` returned in a result object once. HTTP response must whitelist only permitted metadata plus the one-time raw key; never serialize `apiKey.key_hash`. |
| Verify expiry/revocation | `ApiKeyService.verifyKey()` | Reuse | Checks revocation and expiry on authentication; repository lookup runs on the presented verifier. G9 reports revoked keys are rejected by the next request. |
| Revoke a key | `ApiKeyService.revokeKey()` → `ApiKeyRepository.revokeApiKey()` | Reuse primitive, add owner authorization | The low-level method accepts a key ID; it does not itself bind the action to the request user's ownership. The route/service must reject Member requests for another user's ID. |
| List key metadata | `ApiKeyRepository.listApiKeysByUser(userId)` | Reuse primitive, project DTO | Returns full `ApiKeyRecord` fields, including `key_hash`; never send repository records straight to a browser. Return a deliberately safe DTO with no hash, no secret, and one-time issuance output separated from listing. |
| Create user row | `ApiKeyService.createUser(username, role)` and `ApiKeyRepository.insertUser()` | Reuse primitive, add validated lifecycle | `users` table has `id`, `username`, `role`, `created_at`; the helper is not a user-management API and does not provide invitations, browser credentials, deactivation, or role-change policy. |
| User list/invitation/role updates | No HTTP routes found in `apps/gateway/src/http/admin.ts` | Gap | Build only the endpoints required by the approved Admin/Member model. Do not store members in a second database or in frontend state. |
| Browser identity/password/session | No browser login/session routes; user schema lacks password verifier/session table | Gap / G1 decision | MCP bearer keys are non-interchangeable with human browser identity. A separate server-side session and credential setup flow is required for the requested product experience. |
| One-time first-admin browser setup | Existing `apps/gateway/src/cli/bootstrap.ts` bootstraps a first Admin and API key, idempotently; it does not create a browser password/session | Partial | Extend via an explicit safe bootstrap/enrollment decision, without changing or duplicating the first-admin/API-key invariant or logging one-time secrets. |
| User deactivation / session invalidation | No current user active-state/session schema | Gap / scope decision | Required only if member disablement is included. At minimum, role and invite changes must be checked server-side and not left stale in a client-side role cache. |

### 3.3 Audit read model

| Capability | Current implementation / API | Status for P5 | Notes |
|---|---|---|---|
| Write tool-call audit record | `AuditService.startAudit()` and `finalizeAudit()` | Reuse | G9 reports redacted argument hashes. Start-write failure is fail-closed; finalization failure sets degraded state instead of falsely converting a potentially successful upstream mutation to failure. |
| Persist audit fields | SQLite `audit_logs` table in `apps/gateway/src/db/schema.ts` | Reuse | Fields include user ID, upstream slug, tool name, `arguments_hash`, status, duration, error code/message, created timestamp. Do not fabricate separate start/end timestamps that the schema does not have. |
| Read one audit record | `AuditService.getAuditById()` and repository lookup | Reuse but not user-facing | No HTTP audit query route was found in `apps/gateway/src/http/admin.ts`. A by-ID accessor is not a searchable/paginated audit API. |
| Query audit page | `AuditRepository.listAudits({ limit, offset, status, userId })` | Reuse low-level query | The repository has a bounded-shape query function (current implementation defaults limit 50 and supports status/user ID filters). A safe service method and HTTP contract still need to validate the maximum limit, authorization, allowed filters, actor display fields, and redaction. |
| Audit table / filters | No dashboard frontend | Gap | UI should show actor/upstream/tool/time/duration/outcome; raw tool args/results must not be shown. Existing args hash is for redaction, not a user-facing substitute for tool inputs. |
| Audit retention | `AuditService.pruneAuditLogs(retentionDays = 30, batchLimit = 500)` | Existing capability; policy needs approval | Confirm intended retention and whether pruning is invoked operationally, documented, and acceptable for assignment evidence before enabling automatic deletion in this phase. |

## 4. Requirement-to-API traceability matrix

The matrix maps every P5 requirement in this work order to current implementation evidence, a proposed bounded action, and a concrete acceptance test. Proposed `/api/v1/browser/*` routes below are **not implemented APIs**; they are a recommended contract namespace to approve at G1. Existing `/admin/v1/*` paths are current APIs.

| Requirement | Existing capability | Evidence/location | Gap | Phase 5 action | Acceptance test |
|---|---|---|---|---|---|
| P5-01 Admin browser authentication | MCP bearer-key authentication only | `src/auth/middleware.ts`, `src/auth/api-key-service.ts`, `src/db/schema.ts` | No browser credentials/session | Implement approved browser login/session separate from API key | Unauthenticated browser API returns 401; valid session resolves user/role; raw API key is not required or accepted as a browser password/session. |
| P5-02 Logout/expiry/revocation | MCP key expiry/revocation supported | `src/auth/api-key-service.ts`; ADR-013 | No browser-session lifecycle | Add session expiry, server-side logout/revocation, and CSRF/origin rules | After logout/expiry/revocation, next unsafe/read request requiring session is rejected; old cookie cannot restore session. |
| P5-03 Admin/Member authorization | Admin router enforces bearer-authenticated Admin role; G9 reports Member 403 | `src/http/admin.ts`, G9 report, `test/unit/admin.test.ts` | No browser session role check or browser API | Authoritative permission middleware for browser routes, plus direct route tests | Member direct `POST/PATCH/DELETE` upstream route returns 403 and leaves DB/Secrets/catalog unchanged. |
| P5-04 Upstream list | Admin REST list already exists | `src/http/admin.ts` + `AdminService.listUpstreams()` | Private route not browser-consumable; no UI | Add browser list facade reusing AdminService; safe DTO | Admin and Member see the configured list; fields match service result; no credential values. |
| P5-05 Status and tool visibility | Health state and tool count in DTO; catalog supports `tools/list` | `src/admin/admin-service.ts`, `src/admin/admin-types.ts`, G9 report | No per-upstream tools API/UI; display mapping unapproved | Add safe upstream tools read endpoint/DTO and UI state mapper | The list shows exact discovered tools and count per server; an isolated unreachable upstream shows unavailable and healthy peers still work. |
| P5-06 Create upstream | `POST /admin/v1/upstreams` plus saga and validation | `src/http/admin.ts`, `src/admin/admin-service.ts`, G9 report | No dashboard form or browser identity façade | Bind UI to existing service; never reimplement registration/Secret logic | Admin creates unique isolated test upstream; UI shows tools; secret not in response/log/DB. |
| P5-07 Edit configuration/rotation | `PATCH /admin/v1/upstreams/:id`, schema supports config/credential fields | `src/http/admin.ts`, `src/admin/admin-types.ts` | Reported route wording conflicts (G9 says `PUT .../credential`; current router exposes `PATCH /upstreams/:id`) | Use currently verified source contract unless G9 execution evidence reconciles it; provide form/rotation workflow | Change timeout and rotate a disposable upstream credential; old/new values are never displayed or logged; source/API path mismatch closed with curl evidence. |
| P5-08 Enable/disable/delete/cleanup | Enable, disable, delete, retry-cleanup routes and saga | `src/http/admin.ts`, `src/admin/admin-service.ts` | UI and explicit destructive confirmation | Reuse existing methods and model transitional/cleanup state | Disable removes test upstream tools; enable restores them; deletion removes only isolated fixture/its secret; faulted cleanup status remains honest. |
| P5-09 Team member management | `users` table and `createUser()` helper | `src/db/schema.ts`, `src/auth/api-key-service.ts` | No member-list/create/invite/role API; no browser login setup; no name/email fields | Define minimal account fields and single-use invitation workflow with safe bootstrap; don't invent email service | Admin creates invite; invalid/expired/replayed invite rejected; Member cannot create an Admin or mutate another member. |
| P5-10 Admin issues key to a member | Key generator already accepts `userId` | `src/auth/api-key-service.ts` | No issuance API, UI, or safe DTO | Add Admin-only key issuance for selected existing member, optional expiry only if approved | Key verifies for intended member; cannot be read again; DB/logs contain only verifier; wrong target/role rejected. |
| P5-11 Member self-service own key | List/revoke primitives exist | `src/db/api-key-repo.ts`, `src/auth/api-key-service.ts` | No self-service routes; no ownership guard in repository method | New browser endpoints bind user ID from session, never request query/body | Member lists and revokes own keys; attempts to read/revoke another user's ID fail with 403/404 and leave key valid. |
| P5-12 Key status/expiry/revocation | `expires_at`, `revoked_at`, `last_used_at`, verification logic | `src/db/schema.ts`, `src/auth/api-key-service.ts` | Safe summary API missing | UI displays status based on metadata; avoid implying a `null` expiry expires | Expired/revoked key fails next MCP request with 401; active key succeeds; UI shows exact status/expiry and not raw verifier. |
| P5-13 Audit log list/retrieval | Write path, audit schema, and repository `listAudits()` | `src/audit/audit-service.ts`, `src/db/audit-repo.ts`, `src/db/schema.ts` | No service list method/HTTP route/UI; filters limited | Add validated read service and browser endpoint with bounded pagination/filters; safe DTO | Admin page results match read-only DB sample and status filters; max limit is enforced; member cannot request global logs. |
| P5-14 Audit attribution and display | `user_id`, `upstream_slug`, `tool_name`, `created_at`, `duration_ms`, status | `src/db/schema.ts`, `src/db/audit-repo.ts` | Username join / actor display response not available; schema lacks separate start/end time | Join user display via service; label one event timestamp; add no fabricated columns | Sample rows show actor, upstream, tool, timestamp, duration and outcome consistent with stored record. |
| P5-15 Credential/key/audit redaction | API key verifier-only persistence; upstream response omits credential value; audit args hashed | `ApiKeyService`, `AdminService.toDTO()`, `AuditService`, G9 report | Browser layer/DTO/logging behavior not present | Explicit safe DTOs; disable client request/response body logging on secret forms; redact server errors | Canary tokens/keys are absent from browser storage, DOM after close, console, HTTP error bodies, audit rows, DB snapshots and logs. |
| P5-16 SPA scaffolding and typed client | Existing backend Zod schemas; npm workspaces and shared package boundary | `package.json`, `apps/gateway/src/admin/admin-types.ts`, `README.md` | `apps/dashboard/` entry and frontend package absent; no generated API schema evidenced | Add React/Vite workspace; define typed browser DTOs and error mapping; don't duplicate validation/business logic | Clean checkout installs/builds both workspace targets; frontend typecheck/build passes; API contract tests detect DTO mismatch. |
| P5-17 CORS/CSRF/browser transport | MCP endpoint has bearer auth; no browser cookie route identified | `apps/gateway/src/server.ts`, `package.json` | Browser cookie attack surface and CORS policy not yet defined | Prefer same-origin SPA/API; strict Origin validation, CSRF protection for unsafe methods, no wildcard CORS | Cross-origin mutation attempts fail; invalid Origin/CSRF token rejected; same-origin login and form submission succeeds. |
| P5-18 Ingress and deployment | Existing Helm chart and local/prod values; current gateway ingress routes `/mcp` to port 3000 | `templates/ingress.yaml`, `templates/gateway-deployment.yaml`, `values-local.yaml` | No browser port/static asset path; catch-all can accidentally expose private admin router if mounted on same port | Recommended second in-process browser listener/port 3001; Ingress `/mcp` → port 3000, `/` → port 3001; browser listener omits Admin router | Rendered Helm manifests and live probes show `/mcp` works, UI/browser API works, external `/admin/v1/upstreams` remains 404, internal Admin API retains auth/RBAC. |
| P5-19 Data/persistence invariant | SQLite `node:sqlite`, WAL/PVC, one replica, Recreate strategy; G9 reports integrity after pod replacement | ADR-012, `src/db/connection.ts`, gateway Deployment, G9 report | New session/invitation fields require migration and pod-replacement proof | Add forward-only schema migration; don't change PVC, replica or database owner; no destructive rollback | `PRAGMA integrity_check=ok`; new sessions/users/keys/upstreams/audit persist after controlled pod replacement; PVC UID and protected store fixtures unchanged. |
| P5-20 Existing regression and Phase 6 compatibility | G9 reports build/test/Helm and `/mcp` tests | G9 report and `docs/phase-4/g9-e2e-acceptance-runbook.md` | No cross-version/browser-to-MCP regression evidence yet | Rerun gateway + WooCommerce/CRM/Tasks suites; add MCP Inspector-ready connection instructions | Existing bearer-key MCP connection still lists ten tools; revocation behavior works; tool namespace/route contract unchanged and supports Phase 6 agent identity. |

## 5. Proposed browser-facing API contract (to approve, not current implementation)

Use a new, explicitly named browser API such as `/api/v1/browser/*`, protected by the browser session. Do not repurpose the gateway MCP API key as the browser session. Do not expose raw `/admin/v1/*` through the dashboard listener.

| Proposed route | Role | Purpose and service reuse |
|---|---|---|
| `POST /api/v1/browser/session` | Anonymous with login rate limit | Verify browser credential and create server-side session; generic failure response |
| `GET /api/v1/browser/session` | Authenticated | Return minimal `{ id, username, role }` identity |
| `DELETE /api/v1/browser/session` | Authenticated + CSRF | Logout/revoke current server-side session |
| `GET /api/v1/browser/upstreams` | Admin/Member read | Safe projection of `AdminService.listUpstreams()` |
| `GET /api/v1/browser/upstreams/:id` | Admin/Member read | Safe projection of `AdminService.getUpstream()` |
| `GET /api/v1/browser/upstreams/:id/tools` | Admin/Member read | New wrapper around the existing live catalog snapshot, filtered by server slug; no credentials |
| `POST /api/v1/browser/upstreams` | Admin | Calls existing `AdminService.createUpstream()` |
| `PATCH /api/v1/browser/upstreams/:id` | Admin | Calls existing `AdminService.updateUpstream()`; rotation inputs never redisplayed |
| `POST /api/v1/browser/upstreams/:id/enable` / `/disable` | Admin | Calls existing lifecycle functions |
| `DELETE /api/v1/browser/upstreams/:id` | Admin + CSRF | Calls existing delete/compensation logic |
| `POST /api/v1/browser/upstreams/:id/retry-cleanup` | Admin + CSRF | Calls existing cleanup recovery |
| `GET /api/v1/browser/members` | Admin | New safe member-list service; never exposes password/session/invite verifiers |
| `POST /api/v1/browser/invitations` | Admin + CSRF | New single-use Member invitation/enrollment; no email dependency in MVP |
| `POST /api/v1/browser/invitations/accept` | Invite token | Redeem exactly once and establish browser credential |
| `GET /api/v1/browser/keys` | Admin or Member | Admin can view metadata globally; Member can query only session user's own keys |
| `POST /api/v1/browser/keys` | Admin or Member | Admin provides target user ID; Member target is derived from session subject, not request input |
| `POST /api/v1/browser/keys/:id/revoke` | Admin or key owner | Ownership check occurs server side; existing `ApiKeyService.revokeKey()` reused after authorization |
| `GET /api/v1/browser/audit` | Admin | New service/route on top of `AuditRepository.listAudits()`, validated page and whitelisted filters |
| `GET /api/v1/browser/audit/mine` | Deferred; requires decision | Implement only if Member audit visibility is approved; hard bind subject to current session |

The exact path prefix and response schemas are a G1 freeze item. Browser routes must use a strict route allowlist, no generic proxy to arbitrary Gateway paths, no user-supplied SQL, and bounded page sizes. Status codes should be consistent (`401` unauthenticated, `403` authenticated but forbidden, `404` absent resource where chosen to avoid cross-user disclosure, `400/422` invalid input, `409` conflict, `502` dependency failure). Error responses must use safe messages/codes without upstream bodies, credential strings, stack traces, or raw submitted secrets.

## 6. Data migration and state ownership constraints

- The gateway alone opens `/data/gateway.db`. Dashboard HTTP handlers may call shared in-process services/repositories; do not mount/open the same SQLite database from another pod/process.
- Keep the gateway at one replica with its current `Recreate` strategy and existing PVC. Do not set Deployment `maxSurge` or introduce concurrent writers. Don't shrink/delete PVCs or switch StorageClass during P5.
- Use a forward-only, versioned migration for browser credential verifier, session, invitation, and optional session revocation data. Test migration against a copy of the schema/database in a disposable environment first. Do not delete/seed the live database to “reset” the test.
- `users` currently stores `id`, `username`, `role`, `created_at`; `api_keys` references `user_id`. Preserve existing Admin and Member rows/API keys through migration. Do not store raw password, raw invitation token, raw browser session token, raw API key, or upstream secret value in SQLite.
- Upstream credentials remain in Kubernetes Secrets managed by the current gateway `ServiceAccount`, `urumi-gateway-secrets` namespace, and namespaced RBAC. Browser users must never gain Kubernetes API access.
- Keep WooCommerce MCP as the only path to WordPress/WooCommerce REST. Gateway/dashboard remains blocked from WordPress and MariaDB by NetworkPolicy. Do not modify products 10, 11, 12 or Order #14; use a uniquely named disposable upstream fixture and synthetic data.

## 7. Contradictions and claims requiring reconciliation

| ID | Contradiction / claim needing reconciliation | Evidence | Required resolution |
|---|---|---|---|
| GAP-C01 | G9 report says credential rotation used `PUT /admin/v1/upstreams/test-crm-iso/credential`; inspected `apps/gateway/src/http/admin.ts` currently defines `PATCH /upstreams/:id` with credential fields and no `PUT /credential` route. | G9 report §5; current `src/http/admin.ts` and `UpdateUpstreamSchema` | Check the exact deployed image/commit and captured curl command. Record the actual route and align report/runbook/tests; do not build UI against a route that doesn't exist. |
| GAP-C02 | G9 says all Admin endpoints are private with external 404; current Ingress exposes `/mcp` only. Adding a catch-all dashboard path on the same target port would also route `/admin/v1/*` into the private router. | G9 report §4; `templates/ingress.yaml`; `src/server.ts` mounting `/admin/v1` | Use separate in-process listener/Service port or another reviewed allowlist design. Test external 404 and internal Admin API functionality after change. |
| GAP-C03 | ADR-013 describes managing users/keys and reading audit routes (`POST /admin/v1/api-keys`, `GET /admin/v1/audit`) as role capabilities, but current router defines only upstream CRUD and falls through for other paths. | `ADR-013`; `src/http/admin.ts` | Treat these as design intent/primitives, not implemented HTTP endpoints. Add endpoints in Phase 5 and test them. |
| GAP-C04 | `docs/requirements-traceability.md` still marks Phase 4 requirements (GTW-01..11), SEC-01/SEC-04, and audit writing as planned or assigns key/auth implementation to Phase 5 despite G9 reporting completed gateway authentication/audit writing. | `docs/requirements-traceability.md`, G9 report, Phase 4 source | At P5-G0 update statuses with separate labels for source-inspected, worker-reported, independently verified, and formally accepted. Do not mark all of them complete just from the report. |
| GAP-C05 | Architecture text describes a static React/Vite SPA served by Gateway, while README describes `apps/dashboard` as Phase 5 and no frontend workspace or SPA assets exist in the inspected repository. | `docs/architecture.md`, `README.md`, failed frontend path fetches, `apps/gateway/Dockerfile` | Correct stale wording/status as part of P5-G7 and define a reproducible build/deploy plan. |
| GAP-C06 | ADR-012 is marked `Proposed — Pending Technical Head Approval`, but G9 says SQLite/WAL/persistence and pod replacement were implemented and verified at Helm revision 9. | `ADR-012`; G9 report and execution log | Technical Head must explicitly accept/replace ADR-012 status and confirm the production constraints. Do not infer architectural approval from an implementation report. |
| GAP-C07 | G9's benchmark reports one failure at concurrency 10 and p95 latency approximately 1.65–3.20 seconds at concurrency 5–20 while summarizing “stable resource utilization.” | G9 report §8 and `g9-e2e-acceptance-runbook.md` | Not necessarily contradictory: queue protection and memory stability can coexist with latency. Record as baseline, avoid promising sub-second p95, and rerun only if P5 adds material load or a revised performance target is approved. |
| GAP-C08 | Current source schema uses `arguments_hash`, but the report prose refers to `args_hash`. Also the schema stores `created_at` plus `duration_ms`, not distinct start/end timestamps. | `src/db/schema.ts`, `src/db/audit-repo.ts`, G9 report §4 | Use canonical field names in API DTO and runbooks; label the recorded timestamp accurately and do not invent missing timestamps. |
| GAP-C09 | Older Phase 3 completion evidence lists 120 tests, while the Phase 4 G9 matrix lists 81 `apps/woocommerce-mcp` unit tests. | Phase 3 completion record/project study and G9 report §2 | Treat as potentially different revisions/suites, not automatic failure. Capture actual post-Phase-4 test counts in the G0 baseline and use that as the P5 regression baseline. |
| GAP-C10 | The G9 report says an image/deployment was verified against baseline `210d589...`; the report does not by itself prove that the current remote branch, local checkout, and live Helm revision correspond to the same commit/chart. | G9 report preamble and §7; Phase 4 execution log | Before code work, capture Git HEAD, live image IDs/digests, Helm revision/values and deployment rollout. Freeze the implementation baseline with that evidence. |

## 8. Decisions needed from the Technical Head

1. **Browser authentication:** approve a separate password-based browser session with opaque server-side session tokens, `HttpOnly`/`SameSite` cookie, explicit expiry/logout, CSRF protection and strict Origin checks; do not use an API key as browser login. Confirm if a different browser identity mechanism is required.
2. **First administrator:** approve a one-time CLI-generated browser enrollment credential/token that does not alter existing Admin/API-key bootstrap behavior, uses no hardcoded default, and is stored only as a verifier. Define the operator recovery path.
3. **Member onboarding:** approve single-use, expiring, out-of-band invitations (no mail delivery dependency) and whether Admin can promote/change role or deactivate a Member in this MVP.
4. **Member API-key self-service:** preserve the original assignment story and allow a Member to create/list/revoke only their own keys; Admin can issue/revoke for any Member. Confirm whether Member expiry selection is necessary or default/no-expiry is sufficient for the assignment.
5. **Member audit visibility:** keep global logs Admin-only and default to no Member audit view unless the Technical Head explicitly confirms “own audit history” as required. If approved, it must be strictly subject-bound and testable.
6. **Browser listener / Ingress:** approve same-process browser port 3001 serving the SPA and `/api/v1/browser/*`, with `/mcp` on port 3000, so the Admin router is not reachable via the catch-all path. Keep current `/mcp` URL stable unless a separately reviewed URL change is required.
7. **Audit contract:** approve limit/offset page semantics (bounded limit), filters (status/user/upstream/tool/time as schedule allows), display of sanitized error summaries, and retention policy. Existing repository query directly supports only limit, offset, status and user ID.
8. **ADR-012 and Phase 4 status:** formally accept or revise the SQLite/WAL ADR and G9 closure status. Ensure the deployed image/chart and current source versions line up before P5 begins.
9. **Performance:** use G9 results as baseline; no new hard p95 target without approval. Decide whether the single concurrency-10 failure must be investigated before the submission, if it reproduces under clean baseline.

## 9. Gate G0 verification checklist before P5 implementation

Run read-only checks only, with credentials redacted:

```bash
git status --short --branch
git rev-parse HEAD
git log -1 --format='%H %cs %s'
find apps -maxdepth 3 -type f | sort | grep -E 'dashboard|gateway/src/(http/admin|admin/admin-service|auth/api-key-service|audit/audit-service)'
grep -R "router\.(get\|post\|patch\|put\|delete)" apps/gateway/src/http
kubectl config current-context
kubectl -n urumi get deploy,pod,svc,ingress,pvc -o wide
helm -n urumi history urumi-store
helm -n urumi get values urumi-store
```

The `kubectl`/Helm checks above are a future approved operational preflight, not commands executed during this planning task. Do not dump Secret values. Confirm the live deployment/image identifier and status before relying on G9's report. If baseline differs, stop and reconcile first.

Protected read-only baseline to preserve across Phase 5: WooCommerce product IDs 10, 11, 12; Order #14; and PVCs `urumi-gateway-pvc`, `urumi-mariadb-pvc`, `urumi-wordpress-pvc`. Test mutations must use isolated upstream `test-...` fixtures or synthetic CRM/Tasks data. Never use product IDs 10/11/12 or Order #14 as write-test targets.

## 10. Phase 5 planning exit

G0 may exit only when the source/cluster baseline is captured and the contradiction register is acknowledged. G1 may exit only when browser identity, session lifecycle, role matrix, API contract, listener/Ingress separation, invitation/bootstrap behavior, key ownership, audit pagination/redaction, and migration design are approved. No implementation starts before approval of the Phase 5 planning documents and explicit release of the implementation hold.
