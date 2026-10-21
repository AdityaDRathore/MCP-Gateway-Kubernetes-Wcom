# Phase 6 Product Brief — Chat Agent & External MCP Client

**Planning date:** 21 October 2026 | **Target:** capability-complete 22 October | **Status:** planning draft; implementation hold pending technical-head approval.

## Product outcome
Add an authenticated dashboard chat journey where a user can ask a natural-language question, see a real model response and sanitized tool activity, and have any tool call pass through the Gateway's normal validation, authorization, timeout/circuit-breaker and audit path. Separately, prove that a standard external MCP client can connect to the Gateway with a member's own scoped API key.

## Traceability scope
The repository reserves **CHT-02..CHT-04** for the in-dashboard chat agent and **EXT-01..EXT-03** for external MCP client integration. The descriptions below are planning interpretations; at G0, copy the exact verbatim requirement wording from the original assignment brief into the traceability matrix.

- **CHT-02:** authenticated natural-language chat interaction.
- **CHT-03:** model-driven tool selection/execution through the Gateway.
- **CHT-04:** display assistant response and sanitized tool activity in the dashboard.
- **EXT-01:** connect an external MCP client to the Gateway.
- **EXT-02:** authenticate with a member-specific Gateway API key.
- **EXT-03:** discover and invoke tools from multiple upstream MCP servers.

## User journeys
### Dashboard chat
1. User signs in using the existing browser session.
2. Dashboard submits the message to the browser API on port 3001.
3. Server validates session, active user, request size and existing CSRF/origin rules.
4. Server-side provider adapter calls the configured model; provider credentials never enter the browser.
5. Any model-requested tool is validated against the current catalog and policy, then executed through the normal Gateway MCP path.
6. UI displays the final answer and sanitized tool activity (name/status/duration), not secrets or raw customer PII.
7. Chat and child tool calls are correlatable in audit evidence.

### External client
1. Create a member-specific API key and reveal it once.
2. Configure MCP Inspector for the Gateway's actual Streamable HTTP endpoint and installed Inspector version.
3. Discover namespaced tools from WooCommerce, Mock CRM and Mock Tasks.
4. Invoke safe read-only tools across all three upstreams.
5. Revoke the key and verify the next request fails.

## Non-negotiable principles
- Keep browser-session auth on port 3001 and MCP bearer-key auth on port 3000 separate.
- Keep model and upstream credentials server-side.
- Never allow model output to bypass Gateway auth, schema validation, policy, timeouts, circuit breakers or audit.
- Default demo to read-only. Writes require explicit confirmation or a disposable fixture and cleanup.
- External clients talk only to the Gateway; upstream MCP services remain internal.
- Preserve SQLite WAL single-replica/PVC assumptions.
- Products 10, 11, 12 and Order #14 are protected. Do not mutate or delete them.
- Zero-cost/open-source-first remains the target. Gemini Free Tier is viable only if credentials/quota are available; Ollama is an optional local path subject to machine capacity.
- Missing provider configuration must yield a clear error, never a fake answer or false success.

## In scope
Dashboard chat panel; authenticated browser chat API; one verified server-side model provider; bounded tool loop; catalog/schema/policy validation; safe tool activity UI; MCP Inspector setup; per-member API-key and revocation proof; tests, traceability, runbook and demo evidence.

## Deferred
Paid subscriptions, mandatory VPS rollout, autonomous/background agents, vector search, long-term memory, arbitrary destinations/tools, multi-replica Gateway, and streaming unless explicitly required and safely achievable. Chat history should be ephemeral/minimal unless the assignment explicitly requires persistence.

## Definition of done
1. Existing dashboard remains buildable/authenticated.
2. Signed-in member gets a real model response.
3. At least one model-selected tool call executes through the normal Gateway path and is visible in chat.
4. Unknown/disabled tools, invalid args, provider errors, timeouts, oversized requests and unauthorized calls fail safely.
5. Audit attribution and PII/secret redaction remain intact.
6. MCP Inspector discovers tools from all three upstreams and invokes one safe read-only tool per upstream.
7. Invalid/revoked keys fail; member cannot access admin-only browser APIs.
8. Tests cover happy path, error path, auth, authorization, redaction and regression.
9. Protected store baseline is unchanged.
10. Traceability, runbook, demo script and evidence-backed completion report are updated.

## Evidence required
Record exact commit SHA/image, commands and exit codes, test counts by suite, sanitized chat/tool activity, MCP Inspector version/config (no secret values), positive/negative auth checks, audit correlation, baseline integrity and unresolved limitations.
