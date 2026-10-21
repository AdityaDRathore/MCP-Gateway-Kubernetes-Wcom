# Phase 6 Risk, Decision & Open-Question Register

**Status:** draft; recommendations are not accepted decisions until reviewed.

## Risks

| ID | Risk | Mitigation | Stop condition |
|---|---|---|---|
| P6-R01 | Tool call bypasses Gateway auth/audit | Normal MCP path, least-privilege identity, integration tests | Any direct upstream call or unaudited execution |
| P6-R02 | Provider key leaks to browser/logs | Server-side secret, bundle/log scan | Any provider secret reaches browser |
| P6-R03 | Prompt injection causes unsafe write | Allowlist, schema/policy checks, explicit confirmation, read-only demo | Unconfirmed protected-data mutation |
| P6-R04 | Tool output leaks PII | Minimize/redact before model/UI/audit | PII persists in logs/evidence |
| P6-R05 | Provider quota/network blocks demo | Preflight, bounded error, optional local fallback | No verified provider by G2 |
| P6-R06 | Agent loops or request hangs | Max 5 calls initially, deadline, size/concurrency caps | Unbounded execution |
| P6-R07 | Tool names differ from docs | Verify actual live catalog | Demo relies on nonexistent names |
| P6-R08 | Phase 5 baseline/evidence inconsistency | Run baseline and record each suite separately | Critical baseline failure unresolved |
| P6-R09 | Deadline pressure expands scope | Feature freeze after 22 Oct; reserve 23–26 Oct | Optional feature delays acceptance |
| P6-R10 | Chat history adds privacy/schema risk | Ephemeral by default | Persistence added without retention design |
| P6-R11 | Demo leaks member key | Placeholder docs, redact screenshots, revoke key | Live credential committed |
| P6-R12 | Self-call complicates correlation/recursion | Design review, narrow identity, deadline and correlation tests | Recursion/deadlock or lost attribution |

## Decisions to approve

| ID | Decision | Recommendation |
|---|---|---|
| P6-DEC-01 | Required model path | One provider adapter end-to-end; second provider optional |
| P6-DEC-02 | Provider selection | Gemini Free Tier if key/quota available; otherwise evaluate local Ollama |
| P6-DEC-03 | Tool execution | Normal Gateway MCP endpoint with dedicated least-privilege server-side identity unless an existing equivalent path is proven |
| P6-DEC-04 | Tool policy | Read-only default; writes require explicit confirmation or isolated fixture |
| P6-DEC-05 | History | Ephemeral by default |
| P6-DEC-06 | Response mode | Request/response acceptable; streaming only if explicitly required |
| P6-DEC-07 | Agent limits | Max 5 tool calls/message initially, bounded wall clock and payload |
| P6-DEC-08 | External client | MCP Inspector first; named desktop client only if explicitly required |
| P6-DEC-09 | Demo calls | Safe read-only calls across all three upstreams |
| P6-DEC-10 | Deployment | Local k3d validation; VPS not a Phase 6 gate |

## Questions for G0/G1
1. What is the exact assignment wording for CHT-02..04 and EXT-01..03?
2. Does current code already contain a chat route/provider abstraction?
3. Is persistent history or streaming explicitly required?
4. Which provider is actually configured and available?
5. What MCP Inspector version/config is installed?
6. Can the agent call the normal MCP endpoint without recursion or loss of attribution?
7. What are the actual namespaced tool names?
8. Is a desktop client beyond Inspector required?
9. Are model-selected writes required, and what confirmation semantics are expected?
10. Which test totals correspond to which command/suite/SHA?

## Change control
Any schema change needs migration, backup, test and rollback note. Changes to ports, ingress, NetworkPolicy, secrets or API-key scopes need technical-head approval. Never commit provider keys, MCP keys, cookies, invitation tokens or customer data. Protected store records remain untouched.
