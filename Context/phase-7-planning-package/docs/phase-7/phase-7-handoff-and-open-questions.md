# Phase 7 Planning Handoff and Open Questions

## Recommendation

**READY FOR TECHNICAL HEAD REVIEW OF THE PLAN; NOT READY FOR IMPLEMENTATION AUTHORIZATION.**

Phase 7 should verify and close the original hardening objectives without rebuilding Phase 4/5/6 features. The highest-value evidence is a controlled gateway pod-replacement test, effective NetworkPolicy checks, runtime non-root verification, production-like Helm rendering, and a complete regression run that preserves protected store records.

## What is reusable

Prior reports and repository search indicate existing gateway aggregation, dynamic upstream management, gateway API-key authentication, Admin/Member roles, audit logging/redaction, SQLite/PVC persistence, Kubernetes deployment controls, dashboard, chat agent, and external MCP-client demonstration materials. These should be reused and tested; they should not be reimplemented without a demonstrated gap.

## What Phase 7 adds

- Current-commit evidence for resilience and recovery.
- Effective network-boundary proof, not just manifest presence.
- Runtime verification of non-root and container security settings.
- Local/production-like Helm validation and explicit deployment qualifications.
- Regression results and data-integrity evidence.
- Updated traceability/runbook and a clean handoff to Phase 8.

## Unresolved questions

1. What exact commit is the approved Phase 6 baseline?
2. Has the Technical Head formally accepted Phase 6, or is its final report only submitted/recommended?
3. What exact original assignment requirement IDs correspond to Phase 7? Copy them from the current traceability file at G0.
4. Does the assignment explicitly require a real VPS/k3s deployment, or only a production-like configuration? Recommendation: do not deploy to a VPS without explicit requirement and approval.
5. Are TLS, remote registry digest pinning and off-host backup/restore mandatory for the assignment, or documented production qualifications?
6. Is the local cluster stable and sufficiently resourced for a controlled pod replacement and test run?
7. Which existing commands constitute the canonical Phase 6 chat-agent and external MCP-client acceptance tests?
8. Who signs Phase 7 acceptance and which evidence artifact format is preferred?

## Review requested

Technical Head is asked to:
- Confirm the source baseline and Phase 6 acceptance status.
- Approve the bounded scope and proposed gates.
- Decide D7-01 through D7-07 in `phase-7-risk-and-decision-register.md`.
- Explicitly authorize or decline the targeted pod replacement after G0.
- Keep implementation on hold until those decisions are recorded.

No implementation, deployment, commit, push, credential rotation, or destructive action was performed in preparing this planning package.
