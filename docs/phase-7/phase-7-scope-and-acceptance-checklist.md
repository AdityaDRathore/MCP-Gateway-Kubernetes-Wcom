# Phase 7 Prioritized Scope & Acceptance Checklist

**Status:** proposed; not approved or executed.

## 1. Must-have

### M1 — Baseline freeze and evidence reconciliation
- [ ] Record current main SHA, branch, dirty state, chart commit, image ID/digest, Helm release/revision, Kubernetes context and workload status.
- [ ] Confirm Phase 6 G7 status remains “submitted for Technical Head review” unless a formal acceptance record exists.
- [ ] Reconcile README/Phase 6 suite-count differences by command and scope.
- [ ] Resolve INF-02 traceability inconsistency using current chart and release evidence.
- [ ] Capture a read-only baseline for products 10/11/12 and Order #14.
- **Acceptance:** baseline report has identities, commands, sanitized outputs and explicit unresolved items; no secret values or customer PII.

### M2 — Helm and deployment security posture
- [ ] `helm lint infra/helm/urumi-platform`.
- [ ] Render `values-local.yaml` and `values-prod.yaml`; record commands and exit codes.
- [ ] Inspect all workload probes, resource requests/limits and security contexts.
- [ ] Inspect Services/Ingress/hostPort/NodePort, NetworkPolicies, ServiceAccounts/RBAC, PVCs and secret references.
- [ ] Confirm Gateway replica count remains 1 and update strategy remains `Recreate`.
- [ ] Confirm no upstream MCP is public and Gateway has no direct path to WordPress/MariaDB outside WooCommerce MCP.
- [ ] Confirm production profile prerequisites (TLS/DNS/registry/secrets/storage) are stated, not assumed satisfied.
- **Acceptance:** both profiles render and no critical security/perimeter defect remains unresolved.

### M3 — Controlled upstream failure isolation
- [ ] Capture healthy baseline: readiness, enabled tool list and one safe read-only call to each upstream.
- [ ] Disrupt one disposable stateless upstream pod only; do not touch store or Gateway PVCs.
- [ ] Verify Gateway stays ready and at least one unaffected upstream tool call succeeds during the fault.
- [ ] Verify the affected upstream is reported unreachable in dashboard and its tools/calls fail clearly without secret leakage.
- [ ] Allow controller recovery; verify readiness and a successful post-recovery call.
- [ ] Confirm no protected data changed and test fixture cleanup is complete.
- **Acceptance:** fault is isolated; unaffected service remains usable; status and recovery are visible and evidenced.

### M4 — Gateway persistence and integrity
- [ ] Run documented SQLite integrity check through approved safe access.
- [ ] Create a new backup copy using existing `VACUUM INTO` procedure; use unique filename and restrictive permissions.
- [ ] Validate backup copy exists, is readable by SQLite and returns `PRAGMA integrity_check = ok`.
- [ ] Obtain Technical Head approval before Gateway pod replacement/rollout.
- [ ] After replacement, verify readiness and selected audit/config/user/key metadata persists (counts/IDs only; never reveal raw keys or hashes unnecessarily).
- **Acceptance:** integrity is `ok`, persisted metadata remains available, no second writer and no secret disclosure.
- **Boundary:** validate a backup copy; never restore over the current DB. Actual restore only in an isolated disposable environment with separate approval.

### M5 — Required cross-phase regression
- [ ] Root/workspace build and typecheck commands that exist in current package scripts pass.
- [ ] Gateway unit, protocol and integration suites pass; WooCommerce MCP and mock upstream suites pass where defined.
- [ ] Dashboard build passes.
- [ ] Admin/Member login, RBAC, CSRF/Origin, listener separation and key revocation behave as expected.
- [ ] Chat read-only query invokes tool via Gateway; UI shows tool name/status/duration; audit actor is logged-in user.
- [ ] External MCP client connects only to Gateway using Member key, discovers all enabled tools and performs a safe read-only call.
- [ ] One cross-server CRM+Tasks prompt succeeds.
- [ ] Disable/re-enable one upstream and confirm tools disappear/reappear in chat and external client.
- [ ] Audit rows exist for chat and external calls; redaction holds.
- [ ] Storefront is reachable and baseline records unchanged; use disposable fixture for any write.
- **Acceptance:** no critical regression; results are tied to final SHA and evidence artifacts.

### M6 — Evidence and handoff
- [ ] Update requirements traceability only where new evidence supports status change.
- [ ] Publish Phase 7 completion report and evidence index.
- [ ] Document exact commands, exit codes, per-suite counts and test environment.
- [ ] Record PASS/FAIL/BLOCKED/NOT RUN for every gate and criterion.
- [ ] Document local-path node-local limitation, production-profile assumptions, deferred items and cleanup.
- [ ] Produce Phase 8 handoff with final demo flow and open issues.
- **Acceptance:** Technical Head can make an informed Go/No-Go decision without inferring untested behavior.

## 2. Should-have, conditional on a real gap

- [ ] Minimal chart/config correction if a required profile fails to render or a concrete selector/probe/security issue is reproduced.
- [ ] Targeted regression test for each fixed defect.
- [ ] Conservative load/backpressure check if host resource headroom is adequate and existing benchmark harness is trusted.
- [ ] Verify image identity policy and production digest pinning assumptions.
- [ ] Improve stale documentation only where it conflicts with observed behavior or the original brief.

A “should-have” is not permission to implement. The gap must be demonstrated, the fix must be scoped, and any architecture/perimeter/storage change must be approved.

## 3. Explicitly out of scope

- [ ] Multi-store provisioning and teardown.
- [ ] OAuth/OIDC replacement or addition to mandatory API-key auth.
- [ ] Per-tool/per-user ACLs, unless explicitly elevated by Technical Head.
- [ ] Chat SSE streaming or persistent conversation history.
- [ ] More upstream services, vector search/tool retrieval, dashboard redesign.
- [ ] New database, schema migration, SQLite multi-replica, HA or storage architecture change.
- [ ] New observability stack, service mesh, external secrets manager, paid infrastructure.
- [ ] Public VPS deployment by default; rendering production values is the planned minimum.
- [ ] Destructive resets, PVC deletion, live restore, protected record mutations, broad refactoring.

## 4. Mandatory no-go conditions

Stop the current gate and return to Technical Head if:
- Product 10, 11 or 12 or Order #14 changes unexpectedly.
- Any raw credential, session cookie, API key or customer PII is exposed.
- An upstream MCP is publicly reachable or Gateway bypasses WooCommerce MCP to access the store.
- Gateway SQLite integrity fails, multiple writers appear, or PVC identity changes unexpectedly.
- Browser session and MCP bearer-key auth become interchangeable.
- A fault test destabilizes the cluster or touches persistent store/Gateway volumes.
- A proposed change requires a database migration, replica strategy change, new infrastructure, or public rollout not already approved.
