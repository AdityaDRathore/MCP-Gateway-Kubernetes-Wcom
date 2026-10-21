# Phase 6 Roadmap Addendum (21 Oct 2026)

> Append this section to the existing canonical `Resource/implementation/phase_1_master_roadmap_and_checklist.md`. Do not replace or delete the existing Phase 1 work order.

## Eight-phase schedule (preserve original structure)

| Phase | Dates | Outcome |
|---|---|---|
| 1 | Oct 9–10 | Foundation and technical validation |
| 2 | Oct 11–12 | WooCommerce store on local Kubernetes |
| 3 | Oct 13–14 | Custom WooCommerce MCP |
| 4 | Oct 15–17 | Gateway aggregation/routing |
| 5 | Oct 18–20 | Team platform/dashboard — Phase 5 report dated Oct 21 says accepted/closed |
| 6 | Oct 21–22 | In-dashboard chat agent and external MCP clients |
| 7 | Oct 23–24 | Reliability/deployment hardening |
| 8 | Oct 25–26 | Acceptance, demo and submission by 26 Oct 11:59 PM IST |

## Phase 6 — CHT-02..04 and EXT-01..03

**Status:** planning draft; implementation hold pending technical-head approval. Copy exact requirement wording from the original assignment brief into traceability at G0.

### Invariants
- Browser session auth stays on port 3001; MCP bearer keys stay on port 3000.
- Provider/upstream credentials stay server-side.
- Every model tool call uses normal Gateway validation, authorization, timeout/circuit-breaker and audit.
- External clients connect only to Gateway; upstreams remain internal.
- SQLite WAL remains single-replica/PVC.
- Products 10/11/12 and Order #14 are protected; use disposable fixtures for writes.
- No paid plan or VPS rollout is mandatory.

### Gates
- **P6-G0 Baseline:** confirm SHA, clean tree, exact CHT/EXT wording, build/tests/Helm, existing chat code, actual tool names and protected records.
- **P6-G1 Design:** approve provider, session-authenticated route, least-privilege tool execution, allowlist/schema validation, write confirmation, limits, redaction, history policy and Inspector setup.
- **P6-G2 Backend:** one real server-side model provider; input/output/deadline/concurrency limits; safe errors; no secret leakage.
- **P6-G3 Agent/UI:** bounded tool loop (initial suggestion max 5 calls), normal Gateway path, read-only default, sanitized tool activity, safe rendering.
- **P6-G4 External client:** MCP Inspector connection, namespaced discovery from WooCommerce/CRM/Tasks, safe call per upstream, invalid/revoked key tests.
- **P6-G5 Security/regression:** auth separation, RBAC, redaction, audit correlation, timeout/circuit breaker, tests/build/Helm and protected-data checks.
- **P6-G6 Docs:** traceability, provider setup, Inspector guide, runbook, demo script and per-suite evidence.
- **P6-G7 Acceptance:** CHT-02..04 and EXT-01..03 evidenced; technical-head Go/No-Go before Phase 7.

See `docs/phase-6/phase-6-master-technical-roadmap.md` for the detailed checklist and `phase-6-risk-and-decision-register.md` for approvals/open questions.
