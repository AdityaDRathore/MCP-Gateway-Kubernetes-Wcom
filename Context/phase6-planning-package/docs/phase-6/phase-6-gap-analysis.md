# Phase 6 Gap Analysis & Baseline Verification

**Source baseline:** repository review at commit `654c2e6` and Phase 5 completion artifacts. Phase 5 test/runtime outcomes are reported by repository documents and were not independently rerun while preparing this plan.

## Established baseline from repository artifacts
- Phase 5 completion report dated 21 Oct says Phase 5 is accepted/closed and Phase 6 is authorized.
- `apps/dashboard` is a React/Vite SPA; `apps/gateway` has separate MCP and browser listeners (3000/3001).
- Browser sessions use opaque HttpOnly cookies; MCP clients use scoped bearer API keys.
- Gateway aggregates WooCommerce, Mock CRM and Mock Tasks with namespaced `{server}__{tool}` identifiers.
- Audit, key lifecycle, invitation/RBAC, SQLite WAL/PVC, upstream management and circuit-breaker behavior are reported as implemented.
- Traceability matrix reserves CHT-02..04 and EXT-01..03 for Phase 6.
- Gateway package defines unit/protocol/integration tests, build/typecheck and benchmark scripts; dashboard package defines a build script.

## G0 baseline checklist
- [ ] Confirm current branch/SHA and whether it matches intended accepted baseline.
- [ ] Run install/build/typecheck/tests/Helm lint+template and record actual exit codes.
- [ ] Read original assignment brief; capture exact CHT/EXT wording verbatim.
- [ ] Inspect existing browser routes, auth/CSRF middleware, dashboard API client, MCP transport/router, key scopes, audit schema and any existing chat/provider code.
- [ ] Query actual `tools/list` and verify exact namespaced tool identifiers. Do not rely on demo examples that may omit namespace prefixes.
- [ ] Reconcile test counts by command, suite, commit and scope; do not combine unlike counts into a single total.
- [ ] Verify protected products 10/11/12 and Order #14 using read-only checks.
- [ ] Confirm installed MCP Inspector version and actual Streamable HTTP auth configuration.

## Gap register

| ID | Gap / uncertainty | Required action | Gate |
|---|---|---|---|
| P6-GAP-01 | Exact CHT/EXT wording not reproduced here | Fetch original brief and update traceability verbatim | G0 |
| P6-GAP-02 | Existing chat/provider code not confirmed | Inspect before creating modules/routes | G0 |
| P6-GAP-03 | Server-side agent-to-tool execution path not established | Choose path preserving scopes, router, timeouts and audit | G1 |
| P6-GAP-04 | Provider credentials/quota unknown | Verify one provider end-to-end; Ollama fallback only if viable | G1 |
| P6-GAP-05 | Model output is untrusted | Tool allowlist, schema validation, write policy, max iterations | G1 |
| P6-GAP-06 | Tool output may include PII/large payloads | Minimize, redact and cap before model/UI/audit | G1 |
| P6-GAP-07 | Long chat requests can hang/exhaust resources | Deadline, cancellation, rate/concurrency limits | G1 |
| P6-GAP-08 | MCP Inspector config unproven | Reproducible connection and invocation log | G4 |
| P6-GAP-09 | Demo may use unprefixed tool names | Verify live catalog and correct docs | G0/G4 |
| P6-GAP-10 | Reported test totals vary by scope | Record each run separately with command/SHA | G0 |
| P6-GAP-11 | Provider outage/config error may confuse users | Explicit safe errors and preflight | G2 |
| P6-GAP-12 | Chat and tool events may not correlate | Define correlation chain and verify audit | G3 |

## Provisional architecture recommendation
Use a thin session-authenticated browser chat route and a server-side `ChatAgentService`/provider adapter. The browser sends only message content and optional conversation ID. The server derives the actor from the existing session, validates policy, calls the provider, validates model-requested tools against the live catalog and published schema, and executes through the normal Gateway MCP path with a dedicated least-privilege server-side identity if needed. Do not reuse browser cookies as MCP auth, expose member keys to the model, or call WooCommerce/other upstreams directly.

Use one provider path first. Provider credentials must not be in Vite `VITE_*` variables, browser bundles, responses, or logs. If no provider is configured, return a clear error rather than fabricating a response. Default to ephemeral chat history unless the brief requires persistence.

## Threat-focused tests
- Missing/expired session or inactive user → rejected.
- Member → chat allowed; admin-only routes remain forbidden.
- CSRF/origin failure on mutating browser route → rejected.
- Empty, malformed, oversized request → safe 4xx.
- Unknown/disabled tool, invalid args, unauthorized write → no execution.
- Provider timeout/rate-limit/invalid key → bounded error, no secret leakage.
- Tool output with email/phone/address/token/password or excessive size → redacted/truncated.
- Loop exceeds cap → stops.
- Invalid/revoked/insufficient-scope MCP key → denied.
- Chat tool call → attributable audit with status/duration/correlation.
- Existing tests/build/Helm render and protected store baseline → no regression.
