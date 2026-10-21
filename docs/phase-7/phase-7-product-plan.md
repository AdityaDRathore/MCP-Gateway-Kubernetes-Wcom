# Phase 7 Product Plan — Reliability, Deployment Hardening & Evidence

**Project:** Urumi AI FDE Assignment — MCP Gateway on Kubernetes  
**Planning date:** 22 October 2026  
**Target execution window:** 23–24 October 2026  
**Assignment deadline:** 26 October 2026, 11:59 PM IST  
**Status:** Proposed for Product Manager review; then Technical Head approval. **No implementation is authorized.**  
**Baseline:** Phase 6 handoff report submitted for Technical Head review; report identifies `db82863` as its starting baseline and documents Phase 6 artifacts through `a58d268`. P7-G0 must resolve the exact current main SHA, image/chart identity and deployment state before execution.

## 1. Executive recommendation

Phase 7 should **not introduce new user-facing features**. It should make the existing Phase 1–6 result more defensible by proving the integrated platform’s reliability and security boundaries against the original assignment’s mandatory evaluation scenarios, validating the same Helm chart for local and production-like configuration, and producing reproducible evidence and operator instructions.

The original brief requires a system that runs on local Kubernetes and is deployable to a production-like VPS using the same Helm chart with configuration changes only. It also explicitly requires that one dead upstream not break other upstreams, that the dashboard show it as unreachable, that credentials remain private, and that every call is audited. The Phase 1 master roadmap explicitly assigns pod-kill tests, NetworkPolicies, non-root containers and `values-prod.yaml` validation to Phase 7. These needs make reliability/evidence the correct phase objective.

The best assignment outcome is **a stable, demonstrable release candidate plus truthful evidence**, not the largest feature set. A VPS deployment, multi-store provisioning, OAuth, per-tool permissions, chat streaming, new database, or observability stack should not displace mandatory verification unless the original brief/Technical Head makes one a specific acceptance requirement.

## 2. Objective and rationale

### Objective

By the end of 24 October, establish an evidence-backed release candidate in which:

1. The existing required end-to-end user journeys still pass on the current combined code/chart.
2. A controlled failure of one stateless upstream is isolated: Gateway and other upstreams remain usable, the failed upstream is accurately reported unreachable, and service recovers.
3. The current Helm chart renders valid local and production-like manifests and preserves expected ingress, private service boundaries, probes, resource bounds, security contexts, secrets references, NetworkPolicies and persistence configuration.
4. Gateway SQLite data remains consistent through an approved Gateway pod replacement, and the existing store persistence is rechecked safely if a store restart is approved.
5. Evidence records what was freshly run, what is reused from earlier reports, what is blocked/not run, and what the local environment cannot prove.
6. Phase 8 receives a clear test matrix, runbook, residual-risk list and final demo path.

### Why now

- Phase 6 G7 says the implementation worker submitted the final handoff for Technical Head review; it does not itself claim authority for formal final acceptance. Product planning must preserve that distinction.
- The assignment’s definition of done requires live workflows, two-user behavior, revocation, disabled-upstream discovery changes, dead-upstream isolation and audit attribution. Phase 6 report supports many journeys, but final integrated failure/recovery and deployment-profile evidence must be tied to the exact candidate used for submission.
- The requirements matrix still labels INF-02 “Partial (Store Workloads Verified)” with a historical note that predates the later Gateway/upstream integration. This inconsistency should be reconciled with current chart and release evidence rather than assumed solved or reimplemented.
- README and Phase 6 report show differing protocol/test counts (README says 351 unit + 62 protocol; the Phase 6 G5 report describes 28 focused protocol tests and other reports enumerate narrower suites). Counts may represent different scopes; Phase 7 should preserve command-level provenance, not sum or repeat them without confirmation.
- Local-path PVCs establish local pod-replacement persistence but do not prove off-host backup, node-loss recovery or production disaster recovery.

## 3. Original assignment requirements in scope

The original brief requires:
- Store: WordPress/WooCommerce and MariaDB on Kubernetes; persistent database/content; Ingress; working catalog/cart/COD checkout; order visible in WooCommerce Admin.
- Custom WooCommerce MCP: written in TypeScript; Streamable HTTP; five named tools; private from outside cluster; only Gateway can call it.
- Gateway: one downstream MCP endpoint; dynamic add/edit/disable/remove upstreams; tool aggregation and namespacing; upstream credentials server-side; timeouts and clear errors; healthy upstreams unaffected by a dead/slow upstream; three upstream servers.
- Team access: Admin and Member roles; individual hashed/revocable API keys; audit logs visible to Admin and containing actor/server/tool/time/duration/outcome.
- Chat: LLM tool loop through the Gateway, acting as the logged-in user; visible tool activity; provider key server-side.
- Kubernetes/Helm: all services in cluster; same Helm chart for local and production-like VPS with values-only differences; Ingress stable URLs; probes and resource requests/limits; secrets not hardcoded.
- Demo: User A chat creates a disposable product and can query an order created through the storefront; User B uses MCP Inspector/another external client with their own key; cross-server prompt; key revocation; upstream disable removes tools from chat and external client; pod kill leaves other servers working and dead server marked unreachable; calls visible in audit.

Phase 7 owns **reliability and deployment-hardening verification**, not a rebuild of these features. The final Phase 8 demonstration remains responsible for the complete Definition of Done.

## 4. Current-state assessment and evidence confidence

This assessment is derived from repository documentation and the supplied Phase 6 G7 report. No runtime tests, Kubernetes commands, or live cluster checks were executed while preparing this plan. “Reported” is not equivalent to independently reverified in this planning session.

### Reported delivered by prior phases
- Phase 1: Node/npm workspace, MCP Streamable HTTP compatibility spike, ADRs and unified Helm scaffold.
- Phase 2: WordPress/WooCommerce and MariaDB on Kubernetes, persistent volumes, COD checkout, seed catalog and Order #14.
- Phase 3: custom WooCommerce MCP server exposing five tools, input validation and order PII exclusion; private ClusterIP path through Gateway.
- Phase 4: unified Gateway MCP endpoint, dynamic upstream catalog, 10 namespaced tools from WooCommerce/CRM/Tasks, upstream timeouts/failure isolation, bounded concurrency, SQLite WAL persistence, hashed API keys, audit service, NetworkPolicies and secret isolation.
- Phase 5: Admin/Member dashboard, browser sessions/CSRF, separate browser and MCP listeners, invitations/key lifecycle, audit viewer and unified Helm release.
- Phase 6 G7 report: live Gemini-backed chat tool use; bounded 5-iteration/30-second agent loop; mutation confirmation; protected baseline guards; tool visibility; audit actor attribution; external MCP SDK/Inspector discovery and cross-server workflow; key revocation; cross-path security tests; documentation and demo runbook.

### Must be freshly verified at P7-G0–G4
- Exact repository SHA, deployed image ID/digest, Helm revision and cluster context; prove they refer to the same candidate or document differences.
- Whether current local and production values render after Phase 6 chart/code changes.
- Whether NetworkPolicy selectors match current pod labels and permit only intended flows.
- Probes, requests/limits and security contexts across all current workloads, not just the store.
- Failure isolation and recovery against the final combined candidate, including dashboard status.
- SQLite integrity/persistence after approved Gateway pod replacement.
- Store baseline unchanged after any approved store restart; no protected record mutation.
- Exact test commands, suite counts, exit codes and evidence references.
- INF-02 traceability status and README/report test-count discrepancies.

### Incomplete, deferred or not conclusively demonstrated
- **Final formal Phase 6 acceptance:** G7 report is submitted for Technical Head review, not a formal acceptance record.
- **Production-like deployability:** `values-prod.yaml` rendering does not prove an actual VPS rollout, DNS, TLS, registry access or external secret provisioning. Actual VPS deployment is a strong differentiator but is not mandatory unless explicitly required by the assignment/Technical Head.
- **Disaster recovery:** local-path volumes are node-local. Pod restart/replacement evidence is not node-loss/off-host DR evidence.
- **Phase 6 UI limitations:** chat history is ephemeral on page refresh and chat responses are turn-based JSON rather than partial SSE token streaming. The handoff explicitly treats these as deferred enhancements.
- **Bonus capabilities:** granular per-user/per-tool permissions, OAuth/OIDC and multi-store provisioning are deferred. The assignment marks these bonus/optional; do not pull them into P7.
- **Image immutability:** local image tags and registry digest pinning have different semantics. Confirm the applicable release policy; do not invent a registry requirement if none exists.
- **Fresh runtime verification:** earlier reports describe successful tests, but Phase 7 evidence must identify whether a result is fresh, reused, blocked or not run.

## 5. Scope and prioritization

### Must-have
1. **Baseline and evidence reconciliation:** current SHA/chart/image/release, requirement status, test count provenance, protected-store snapshot.
2. **Helm and deployment posture review:** lint and render both values profiles; inspect all workload types, Services/Ingress, PVCs, NetworkPolicies, secret references, probes/resources and security contexts.
3. **Controlled failure isolation:** safely interrupt one disposable stateless upstream and prove healthy upstream calls continue, Gateway stays ready, dashboard shows unreachable, and recovery works.
4. **Persistence/integrity validation:** safe SQLite integrity check and backup-copy validation; approved Gateway pod replacement; recheck relevant metadata/audit persistence. Store pod replacement only with separate explicit approval.
5. **Focused cross-phase regression:** required browser/chat/MCP/role/key/audit/store journeys, test suites, build and Helm checks.
6. **Evidence and handoff:** traceability updates supported by new evidence, final gate report, exact reproduction steps, limitations, cleanup status and Phase 8 plan.

### Should-have only if G0 reveals a real gap
- Minimal correction to a broken chart value, selector, probe, resource setting or documentation statement that blocks an explicit acceptance criterion.
- Add a targeted regression test for a reproduced defect.
- Validate image digest/registry assumptions and TLS-related production profile values.
- Run conservative benchmark/backpressure tests if resource headroom is safe and the existing harness is trustworthy.

### Explicitly out of scope
- New product features or dashboard redesign.
- Multi-store provisioning, OAuth/OIDC, granular tool ACLs, SSE streaming, tool search/vector retrieval or more upstreams.
- New database, SQLite schema migration, Gateway multi-replica/HA redesign, storage migration or service mesh.
- New observability stack, external secrets manager, paid cloud infrastructure or broad refactor.
- Mandatory public VPS rollout unless specifically confirmed by the assignment owner/Technical Head.
- Destructive reset/reseed, PVC deletion, restoring over live databases, mutating/deleting protected WooCommerce records, or using Order #14/products 10/11/12 as mutation targets.

## 6. Functional requirements for Phase 7 deliverables

### P7-FR-01: Baseline inventory and evidence classification
- **Problem:** reports may refer to different SHAs, test scopes or release identities.
- **Behavior:** record branch/SHA/working-tree state; image ID/digest; Helm release/revision; cluster context; workload/pod/PVC status; known report references; baseline store record snapshot; test commands and count provenance.
- **Roles:** operator/implementation worker; Product Manager reviews; Technical Head approves progression.
- **Success:** each evidence item is labeled Fresh / Reused / Reported / Blocked / Not Run; no unknown source identity remains hidden.
- **Failure:** any source/image/chart mismatch is unexplained or protected data differs from expected baseline.
- **Acceptance:** G0 report includes exact IDs, commands and sanitized outputs; no secrets/PII.

### P7-FR-02: Helm profile and Kubernetes security posture
- **Problem:** the assignment requires one chart for local and production-like deployment, and workload security controls must apply across the integrated system.
- **Behavior:** run `helm lint`; render local and production values; inspect rendered resources and compare required profile differences; verify private upstream services, ingress routing, probes, requests/limits, non-root/capability/seccomp settings where configured, secret references, NetworkPolicies, service accounts/RBAC and Gateway replica strategy.
- **Roles:** operator; no new dashboard role is introduced.
- **Dependencies:** current chart under `infra/helm/urumi-platform`, values-local/prod files, cluster labels and current ADRs.
- **Success:** both profiles render; no unintended public upstream endpoint; Gateway remains one replica with Recreate for SQLite WAL; all expected workloads have appropriate probes/resources; secrets are not emitted as plaintext.
- **Failure:** unexpected Ingress/NodePort/hostPort, policy selector mismatch, secret leakage, unsafe persistence/replica change, or profile render failure.
- **Acceptance:** saved commands/output/manifest review and a requirement-linked findings table.

### P7-FR-03: Upstream failure isolation and recovery
- **Problem:** original Definition of Done explicitly requires killing one upstream pod while others keep working and the dashboard marks it unreachable.
- **Behavior:** capture healthy baseline; interrupt one disposable stateless upstream only; verify Gateway health and successful calls to at least one unaffected upstream; verify failed upstream is reported unreachable/error without leaking credentials; allow controller to restore it; verify tool discovery/call succeeds after recovery.
- **Roles:** Admin may view server status; Member may call only tools allowed by existing access model; operator performs fault injection.
- **Dependencies:** Gateway health tracking, upstream registry/catalog, existing mock CRM/Tasks services, NetworkPolicies, dashboard status UI.
- **Success:** other upstreams remain usable throughout; affected service is clearly unavailable; recovered service returns to normal without manual database edits.
- **Failure:** Gateway becomes unavailable, unrelated upstream calls fail because of one upstream, tool listing hangs, stale tools are presented as callable without clear failure, or recovery requires data reset.
- **Acceptance:** timestamped fault/recovery log, before/during/after tool-list and tool-call evidence, dashboard status evidence, cleanup proof.

### P7-FR-04: Persistence and safe recovery
- **Problem:** assignment requires persistent data and a reliable operational demonstration; local PVC claims must remain accurate.
- **Behavior:** verify Gateway DB integrity and a new backup copy with restrictive permissions; after explicit approval, replace Gateway pod using documented safe procedure; verify readiness and persistence of selected non-secret records/counts; optionally restart store workloads only under a separate approved window and compare protected records read-only.
- **Roles:** operator; Technical Head approves stateful restarts/restore operations.
- **Dependencies:** SQLite WAL/PVC, Recreate single-replica deployment, existing `VACUUM INTO` backup capability, MariaDB/WordPress PVCs.
- **Success:** SQLite `PRAGMA integrity_check` returns `ok`; database metadata/audit history persists across Gateway pod replacement; store remains available and baseline remains unchanged if store restart tested.
- **Failure:** integrity check fails, a second Gateway writer exists, PVC is replaced unexpectedly, protected record differs, or test risks overwriting current DB.
- **Acceptance:** backup-copy validation, pre/post counts and integrity results, pod identity/revision, store baseline comparison if applicable.
- **Limit:** this proves pod replacement persistence only, not node-loss/off-host disaster recovery.

### P7-FR-05: Mandatory journey regression
- **Problem:** hardening must not regress the actual assignment Definition of Done.
- **Behavior:** execute documented test flows against current candidate: storefront checkout using a disposable fixture; chat as User A with a disposable product/order journey if time and safe fixture cleanup permit; external client as User B; cross-server prompt; key revocation; upstream disable/discovery behavior; audit attribution; failure isolation.
- **Roles:** Admin/User A and Member/User B, with disposable credentials and test data.
- **Dependencies:** Phase 2–6 services and documented runbooks.
- **Success:** mandatory scenarios pass with exact test data, expected response and audit entry. Protected baseline IDs are never mutation targets.
- **Failure:** auth boundary regression, missing audit record, upstream credentials visible to client, required tools missing, cross-server workflow failing, or protected data changed.
- **Acceptance:** traceability matrix with scenario IDs and exact evidence links. Phase 8 owns the final full demo/recording.

### P7-FR-06: Evidence-backed handoff
- **Problem:** evaluators need to reproduce and judge the result without trusting unsupported claims.
- **Behavior:** publish a Phase 7 completion report with per-gate disposition, exact commands and exit codes, SHA/image/chart identity, suite counts, evidence links, known limitations, cleanup and Phase 8 handoff.
- **Success:** every mandatory criterion is PASS, or explicitly FAIL/BLOCKED/NOT RUN with reason, owner and effect on final acceptance.
- **Acceptance:** Technical Head can decide Go/No-Go without guessing what was actually tested.

## 7. Dependencies and architectural constraints

- Preserve `infra/helm/urumi-platform` and values-local/prod as the deployment source of truth.
- Keep the Gateway as the only downstream route to MCP upstreams; upstream services remain ClusterIP-only.
- Preserve separate browser/session+CSRF listener (port 3001) and MCP bearer API-key listener (port 3000); do not merge auth domains.
- Preserve WooCommerce MCP as the sole gateway path to WooCommerce REST; no Gateway-to-WordPress/MariaDB bypass.
- Preserve existing MCP Streamable HTTP contracts, tool namespacing, error handling and per-upstream timeouts.
- Preserve SQLite WAL on PVC with one Gateway replica and `Recreate`; no scale-out or database migration.
- Preserve audit actor attribution, argument hashing/redaction and existing key revocation semantics.
- Use disposable fixtures for writes. Never mutate/delete product IDs 10, 11, 12 or Order #14.
- Use only existing dependencies/harnesses unless a concrete defect and Technical Head approval justify adding one.
- Do not expose secrets, cookies, raw keys, provider credentials or customer PII in reports/logs/screenshots.

## 8. Definition of Phase 7 complete

Phase 7 can be recommended for acceptance only when:
1. G0 establishes the exact candidate and resolves evidence provenance issues.
2. Local and production-profile Helm lint/render pass and manifest review has no unresolved critical security issue.
3. One controlled stateless-upstream failure proves isolation and recovery, including dashboard unreachable status.
4. Gateway persistence/integrity is proven across an approved pod replacement, or is explicitly BLOCKED with approved alternative evidence.
5. Required Phase 1–6 journeys pass the final regression or have a documented Technical Head-approved disposition.
6. Protected store records remain unchanged and fixture cleanup is verified.
7. Requirements matrix is updated only where evidence justifies status changes.
8. Completion report clearly separates fresh, reused, reported, blocked and not-run evidence.
9. Technical Head gives an explicit Go/No-Go before Phase 8 proceeds.

## 9. Product Manager recommendation

Freeze feature scope. Prioritize P7-G0, P7-G1 and the original brief’s upstream-kill journey before optional load testing or production rollout. Use the current local cluster and existing test harnesses. Make only minimal fixes supported by reproduced failures. Keep 25–26 October available for Phase 8 final acceptance, demo rehearsal/recording, threat-model/README review and submission.
