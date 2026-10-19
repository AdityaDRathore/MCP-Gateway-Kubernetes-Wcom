# Phase 5 Schedule and Technical Head Handoff

**Planning date:** 19 October 2026 (IST)  
**Submission deadline:** Monday, 26 October 2026, 11:59 PM IST  
**Status:** Proposed; requires review  
**Implementation status:** HOLD — no implementation authorization in this package

## 1. Dates and critical path

| Date | Planned decision/delivery | Required evidence | Gate/blocker |
|---|---|---|---|
| Mon 19 Oct | Review this package; clarify G9 formal acceptance; approve or reject core browser-auth/listener/key-ownership assumptions | Technical Head decision log; no implementation actions | Phase 4 acceptance and Phase 5 planning decision |
| Tue 20 Oct | Complete G0 read-only baseline reconciliation and G1 contract freeze | Current HEAD/image/Helm/Ingress evidence; route/API inventory; approved migration/session/role contract | No code work before documented approval and hold release |
| Wed 21 Oct | P5-G2 dashboard scaffold/build/login/current session and listener/Ingress path | Clean build, Helm render, `/mcp` remains healthy, public `/admin/v1` remains 404 | Foundation and security path |
| Thu 22 Oct | P5-G3 upstream list/detail/tool view and lifecycle UI | Disposable fixture end-to-end; no secret leak; Member direct API denial | Reuse existing AdminService and catalog |
| Fri 23 Oct | P5-G4 team invitation, API-key management, owner checks, migration/pod replacement | One-time key flow; cross-user denial; `/mcp` immediate revocation; SQLite integrity | Highest-risk account/key milestone |
| Sat 24 Oct | P5-G5 audit read/table; G6 full integration and security regression; P5 acceptance recommendation | Test matrix; redaction; protected baseline/PVC comparison; evidence package | Phase 5 intended acceptance target |
| Sun 25 Oct | Phase 6 chat agent tool loop + external MCP client/User B demo; targeted Phase 7 hardening | Multi-server tool loop, external client test, pod-failure/fail-isolation evidence as feasible | Depends on P5 acceptance; no bonus features |
| Mon 26 Oct | Final regression, demo capture, docs/README/traceability, submission packaging | Final evidence manifest; clean demo flow; explicit known gaps | Deadline 11:59 PM IST; keep final hours for submission |

## 2. Feasibility assessment

The original forecast put Phase 5 on 18–20 October, Phase 6 on 21–22, Phase 7 on 23–24, and Phase 8 on 25–26. That sequence is now compressed. The dashboard source and browser management endpoints are not present in the inspected source paths, and G9 formal acceptance is not evidenced. This makes the remaining plan **high risk and not confidently feasible without prompt decisions and strict scope**.

The schedule assumes one implementation worker can reuse the current service classes rather than rewrite them, no major mismatch between the deployed G9 image and current source, and a working baseline cluster. A browser identity/migration issue, ingress isolation failure, or key ownership defect can consume the remaining contingency. Do not compensate by removing CSRF, weakening RBAC, exposing the Admin router, skipping audit redaction, running against protected products/orders, or adding a second SQLite writer.

### Priority if time slips

1. **P0 — mandatory assignment blockers:** Admin/Member browser identity and direct API authorization; upstream lifecycle; member/key ownership and immediate revocation; private upstream credentials; audit attribution/table; `/mcp` compatibility; Kubernetes/store data invariants.
2. **P1 — remaining mandatory demonstration:** LLM chat agent tool loop as User A, external MCP client/User B using only gateway URL/key, one cross-server workflow, upstream failure isolation, reproducible deployment and final demo.
3. **P2 — deferable:** advanced filters, animation, sophisticated visual system, per-tool granular permissions, OAuth/OIDC, multi-store, distributed scaling, heavyweight observability, optional VPS rollout.

If Phase 5 is not acceptance-ready by 24 October, the Technical Head should re-prioritize explicitly. A failed mandatory test is not solved by relabeling the phase complete.

## 3. Handoff requested from the Technical Head

Please record decisions for `P5-DEC-01` through `P5-DEC-12` in `phase-5-risk-and-decision-register.md`, including:

- Whether Gate G9 is formally accepted and how ADR-012 status is resolved.
- Browser session/authentication choice and first-admin/member onboarding approach.
- Whether Member self-service keys and only-own-audit view are in scope.
- Approval/rejection of the two-listener Ingress plan.
- Disposition of the G9 route discrepancy and stale requirements status.
- Confirmation that implementation remains held until a separate explicit release.

## 4. Work-order boundary

This handoff includes product planning and acceptance design only. It does not authorize source edits, package installs, builds, tests that mutate state, Helm upgrades, Kubernetes changes, secrets/key rotation, database migration, VPS deployment, or destructive test setup. Once the planning documents are approved, the Technical Head should issue a separate bounded implementation work order with gate-specific change permissions and stop conditions.
