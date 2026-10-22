# Phase 7 Risk and Decision Register

**Status:** Proposed for Technical Head review. No decisions are considered approved by this document.

## Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner / closure evidence |
|---|---|---:|---:|---|---|
| R7-01 | Only four calendar days remain before submission | High | High | Strict gate order; freeze optional scope by 24 Oct; protect Phase 8 | Technical Head approves priority plan |
| R7-02 | Phase 6 report is mistaken for formal acceptance | Medium | High | Inspect exact report and acceptance record; use explicit status labels | Formal sign-off or open status recorded |
| R7-03 | Historical test claims are stale | High | High | Rerun targeted tests on current commit | Current-run output attached |
| R7-04 | Pod replacement damages persistent state | Low/Medium | Critical | Target gateway pod only; baseline capture; no PVC deletion; stop on drift | Before/after PVC/DB/baseline evidence |
| R7-05 | NetworkPolicy edit blocks healthy traffic | Medium | High | Inspect selectors, test positive and negative paths, minimal change | Test matrix and reviewed diff |
| R7-06 | SQLite and replica/storage configuration conflict | Medium | Critical | Preserve single-writer assumption; verify one replica and volume mode | Rendered manifest and persistence test |
| R7-07 | Production-like values are interpreted as production readiness | High | High | Separate render evidence from deployment evidence; list TLS/digest/DR gaps | Qualified readiness statement |
| R7-08 | Resource pressure invalidates results | Medium | Medium | Capture headroom, keep load test small, stop on instability | Environment snapshot and logs |
| R7-09 | Phase 6 required journey is still failing | Unknown | High | Read handoff and rerun critical journey early | E2E report; Head reprioritization if failed |
| R7-10 | Protected WooCommerce records are changed by tests | Low/Medium | Critical | Read-only snapshots, synthetic disposable fixtures, post-run comparison | Before/after IDs/SKUs/order status/total |

## Decisions requiring Technical Head approval

| ID | Decision | Recommendation | Why approval is required |
|---|---|---|---|
| D7-01 | Is a VPS/k3s rollout mandatory for assignment DoD? | No, unless the original brief explicitly requires it. Validate production-like Helm rendering instead. | External infrastructure increases time, exposure and rollback risk. |
| D7-02 | May the worker delete one gateway pod to test recovery? | Yes, only after G0 baseline capture and a specific authorized command/target. | It mutates the live local cluster, though it should preserve the PVC. |
| D7-03 | Are registry digest pinning, in-cluster TLS and off-host backup required in Phase 7? | Treat as production qualifications unless original brief explicitly makes them mandatory. | Existing reports identify these as open production-readiness areas; avoid scope creep and false closure. |
| D7-04 | Can concrete Helm/NetworkPolicy/runtime defects be fixed during Phase 7? | Only after G1 presents exact diff, test, impact and rollback for approval. | Changes can affect store, dashboard, MCP access and persistent state. |
| D7-05 | What is the formal Phase 6 acceptance status? | Use the explicit Technical Head record; if absent, say “handoff submitted; acceptance unconfirmed.” | Worker recommendation is not approval. |
| D7-06 | What exact requirement IDs define Phase 7? | Copy from canonical traceability and original assignment during G0. | Search excerpts do not establish the complete current matrix. |
| D7-07 | Should optional backup/restore and load tests be attempted? | Only if mandatory gates pass and time remains. | Protects final demo/submission window. |

## Mandatory stop conditions

Stop and return to the Technical Head if:
- Current branch/commit or working-tree state cannot be established.
- The active Kubernetes context differs from the expected local cluster.
- The baseline store records are absent or already differ from accepted records.
- A proposed test would delete/replace a PVC, overwrite a database, rotate a credential, or expose an internal service.
- SQLite integrity fails, protected records drift, or unexpected database writes occur.
- A required fix needs architecture migration, multi-replica SQLite, broad policy relaxation, privileged containers, or public exposure.
- A test failure could not be reproduced or its cause is unknown.
- The remaining schedule no longer supports both mandatory hardening evidence and final acceptance/demo.
