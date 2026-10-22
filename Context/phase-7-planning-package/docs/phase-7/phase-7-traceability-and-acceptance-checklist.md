# Phase 7 Traceability & Acceptance Checklist

**Status:** Proposed; requirement IDs must be reconciled against the current `docs/requirements-traceability.md` during P7-G0.

| Requirement / roadmap item | Deliverable | Test | Acceptance evidence | Priority |
|---|---|---|---|---|
| Phase 7 reliability: pod replacement | Recovery evidence report | P7-T04 + P7-T05 | Changed pod UID, same PVC identity, readiness, DB integrity, retained synthetic config/audit | Must |
| Network segmentation | Effective policy evidence | P7-T06 | Expected allowed paths work; prohibited direct paths fail | Must |
| Non-root application containers | Runtime security report | P7-T07 | UID/capabilities/seccomp match manifests and approved baseline | Must |
| Local and production-like Helm profiles | Render review | P7-T02 + P7-T03 | lint/template succeeds; no public internal MCP service; SQLite replica/storage assumptions consistent | Must |
| Existing MCP gateway contract | Regression evidence | P7-T08 | initialize/list/call succeeds and errors are safe | Must |
| Admin/Member authorization and key lifecycle | Security regression | P7-T09 | direct API bypass attempts rejected; revoked key denied | Must |
| Audit redaction | Audit evidence | P7-T11 | no raw key, upstream credential or excluded PII exposed | Must |
| Phase 6 chat-agent journey | E2E evidence | P7-T10 | exact required tool-loop scenario passes as specified by source requirements | Must verify |
| Phase 6 external MCP client | E2E evidence | P7-T10 | separate client identity/key reaches gateway only and invokes required cross-server tools | Must verify |
| Store data integrity | Before/after baseline | P7-T01 + P7-T12 | Product IDs 10–12 and Order #14 unchanged | Must |
| Reproducible evidence | Execution log/runbook | P7-T14 | commands, versions, commit, results and limitations recorded | Must |
| Optional load sanity | Benchmark output | Existing harness if safe | measurements only; no unsupported SLA claims | Should |
| Backup/restore rehearsal | Separate-location rehearsal report | Existing procedure only | recoverable copy verified without overwriting live state | Should, subject to approval |
| VPS deployment | Not included by default | Only if assignment/Head requires | separate approved deployment plan | Out of scope unless approved |

## Acceptance checklist

### Preflight
- [ ] Exact repository commit and working tree recorded.
- [ ] Original assignment and canonical roadmap read.
- [ ] Phase 6 handoff status correctly distinguished from formal acceptance.
- [ ] Traceability IDs copied from source, not guessed.
- [ ] Active cluster/context/namespace recorded.
- [ ] PVC/PV identity and Helm revision recorded.
- [ ] Products 10–12 and Order #14 baseline captured read-only.
- [ ] Resource headroom is adequate.

### Deployment and hardening
- [ ] Local Helm lint/render passes.
- [ ] Production-like Helm lint/render passes.
- [ ] Rendered Services/Ingress do not expose internal MCP upstreams.
- [ ] SQLite replica count and volume assumptions are coherent.
- [ ] Image identity/digest status recorded accurately.
- [ ] TLS status and limitations recorded.
- [ ] NetworkPolicy positive and negative probes pass.
- [ ] Runtime UID and security context verified.

### Recovery and regression
- [ ] Pod replacement explicitly authorized.
- [ ] Gateway recovers without PVC replacement.
- [ ] Database integrity and synthetic persistence markers pass.
- [ ] MCP initialize/tools/list/tools/call pass.
- [ ] Dashboard Admin/Member and key revocation regression passes.
- [ ] Chat-agent tool loop and external MCP client journey pass.
- [ ] Audit redaction passes.
- [ ] Protected store baseline unchanged after all tests.
- [ ] Test fixtures cleaned up.

### Handoff
- [ ] Every result is labeled current-run, repository evidence, historical report, or unverified.
- [ ] Failed/skipped tests and reasons are documented.
- [ ] Exact command outputs or CI artifacts linked.
- [ ] Known production qualifications retained.
- [ ] Traceability and runbooks updated.
- [ ] Technical Head decision recorded; no implicit acceptance.
