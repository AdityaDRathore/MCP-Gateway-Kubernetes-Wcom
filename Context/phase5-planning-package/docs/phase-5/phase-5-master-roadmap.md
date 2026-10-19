# Phase 5 Master Technical Roadmap — Team Platform and Dashboard

**Planning date:** 19 October 2026  
**Deadline:** 26 October 2026, 11:59 PM IST  
**Status:** DRAFT — for Technical Head review; implementation HOLD remains  
**Phase 4 input:** Gate G9 completion report is mandatory and currently labelled `READY FOR TECHNICAL HEAD ACCEPTANCE`; formal acceptance not yet evidenced.  
**Recommendation:** READY FOR PHASE 5 IMPLEMENTATION PLANNING APPROVAL. No implementation work order is issued by this document.

## 1. Goal and phase boundary

Deliver a usable team dashboard on top of the existing Gateway services: Admin/Member browser identity, upstream and tool management, team/member and API-key lifecycle, and a redacted audit table. Reuse Phase 4's `AdminService`, `UpstreamManager`, catalog, `ApiKeyService`, SQLite repositories, `AuditService`, Secret Manager, and authentication primitives. Do not rebuild gateway routing or move database/credential ownership to the frontend.

Phase 5 finishes only after an evidence-backed recommendation for Technical Head acceptance. Phase 6 remains chat agent + external MCP client; Phase 7 remains reliability/deployment hardening; Phase 8 remains final acceptance/demo/submission. It is not valid to claim the assignment complete at Phase 5.

## 2. Phase 4 baseline facts and stop conditions

The G9 worker report records: ten tools across CRM, Tasks and WooCommerce; passing build/regression and Helm checks; API-key authentication, role checks and revocation; dynamic upstream CRUD/discovery/disable/delete/credential rotation using an isolated fixture; redacted audit writes; NetworkPolicy/RBAC probes; and SQLite `PRAGMA integrity_check` after a pod replacement at Helm revision 9. It also reports products 10/11/12 and Order #14 unchanged. These are **reported outcomes**, not formal acceptance.

Source inspection corroborates existing upstream CRUD/service, API-key verifier/service primitives, audit writer/query-repository primitives, SQLite WAL and existing PVC deployment, and a chart Ingress that currently routes `/mcp` to port 3000. It also identifies gaps and inconsistencies in the gap analysis: no dashboard workspace/assets; no browser login/session; no user/key/audit read routes in the current Admin router; report's `PUT .../credential` path not matching the current source router; and ADR-012 still marked `Proposed — Pending Technical Head Approval`.

**Hard implementation start conditions:** (1) Technical Head reviews/accepts Phase 5 planning documents; (2) implementation hold is explicitly released; (3) G0 baseline is captured; (4) Phase 4 acceptance status and current source/image/chart are reconciled; (5) G1 decisions are approved. If these conditions are not met, stop at planning. Do not infer authorization from this roadmap.

## 3. Recommended technical shape

- One Node gateway process remains the sole owner of `/data/gateway.db`, one SQLite connection, existing WAL/PVC, and existing Secret operations. Keep the single replica and `Recreate` deployment strategy. Do not add a second pod/process that opens the SQLite database.
- Add `apps/dashboard/` as a React/Vite workspace. Build static assets in a multi-stage build and copy them into the gateway image, subject to G1 approval.
- Proposed listener split: existing port 3000 retains `/mcp` and the private bearer-key-protected `/admin/v1/*` router; a new browser listener/service port (proposed 3001) serves the static dashboard and a strict allowlist of session-authenticated `/api/v1/browser/*` routes only. The listener shares already-created in-process services; it does not open SQLite separately and must not mount/proxy `/admin/v1/*`.
- Ingress routes `/mcp` to port 3000 and `/` to browser port 3001. On the browser listener, `/admin/v1/*` and unknown paths must return 404. Preserve current local host/URL where practical. Validate longest-prefix behavior of the rendered/live Ingress and NetworkPolicy before acceptance.
- Browser uses opaque server-side sessions; MCP clients use bearer API keys. Never use API keys as a browser login or place an Admin key in browser storage. Prefer same-origin API calls, no wildcard CORS, strict Origin checks, CSRF protection for unsafe cookie-authenticated methods, and an `HttpOnly`/`SameSite` cookie with `Secure` under TLS.
- Upstream credentials stay in `urumi-gateway-secrets` under existing namespaced RBAC. React handles input only; existing backend validation and Secret lifecycle remain authoritative. No browser role is allowed to access Kubernetes Secrets.

The listener/Ingress design and browser session design are proposals, not accepted ADRs. G1 must freeze them before implementation. If the proposed split is rejected, an alternative must pass the same ingress perimeter acceptance tests.

## 4. Gate overview and dependency sequence

| Gate | Focus | Dependencies | Exit condition |
|---|---|---|---|
| P5-G0 | Baseline and contract verification | Phase 4 G9 report + current repository/cluster access | Current revision/deployment/source baseline captured; source/report contradictions dispositioned; product/gap scope approved |
| P5-G1 | Browser identity and role model | G0 | Identity/session/threat design, role matrix, API contract, migration, bootstrap and ingress/listener decisions approved; automated contract/security tests specified |
| P5-G2 | Dashboard foundation | G1 | Reproducible React/Vite workspace/build/deployment; browser listener and protected navigation work; sessions gate protected views |
| P5-G3 | Upstream and tool management | G2 | Admin upstream lifecycle and tool visibility pass E2E; Members cannot mutate upstreams; no secret disclosure |
| P5-G4 | Team and API-key management | G1, G2; shares account/session model | Admin invites Members/issues/revokes keys; Member manages only own keys if approved; revocation proven against `/mcp` |
| P5-G5 | Audit log and operational feedback | G1, G2; audit write path already exists | Authorized, paginated/redacted audit reads and honest failure state; filter/ownership rules verified |
| P5-G6 | Integration, accessibility and security regression | G2–G5, stable deployment | Mandatory Admin/Member journeys, bypass tests, protocol/security regression and protected-store invariants pass or approved exception exists |
| P5-G7 | Documentation and acceptance | G6 | reproducible operator/developer documentation, demo script, updated traceability/master roadmap, evidence-backed completion report and Technical Head handoff |

Gates are sequential review points, not permission to implement immediately. A gate's technical DoD is not a gate approval. After each gate, record exact commit, tests/exit codes, image identifier, Helm revision, fixture cleanup and explicit stop/go decision. If a gate fails, repair only within its approved scope and rerun its gate tests before proceeding.

---

## 5. P5-G0 — Baseline and Contract Verification

### Objective and bounded scope

Capture the actual source and deployment baseline; verify what the G9 worker report says against current repository and deployed state; inventory existing frontend, gateway services, contracts, Helm and network boundaries. Read-only inspection only. No source edits, image builds, Helm upgrades, key creation, fixture mutation, or cluster changes in G0.

### Dependencies and assumptions

- Requires current repository and cluster access for final baseline capture.
- G9 report/runbook/execution log are inputs, not a substitute for current revision/deployment proof.
- Protected entities/PVCs remain fixed: WooCommerce products 10/11/12, Order #14, `urumi-gateway-pvc`, `urumi-mariadb-pvc`, and `urumi-wordpress-pvc`.

### Tasks and expected files

1. Record `git status --short --branch`, `git rev-parse HEAD`, latest commit, and workspace/package list.
2. Confirm whether `apps/dashboard/` is absent or was added since the current source snapshot. Record `apps/gateway` routes and the Zod schemas actually mounted in the active router.
3. Capture chart and cluster state read-only: context, namespace, deployments/pods/services/Ingress/PVCs, Helm release history/current values, current image IDs/digests, current rollout status. Redact credentials and never decode Secrets for evidence.
4. Read `docs/phase-4/phase-4-execution-log.md`, `docs/phase-4/g9-e2e-acceptance-runbook.md`, G9 report, ADR-012/013/014, `docs/requirements-traceability.md`, `docs/architecture.md` and `README.md`.
5. Reconcile at minimum GAP-C01–C10 from `phase-5-gap-analysis.md`; mark each `resolved`, `accepted discrepancy`, or `open decision` with source line/command evidence.
6. Freeze the P5 requirement and API inventory; baseline pass counts from actual current test execution can only be captured after test execution is explicitly authorized. Until then, the G9 test counts remain reported values.

### Acceptance and verification

- A baseline note in `docs/phase-5/phase-5-baseline.md` includes commit SHA, branch/worktree, chart/Helm revision, image reference/ID/digest, route map, PVC UIDs, protected-store snapshot reference, and exact inspection commands.
- An API inventory marks each endpoint as `implemented and source-confirmed`, `worker-reported but not reconciled`, `design-only`, or `missing`.
- Every G9 route discrepancy is reconciled; if credentials route or image/source revision differs, stop and obtain Technical Head disposition.
- Product brief, gap analysis, roadmap, and decision register agree on scope and definitions.

### Risks, rollback and stop condition

Risk: trusting stale README/traceability status or an unaligned image could send the UI against nonexistent endpoints. There is no rollback because G0 is read-only. Stop if the current commit/deployment cannot be reconciled with the G9 report, a protected baseline changes unexpectedly, Secret metadata changes unexpectedly, or the source/cluster differs materially from assumptions. Return evidence to the Technical Head; do not “fix” the cluster as part of G0.

### Required evidence and approval

- Baseline report and contradiction disposition table.
- No live mutation; output should show the working tree was not altered by G0.
- Technical Head approval of G0 findings and release of the planning hold is required before G1 design/implementation work beyond documentation.

---

## 6. P5-G1 — Browser Identity and Role Model

### Objective and bounded scope

Freeze the identity plane, session threat model, role matrix, invitation/bootstrap flow, browser-facing routes, ownership rules, audit-read authorization, and database migration plan before frontend/backend implementation. This gate is primarily contract/design work; code remains on hold until G1 approval.

### Recommended design for review

- Browser user identity is a username/account with a versioned password verifier; use a built-in Node password-hashing primitive with salt and reviewed parameters unless the Technical Head directs otherwise. Never store raw password.
- Browser sessions are opaque, high-entropy tokens; store only token hashes in the existing SQLite database. Cookies are `HttpOnly`, `SameSite=Lax`, path-scoped, and `Secure` in TLS-enabled deployments. Define idle and absolute expiry, logout, role-change invalidation and recovery.
- Cookie mutation protection: strict Origin checks plus a synchronizer CSRF token or explicitly approved equivalent, bounded body sizes, generic auth errors and login rate limiting. Same-origin browser UI/API avoids wildcard CORS.
- The current bootstrap CLI provisions an Admin and one-time MCP API key but no browser credential. A new explicit one-time enrollment path should be operator-triggered, idempotent, with verifier-only token storage and no hardcoded initial password. No email service is assumed; a single-use invitation can be delivered out of band.
- Admin manages members/roles/keys. Member key self-service binds `userId` to the authenticated session and forbids target-user override. Raw MCP keys are shown once only. Member global audit access is denied; an own-audit view is deferred unless explicitly approved.
- Proposed same-process listener split: port 3000 retains `/mcp` and private `/admin/v1/*`; port 3001 has SPA and only browser-safe `/api/v1/browser/*` routes. The browser listener does not mount the private Admin router. Both listeners share existing in-process services/one DB connection. Ingress `/mcp` maps to 3000; `/` maps to 3001. `/admin/v1/*` through the browser host must return 404.

### Tasks and artifacts

1. Finalize permission matrix, data classification, threat boundary and session lifecycle diagrams.
2. Define the browser API schema and status/error contract for session, upstream, tools, members/invitations, API keys, and audit reads.
3. Decide if an invitation token is the member's initial setup mechanism and how first-admin recovery works.
4. Define a versioned forward-only SQLite migration adding required password/session/invitation fields/tables only; preserve current `users`, `api_keys`, `upstreams`, and audit rows.
5. Define strict safe browser DTOs. Do not return `key_hash`, raw invitation/session verifiers, Secret references where unnecessary, raw upstream credentials, or unsanitized `error_message`.
6. Define authorization matrix at the service and router level; choose whether own-audit read is in scope.
7. Freeze listener/Ingress/network policy values, one-replica SQLite assumptions, CSRF and cookie settings for local HTTP vs TLS production values.

### Acceptance and verification plan

Design review must include test cases before implementation:

- **AUTH-01:** no session → browser API 401; invalid credentials use generic error.
- **AUTH-02:** successful login → current-session endpoint returns ID/username/role only.
- **AUTH-03:** logout, absolute expiry, idle expiry and revoked session fail on the next request.
- **AUTH-04:** Member session cannot call an Admin mutation by direct HTTP; role middleware is server-authoritative.
- **AUTH-05:** invalid Origin/CSRF on cookie-authenticated mutation fails; same-origin call passes.
- **AUTH-06:** API key presented to login is not a valid browser credential; session cookie is not accepted as MCP `/mcp` bearer key.
- **AUTH-07:** invitation token expires, cannot be replayed, and never appears in DB/logs after hashing.
- **AUTH-08:** bootstrap rerun does not overwrite an existing Admin or rotate existing API keys unexpectedly.
- **NET-01:** browser listener returns 404 for `/admin/v1/upstreams`; internal port-3000 Admin router remains bearer-authenticated and Admin-only.
- **DB-01:** migration from existing schema retains users, key verifiers/status, upstreams, audit rows and integrity.

### Risks, rollback and stop condition

Risk: the short deadline encourages reuse of a gateway API key as a browser login. That is explicitly prohibited. Another risk is adding a broad `/` Ingress to the port containing private `/admin/v1` routes. Stop if the listener isolation cannot be proven with rendered/live route tests, or if role/ownership rules remain ambiguous. Do not start G2–G5 until the Technical Head approves the G1 design/contract and required tests.

### Required evidence and approval

- Approved decision register and permission matrix.
- Approved browser API schema with each endpoint marked proposed/current.
- Approved migration/session/bootstrap/invitation strategy and ingress diagram.
- G1 formal go decision before code work proceeds.

---

## 7. P5-G2 — Dashboard Foundation

### Objective and bounded scope

Create the React/Vite workspace and reproducible build/deployment path, implement the browser listener/static asset serving, login/logout/current identity, route protection, typed browser client, common error/loading states, and accessible base layout. No chat agent is included.

### Dependencies and expected artifacts

Requires approved G1 decisions. Proposed source/artifacts:

- `apps/dashboard/package.json`, `apps/dashboard/vite.config.ts`, `apps/dashboard/index.html`, `apps/dashboard/src/main.tsx`, `apps/dashboard/src/app/*`, `apps/dashboard/src/api/*`, and shared type modules as approved.
- Gateway browser routes/session service and session migrations under `apps/gateway/src/` and `apps/gateway/src/db/`.
- `apps/gateway/Dockerfile` update to build/copy SPA assets; update the gateway Express app/listener only after the listener split is approved.
- Helm gateway Service/Ingress templates and values for both listener ports; preserve one gateway pod/PVC.
- Unit tests for session lifecycle, browser route allowlist, cookie/CSRF, and SPA build; no secrets in build arguments.

### Tasks

1. Add React/Vite workspace within existing npm monorepo; align Node/npm workspace lock without unrelated dependency changes.
2. Implement a typed fetch client that sends same-origin requests, handles 401/403 and safe API error shapes, and never serializes API secrets into browser storage.
3. Implement login, logout and `/session` identity check; render role-aware navigation after server-authenticated state is known.
4. Build accessible forms, tables, empty states, spinners, retry actions, status pills and confirmation dialogs. UI visibility is convenience only.
5. Add SPA serving on the browser listener, a hardened 404 fallback, and static cache headers appropriate for the build. Do not let fallback HTML turn API or `/admin` errors into HTTP 200.
6. Wire Helm local/prod values to the new ports and assets. Do not deploy to a VPS in this gate.

### Acceptance and exact verification

- `npm ci` succeeds from a clean tree; `npm run build` plus `npm --workspace=dashboard run build` (once workspace exists) and TypeScript/type/lint checks pass.
- `helm lint infra/helm/urumi-platform` and `helm template` with local and prod values pass; rendered Service contains the intended ports and Ingress route mapping.
- A deployed local browser URL loads the SPA, login/logout works, unauthenticated protected views do not render protected data, and unknown paths/`/admin/v1/*` return the specified 404/401 behavior.
- Ingress `/mcp` still reaches port 3000 and passes existing MCP protocol smoke tests; browser root goes to port 3001. No new Ingress exposes CRM, Tasks or WooCommerce MCP Services.
- No raw key/credential is put into React local/session storage, build-time Vite variables, public source maps, or URL query strings.

### Risks, rollback and stop condition

Risk: frontend bundles can accidentally embed build-time secrets; catch-all routes can leak private Admin endpoints; Docker changes can omit static assets from the runtime stage. Roll back the dashboard image/chart revision only through an approved non-destructive Helm process while keeping the PVC/SQLite intact. Stop if either `/mcp` regression or external `/admin` 404 fails; no database deletion/reset is an acceptable rollback.

### Required evidence and approval

- Successful clean-build logs, dependency/lockfile diff, Helm render, local ingress route tests, screenshots of login/loading/error states (no real secrets) and browser security tests.
- G2 acceptance review before G3/G4 feature completion is declared.

---

## 8. P5-G3 — Upstream and Tool Management

### Objective and bounded scope

Build the management surface on the existing upstream service. Admin can list/inspect/add/edit/enable/disable/rotate/delete/retry cleanup. Admin and Member can view only the tool/status information approved for each role. Browser code never talks to upstream MCP services directly.

### Dependencies and expected artifacts

Requires G2 and approved G1 API contracts. Expected artifacts include the upstream list/detail form/table and tools table in `apps/dashboard/src/features/upstreams/`, browser API service/DTOs in `apps/gateway/src/`, and component/contract/E2E tests. No new domain logic for SSRF, secret names, K8s Secret writes or upstream clients should be created in React.

### Tasks

1. Build `GET /api/v1/browser/upstreams`, detail and tools listing around `AdminService` and the existing catalog snapshot. Define a safe DTO mapping of stored status plus current health/tool names.
2. Build create/edit forms using the same constraints as `CreateUpstreamSchema` and `UpdateUpstreamSchema`; show validation messages without duplicating backend authority.
3. Credential rotation uses the source-confirmed service operation; reconcile GAP-C01 before wiring the UI. Credential controls are write-only and clear immediately after submit.
4. Add enable/disable and delete confirmations; display `provisioning`, `failed`, `disabled`, `deleting`, `cleanup_required`, `available`, and `unavailable` honestly. Offer retry-cleanup only when applicable.
5. Refresh/re-query server state after every mutation; never optimistically declare a successful mutation before API confirmation.
6. Use isolated fixtures such as unique `p5-probe-<timestamp>` slugs; do not mutate/remove baseline WooCommerce products/orders or existing baseline upstreams.

### Acceptance and exact verification

- **UP-01:** Admin views the three known upstreams; enabled status/tool count match the current backend catalog.
- **UP-02:** Admin creates a disposable CRM/Tasks test upstream, sees it in the catalog/tool view, invokes a safe synthetic read tool, updates configuration, disables/enables, rotates credentials, and deletes the fixture.
- **UP-03:** Disabled upstream tools disappear from `tools/list`; re-enabled upstream tools return without a gateway restart.
- **UP-04:** Member attempts every direct mutating browser endpoint and receives 403; SQLite upstream row, Secret metadata, and catalog remain unchanged.
- **UP-05:** Unreachable fixture displays unavailable; healthy WooCommerce/CRM/Tasks siblings remain callable.
- **UP-06:** Responses, console, logs, table DOM and screenshots never include raw credential; secret rotation never redisplays its prior/current value.
- **UP-07:** URL validation rejects loopback/metadata/IP/private or disallowed destinations as currently defined by `validateAndNormalizeUpstreamUrl()`; the dashboard cannot bypass server-side SSRF checks.
- **UP-08:** Simulated cleanup-required response is rendered as incomplete cleanup and not successful deletion.
- **NET-02:** External `/admin/v1/upstreams` remains 404; direct browser Admin mutation is denied server-side; internal API auth/RBAC behaves as before.

### Risks, rollback and stop condition

Risk: duplicate business logic, frontend interpretation of a transient health state as a confirmed connection, race between disable/delete and catalog refresh, or destructive use of a baseline upstream. Rollback means disable/remove only the disposable test fixture through normal lifecycle APIs and revert the approved application/chart revision if needed. Stop on any secret leak, SSRF-policy discrepancy, change to baseline upstream configuration, or protected store/PVC drift.

### Required evidence and approval

- Upstream E2E run log showing each lifecycle transition and tool-catalog delta.
- Secret-leak check result with canary values (never real credentials) and protected-baseline comparison.
- G3 review before claiming upstream management complete.

---

## 9. P5-G4 — Team and API-Key Management

### Objective and bounded scope

Implement invitation/member account APIs and UI, key issuance/listing/revocation, ownership enforcement, one-time display, and browser identity bootstrap. Reuse the current `ApiKeyService` and repositories; do not store raw keys. No OAuth, external email delivery, or new identity SaaS.

### Dependencies and expected artifacts

Requires approved G1 identity/bootstrap/invite contract and G2 base session UI. Proposed source additions include browser auth/account/key routes, session/invitation service/repository, schema migration(s), Member directory and key screens, and focused tests. All DB access remains within the gateway process and existing connection.

### Tasks

1. Add a forward-only SQLite migration for approved password/session/invitation storage. Preserve existing users/API keys/upstreams/audit rows and existing migration compatibility.
2. Implement first-admin browser enrollment and Member single-use invite acceptance with expiry, replay protection and hashed tokens. Never print reusable passwords or place token in logs/query params.
3. Implement Admin list/invite/create and allowed role changes; validate unique usernames and map duplicate/invalid input to safe 400/409 errors. Members cannot promote or create users.
4. Implement key issuance for Admin target user and Member self-service. In Member requests, target user ID derives from session principal; ignore/reject client-supplied target user override.
5. Use safe key response DTO: raw key appears only in issuance response; metadata includes ID/name/prefix/created/expiry/revocation/last-used but never `key_hash` or raw key. Never re-show a key from a later list view.
6. Add an explicit “copy now; shown once” state with confirmation before dismissal/navigation. Key stays only in component memory and is discarded on navigation/unmount; avoid persistent drafts or logging.
7. Revoke through current service. Ownership is checked in a transaction/service boundary before calling `revokeKey`; after revoke, authenticate against real `DatabaseAuthenticator` and call `/mcp` immediately.

### Acceptance and exact verification

- **TEAM-01:** Bootstrap on an empty disposable DB creates one Admin enrollment path; re-running bootstrap does not add/overwrite another Admin or rotate existing API key.
- **TEAM-02:** Admin invites a Member; invite is one-use, expires, cannot replay; Member can establish browser session.
- **TEAM-03:** Admin issues key to selected Member; key belongs to expected user; raw key shown once; second GET/list never returns raw key.
- **TEAM-04:** Member issues own key (if approved), lists only their metadata, revokes their own key, and cannot act on another user's key ID.
- **TEAM-05:** Direct requests for cross-user key list/revoke return 403 or the approved non-enumerating 404 without affecting the target; promotion to Admin is denied to Member.
- **TEAM-06:** Database holds only SHA-256 key verifier, password verifier, and hashes of invitation/session tokens; canary strings are absent from DB dump, app logs, frontend storage and HTTP errors.
- **TEAM-07:** Active key succeeds at `/mcp`; revoked and expired keys receive HTTP 401 on the next request; unaffected key still succeeds.
- **TEAM-08:** Existing key/user rows and upstream/audit data survive schema migration and controlled pod replacement; `PRAGMA integrity_check` returns `ok`.

### Risks, rollback and stop condition

Risk: cross-user IDOR on key endpoints, exposed verifier hash, invite replay, insecure first-admin reset, or migration failure. Do not downgrade by restoring an old DB over the live PVC. If a migration or auth test fails, stop rollout, retain PVC, capture integrity/readiness evidence and use the reviewed SQLite recovery procedure. Stop on any account/key ownership violation or raw key leakage.

### Required evidence and approval

- Schema migration test from current version; current Admin/key fixture preserved.
- E2E traces for Admin invite/key issue, Member own-key flow, cross-user denial and immediate `/mcp` revocation.
- G4 review before G5 depends on these endpoints.

---

## 10. P5-G5 — Audit Log and Operational Feedback

### Objective and bounded scope

Expose persisted tool-call audit events to authorized browser users using the existing audit repository. Implement a clear table and essential filters/pagination. Do not change the current fail-closed start-write/truthful-finalize contract unless a separately approved ADR requires it.

### Dependencies and expected artifacts

Requires G1 authorization/filter decisions and G2 UI. Expected artifacts: safe audit-list service on top of `AuditRepository.listAudits()`, browser endpoint, actor-label join/projection, audit table/filters and tests. No new logging database, external telemetry service, raw tool argument collection, or new retention behavior by default.

### Tasks

1. Add a service-level list method and route with strict maximum `limit` and bounded `offset`, allowed status enum, Admin-only global view, and a whitelisted filter set.
2. Return safe fields only: event ID, actor ID/username where available, upstream slug, tool, recorded timestamp, duration, status/outcome and sanitized error code/message. Do not return `arguments_hash` unless needed for internal debug; never return raw arguments/results.
3. Verify error-message sanitizer; if raw `error_message` may include upstream input/credentials, map only error code and authored safe message.
4. Implement an accessible table with loading/empty/error/degraded states, pagination and approved status/user/upstream/tool/time filters. Clearly mark `pending` and `unconfirmed_outcome` rather than displaying them as success/failure with certainty.
5. Decide whether Member has no audit view or only own audit view. If self-view approved, enforce `userId` from current session server-side and test direct query tampering.
6. Ensure the UI reports audit finalization degradation (`X-Urumi-Audit-Status` or safe event state) honestly; don't retry a tool action merely because audit finalization was degraded.

### Acceptance and exact verification

- **AUD-01:** An authorized Admin can query multiple pages; limit above configured max is rejected or clamped by the documented contract.
- **AUD-02:** Status filter returns only matching states; pagination has no accidental duplicate/missing rows in the tested fixture set.
- **AUD-03:** Table actor/upstream/tool/time/duration/outcome match redacted read-only DB rows. The UI reports the available `created_at` timestamp and `duration_ms`, not fabricated start/end timestamps.
- **AUD-04:** Member global audit request returns 403; if own view is approved, tampering `userId` cannot expose another user's rows.
- **AUD-05:** Canary credential/PII in synthetic tool inputs is not present in DB payloads, audit view, network response, app log or browser console; only the pre-existing argument hash remains.
- **AUD-06:** Pending/unconfirmed/degraded states render with truthful labels and never encourage blind retry of a potentially committed write.
- **AUD-07:** The audit query does not affect tool invocation latency materially in the local MVP; benchmark only if a meaningful regression appears.

### Risks, rollback and stop condition

Risk: the audit UI accidentally reveals PII or an error string; large unbounded audit requests can pressure SQLite; a user filter can become an IDOR. Rollback is to remove/disable only the browser read surface, not to drop audit rows or schema. Stop on sensitive-field leakage, role leak, invalid query bounds, or integrity-check failure.

### Required evidence and approval

- Audit pagination/filter and authorization test results, canary redaction report, and a screenshot using synthetic rows.
- G5 review before full integration gate.

---

## 11. P5-G6 — Integration, Accessibility and Security Regression

### Objective and bounded scope

Prove the complete Admin/Member flows against the deployed local cluster, test server-side authorization independently of React, preserve Phase 4 MCP and Kubernetes security guarantees, and close mandatory requirement coverage. Minimal usability/accessibility only; do not spend this gate on visual polish.

### Test matrix

| ID | Test | Expected result/evidence |
|---|---|---|
| E2E-P5-01 | Clean install/build, browser SPA + listener, Helm local/prod render | Build and type checks pass; assets included in image; expected ports/routes render |
| E2E-P5-02 | Anonymous browser request to protected API | 401; no protected data |
| E2E-P5-03 | Admin sign-in and upstream overview | Baseline upstreams/status/tool data match backend |
| E2E-P5-04 | Admin lifecycle on isolated `test-...` upstream | Create/edit/rotate/disable/enable/delete/retry cleanup tested; catalog updates |
| E2E-P5-05 | Direct Member requests to every Admin mutation | 403; DB/Secret/catalog unchanged |
| E2E-P5-06 | Member invite/redeem and session expiry/logout | Single use and expiry enforced; stale session rejected |
| E2E-P5-07 | Key issue/list/revoke and ownership | One-time raw key; safe DTOs; cross-user actions denied; revoked `/mcp` request 401 |
| E2E-P5-08 | Audit global access and pagination/redaction | Admin can page/filter; Member denied global; sensitive values absent |
| E2E-P5-09 | Invalid CSRF/Origin and malformed/oversized body | Rejected without side effects; safe error response |
| E2E-P5-10 | Ingress perimeter | `/mcp` reaches port 3000; dashboard/API reaches browser listener port 3001; `/admin/v1/*` via public host returns 404 |
| E2E-P5-11 | Internal-service/network boundaries | Gateway → three upstreams succeeds; gateway/dashboard cannot reach WordPress or MariaDB directly; upstream Services remain internal |
| E2E-P5-12 | SQLite/pod replacement | Existing and P5 data persists; `PRAGMA integrity_check=ok`; PVC identity preserved |
| E2E-P5-13 | Protected WooCommerce baseline | IDs 10/11/12 and Order #14 identical to baseline; no writes issued to them |
| E2E-P5-14 | Phase 4 regression | Gateway unit/protocol, WooCommerce MCP, CRM/Tasks, secret lifecycle, RBAC, `tools/list`/`tools/call` still pass |
| E2E-P5-15 | External MCP-client compatibility smoke test | Same gateway MCP URL/key protocol still works; full User B demonstration remains a Phase 6 deliverable |
| E2E-P5-16 | Keyboard/responsive/error-state pass | Tab order, labels, focus, form error text and practical mobile viewport manually checked |

### Concrete verification approach

Use project-defined workspace scripts, once their current commands are rechecked against the actual `package.json`:

```bash
npm ci
npm run build
npm run lint
npm --workspace=gateway run test:unit
npm --workspace=gateway run test:protocol
npm --workspace=woocommerce-mcp test
npm --workspace=mcp-crm test
npm --workspace=mcp-tasks test
helm lint infra/helm/urumi-platform
helm template urumi infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml -n urumi
helm template urumi infra/helm/urumi-platform -f infra/helm/urumi-platform/values-prod.yaml -n urumi
```

These are planned verification commands, not results. Reconfirm each exact workspace name/script before execution; do not allow a missing script's no-op behavior to count as a pass. Add dashboard build/test commands when the workspace exists. Do not run mutations against the real baseline WooCommerce records. Use disposable upstream fixtures and synthetic CRM/Tasks records. Capture exit code/counts and redact secrets from outputs.

### DoD, risks and stop conditions

- All mandatory Phase 5 tests pass, or each exception has an explicit Technical Head waiver, scope impact and compensating demo.
- No direct-call authorization bypass; no upstream credential or key leakage; no HTTP ingress bypass; no loss of keys/users/upstreams/audit data; no protected store/PVC drift.
- Any 401/403 behavior must be tested by raw HTTP request, not only UI; any secret-leak or isolation test failure blocks acceptance.
- Any unplanned Helm behavior, migration anomaly, or SQLite integrity failure stops the rollout. Capture state, do not delete PVCs or reset data to make tests green.

### Required evidence and approval

- Test matrix with command, exit code, test count, time, commit SHA, image identifier, Helm revision.
- Protected baseline comparison; redacted security probe outputs; UI screenshots with synthetic data only.
- Explicit list of passed, skipped, failed, and waived tests; no skipped test counted as pass.
- Gate sign-off before G7 documentation/acceptance package.

---

## 12. P5-G7 — Documentation and Acceptance

### Objective and bounded scope

Produce a reproducible operator/developer handoff, update requirements/master roadmap statuses based on evidence, and submit the Phase 5 completion recommendation. No new feature work after the agreed freeze except acceptance-blocking defects.

### Tasks and expected artifacts

1. Update `README.md` for dashboard access, local domains/ports, initial admin enrollment, login/session behavior, Admin/Member workflows, API-key display-once warning, and the retained external MCP connection setup.
2. Add/update dashboard developer setup and test commands (e.g. `apps/dashboard/README.md` or the project-approved equivalent).
3. Update `docs/requirements-traceability.md`: correct phase assignments/statuses and mark each requirement as planned/implemented/source-confirmed/tested/accepted distinctly. Fix stale Phase 4 statuses only from evidence, not assumptions.
4. Update `docs/architecture.md` and ADRs affected by browser identity, multi-listener route mapping, CSRF/session model, and schema migration. Mark ADR-012 only after a real Technical Head acceptance decision.
5. Update Phase 5 execution log with gates, exact commands, exits, test evidence, commit SHA, image digest/reference, Helm revision, and known gaps.
6. Record remaining Phase 4/G9 discrepancies and Phase 5 risks, and add an operator runbook for session/member/key recovery without exposing secrets.
7. Write a repeatable demo script using safe fixtures: Admin list/manage upstream, invite Member, issue key, Member own-key workflow, audit table, direct authorization denial, `/mcp` revocation proof. Preserve products 10/11/12 and Order #14.
8. Submit a completion report as `READY FOR TECHNICAL HEAD ACCEPTANCE` or `BLOCKED — ACCEPTANCE CRITERIA NOT MET`; never call the assignment done.

### Acceptance and exact verification

- A clean checkout can reproduce the frontend/gateway build and Helm render using documented commands.
- All documented secrets use environment/Secret bootstrap, not committed literals.
- The eight-phase master roadmap names the canonical file and has current status/evidence/remaining work/dependencies for Phases 1–8.
- Demo script can be followed without modifying protected baseline entities or requiring paid services.
- Test evidence matches current code commit/chart/image and contains no secrets.

### Risk, rollback and stop condition

Risk: inconsistent docs or a demo that depends on manually patched DB state. No rollback of audit/database records; only correct documentation or code within approved scope. Stop if completion evidence cannot be tied to a revision or mandatory test remains skipped/failed.

### Required evidence and approval

- `docs/phase-5/phase-5-completion-report.md` with results, deviations and decision requested.
- Updated master roadmap and requirements traceability.
- Technical Head decision for Phase 5 closure and separate authorization of Phase 6 work.

---

## 13. Proposed delivery schedule to the submission deadline

This is a high-risk, compressed forecast—not a promise. It replaces the elapsed Oct 18–20 Phase 5 target with an explicit critical-path plan. Full feasibility depends on prompt approval, no major G0 reconciliation issue, and implementation capacity.

| Date (IST) | Planned outcome | Priority / contingency |
|---|---|---|
| **Mon 19 Oct (today)** | Review Phase 5 plan, accept/reject G9, resolve core identity/ingress/key ownership decisions; G0 is read-only | **Gate blocker.** No implementation without approval. |
| **Tue 20 Oct** | G0 baseline finalization and G1 design freeze; bootstrap/session/schema plan approved | If unresolved by end of day, schedule is at risk and Technical Head must re-prioritize. |
| **Wed 21 Oct** | G2 frontend scaffold/listener/build + initial login/current identity; start upstream list/detail | Mandatory. No style polish. |
| **Thu 22 Oct** | G3 upstream lifecycle/tool list with direct role denial; start G4 member/key HTTP/UI | Use existing AdminService/API-key primitives; do not rebuild them. |
| **Fri 23 Oct** | Finish G4 invitation/key lifecycle/ownership/revocation; schema and pod-replacement validation | Critical security gate; any key leak/IDOR blocks. |
| **Sat 24 Oct** | G5 audit read API/table, G6 integration/security regression; target Phase 5 acceptance recommendation by day-end | If Phase 5 is not stable, reduce polish, not security/audit correctness. |
| **Sun 25 Oct** | Phase 6: chat agent tool loop and external MCP client/User B demonstration; begin Phase 7 targeted hardening and runbook updates | Tight, with little contingency. Full chat may be infeasible if P5 slips. |
| **Mon 26 Oct (deadline)** | Finish critical regression and protected-data checks; capture demo; final README/traceability/risk notes; submit before 11:59 PM IST | Freeze code by a Technical Head-agreed time; retain several hours for demo/evidence/packaging. Do not start optional features. |

### Feasibility assessment

The original plan allocated Phases 5–8 across 18–26 October, but as of 19 October the dashboard source and required browser-facing APIs are not evidenced, and G9 formal acceptance is unconfirmed. The plan is **aggressive and not yet confidently feasible**. It can only succeed if the Phase 5 scope remains an MVP, the existing gateway services are reused directly, decisions are made immediately, and no major security/schema/Ingress defect appears.

Priority order if time slips:

1. **P0 — Assignment blockers:** secure Admin/Member identity and server-side authorization; upstream lifecycle; Member key issue/revoke/ownership; credential secrecy; audit attribution/table; `/mcp` compatibility and immediate revocation; Kubernetes and store invariants.
2. **P1 — Needed for full DoD:** working LLM chat agent tool loop as logged-in User A; external MCP client/User B with separate key; cross-server workflow; pod-kill/unreachable-server proof; build/deploy and final reproducible demo.
3. **P2 — Deferable polish:** advanced table filters beyond practical status/user/upstream, animation, sophisticated design system, advanced responsive polish, bonus multi-store, per-tool ACLs, OAuth, distributed scaling, optional VPS rollout.

If Phase 5 is not acceptance-ready by 24 October, the Technical Head should explicitly decide whether to protect the mandatory Phase 5 security guarantees and narrow optional UI work, or revise the delivery plan. Do not claim all eight phases complete if a mandatory Phase 6/7/8 test remains undone.

## 14. Final Phase 5 definition of done

- [ ] Technical Head formally accepts Phase 4/G9 or records a documented exception and releases Phase 5 hold.
- [ ] Technical Head approves G1 browser identity, role/ownership model, ingress/listener plan and migration.
- [ ] Dashboard React/Vite SPA builds from a clean checkout and deploys via existing Helm chart.
- [ ] Admin and Member can independently authenticate; logout/expiry/CSRF/security behavior is tested.
- [ ] Admin can view/manage upstreams and see discovered tools/current reachability; Members cannot mutate via UI or direct API.
- [ ] Team invitation/member and key issue/list/revoke flows are implemented; key owner checks are server-side; raw key is displayed once; revocation works on the next MCP request.
- [ ] Audit retrieval/table is paginated, authorized and redacted; actor/upstream/tool/time/duration/outcome are truthful; failure/degradation states are not hidden.
- [ ] Public `/mcp` remains the single downstream MCP endpoint; public browser listener cannot route to `/admin/v1`; internal upstream Services remain private.
- [ ] Kubernetes Secret namespace/RBAC, NetworkPolicy, non-root settings, single SQLite writer/PVC, one gateway replica/Recreate strategy and protected store records are preserved.
- [ ] All mandatory test results are evidence-backed, and any exception is explicitly approved.
- [ ] Requirements traceability, architecture/ADR, ops/developer docs, eight-phase master roadmap, demo script and completion report are updated.
- [ ] Technical Head explicitly accepts Phase 5; Phases 6–8 remain separate and are not marked complete by this gate.

**Current stop condition:** This roadmap is a planning deliverable. No implementation, deployment mutation, or Phase 6 work is authorized until the Technical Head approves the planning documents and explicitly releases the implementation hold.
