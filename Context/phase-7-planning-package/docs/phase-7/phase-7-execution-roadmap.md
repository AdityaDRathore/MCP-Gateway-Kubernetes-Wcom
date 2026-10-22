# Phase 7 Gate-by-Gate Execution Roadmap

**Status:** Planning only. No gate is approved or started.  
**Deadline:** 26 October 2026, 11:59 PM IST.

## Gate sequence

| Gate | Purpose | Depends on | Required output | Review boundary |
|---|---|---|---|---|
| P7-G0 | Baseline/repository/assignment verification | None | Exact commit, source inventory, baseline snapshots, command inventory | Stop for any ambiguity or unsafe environment |
| P7-G1 | Gap triage and authorization | G0 | Prioritized gap list with diff/test/rollback and requirement IDs | Technical Head approves remediation scope |
| P7-G2 | Static Helm/runtime review | G1 | Lint/template outputs and rendered-manifest checklist | Stop for exposure/storage mismatch |
| P7-G3 | Pod replacement and persistence | G1; G2 review | Recovery report, DB integrity, baseline comparison | Requires explicit pod-replacement authorization |
| P7-G4 | Network/runtime hardening | G2 | Positive/negative network probes and UID/security-context evidence | Changes require separate approval |
| P7-G5 | Regression and data-integrity suite | G3/G4 | Automated test report and post-test baseline | Any security regression/data drift blocks exit |
| P7-G6 | Documentation and handoff | G5 | Traceability, execution log, known limitations, acceptance recommendation | Technical Head accepts/rejects; no implicit sign-off |

## Detailed gate cards

### P7-G0 — Baseline
**Tasks:** record commit/branch/status; read original assignment, master roadmap, traceability, Phase 4 G9 report, Phase 5 closeout, Phase 6 final handoff, relevant ADRs and runbooks; inventory current chart/workloads/policies/PVCs; check cluster context/headroom; record store baseline.  
**Commands:** use the repository's documented commands and environment-specific read-only Kubernetes queries; do not invent namespace/resource names before inspecting manifests.  
**Pass:** all source paths and command names are exact, baseline captured, no unsafe environment discrepancy.  
**Stop:** missing canonical requirement or report, dirty state not understood, unexpected context, low headroom, baseline drift.

### P7-G1 — Gap triage
**Tasks:** map each Phase 7 original roadmap item to existing implementation and current-run evidence; classify as verified/re-run/fix/defer; document proposed diffs and rollback.  
**Pass:** bounded worklist approved by Technical Head.  
**Stop:** unapproved architecture changes or scope beyond deadline.

### P7-G2 — Static configuration review
**Tasks:** lint and render local and production-like values; inspect image references, services/ingress, TLS, replicas, PVC mode, SQLite single writer, securityContext, probes, resources, Secret refs and NetworkPolicies.  
**Pass:** renders cleanly and reviewed output matches intended boundaries.  
**Stop:** public internal MCP exposure, SQLite multiwriter, unsafe image/secret configuration.

### P7-G3 — Recovery
**Tasks:** after authorization, delete only the gateway pod (not deployment/PVC/store/database); wait for replacement; verify readiness, MCP, persisted synthetic markers, SQLite integrity and protected store baseline.  
**Pass:** new pod UID, same PVC identity, recovered service, intact data.  
**Stop:** any data drift, integrity failure, crash loop or PVC change.

### P7-G4 — Effective security boundaries
**Tasks:** inspect policy selectors; test allowed gateway-to-upstream flows and blocked direct client-to-upstream/store/database flows; verify runtime UID and security settings.  
**Pass:** positive and negative tests match documented policy.  
**Stop:** fixes require broad relaxation or disrupt the store.

### P7-G5 — Regression
**Tasks:** run canonical unit/protocol/integration/dashboard/chat/external-client tests from current docs; audit redaction; key revocation; dynamic upstream lifecycle; test cleanup; baseline comparison. Run load sanity only if safe.  
**Pass:** mandatory tests pass or exceptions are explicitly approved.  
**Stop:** security regression, unexplained failures or protected-data drift.

### P7-G6 — Handoff
**Tasks:** update traceability and runbooks; record commit, environment, exact commands, exit codes, failures/skips and evidence; distinguish current-run from historical evidence; hand off to Phase 8.  
**Pass:** complete, reviewable evidence pack.  
**Stop:** unsupported claim, missing mandatory evidence or unresolved critical risk.

## Proposed calendar
- **23 Oct:** G0 and G1; if baseline/reports are unclear, stop and escalate rather than coding.
- **23 Oct afternoon:** G2 static review.
- **24 Oct:** G3 controlled recovery and G4 network/runtime checks.
- **25 Oct:** G5 regressions and only approved minimal fixes.
- **26 Oct morning:** G6 documentation and Technical Head review.
- **26 Oct afternoon/evening:** Phase 8 final DoD, demo/video, README and submission. Phase 7 must not consume this reserved window.

The dates are targets, not authorization. If G0 finds a critical failure, the Technical Head must explicitly re-prioritize the remaining scope.
