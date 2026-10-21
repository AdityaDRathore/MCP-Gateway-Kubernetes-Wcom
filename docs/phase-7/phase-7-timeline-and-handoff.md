# Phase 7 Timeline, Feasibility & Handoff

**Planning date:** 22 October 2026  
**Target Phase 7 completion:** end of 24 October 2026  
**Assignment deadline:** 26 October 2026, 11:59 PM IST

## 1. Estimated schedule

| Date / window (IST) | Gate | Effort estimate | Output | Checkpoint |
|---|---|---:|---|---|
| 22 Oct — planning review | Product Manager + Technical Head decision review | 1–2 h review | Approved scope and risk envelope | No execution before explicit approval |
| 23 Oct morning | P7-G0 baseline freeze | 2–3 h | Baseline/evidence report and gap list | PM review; Technical Head Go for G1 |
| 23 Oct afternoon | P7-G1 Helm/security posture | 2–3 h | Local/prod renders, manifest checklist, findings | Stop for critical exposure or release identity mismatch |
| 24 Oct morning | P7-G2 fault isolation | 2–3 h | Before/during/after failure and recovery evidence | Review before persistence work |
| 24 Oct late morning | P7-G3 persistence | 2–4 h | SQLite integrity/backup copy/pod replacement evidence | Requires explicit approval for Gateway/store restarts |
| 24 Oct afternoon | P7-G4 regression | 3–4 h | Per-command test matrix and release candidate | Critical regression blocks completion |
| 24 Oct end of day | P7-G5 handoff | 2–3 h | Final report, traceability, Phase 8 checklist | Technical Head Go/No-Go |
| 25 Oct | Phase 8 acceptance and demo | Protected full day | Full DoD, two-user demo, video, docs/threat model | No optional features |
| 26 Oct | Final buffer and submission | Protected | Defect fix only if safe; final submission before 11:59 PM | Verify submitted artifacts |

Total estimated Phase 7 effort: roughly 12–18 focused hours plus review/approval wait time. This is feasible only if no major architecture defect is uncovered and the local cluster is already available. The estimate is not permission to skip safety checks.

## 2. Dependency order

1. G0 must establish exact source and runtime identity before any failure injection or rollout.
2. G1 must establish chart and security posture before fault testing.
3. G2 uses a stateless upstream and should complete before touching persistent Gateway/store workloads.
4. G3 needs explicit approval and a safe backup-copy check before Gateway pod replacement; WordPress/MariaDB restarts are separately optional and approved.
5. G4 runs after any approved remediation and must target the final candidate SHA.
6. G5 is an evidence/reporting gate, not a substitute for tests.
7. Phase 8 begins only after Technical Head Go/No-Go.

## 3. Feasibility and scope cuts

If time is lost or a critical gap appears, prioritize in this order:
1. Protected data, secrets, auth boundaries and current release identity.
2. Original assignment pod-kill/failure isolation journey.
3. Helm lint/render and security/perimeter review.
4. Gateway SQLite integrity/persistence.
5. Required journey regression and audit attribution.
6. Evidence/handoff and Phase 8 protected time.
7. Optional benchmark, extended chaos scenarios, resource tuning and cosmetic cleanup (cut first).

Do not compress Phase 8 below the time required for the full Definition of Done, video walkthrough, README/threat model review and submission. If 12–18 hours is not available, narrow optional checks and report them Not Run; do not imply they passed.

## 4. Required Phase 7 evidence bundle

Each test artifact must include:
- Gate/test ID and linked requirement ID(s).
- Timestamp and operator.
- Repo SHA, image ID/digest, Helm release/revision, cluster context and namespace.
- Exact command or reproducible manual steps.
- Exit code and per-suite count where applicable.
- Expected result and observed result.
- Sanitized logs/screenshots; no raw credentials, session cookies, API keys or customer PII.
- Cleanup and protected-data post-check.
- Disposition: PASS / FAIL / BLOCKED / NOT RUN.
- Evidence provenance: Fresh / Reused / Reported / Derived.

## 5. Phase 7 final handoff definition

Required artifacts:
- `docs/phase-7/p7-g0-baseline-report.md`
- `docs/phase-7/p7-g1-helm-security-review.md`
- `docs/phase-7/p7-g2-failure-isolation-report.md`
- `docs/phase-7/p7-g3-persistence-recovery-report.md`
- `docs/phase-7/p7-g4-regression-matrix.md`
- `docs/phase-7/p7-g5-final-completion-and-handoff-report.md`
- Updated `docs/requirements-traceability.md` only where supported.
- Updated runbook only if operational behavior changed.
- Sanitized evidence index and Phase 8 acceptance checklist.

Do not create “PASS” reports in advance. These filenames are proposed future execution artifacts; their contents must be filled only from actual gate evidence.

## 6. Phase 8 handoff checklist

- [ ] Current candidate SHA/image/chart identities are recorded.
- [ ] All required assignment user journeys are mapped to tests and evidence.
- [ ] Storefront checkout with a disposable fixture is rehearsable.
- [ ] Chat User A journey uses disposable product/order data and does not touch protected IDs.
- [ ] User B external MCP client connects with only Gateway URL and User B key.
- [ ] Cross-server CRM+Tasks prompt works.
- [ ] Revocation rejects next request.
- [ ] Disable upstream removes tools from both chat and external client.
- [ ] Pod-kill test shows unaffected upstreams continue and dead upstream is unreachable.
- [ ] Audit shows actor/server/tool/time/duration/outcome.
- [ ] Protected store records unchanged and disposable fixtures cleanup is documented.
- [ ] README, architecture, threat model, operational runbook and demo script are accurate.
- [ ] Demo video/recording and submission form are completed by deadline.
