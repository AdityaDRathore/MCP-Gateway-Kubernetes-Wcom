# Phase 7 Addendum — Reliability, Deployment Hardening & Evidence

**Planning status:** Proposed; Product Manager review and Technical Head approval required.  
**Execution target:** 23–24 October 2026. **Assignment deadline:** 26 October 2026, 11:59 PM IST.

This addendum supplements `Resource/implementation/phase_1_master_roadmap_and_checklist.md`; it does not replace or rewrite the canonical roadmap.

## Objective

Do not expand the feature set. Verify the integrated Phase 1–6 platform against the original assignment’s failure-isolation, deployment, security and persistence requirements; close only concrete evidence-backed gaps; and hand Phase 8 a reproducible release candidate.

## Sequential gates

- **P7-G0 Baseline freeze:** record repo SHA/tree state, image/chart/Helm release identity, cluster context, authoritative Phase 6 handoff status, test-count provenance, INF-02 traceability inconsistency and protected store baseline.
- **P7-G1 Helm/security review:** lint and render local and production values; inspect ingress/services, NetworkPolicies, probes/resources, security contexts, secrets references, PVCs and single-replica SQLite strategy.
- **P7-G2 Failure isolation:** disrupt only a disposable stateless CRM/Tasks upstream; prove Gateway and other upstreams remain usable, dashboard shows Unreachable, and service recovers.
- **P7-G3 Persistence:** validate SQLite integrity and a new backup copy; after explicit approval, replace Gateway pod and verify persisted metadata. Store restart is separately approved and optional.
- **P7-G4 Regression:** rerun build/typecheck/tests, dashboard build, Helm checks, browser auth/RBAC/CSRF, chat read-only tool cycle, external MCP discovery/cross-server flow, revocation, upstream disable/re-enable, audit attribution and protected-data checks.
- **P7-G5 Handoff:** publish evidence-backed completion report, update traceability only when proven, record limitations and deliver Phase 8 checklist. Technical Head Go/No-Go is required.

## No-change invariants

- Never mutate/delete WooCommerce products 10, 11, 12 or Order #14.
- Keep Gateway single-replica with `Recreate`, SQLite WAL and the existing PVC strategy.
- Keep browser session/CSRF on port 3001 separate from MCP bearer-key auth on port 3000.
- Keep upstream MCP services private and all downstream calls routed through Gateway.
- Keep WooCommerce access behind WooCommerce MCP.
- Do not claim local-path volumes provide off-host or node-loss recovery.
- No destructive reset/reseed, PVC deletion, live restore, schema migration, public VPS rollout or architecture redesign without explicit approval.
- No test is “passed” without a recorded command/steps, exit code, SHA and evidence.
- Phase 8 on 25–26 October remains protected for full Definition of Done, demo/video, documentation and submission.

See `docs/phase-7/README.md` for the full planning package.
