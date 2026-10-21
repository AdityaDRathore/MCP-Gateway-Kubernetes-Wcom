# Phase 7 Gate-by-Gate Implementation Roadmap

**Planning only.** Gates are sequential; each gate’s exit evidence is reviewed before the next begins. A gate cannot be marked approved by the implementation worker alone.

## P7-G0 — Baseline freeze and evidence reconciliation
**Estimated effort:** 2–3 hours. **Target:** 23 Oct, morning.  
**Objective:** know exactly what is in source, chart, live cluster and reports before any change.

- **Prerequisites:** Technical Head approves starting planning execution; no in-flight rollout; read-only access to repo/cluster.
- **Scope:** record main SHA and tree state; chart/image identity; Helm release/revision; cluster context; workload and PVC state; authoritative Phase 6 G7 report; current traceability rows; suite-count discrepancy; protected store baseline; prior fault/recovery evidence.
- **Deliverables:** `p7-g0-baseline-report.md`, evidence index, gap list.
- **Tests/evidence:** sanitized repository status/log; image inspect; `helm list/history`; pod/service/ingress/PVC inventory; read-only product/order comparison; test script inventory.
- **Exit criteria:** source/chart/image/release identities reconciled or mismatches explicitly explained; no unrecognized change in protected data; all open gaps prioritized.
- **Stop/return:** mismatch between live image and source with no reproducible mapping; dirty tree/in-flight worker; unexpected protected record changes; test-count claims cannot be mapped to commands.
- **Approval:** Product Manager reviews; Technical Head authorizes G1.

## P7-G1 — Helm, packaging and security posture
**Estimated effort:** 2–3 hours. **Target:** 23 Oct, afternoon.  
**Objective:** verify the mandatory Kubernetes/Helm requirements on the integrated candidate.

- **Prerequisites:** G0 accepted; no source change unless separately approved.
- **Scope:** `helm lint`; render local and production values; inspect Deployment/StatefulSet/Service/Ingress/PVC/NetworkPolicy/ServiceAccount/RBAC and secret references; check probes/resources/security contexts; verify single Gateway replica/Recreate; inspect upstream public exposure and egress boundaries; document production prerequisites.
- **Deliverables:** `p7-g1-helm-security-review.md`, rendered manifests (sanitized), findings and minimal fix proposals.
- **Tests/evidence:** exact commands/exit codes; manifest-level checklist; if allowed, live label/policy inspection and safe intended-path checks.
- **Exit criteria:** both profiles render; no critical secret exposure, public upstream, broken policy, missing mandatory probe/resource setting, or unsafe persistence change remains.
- **Stop/return:** any change to ingress ports, NetworkPolicy, ServiceAccount/RBAC, secrets, PVC, replica strategy or image identity policy requires Technical Head review before modification.
- **Approval:** Technical Head authorizes G2 and any narrowly scoped remediation.

## P7-G2 — Controlled upstream failure isolation
**Estimated effort:** 2–3 hours. **Target:** 24 Oct, morning.  
**Objective:** prove the original assignment’s explicit dead-upstream acceptance journey against the current candidate.

- **Prerequisites:** G1 accepted; fault target is a stateless disposable upstream (prefer CRM or Tasks); current healthy baseline captured; cluster resource headroom checked.
- **Scope:** call one safe tool from each upstream; interrupt one stateless upstream pod using an approved method; check Gateway readiness and healthy upstream calls; check dashboard shows Unreachable; check clear bounded failure for affected tool; wait for controller recovery and re-test.
- **Deliverables:** `p7-g2-failure-isolation-report.md`, timestamped before/during/after outputs, cleanup record.
- **Tests/evidence:** test ID mapped to GTW-05/06 and assignment Definition of Done; no raw secrets/PII.
- **Exit criteria:** healthy upstream remains usable during fault; failure is visible and bounded; affected upstream returns healthy after recovery.
- **Stop/return:** any impact to Gateway/WooCommerce PVCs, protected data, unexpected cluster instability, or evidence of broad outage. Do not delete stateful pods/PVCs as a substitute.
- **Approval:** Technical Head reviews results before G3.

## P7-G3 — Persistence and recovery
**Estimated effort:** 2–4 hours. **Target:** 24 Oct, late morning.  
**Objective:** prove Gateway database integrity and pod-replacement persistence while preserving the existing single-writer design.

- **Prerequisites:** G0 baseline accepted; safe backup location known; explicit Technical Head approval for Gateway pod replacement. Separate approval required for WordPress/MariaDB restart.
- **Scope:** SQLite integrity check; create and validate a new backup copy using existing online backup mechanism; replace Gateway pod only under approved procedure; verify readiness and selected persisted audit/config metadata; optionally recheck store persistence after approved store restart.
- **Deliverables:** `p7-g3-persistence-recovery-report.md`, backup-copy checksum/path/permissions (not database contents), pre/post counts and pod/PVC identity.
- **Tests/evidence:** `PRAGMA integrity_check` = `ok`; DB persists after pod replacement; same safe MCP/chat request works; protected baseline unchanged if store restart is tested.
- **Exit criteria:** integrity and persistence evidence pass; no second writer; no claim of node-loss recovery.
- **Stop/return:** integrity failure, wrong PVC, unexpected DB migration, protected data mismatch, backup path permission issue, or any possibility of restore over live data.
- **Approval:** Technical Head authorizes G4.

## P7-G4 — Integrated regression and release candidate
**Estimated effort:** 3–4 hours. **Target:** 24 Oct, afternoon.  
**Objective:** show reliability checks did not regress assignment-critical journeys.

- **Prerequisites:** G1–G3 disposition accepted; any remediation complete with a targeted regression test.
- **Scope:** build/typecheck; all defined gateway/WooCommerce/mock MCP test suites; dashboard build; Helm lint/template; browser login/role/CSRF; chat read-only tool cycle and audit attribution; external MCP discovery and member key; cross-server CRM+Tasks prompt; key revocation; disable/re-enable upstream tool discovery; redaction; protected-store baseline.
- **Deliverables:** `p7-g4-regression-matrix.md`, per-command logs and exact test counts.
- **Tests/evidence:** exact SHA, commands, exit codes, suite counts and evidence references. Distinguish hermetic mocks from live provider tests.
- **Exit criteria:** all mandatory critical journeys pass or a specific item is marked BLOCKED/FAIL with reason and approved disposition; no critical security/data-integrity regression.
- **Stop/return:** auth boundary regression, missing audit attribution, public upstream exposure, secret/PII leakage, failed cross-server workflow, or protected record drift.
- **Approval:** Product Manager reviews release-candidate evidence; Technical Head authorizes G5.

## P7-G5 — Documentation, traceability and Phase 8 handoff
**Estimated effort:** 2–3 hours. **Target:** 24 Oct, end of day.  
**Objective:** package the evidence so final acceptance and demo can proceed without guesswork.

- **Prerequisites:** G4 evidence available.
- **Scope:** update `docs/requirements-traceability.md` only where evidence supports it; produce `p7-g5-final-completion-and-handoff-report.md`; refresh runbook only for verified changes; document limitations and cleanup; create Phase 8 checklist.
- **Deliverables:** Phase 7 completion report, evidence index, Phase 8 handoff checklist, sanitized artifacts.
- **Exit criteria:** every gate PASS/FAIL/BLOCKED/NOT RUN; requirements mapped to tests; fresh vs reused evidence distinguished; protected data and fixture cleanup confirmed; local-path and production-profile limitations explicit.
- **Stop/return:** report claims unsupported by evidence; missing test provenance; unresolved critical risk; undocumented deviation from approved scope.
- **Approval:** Technical Head Go/No-Go. Phase 8 may begin only after explicit Go.

## Gate control rules

- No gate is approved automatically by the passage of time.
- No code/config change is included in planning scope unless G0/G1 identifies a concrete acceptance failure and Technical Head approves the exact change.
- A fix is minimal, tied to one criterion, includes a regression test, and triggers rerun of the affected gates.
- Any stateful restart, restore, rollout affecting persistence, or production deployment requires explicit approval.
- If a gate is blocked, record the blocker and re-plan against mandatory assignment criteria; do not hide it or silently compress Phase 8.
