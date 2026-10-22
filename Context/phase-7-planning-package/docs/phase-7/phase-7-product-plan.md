# Phase 7 Product Plan — Reliability & Deployment Hardening

**Project:** Urumi AI FDE assignment — Team MCP Gateway on Kubernetes  
**Planning date:** 22 October 2026  
**Assignment deadline:** 26 October 2026, 11:59 PM IST  
**Status:** Proposed for Technical Head review; implementation not authorized  
**Evidence baseline:** Repository search surfaced the Phase 6 handoff at `docs/phase-6/p6-g7-final-acceptance-and-handoff-report.md` and an eight-phase roadmap. This planning document does not claim a fresh local-cluster test run. Phase 6 gate status and all runtime claims must be checked against the report and current commit during P7-G0.

## 1. Executive recommendation

Phase 7 should be a **bounded verification-and-remediation phase**, not a broad redesign. The original roadmap defines Phase 7 as Reliability & Hardening and names pod-kill tests, NetworkPolicies, non-root containers, and a production-values profile for k3s. Phase 4/5/6 reports already describe some of these controls. Therefore, Phase 7 must first verify those controls against the current commit and the assignment's Definition of Done, then close only evidenced gaps.

**Recommended outcome:** a reproducible hardening evidence pack showing (1) recovery from a gateway pod replacement without loss of gateway configuration/audit data, (2) least-privilege network paths and non-root execution for relevant workloads, (3) valid local and production-like Helm rendering, (4) explicit image/TLS/backup limitations, and (5) no regression in mandatory product journeys. A real VPS deployment is not mandatory unless the original assignment says so or the Technical Head explicitly approves it.

**Implementation hold:** no coding, Helm upgrade, cluster mutation, credential rotation, deletion, commit, or push is authorized by this plan.

## 2. Objective and rationale

The goal is to make the already-built team MCP gateway demonstrably resilient and deployable, without destabilizing the working store, gateway, dashboard, chat agent, or external MCP-client workflow.

Objectives trace to the original roadmap's Phase 7 line: pod kill tests, NetworkPolicies, non-root containers, and `values-prod.yaml` for k3s. The final acceptance phase remains separate: final full DoD run, video, README/threat model reconciliation, and submission.

## 3. Evidence vocabulary

Use these labels in all execution records:
- **Verified in this run:** command/test was executed against the stated commit/environment and output retained.
- **Repository evidence:** source, test, manifest, or report exists at a cited path; not proof that a live test was rerun.
- **Previously reported:** a prior report claims the result; not independently rerun for this phase.
- **Open/unverified:** evidence absent, stale, contradictory, or environment-dependent.
- **Accepted:** only when the designated Technical Head has explicitly signed off.

Do not turn a worker's `READY FOR ACCEPTANCE` into formal acceptance.

## 4. Current-state assessment (provisional pending P7-G0)

| Area | Current understanding | Evidence status / action |
|---|---|---|
| WooCommerce store and MCP server | Phases 2–3 reports describe persistent store and five-tool MCP service; products 10–12 and Order #14 are protected. | Historical report; use read-only baseline checks before and after all tests. |
| Gateway | Phase 4 G9 report describes aggregation of WooCommerce, CRM, Tasks; auth, dynamic upstreams, audit, SQLite/PVC and network isolation. | Reported evidence; re-run targeted regressions, not the entire implementation from scratch unless a failure requires it. |
| Team platform/dashboard | Phase 5 completion report is present in repository search and describes dashboard, identity, member/key lifecycle and audit retrieval. | Confirm exact current paths, current test commands and live deployment before planning remediation. |
| Chat agent/external MCP client | Phase 6 handoff path surfaced; its exact final status and test evidence must be read during G0. | Do not assume all CHT/EXT journeys passed merely because a handoff report exists. |
| Non-root, NetworkPolicy, Helm | Earlier G9 evidence reportedly includes some controls; original Phase 7 explicitly requires verifying them. | Validate current manifests and runtime security context; avoid duplicative work if evidence is current and adequate. |
| Production profile | Original roadmap names `values-prod.yaml` for k3s. | Validate render/schema/security posture; no VPS rollout by default. |
| Registry digest, TLS, backup/restore | Prior Phase 3/4 notes identify registry digest pinning and in-cluster TLS as production qualifications; local-path PVC is not off-host DR. | Keep explicit; only remediate if required by assignment and feasible, otherwise document as limitation. |

**Baseline source caveat:** the GitHub connector surfaced a commit-specific Phase 6 handoff URL at `docs/phase-6/p6-g7-final-acceptance-and-handoff-report.md` and search excerpts from the original roadmap. Before work, inspect the exact current default-branch commit and verify the report exists at that ref. This plan has not independently executed the repository's tests or queried the live cluster.

## 5. Scope and priority

### Must-have
1. **Baseline and requirement reconciliation:** current commit, clean/known working tree, exact Phase 6 handoff, original assignment DoD, traceability matrix, current Helm chart and runbooks.
2. **Non-destructive resilience test:** controlled gateway pod replacement, then verify readiness, MCP discovery/call, dashboard/chat/external-client paths as applicable, SQLite integrity, audit/config persistence, and WooCommerce baseline preservation.
3. **Network boundary verification:** prove intended traffic works and disallowed direct access to internal MCP services/store/database is blocked in the current profile. Verify NetworkPolicy selector/namespace behavior and local test-client exception.
4. **Runtime hardening verification:** inspect and test non-root UID, capabilities, seccomp, read-only filesystem where configured, writable paths, probes, shutdown behavior and resource settings. Fix only concrete failures.
5. **Helm profile validation:** render/lint local and production-like values; check replicas/PVC/SQLite single-writer assumptions, service exposure, ingress/TLS settings, secrets references and image identity. Do not deploy production values to a VPS by default.
6. **Regression + evidence:** run targeted and full feasible test suites; record skipped tests and limitations; update traceability, runbook, execution log and handoff report.

### Should-have, only if a concrete gap and time permits
- Repeatable script for non-destructive pod replacement and baseline checks.
- Failure injection for one unavailable/slow upstream, if not already covered by accepted Phase 4 tests and if it can run safely in the local cluster.
- Backup/restore rehearsal to a separate temporary location, only if a documented existing backup procedure can be exercised without overwriting live data.

### Out of scope unless separately approved
- Production/VPS rollout; real domain or certificate issuance.
- Distributed/multi-replica gateway or SQLite redesign.
- Database engine migration, broad refactor, new observability stack, multi-store provisioning.
- OAuth replacement, new auth model, new features unrelated to the assignment.
- Destructive cluster recreation, PVC deletion, database restore over live state, modifying/deleting products 10–12 or Order #14.
- Claiming production readiness solely from a successful Helm render or local k3d test.

## 6. Functional and technical requirements

### P7-F1 — Safe recovery after gateway pod replacement
- **Problem:** gateway must recover from a routine pod loss without silently losing persisted team configuration or audit history.
- **Behavior:** replacement pod becomes Ready; existing endpoint responds; known upstream catalog and authorized tool invocation work; persistent SQLite data remains valid.
- **Roles:** Admin and Member journeys may be used to verify access but no role changes are required.
- **Success:** capture pod UID before/after; replacement UID differs; PVC identity is unchanged; database integrity check succeeds using the documented safe procedure; known synthetic audit/config fixture remains; MCP health/discovery/call succeeds.
- **Failure:** pod cannot mount PVC, readiness never succeeds, SQLite integrity fails, or auth/config/audit state disappears. Stop further mutation and escalate.
- **Constraint:** never delete PVCs or reset live databases as part of this test.

### P7-F2 — Network segmentation
- **Problem:** internal MCP servers and the store/database must not become directly reachable from downstream clients.
- **Behavior:** only intended gateway-to-upstream and required platform paths are allowed; the gateway remains the single public MCP endpoint.
- **Success:** positive and negative connectivity probes from the documented source pods; effective policies inspected; store/database have no accidental public Service/Ingress; direct downstream-to-upstream access fails.
- **Failure:** policy does not select the expected pods, denies required traffic, or permits prohibited paths. Record actual source/destination/port and stop if correction could interrupt the store.

### P7-F3 — Non-root and container runtime posture
- **Problem:** reduce impact of a container compromise.
- **Behavior:** relevant application containers run as non-root, with restricted capabilities and seccomp where supported by existing design; writable locations are explicit.
- **Success:** manifest checks plus runtime UID/capability evidence; probes and normal tool calls still pass.
- **Failure:** image requires root or writes to an undeclared path. Do not relax controls silently; propose a minimal, reviewed fix.

### P7-F4 — Production-like Helm profile
- **Problem:** configuration should be reviewable and render reproducibly without pretending it has been deployed.
- **Behavior:** production-like values render with explicit image references, secrets references, ingress/TLS expectations, resource settings, persistence mode and replica assumptions.
- **Success:** `helm lint` and `helm template` pass for both profiles; rendered manifest review confirms internal MCP Services are not public and SQLite remains single-writer/single-replica unless an approved alternative exists.
- **Failure:** missing required values, unsafe exposure, mutable image reference where digest is required, TLS absent/ambiguous, or replica/storage mismatch.
- **Boundary:** production readiness remains blocked if required registry digest, TLS, backup/restore or external pull verification is still open.

### P7-F5 — Regression and data integrity
- Re-run the existing canonical commands from repository docs, including relevant unit/integration/protocol tests, dashboard/chat/external MCP flows, Helm checks and baseline checks.
- Every test fixture must be synthetic/disposable and cleaned up in `finally`/equivalent cleanup.
- Verify products 10, 11, 12 and Order #14 before and after. Compare IDs, SKU/status/total rather than relying on display names alone.
- Any baseline drift is a stop condition; do not “repair” it without authorization.

## 7. Requirement-to-deliverable traceability (provisional)

| Original requirement / roadmap item | Phase 7 deliverable | Acceptance test / evidence | Status before G0 |
|---|---|---|---|
| Reliability / pod-kill recovery | P7-G3 recovery report/script | Pod UID changes, PVC identity stable, data integrity and app journeys pass | Open until rerun |
| NetworkPolicies | P7-G4 network evidence matrix | Allowed gateway→upstream succeeds; prohibited client→upstream/store/db fails | Prior reports mention controls; current evidence unverified |
| Non-root containers | P7-G4 runtime posture report | SecurityContext manifest + runtime UID/capability evidence | Prior report mentions non-root gateway; all relevant workloads need inspection |
| Production-like `values-prod.yaml` for k3s | P7-G2 Helm review | lint/template for local and production-like values, rendered-manifest review | Verify exact file/path and output |
| Existing gateway/auth/audit/MCP behavior | P7-G5 regression pack | Auth/revocation, routing, dynamic management, audit redaction, MCP Inspector and chat flow tests as defined by current traceability | Reuse canonical tests; do not assume Phase 6 success |
| Store baseline protection | P7-G0/G3/G5 baseline evidence | Products 10–12 and Order #14 unchanged before/after | Must capture fresh baseline |
| Assignment submission quality | P7-G6 evidence handoff | Traceability complete, README/runbook/demo evidence, known limitations listed | Final Phase 8 responsibility; Phase 7 supplies evidence |

During P7-G0, replace the provisional wording with exact requirement IDs and exact acceptance-test identifiers from `docs/requirements-traceability.md`. Do not invent IDs if the matrix cannot be found; record a blocker and request review.

## 8. Implementation gates

### P7-G0 — Repository, report and environment preflight
**Objective:** establish what is actually present and accepted before changing anything.
- Inspect current branch/commit/status; record uncommitted changes and do not overwrite them.
- Read the original assignment, canonical roadmap, traceability matrix, Phase 4 G9 report, Phase 5 completion/handoff, Phase 6 final handoff, relevant ADRs and runbooks.
- Inventory exact chart paths, values files, Deployments/StatefulSets, Services, Ingresses, NetworkPolicies, ServiceAccounts/RBAC, PVCs, images and test commands.
- Record cluster context, node readiness, namespace, pods, PVC/PV identity, current Helm revision, resource headroom and baseline products/orders.
- No deploy, delete, restart, credential rotation, commit or push.
**Acceptance:** source inventory and test plan cite exact paths/commit; uncertainties are explicit; baseline captured.
**Evidence:** `docs/phase-7/phase-7-execution-log.md` (planned output).
**Stop:** missing report/traceability, dirty working tree not understood, unexpected cluster context, low disk/memory, missing protected records, or conflict between assignment and roadmap. Return for Technical Head decision.

### P7-G1 — Gap triage and authorization
**Objective:** turn preflight observations into a bounded worklist.
- Classify each original Phase 7 item as already demonstrated, needs rerun, concrete gap, or deferred production qualification.
- Map each gap to one owner, one test, one proposed change, and rollback.
- Confirm exact required local acceptance environment and whether a VPS deployment is required by the assignment.
**Acceptance:** Technical Head approves the prioritized remediation list and any changes to existing behavior.
**Stop:** proposed work needs schema migration, architecture redesign, public exposure, production credentials, PVC replacement, or exceeds available time.

### P7-G2 — Helm and runtime configuration review
**Objective:** validate current deployment profiles before any cluster operation.
- Run chart lint/template against local and production-like values.
- Review image references/digests, replicas, PVC access mode, SQLite single-writer constraint, Services/Ingress, TLS flags, resource limits, probes, securityContext, Secret references and NetworkPolicy selectors.
- Fix only approved concrete configuration defects; render again after changes.
**Acceptance:** both profiles render and static checks pass; a reviewer can explain all exposure/storage/security differences.
**Evidence:** command output, rendered manifest summaries, diff and review checklist.
**Stop:** values imply unsafe public MCP exposure, multi-replica SQLite writers, missing secret references, or production guarantees unsupported by infrastructure.

### P7-G3 — Controlled pod-replacement and persistence test
**Objective:** demonstrate recovery without data loss.
- Use the exact target Deployment and namespace from G0; capture pod UID, PVC/PV identity, Helm revision, database integrity, synthetic audit/config markers and protected store baseline.
- Use a documented, targeted pod deletion only after Technical Head authorizes the action; do not delete PVCs or restart database/store workloads as a shortcut.
- Wait for new pod readiness, then verify MCP initialization/discovery, one read-only call, dashboard health and relevant Phase 6 flow.
- Recheck SQLite integrity, persistent markers and protected store baseline.
**Acceptance:** replacement pod UID changes, PVC identity stable, app recovers, persisted markers remain, baseline unchanged.
**Rollback/recovery:** if readiness fails, stop repeated deletes; gather events/logs and follow runbook. No restore over live data without approval.
**Stop:** database integrity failure, PVC identity change, baseline drift, or repeated crash loop.

### P7-G4 — NetworkPolicy and runtime hardening verification
**Objective:** prove effective—not merely declared—boundaries.
- Inspect selectors and ports in policies and matching pod labels.
- Run permitted and forbidden connectivity tests from controlled test pods.
- Verify non-root UID, capabilities, seccomp, filesystem writes, probes, resource requests/limits and shutdown behavior for gateway, mocks and WooCommerce MCP as applicable.
- Apply only approved minimal fixes; rerun both positive and negative tests.
**Acceptance:** permitted flows succeed; prohibited direct paths fail; runtime evidence supports the securityContext claims; no regression.
**Stop:** fix requires broad policy relaxation, privileged container, public exposure, or causes store/API unavailability.

### P7-G5 — Regression and load sanity
**Objective:** ensure hardening did not break accepted product behavior.
- Execute repository-defined unit, protocol, integration and frontend tests.
- Test Admin and Member access, key revocation, upstream lifecycle, audit redaction, tool routing, unavailable-upstream behavior, chat tool loop and external MCP Inspector flow as covered by Phase 6.
- Use a small representative load sanity test only if existing harness and resource headroom permit; do not invent a performance SLA.
- Re-check protected WooCommerce records and cleanup synthetic fixtures.
**Acceptance:** all mandatory tests pass; failures/skips are itemized with cause and owner; no baseline drift.
**Stop:** any security regression, protected data change, unexplained flaky failures, or host resource exhaustion.

### P7-G6 — Evidence, documentation and Technical Head handoff
**Objective:** produce an auditable acceptance recommendation.
- Update requirements traceability with exact evidence references.
- Update architecture/ADR only if an approved decision changed; update operational runbook and Phase 7 execution log.
- Produce final report separating current-run tests, repository evidence, historical claims, skipped tests and known limitations.
- Prepare Phase 8 handoff; do not claim assignment completion or submit the form as part of Phase 7.
**Acceptance:** evidence is reproducible and all open risks have owners/disposition.
**Stop:** missing mandatory evidence, ambiguous acceptance status, or any unsupported production-ready claim.

## 9. Test and evidence matrix

| ID | Test | Procedure | Pass condition | Evidence |
|---|---|---|---|---|
| P7-T01 | Baseline capture | Read-only query/verified runbook for products 10–12 and Order #14 | IDs/SKUs/status/total captured without mutation | Before snapshot |
| P7-T02 | Helm lint/render | Canonical `helm lint` and `helm template` for local/prod-like values | Exit 0; no missing values or template errors | Command/output + commit |
| P7-T03 | Manifest security review | Inspect rendered workloads, Services, Ingress, securityContext, policies, PVCs | Intended exposure and storage invariants hold | Checklist and manifest excerpt |
| P7-T04 | Pod replacement | Authorized targeted gateway pod replacement | New UID, stable PVC, Ready, persistent data intact | Before/after pod/PVC/db evidence |
| P7-T05 | SQLite integrity | Documented read-only/safe integrity check against the intended DB | Integrity result successful; no unintended writes | Exact command and output |
| P7-T06 | Network positive/negative | Probe allowed gateway→upstream and denied client→upstream/store/db paths | Expected paths succeed/fail | Source/dest/port results |
| P7-T07 | Runtime UID | Inspect manifest and runtime process UID/capabilities | Non-root and restrictions match approved design | `kubectl`/container evidence |
| P7-T08 | Core MCP regression | initialize, tools/list, representative read-only tools/call | Expected catalog/results, no credential leakage | Test output |
| P7-T09 | Auth and lifecycle regression | Admin/Member, invalid/revoked key, upstream disable/delete in disposable fixture | Correct authorization and state transitions | Automated test report |
| P7-T10 | Phase 6 regression | Chat-agent tool loop and separate external client/User B flow per handoff | All required journeys pass as defined by exact traceability | Video/log/test evidence |
| P7-T11 | Audit redaction | Exercise synthetic call and inspect UI/query/logs | No raw keys, upstream credentials or protected PII | Redacted audit evidence |
| P7-T12 | Post-test baseline | Repeat T01 after tests | Protected records unchanged | Before/after comparison |
| P7-T13 | Test cleanup | Verify disposable fixture cleanup | No leftover test upstream/products/orders | Cleanup report |
| P7-T14 | Reproducibility | Run documented commands from clean checkout/environment where feasible | Results repeat or prerequisites are clearly documented | Execution log |

## 10. Risk register

| ID | Risk | Impact | Mitigation | Escalation/owner |
|---|---|---|---|---|
| R7-01 | Time remaining is very short | Final submission loses time to broad hardening | G0 immediately; prioritize mandatory evidence, stop optional work by 24 Oct | Technical Head decides trade-offs |
| R7-02 | Historical reports are mistaken for current verification | Unsupported acceptance claims | Evidence labels and exact commit references | Product Manager + Technical Head |
| R7-03 | Pod test impacts persistent state | Loss/corruption of SQLite or store data | Backup evidence, exact target, targeted gateway pod only, no PVC deletion | Stop and escalate |
| R7-04 | NetworkPolicy changes block required traffic | MCP/dashboard/store outage | Verify selectors; positive and negative probes; minimal diffs | Technical Head approval for policy changes |
| R7-05 | Production profile appears secure but lacks TLS/digest/backup | False production-ready claim | Explicit qualification table; render ≠ deployment proof | Production remains blocked until criteria met |
| R7-06 | SQLite replica/volume mismatch | Locking/corruption/data loss | Single writer, one replica and compatible volume assumptions checked | Architecture decision required for changes |
| R7-07 | Test fixtures mutate protected WooCommerce records | Assignment demo damaged | Read-only baseline, disposable synthetic fixtures, cleanup, before/after check | Immediate stop |
| R7-08 | Resource pressure causes noisy failures | Flaky tests or cluster instability | Record headroom; small test load; stop under pressure | Technical Head |
| R7-09 | Unclear Phase 6 status | Chat/external-client requirements may remain incomplete | Read exact handoff and traceability during G0; keep Phase 8 acceptance separate | Technical Head resolves scope |

## 11. Decisions required from Technical Head

1. Confirm the canonical repository branch/commit and whether the surfaced Phase 6 handoff is the current accepted artifact.
2. Confirm which original assignment requirements are mandatory for Phase 7 versus final Phase 8 acceptance.
3. Confirm whether a real VPS/k3s deployment is required. Recommendation: no, unless explicit in the original assignment.
4. Authorize one targeted gateway pod replacement test after baseline capture; no other destructive action is implied.
5. Confirm whether registry digest pinning, in-cluster TLS and backup/restore are required to meet assignment DoD or remain documented production qualifications.
6. Approve any concrete source/Helm/NetworkPolicy edits only after G0/G1 reports the exact diff and rollback.
7. Confirm acceptance authority and evidence format; phase report status must remain “recommended for acceptance” until signed off.

## 12. Timeline and feasibility

Deadline: **26 October 2026, 11:59 PM IST**. Original roadmap allocates 23–24 October to Phase 7 and 25–26 October to final acceptance/demo/submission.

| Date (IST) | Planned focus | Exit evidence |
|---|---|---|
| 22 Oct | Prepare plan; no implementation | Technical Head review package |
| 23 Oct AM | P7-G0 preflight and G1 gap triage | Baseline, exact report/requirements map, authorized change list |
| 23 Oct PM | P7-G2 static Helm/runtime review | Lint/render outputs and reviewed manifest checklist |
| 24 Oct AM | P7-G3 controlled pod replacement | Recovery/persistence evidence |
| 24 Oct PM | P7-G4 NetworkPolicy/runtime checks | Positive/negative probes, non-root evidence |
| 25 Oct | P7-G5 regression; only approved fixes | Regression matrix and baseline comparison |
| 26 Oct AM | P7-G6 documentation/handoff; final acceptance preparation | Evidence pack and known limitations |
| 26 Oct PM | Phase 8 demo, video, README/submission | Preserve time for recording and form submission before 11:59 PM IST |

This is aggressive. If G0 discovers a failing mandatory Phase 6 journey, security regression, or data-integrity problem, prioritize that over optional load tests and production-only extras. Do not reduce correctness or conceal failed tests to meet dates.

## 13. Phase 7 Definition of Done

- [ ] Current commit, original assignment, current traceability and Phase 6 handoff reviewed.
- [ ] Exact Phase 7 requirement IDs and acceptance tests mapped; no invented IDs.
- [ ] Both Helm profiles lint and render successfully, with reviewed output.
- [ ] Controlled gateway pod replacement demonstrates recovery and persistence, if authorized and safe.
- [ ] NetworkPolicy allowed/denied paths verified with source/destination evidence.
- [ ] Runtime non-root/securityContext claims verified for relevant workloads.
- [ ] Core gateway, dashboard, chat and external-client regression tests pass, or exceptions are explicitly recorded and approved.
- [ ] Products 10–12 and Order #14 unchanged before/after.
- [ ] No secrets or protected PII in logs, audit evidence or screenshots.
- [ ] Runbook, traceability, execution log and final report updated.
- [ ] Production limitations and deferred work explicitly listed.
- [ ] Technical Head has reviewed evidence and recorded acceptance or requested remediation.

**Phase 7 does not itself constitute final assignment acceptance or authorize production deployment.**
