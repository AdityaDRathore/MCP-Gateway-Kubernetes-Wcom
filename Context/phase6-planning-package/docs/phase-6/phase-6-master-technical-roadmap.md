# Phase 6 Master Technical Roadmap & Execution Checklist

**Date:** 21 Oct 2026 | **Target capability-complete:** 22 Oct | **Status:** ready for technical-head review; implementation hold until approved.  
**Deadline:** 26 Oct 2026, 11:59 PM IST.  
**Traceability:** CHT-02..04 and EXT-01..03; exact wording must be reconciled at G0.

## Non-negotiable invariants
1. Browser sessions remain on port 3001; MCP bearer keys remain on port 3000.
2. Provider/upstream credentials remain server-side.
3. Every model-requested tool call goes through normal Gateway validation, authorization, timeout/circuit-breaker and audit.
4. External clients connect only to the Gateway; upstreams remain internal ClusterIP.
5. No mutation/deletion of protected products 10/11/12 or Order #14; writes use disposable fixtures.
6. Preserve SQLite WAL single-replica (`Recreate`) and PVC.
7. No paid plan, VPS deployment or optional bonus is a blocker.
8. No passing-test claim without recorded command, exit code, commit and scope.

## P6-G0 — Baseline freeze and requirement reconciliation
- [ ] Confirm branch/SHA/clean tree and Phase 5 accepted baseline.
- [ ] Copy exact CHT/EXT wording from original brief into traceability.
- [ ] Run baseline install/build/typecheck/tests/Helm lint+template; capture outcomes.
- [ ] Inspect existing chat/provider code, browser auth/CSRF, MCP router, API-key scopes and audit.
- [ ] Verify actual namespaced `tools/list` catalog and update demo examples.
- [ ] Reconcile test counts by suite/command/SHA; do not sum unlike scopes.
- [ ] Verify protected store records read-only.
**Exit:** baseline is understood; no architecture assumption blocks design.

## P6-G1 — Security/interface design approval
- [ ] Approve chat route schema, input/output caps, deadlines, cancellation and rate/concurrency limits.
- [ ] Choose one verified provider path; Ollama optional.
- [ ] Decide least-privilege agent-to-Gateway execution identity and preserve audit.
- [ ] Approve tool allowlist, schema validation, write confirmation policy, maximum calls (initial recommendation: 5), output redaction.
- [ ] Default to ephemeral history unless persistence is explicitly required.
- [ ] Verify MCP Inspector version/config and acceptance journey.
**Exit:** technical-head approves architecture before implementation.

## P6-G2 — Chat backend/provider adapter
- [ ] Implement or reuse server-side provider adapter.
- [ ] Authenticate from browser session and verify active user.
- [ ] Keep provider key out of frontend build and all responses/logs.
- [ ] Bound input/output, provider timeout, total request duration and concurrency.
- [ ] Handle missing config, provider rate limit, timeout and malformed output safely.
- [ ] Add unit tests for success, validation and provider failures.
**Exit:** real authenticated model round-trip works without tool execution.

## P6-G3 — Bounded agent loop and dashboard chat UI
- [ ] Implement bounded tool loop and cancellation/deadline.
- [ ] Validate tool against current catalog, published schema and per-user policy.
- [ ] Execute through normal Gateway path, not direct upstream calls.
- [ ] Default demo to read-only; writes require explicit confirmation or disposable fixture.
- [ ] Redact/minimize/cap output before model context and UI.
- [ ] UI shows message, pending/error state and sanitized tool name/status/duration.
- [ ] Render untrusted text safely; never execute model HTML/code.
- [ ] Test unknown tools, invalid args, disabled upstream, provider/upstream errors and loop cap.
**Exit:** one full natural-language → tool call → result → final answer cycle, with correlated audit.

## P6-G4 — External MCP client (MCP Inspector)
- [ ] Issue member-specific key with necessary read/execute scopes only.
- [ ] Verify actual host, port, `/mcp`, Streamable HTTP and Inspector config.
- [ ] Connect and record negotiated protocol behavior; don't assume a fixed revision.
- [ ] Discover namespaced tools from WooCommerce, CRM and Tasks.
- [ ] Invoke one safe read-only tool from each upstream.
- [ ] Test invalid, insufficient-scope and revoked keys.
- [ ] Revoke demo key; redact it from screenshots/logs.
**Exit:** reproducible external-client guide and positive/negative evidence.

## P6-G5 — Cross-path security and regression
- [ ] Prove browser sessions and MCP bearer keys cannot substitute for each other.
- [ ] Verify member/admin RBAC, secret isolation, PII redaction and audit correlation.
- [ ] Test provider timeout, upstream timeout/circuit open, unknown tool and max-loop stop.
- [ ] Re-run existing unit/protocol/integration tests and dashboard build.
- [ ] Run Helm lint/template and manifest checks.
- [ ] Verify protected WooCommerce baseline unchanged.
**Exit:** no critical security or baseline regression.

## P6-G6 — Documentation and demo
- [ ] Update traceability with exact criteria, test IDs and evidence paths.
- [ ] Update README, runbook, chat configuration and MCP Inspector guide.
- [ ] Add demo script with cleanup/rollback and placeholder credentials only.
- [ ] Record test counts per suite, commit SHA, sanitized outputs and known limitations.
- [ ] Write completion report; label it ready for acceptance until formally accepted.
**Exit:** another reviewer can reproduce required journeys without guessing.

## P6-G7 — Acceptance and handoff
- [ ] CHT-02: authenticated natural-language chat round-trip.
- [ ] CHT-03: model-selected tool routed through Gateway controls.
- [ ] CHT-04: answer and sanitized activity shown in dashboard.
- [ ] EXT-01: MCP Inspector connects to Gateway.
- [ ] EXT-02: member-specific key works; invalid/revoked key fails.
- [ ] EXT-03: catalog includes all three upstreams and safe call works for each.
- [ ] Auth separation, RBAC, audit/redaction and protected data verified.
- [ ] Tests/build/Helm checks and limitations recorded.
- [ ] Technical-head Go/No-Go before Phase 7 handoff.

## Suggested files (inspect first; do not duplicate existing code)
- `apps/gateway/src/chat/` for orchestration/provider abstraction if no equivalent exists.
- Existing browser route module or a focused chat route for session-authenticated API.
- `apps/dashboard/src/` for chat UI and typed client.
- Existing gateway unit/integration tests and dashboard build checks.
- `docs/phase-6/` for evidence, runbook, demo and completion report.

## Rollback
Keep chat isolated behind route/config toggle if feasible. Do not alter ports, ingress, database schema, or store baseline without approval. If chat destabilizes the platform, disable the chat route and preserve Phase 5 behavior. No database restore or live Helm rollback without explicit maintenance approval.
