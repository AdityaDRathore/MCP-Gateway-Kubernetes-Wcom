# Phase 7 Risk & Technical Head Decision Register

**Status:** proposed; no decisions are approved by this document.

## 1. Risk register

| ID | Risk | Likelihood / impact | Mitigation | Trigger / stop condition |
|---|---|---|---|---|
| P7-R01 | Source, image, chart and live release refer to different revisions | Medium / Critical | G0 records SHA, image ID/digest, Helm revision and cluster context; do not rollout until reconciled | Unexplained identity mismatch |
| P7-R02 | A fault test affects stateful data or destabilizes small local cluster | Low–Medium / Critical | Fault-inject only a disposable stateless CRM/Tasks pod; check headroom; bounded duration and cleanup | Gateway/store impact, memory pressure or PVC touch |
| P7-R03 | Protected WooCommerce records are mutated accidentally | Low / Critical | Read-only baseline before/after; use disposable SKUs and orders; do not target IDs 10/11/12 or Order #14 | Any unexpected difference |
| P7-R04 | SQLite WAL corruption or multi-writer conflict | Low / Critical | Keep one Gateway replica/Recreate; integrity check; backup-copy validation; no scale-up | Integrity != ok or second writer |
| P7-R05 | Local-path persistence is described as disaster recovery | Medium / High | Explicitly state node-local limitation; distinguish pod replacement from node-loss recovery | Unsupported backup/DR claim |
| P7-R06 | Production values render but are mistaken for a production deployment | Medium / High | Label render validation separately from actual VPS/TLS/DNS/registry/secret readiness | Public deployment implied without evidence |
| P7-R07 | NetworkPolicy selectors drift after labels/chart changes | Medium / High | Compare selector/target labels; test intended Gateway-to-upstream path and denied bypass where safe | Upstream exposed or required traffic blocked |
| P7-R08 | Phase 6 code/chart invalidates earlier test results | Medium / High | Run final SHA-focused regression and record image/chart identity | Critical journey fails on final candidate |
| P7-R09 | Test totals conflict between README and phase reports | High / Medium | Preserve each command/suite count and reconcile scope; never add incomparable totals | Unsupported aggregate test count |
| P7-R10 | INF-02 status is stale and misleads evaluator | High / Medium | Compare chart resources to live release and update only with evidence | Matrix marked Verified without evidence |
| P7-R11 | Hardening expands and consumes Phase 8 | High / High | Freeze feature scope; fix only reproduced defects; optional benchmark first to cut | Phase 8 window falls below one day |
| P7-R12 | Backup/restore validation overwrites live data | Low / Critical | Validate backup copy only; restore only into isolated disposable environment after separate approval | Restore target not proven isolated |
| P7-R13 | Secret, session cookie, API key or customer PII leaks into artifacts | Low / Critical | Sanitize logs/screenshots; secret scan; no Secret values printed | Any leak in committed/evidence files |
| P7-R14 | Live Gemini egress or rate limit makes final demo nondeterministic | Medium / Medium | Use mock provider for hermetic regression; live provider smoke test only when configured and safe; document provider dependency | External provider unavailable |
| P7-R15 | Upstream is disabled rather than pod-killed, so assignment criterion remains unproven | Medium / High | Test disable/re-enable and pod-failure as separate scenarios; do not conflate them | Missing pod-kill evidence |
| P7-R16 | Final Phase 6 report is submitted but not formally accepted | High / Medium | Check for Technical Head acceptance record; keep status as submitted until documented | Plan labels Phase 6 formally accepted without evidence |

## 2. Decisions requiring Technical Head approval before implementation

| ID | Decision | Recommendation | Approval needed because |
|---|---|---|---|
| P7-DEC-01 | Phase 7 product objective | Reliability, hardening verification and evidence; no new user-facing features | Protects mandatory evaluation path and time |
| P7-DEC-02 | Scope of production deployment | Validate production-profile Helm rendering and prerequisites; no public VPS rollout unless explicitly mandated | Public exposure, cost, DNS/TLS, registry and secrets prerequisites |
| P7-DEC-03 | Fault-injection target/method | Use one disposable stateless CRM or Tasks pod; do not touch WooCommerce MCP/store/Gateway first | Limits risk and directly tests the original brief |
| P7-DEC-04 | Gateway pod replacement | Permit only after a backup-copy/integrity check and an agreed maintenance window | SQLite WAL/PVC persistence risk |
| P7-DEC-05 | WordPress/MariaDB restart | Separate explicit approval; optional if Phase 2 evidence remains adequate and time is short | Persistent store and protected records |
| P7-DEC-06 | Backup/restore | Create a new online backup copy and validate it; actual restore only in isolated disposable context | Avoids overwrite and unsupported DR claims |
| P7-DEC-07 | Minimal remediation authority | Allow only fixes linked to a reproduced failure, with targeted test; architecture/perimeter/storage changes require renewed approval | Prevents scope creep and unsafe silent changes |
| P7-DEC-08 | Image identity policy | Decide whether local immutable image ID is enough for assignment or registry digest pinning is required | Local k3d image workflow differs from production registry |
| P7-DEC-09 | Optional load testing | Run only if host headroom is healthy and the harness is safe; otherwise mark Not Run | Prevents local-cluster destabilization |
| P7-DEC-10 | Traceability status edits | Change INF-02 and other statuses only after direct evidence; preserve historical notes | Prevents documentation-only acceptance |
| P7-DEC-11 | Phase 8 protected time | Reserve 25–26 Oct for full DoD, demo/video, threat model, README and submission | Fixed deadline |
| P7-DEC-12 | Gate stop conditions | Any protected-data mismatch, public upstream exposure, secret leak, SQLite integrity failure or auth regression is a hard stop | Safety and assignment credibility |
| P7-DEC-13 | Phase 6 formal acceptance | Confirm whether separate acceptance exists; until then call G7 “submitted for review” | Avoids overstating governance state |

## 3. Open questions for P7-G0

1. What is the exact current main SHA and is the working tree clean?
2. What exact image ID/digest and Helm revision are deployed, and do they match the current chart/code?
3. Is there an existing Phase 7 failure-test report that can be reused if it targets the exact final candidate?
4. Which test commands produced README’s 351 unit/62 protocol totals versus focused Phase 6 reports?
5. Does the production values profile require a registry digest, TLS Secret, DNS, external secrets or storage class that is not present locally?
6. Is actual VPS deployment explicitly required by the original assignment or is values-profile validation sufficient for this deadline?
7. Where is the safe SQLite backup stored and what permissions/retention apply?
8. Is there a maintenance window for Gateway pod replacement? Is store restart necessary at all?
9. Can the existing chart/NetworkPolicy runtime be verified in current k3d without altering cluster configuration?
10. Has the Technical Head formally accepted Phase 6 G7, or is it still pending?
11. Are any known test failures or flaky suites present in current main that need to be triaged before G2?
12. What evidence retention format/path should the evaluator receive (committed sanitized text artifacts vs local log bundle)?

## 4. Invariants

- Never mutate/delete products 10, 11, 12 or Order #14.
- Keep Gateway single-replica with `Recreate` and SQLite WAL/PVC.
- Keep browser session/CSRF on port 3001 and MCP bearer-key auth on port 3000.
- Keep upstream MCPs private; all downstream MCP calls go through Gateway.
- Keep WooCommerce access behind WooCommerce MCP; no direct Gateway-to-WordPress/MariaDB route.
- No raw keys, provider credentials, session cookies, Secret values or customer PII in code, logs, screenshots or reports.
- No destructive reset/reseed, PVC deletion, live restore, database migration, public deployment or architecture redesign without explicit approval.
