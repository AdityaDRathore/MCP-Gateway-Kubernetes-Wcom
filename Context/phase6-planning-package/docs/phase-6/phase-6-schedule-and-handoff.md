# Phase 6 Schedule & Handoff

**Planning date:** 21 Oct 2026 | **Assignment deadline:** 26 Oct 2026, 11:59 PM IST. The schedule is aggressive; protect the final acceptance window.

| Date (IST) | Focus | Exit evidence |
|---|---|---|
| **21 Oct** | G0 baseline/requirement reconciliation; G1 architecture approval | Baseline results, exact CHT/EXT wording, approved provider/tool policy |
| **22 Oct** | G2 chat backend; G3 minimal UI/tool loop; G4 Inspector proof | Real chat tool cycle; external client calls safe tools across three upstreams |
| **23 Oct** | G5 security/regression; begin Phase 7 | Auth separation, redaction, revocation, timeouts and protected data verified |
| **24 Oct** | Phase 7 hardening | Reproducible network/non-root/recovery/Helm evidence |
| **25 Oct** | Phase 8 acceptance, docs, demo, evidence cleanup | Clean acceptance run and submission package |
| **26 Oct** | Defect buffer, final audit and submit | Submission confirmed before 11:59 PM IST |

## Cut lines
- If baseline takes more than 2–3 hours, prioritize blockers affecting CHT/EXT.
- Implement only one provider fully; do not build multiple adapters to avoid checking credentials/quota.
- Minimal clear chat UI beats polish that delays the tool loop.
- Request/response beats risky streaming if streaming is not mandatory.
- No feature additions after 22 Oct except acceptance/security fixes.
- MCP Inspector failure must be resolved at the Gateway endpoint/auth/transport layer; never expose upstreams directly.

## Gate handoff record
At each gate, record gate ID, commit SHA, changed files, exact commands/exit codes/test counts, runtime/provider/client versions, positive/negative auth results, protected-data integrity, known failures and Go/No-Go.

## Minimum command inventory
Inspect root scripts first; then run the repository-supported lockfile install, workspace build/test, gateway unit/protocol/integration suites, dashboard build, `helm lint`, and `helm template` for applicable values. Record exact outputs and per-suite counts. Perform the actual Inspector session and read-only protected-store verification. Do not assume root scripts exist, and do not run destructive cleanup or database restore during routine acceptance.

## Phase 7 handoff requirements
All CHT/EXT journeys demonstrated; Phase 5 remains intact; tests/build/Helm outcomes recorded; no secret or protected-data leakage; protected store unchanged; docs/evidence ready; open risks explicitly accepted. Critical security, data-integrity or Gateway regression blocks acceptance.
