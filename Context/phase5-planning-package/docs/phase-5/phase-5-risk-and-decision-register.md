# Phase 5 Risk and Decision Register

**Date:** 19 October 2026  
**Status:** DRAFT for Technical Head review; implementation HOLD remains  
**Recommendation:** READY FOR PHASE 5 IMPLEMENTATION PLANNING APPROVAL. G1 cannot exit until the decisions below are recorded.

## 1. Highest delivery risks

| ID | Risk | Likelihood / impact | Mitigation and acceptance evidence | Stop trigger |
|---|---|---|---|---|
| P5-R01 | G9 report, current source, deployed image/chart, and actual Technical Head acceptance may refer to different revisions/states. | Medium / Critical | G0 captures Git HEAD, image ID/digest, Helm revision/values, live route and current tests. Reconcile report route mismatch and status records. | Cannot tie running workload to source/evidence or Formal G9 decision is unclear. |
| P5-R02 | Browser identity is conflated with the gateway MCP API key. | High / Critical | Separate browser session from bearer-key `/mcp`; approved session/CSRF/expiry design; negative tests prove cookies do not authenticate MCP and API keys do not login as browser users. | Any plan uses an Admin API key in browser storage or treats API key possession as browser login. |
| P5-R03 | Dashboard catch-all ingress accidentally exposes private `/admin/v1/*` routes. | High / Critical | Separate listener/Service port; browser router does not mount private Admin router; Ingress `/mcp` → 3000 and `/` → browser 3001; live external `/admin/v1` is 404. | External Admin path reaches private router or response is not the required 404. |
| P5-R04 | Key-management endpoints expose hashes/raw keys or fail to bind key ownership to the session. | Medium / Critical | Safe DTO projection; member target user derived from session subject; direct HTTP cross-user IDOR tests; canary-secret scan. | Member can query/revoke another user's key or any raw verifier/key leaks. |
| P5-R05 | Browser/member bootstrap introduces insecure default credentials or replayable invitations. | Medium / High | One-time verifier-only invite, expiry/replay test, idempotent first-admin enrollment and operator recovery procedure. No email SaaS required. | Default password, reusable token, lost admin recovery path, or existing admin/API-key reset on repeated bootstrap. |
| P5-R06 | Audit retrieval reveals sensitive error text or provides an unrestricted/unscoped query. | Medium / High | Safe DTO, max page size, approved filters, admin-only global read, optional Member view bound server-side to own subject, PII canary tests. | PII/secret displayed or Member can fetch global/other-user audit. |
| P5-R07 | New SQLite fields/migrations compromise existing users, keys, audit, upstreams, or data consistency. | Medium / Critical | Forward-only migration test from current version, one DB owner/connection, single replica/Recreate/PVC retained, integrity check after pod replacement. | Migration error, loss of rows, integrity check failure, or second process/replica opens same DB. |
| P5-R08 | Scope/timeline overrun prevents Phase 6 chat/external-client demonstration or final submission. | High / High | Strict mandatory-vs-polish split; decisions by 20 Oct; Phase 5 target 24 Oct; no multi-store/OAuth/design-system work; freeze and submit with hours remaining. | Phase 5 not acceptance-ready by 24 Oct; Technical Head must re-prioritize explicitly. |
| P5-R09 | Stale requirements traceability/architecture/ADR status causes duplicated or falsely “completed” work. | High / Medium | Update status labels to source-confirmed/reported/tested/formally accepted; resolve ADR-012 state; use current test baseline. | Any deliverable claims formal acceptance based only on `READY FOR TECHNICAL HEAD ACCEPTANCE`. |
| P5-R10 | Performance results are overstated; G9 shows high p95 under concurrency and one concurrency-10 failure. | Medium / Medium | Keep G9 benchmark as baseline; do not promise sub-second p95; rerun only if P5 causes a meaningful regression. | A new performance claim lacks a current benchmark or queue-full errors are hidden as success. |

## 2. Technical Head decisions

| ID | Decision required | Recommended default | Why / consequence if unresolved |
|---|---|---|---|
| P5-DEC-01 | Browser authentication | Separate username/password-style browser identity using server-side sessions; MCP keys remain exclusively for `/mcp`. | Without this, a secure dashboard login cannot be designed. |
| P5-DEC-02 | Session technology/lifetime | Opaque random session token, verifier-only SQLite storage, `HttpOnly`/`SameSite=Lax`, `Secure` for TLS, idle + absolute expiry, logout/revocation, strict Origin + CSRF on mutations. Use built-in Node password-hashing primitive with versioned parameters. | Cookie/session behavior and schema cannot be frozen until approved. |
| P5-DEC-03 | First Admin browser bootstrap | CLI-issued single-use enrollment token or equivalent, verifier-only storage, no hardcoded credentials, idempotent rerun, explicit operator recovery. Existing MCP key bootstrap remains safe. | Existing CLI issues a gateway key but no browser password/session. |
| P5-DEC-04 | Member onboarding | Single-use expiring invitation token delivered out of band; no email integration in MVP. Default new accounts to `member`; only Admin can manage/promote accounts. | Decide whether role changes/deactivation are mandatory or deferred. |
| P5-DEC-05 | Member API-key self-service | Member can generate/list/revoke own keys; Admin can issue/revoke for any member; owner is server-bound. Expiry remains optional unless policy asks otherwise. | Preserves original assignment story without broadening key access. |
| P5-DEC-06 | Member audit access | Default global audit read is Admin-only; defer Member “own audit” until explicitly approved. | Own-audit needs strict subject-bound query/acceptance tests; avoid accidental global view. |
| P5-DEC-07 | Browser listener and Ingress | Same-process, second browser listener/service port 3001; existing MCP/private Admin listener remains port 3000. Ingress `/mcp` → 3000, `/` → 3001. Browser listener does not mount `/admin/v1`. | Recommended way to expose SPA without broadening private Admin routes or creating a second SQLite owner. |
| P5-DEC-08 | Audit table contract | Bounded limit/offset pagination; status + user filters first; upstream/tool/time filters only if low-risk within deadline; safe error code/message. | Repository currently supports `limit`, `offset`, `status`, `userId`; additional filters need code/query decisions. |
| P5-DEC-09 | Audit retention | Retain current service capability/default only after policy confirmation; avoid altering pruning behavior in P5 unless required. | Audit evidence may be needed for demo/evaluation; automatic retention policy must be clear. |
| P5-DEC-10 | Formal Phase 4 acceptance | Explicitly accept G9 and resolve ADR-012 status, or list blocking exceptions with owner and deadline. | The worker report is a recommendation, not the Technical Head decision. |
| P5-DEC-11 | Credential rotation contract mismatch | Reconcile the report's `PUT /admin/v1/upstreams/:id/credential` against current router `PATCH /admin/v1/upstreams/:id`; use the actual agreed endpoint and correct docs/tests. | UI cannot safely target a reported endpoint not found in inspected source. |
| P5-DEC-12 | Performance gate | G9 benchmark remains informational baseline; no hard p95 target added without approved requirement. | Time should be used on mandatory end-to-end stories rather than an unsupported performance KPI. |

## 3. Source/report contradictions that affect delivery

- **G9 route mismatch:** report records `PUT /admin/v1/upstreams/test-crm-iso/credential`; inspected router currently defines `PATCH /upstreams/:id` and no `PUT /credential` handler. Reconcile active image/commit and captured commands.
- **Route exposure:** current Ingress sends `/mcp` to port 3000. Adding a catch-all to the same port would potentially expose the Admin router; proposed separate browser port is a required design defense, not mere frontend polish.
- **ADR vs implementation:** ADR-013 describes API-key/user/admin-audit capabilities, but the inspected Admin router has no users/key/audit-list routes; current upstream routes are real and should be reused.
- **ADR-012 status:** still `Proposed — Pending Technical Head Approval`, although G9 reports SQLite/WAL, persistence and replacement verification. Need a formal decision.
- **Status/traceability drift:** `docs/requirements-traceability.md` still labels several Phase 4 gateway/auth/audit items planned. Update only with evidence and distinct acceptance semantics.
- **Benchmark interpretation:** G9 records one failure at concurrency 10 and p95 values from ~1.65 s to ~3.20 s under concurrency 5–20. Queue/ memory stability does not mean low latency; do not overclaim.
- **Audit field naming:** schema uses `arguments_hash`, not `args_hash`; it has `created_at` and `duration_ms` rather than separate start/end timestamps.
- **Test count delta:** older Phase 3 evidence and G9 report have different WooCommerce MCP test counts. Establish actual baseline before running the Phase 5 regression.

## 4. Governance rule

The Product Manager prepares documents and acceptance contracts. The Technical Head owns product/security decisions and the release of the implementation hold. An implementation worker may not treat this planning recommendation as approval to modify application code, deploy, migrate SQLite, rotate real credentials, or run destructive tests. Any exception to the existing single-writer SQLite, PVC, Secret namespace/RBAC, NetworkPolicy, Ingress perimeter, WooCommerce MCP boundary, or protected-store rules requires separate explicit review.
