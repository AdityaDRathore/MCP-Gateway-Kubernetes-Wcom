# Urumi Phase 4 — Technical Head Implementation Work Orders

**Audience:** AI implementation workers and verification worker  
**Status:** DRAFT — HOLD UNTIL TECHNICAL HEAD APPROVAL  
**Repository:** `AdityaDRathore/MCP-Gateway-Kubernetes-Wcom`  
**Target:** local `k3d-urumi`, namespace `urumi`, chart `infra/helm/urumi-platform`

## 1. Technical Head direction

Build one authenticated downstream MCP endpoint aggregating three separately deployed upstreams: the existing WooCommerce MCP service, a deterministic synthetic CRM mock, and a deterministic Tasks mock. Expose tools as `{server_slug}__{tool_name}`; route deterministically; default each upstream timeout to 10 seconds; isolate failures; support authenticated dynamic management; persist API-key verifiers, upstream metadata and audit in SQLite WAL on a dedicated PVC.

This work order is not blanket implementation permission. The Product Head’s roadmap is directionally sound, but the unresolved decisions listed below must be explicitly settled before implementation.

### Non-negotiable rules
- No source/config edits or deployment before G0 review and G1 decision approval.
- Work only on the currently authorized gate; stop for review between gates.
- Never mutate/delete products 10/11/12 or Order #14.
- Gateway calls the WooCommerce MCP Service, not WordPress/MariaDB directly. Do not mount WooCommerce REST credentials into gateway.
- Only gateway `/mcp` may be public. CRM, Tasks, WooCommerce MCP and `/admin/v1/*` remain private.
- No unauthenticated production path or auth-bypass environment flag.
- Never persist plaintext gateway API keys/upstream credentials in SQLite, logs, audit, API responses, tool output or repository files.
- Never blindly retry a mutating call after timeout/ambiguous failure.
- No `helm uninstall`, PVC/namespace deletion, broad Secret deletion, `git reset --hard`, force-push or unreviewed cleanup.
- A generated report is not evidence. Capture actual commands, exit codes, tests, manifests and live observations.
- Phase 4 is local-cluster scope. SEC-REG-01/02/03 remain open/qualified; do not claim production readiness.

## 2. Protected baseline and target

Before deployment/mutating tests, capture a redacted baseline of products 10/11/12 (SKU, price, status), Order #14 (status, currency, total, payment method, product ID), WordPress/MariaDB PVC UIDs, Helm revision, pod/Service/NetworkPolicy inventory and Git state. Never capture customer PII or Secret values. Any unexplained change blocks closure; do not auto-correct it.

WooCommerce request path must remain `gateway → urumi-woocommerce-mcp:3000 → WordPress → MariaDB`. Gateway must not access WordPress or MariaDB directly.

Out of scope without separate approval: dashboard/UI, LLM loop, real CRM/task integrations, multi-replica gateway, distributed DB, arbitrary external upstream URLs, production VPS rollout, registry digest closure, TLS/mTLS rollout, unrelated refactoring.

## 3. Gate plan

| Gate | Work | Exit evidence |
|---|---|---|
| G0 | Read-only repository/cluster preflight | Actual HEAD/worktree, runtime, cluster/policy/storage inventory, resource headroom, redacted baseline |
| G1 | Freeze architecture and contracts | Accepted/rejected decision register, ADRs, schemas, threat boundaries, test matrix |
| G2 | CRM and Tasks mock MCP services | Deterministic fixtures, schemas, unit/protocol tests |
| G3 | Gateway protocol skeleton | Strict config, health endpoints, pinned-SDK protocol tests, graceful shutdown |
| G4 | SQLite, keys, bootstrap and audit | WAL/migrations, key lifecycle, audit failure tests, backup/restore |
| G5 | Upstream manager and catalog | Three upstreams, deterministic namespace/catalog, collision and stale-tool tests |
| G6 | Router and resilience | Routing, timeout/cancellation, bounded concurrency, failure isolation |
| G7 | Dynamic management and Kubernetes Secrets | Admin API, RBAC, compensation, atomic config updates, secret-leak tests |
| G8 | Docker/Helm/Kubernetes integration | Local deployment, PVC, probes, security contexts, actual NetworkPolicy tests |
| G9 | E2E/regression and closure | GTW-01–GTW-11 evidence, Phase 3 regression, baseline comparison, runbooks |

Each gate ends with `PASS`, `FAIL`, `BLOCKED` or `NOT RUN` plus a review request. Passing a gate does not authorize the next.

## 4. G0 — Read-only preflight

Inspect, do not repair. Record root/branch/HEAD, recent commits, staged/unstaged/untracked changes, `.nvmrc`, Node/npm/SDK versions and actual scripts. If worktree changes are unexplained, do not stash/reset/clean/overwrite. Verify the current Kubernetes context and never switch it automatically. Inventory nodes, namespace, Deployments/StatefulSets/Pods/Services/Ingresses/NetworkPolicies/PVCs, StorageClass, IngressClass and events. Inspect Secret metadata only—never decode values. Verify policy enforcement with safe traffic tests; rendered YAML alone is insufficient.

Useful commands, adapted to actual scripts/context:

```bash
git rev-parse --show-toplevel
git status --short --branch
git rev-parse HEAD
git log -8 --oneline --decorate
git diff --stat && git diff --cached --stat
node -v && npm -v && cat .nvmrc
npm pkg get workspaces
npm ls @modelcontextprotocol/sdk --all
kubectl config current-context
kubectl --context k3d-urumi get nodes -o wide
kubectl --context k3d-urumi -n urumi get deploy,statefulset,pod,svc,ingress,networkpolicy,pvc
kubectl --context k3d-urumi -n urumi get events --sort-by=.lastTimestamp
kubectl --context k3d-urumi get storageclass,ingressclass
helm version --short && k3d version
docker info
free -h && df -h
```

Only run `npm ci` after checking worktree/lockfile. Do not invent scripts or silently regenerate lockfiles. Create `docs/phase-4/phase-4-preflight-report.md`. Stop if context is wrong, store/cluster unhealthy, baseline unstable, required Secret metadata missing, policy enforcement unproven or resource headroom inadequate.

## 5. G1 — Decisions to freeze before code

Enumerate existing ADR IDs before adding new ones. For each decision mark `ACCEPTED`, `REJECTED` or `NEEDS SPIKE`, with rationale/evidence.

1. Pinned MCP SDK/protocol and stateless/stateful transport lifecycle.
2. Upstream client reuse, concurrency, timeout/cancellation semantics—prove with a minimal SDK spike.
3. SQLite driver compatible with Node 24 and final Linux image—prove packaging.
4. API-key format/verifier, pepper if any, rotation/versioning, constant-time compare and immediate revocation.
5. Secure one-time admin bootstrap.
6. Audit-start/finalization failure policy.
7. Circuit-breaker inclusion/thresholds; business/validation errors must not count as infrastructure failures.
8. Global/per-upstream concurrency, payload/result caps and overload behavior.
9. Health/catalog refresh cadence and unavailable-upstream catalog behavior.
10. Audit retention/cleanup.
11. Internal URL allowlist/SSRF policy; external URLs require separate approval.
12. Public ingress only `/mcp`; admin API private.
13. Single gateway replica/no overlapping SQLite writers.
14. Performance target and measurement method.
15. Exact CRM/Tasks schemas, fixture IDs and task-state reset semantics.
16. Secret namespace/RBAC and compensation workflow.
17. Disable/remove/update behavior for in-flight calls.

Freeze CRM tools `search_contacts` and `get_contact` with synthetic records only; no real contact PII. Freeze Tasks tools `create_task`, `list_tasks`, `update_task_status`, bounds/enums and whether idempotency is supported. Document whether task state resets on pod restart.

**G1 outputs:** accepted decision register, uniquely numbered ADRs, exact TypeScript/Zod contracts, trust-boundary/URL/Secret policy and test IDs. No G2 implementation until Technical Head approval.

## 6. G2 — CRM and Tasks mocks

Create `apps/mcp-crm` and `apps/mcp-tasks` following existing workspace conventions. Use pinned SDK, strict TypeScript, bounded schemas, deterministic synthetic fixtures, stable ordering and real package scripts. Failure/delay injection must be test-only, bounded and off by default. Add unit tests for bounds, fixtures, sorting, errors, no-op/state reset and idempotency if approved; protocol tests must initialize/list/call every tool with official SDK client. No WooCommerce mutation in this gate.

**Exit:** separate mock processes/contracts work; fixtures are stable and non-PII; unit/protocol tests and workspace build pass with real exit codes.

## 7. G3 — Gateway skeleton

Create `apps/gateway` following existing patterns. Strict config; `GET /health/live` checks process only; `GET /health/ready` checks config/DB/handler once integrated and must not fail merely because one upstream is down; `POST /mcp` uses pinned Streamable HTTP behavior. Reserve `/admin/v1/*` for later and keep it private. Ensure body parsing, request/transport cleanup and SIGTERM handling. No API keys, auth headers, raw arguments or raw upstream errors in logs.

A fake authenticator may exist only in isolated tests; the real app must fail closed and have no auth bypass. Test valid/invalid config, MCP initialize, malformed protocol, unsupported methods, repeated request cleanup and SIGTERM.

## 8. G4 — Persistence, keys and audit

Database: `/data/gateway.db` on a dedicated PVC. Verify `journal_mode=WAL`, `foreign_keys=ON`, bounded `busy_timeout` and approved synchronous mode at startup. Use short transactions only; never hold a DB transaction across upstream I/O. Versioned migrations must fail safely on unknown newer schema. Exactly one replica/no overlapping writers.

Freeze schema for `users`, `api_keys` (verifier only), `upstreams` (Secret reference only), `audit_events` (no raw args/results/secrets/PII) and `schema_migrations`.

Generate 32 cryptographically random key bytes; display plaintext once; persist only verifier. Choose SHA-256 or HMAC-SHA-256/pepper at G1; if pepper is used, define rotation and never put it in ConfigMap/DB. Use constant-time digest comparison and make revocation effective on the next request. Bootstrap first admin through a documented one-shot CLI; duplicate bootstrap fails safely.

Audit sequence: authenticate/validate → commit start row → call upstream outside transaction → finalize outcome. If start write fails, do not call upstream. If finalization fails, leave a detectable pending record and emit a redacted diagnostic. Retention/cleanup must be bounded.

Use driver-supported online backup or `VACUUM INTO`, not a blind copy of a live WAL DB. Integrity-check and restore into a separate test DB. Test migrations, WAL/FK settings, reopen persistence, immediate revocation, audit failure paths, disk-full/corrupt test DB and backup/restore.

## 9. G5 — Aggregation and catalog

Maintain one upstream client per service unless G1 spike proves another design. Public tool name exactly `${slug}__${originalToolName}`. Validate slug/name against pinned SDK; deterministic sort by slug/tool; same basename across servers is allowed; duplicate public name within one slug is an integrity error. Reject malformed/unknown/disabled/stale tools before upstream invocation. Build catalog snapshot then atomically swap; never wait for all upstreams on each `tools/list`. One unavailable upstream must not block healthy services. Bound schemas and never fetch remote JSON Schema `$ref`. Reconnect is single-flight; clean timers/listeners/sockets; never retry ambiguous writes.

Tests: one/two/three upstreams, collisions, stable ordering, CRM unavailable at startup, invalid/oversized schema, disabled/stale tool rejection, reconnect cleanup and concurrent-call isolation.

## 10. G6 — Routing and resilience

Router sequence: authenticate → validate namespace/catalog → check enabled/callable state → validate args/size → commit audit start → acquire bounded permits → invoke exactly one upstream under deadline → bound/redact result → finalize audit/release permits. No fallback and no automatic write retry.

Timeout defaults to 10,000 ms. Bounds for overrides require G1 approval (proposal: 500–30,000 ms). Local timeout does not prove upstream side effect was cancelled; callers must inspect state before retrying. Test disconnect/cancellation cleanup and a controlled disposable write timeout. Map malformed protocol separately from tool errors; never return raw stacks/body/credential headers. Audit-start failure blocks execution; finalization failure remains detectable.

Circuit breaker only if G1 approves. Product proposal: 3 consecutive infrastructure failures, 15-second open interval, one half-open probe. Proposed limits of 4 calls/upstream, 20 global, 64 KiB args and 1 MiB result are hypotheses until approved/measured.

Tests: slow CRM times out within configured deadline + 1 second; healthy services remain usable; kill/restart CRM without gateway restart; circuit transitions if included; fast Tasks not starved; no unintended routing; permits/resources released; no write retry; no secret leakage. Record latency percentiles, errors and CPU/RSS.

## 11. G7 — Dynamic admin API and Secret lifecycle

Proposed internal routes (freeze schemas/status codes): `GET/POST /admin/v1/upstreams`, `PATCH /admin/v1/upstreams/:id`, enable/disable/delete routes, health, API-key create/revoke and paginated audit. Never register these as MCP tools or expose publicly.

Every `/mcp` POST requires `Authorization: Bearer <gateway_api_key>`. Missing/invalid/revoked key returns 401 before MCP dispatch; member admin action returns 403. Members may call tools by default; only admins manage upstreams/keys and view global audit. Revocation applies next request.

Default URL policy allows only approved internal Service DNS names/namespace and `/mcp` path/ports. Reject userinfo, fragments, credential query, loopback/link-local/multicast/metadata IPs, unsupported schemes, unapproved hosts and redirects. No generic route to gateway itself, Kubernetes API, WordPress or MariaDB.

Use dedicated credential namespace, dedicated ServiceAccount and namespaced Role/RoleBinding. Avoid list/watch unless proven necessary. Kubernetes RBAC cannot restrict `create` by `resourceNames`, so namespace isolation matters; do not overstate guarantees. DB stores Secret references only.

Kubernetes and SQLite cannot share an ACID transaction. Create flow: validate → generate Secret name → create/verify Secret → validate upstream → commit DB reference → atomically publish config; compensate or record cleanup-needed state on failure. Rotation: create new Secret → validate → switch config revision/client → delete old Secret after successful switch. Disable/remove: block new calls → bounded drain → close client/timers → update metadata/delete Secret and make interrupted operations recoverable.

Add idempotent `upstreams:seed-defaults`; it must not overwrite admin changes on restart and must stop on conflicting slug/ID/destination. WooCommerce default has no gateway-level WooCommerce REST credential.

Test admin/member/anonymous auth, SSRF cases, secret absence from DB/API/log/audit/output, Kubernetes/DB failure compensation, rotation, disable/stale-call behavior, in-flight drain, restart recovery and negative RBAC against unrelated Secrets.

## 12. G8 — Docker, Helm, storage and network

Inspect all current templates/values/helpers before editing. Preserve store/WooCommerce behavior; do not replace whole values files with examples. Prove SQLite driver works in final Node 24 Linux image. Use non-root UID/GID 10001 where compatible, `allowPrivilegeEscalation: false`, drop capabilities, RuntimeDefault seccomp, no privileged mode, port 3000 only. No secrets in build args/image layers/ConfigMaps. Test graceful SIGTERM.

Use dedicated gateway PVC (500Mi is provisional), mount `/data`, DB `/data/gateway.db`, one replica and `Recreate`/tested no-surge strategy. Local-path is not host-loss disaster recovery. Never delete store PVCs or use uninstall as routine rollback.

NetworkPolicy: gateway egress only DNS, approved upstream Services and required Kubernetes API; gateway cannot directly access WordPress/MariaDB; mocks private; MariaDB WordPress-only on 3306; public ingress only gateway `/mcp`; admin route private; production-like render omits test-client exception. Prove actual CNI enforcement from labeled pods, not just rendered YAML.

Run:
```bash
helm lint infra/helm/urumi-platform
helm template urumi-store infra/helm/urumi-platform -n urumi -f infra/helm/urumi-platform/values-local.yaml > /tmp/urumi-local-rendered.yaml
helm template urumi-store infra/helm/urumi-platform -n urumi -f infra/helm/urumi-platform/values-prod.yaml > /tmp/urumi-prod-rendered.yaml
```
Inspect one replica/no surge, PVC mount, security context/probes/resources, gateway-only ingress, production test-client rule absent, RBAC scope and existing store resource preservation. Live deployment only after explicit approval and local profile only.

## 13. G9 — End-to-end acceptance

Preconditions: all earlier gates separately approved, fresh baseline exists, store/MCP healthy, disposable fixtures/cleanup approved.

Required tests:
1. Authenticated official MCP client sees deterministic namespaced tools from all three services.
2. Read seeded products and Order #14 through gateway; no prohibited PII; gateway does not call WordPress directly.
3. Create/read/clean a unique disposable product; never delete products 10/11/12.
4. Use a separate disposable order for status tests; never use Order #14. If safe cleanup is unavailable, block and request isolated store.
5. CRM synthetic search → Tasks create/list workflow and audit actor verification.
6. Missing/invalid/revoked key 401; member denied admin; admin succeeds; revocation immediate.
7. Dynamic add/update/disable/re-enable/remove without restart; revision atomic; stale call denied; Secret cleanup proven.
8. CRM delay/outage bounded; WooCommerce/Tasks remain usable; recovery without gateway restart.
9. Synthetic secret-leak tests across DB/API/log/audit/output.
10. Pod replacement preserves keys/upstreams/audit; only one writer.
11. NetworkPolicy local/production profile differences and private upstream/admin routes.
12. Audit-start failure blocks call; finalization failure leaves pending record.
13. Online backup integrity-check and restore to separate DB.

Performance proposal (must be approved at G1): 10 concurrent clients/requests, 100 fast mock calls, zero internal failures/timeouts, p95 < 1 second for no-delay mocks, delayed calls within timeout + 1 second. Record environment, versions, CPU/RSS, p50/p95/p99, errors and duration. Report failure honestly.

Rerun all Phase 3 suites with real pass/fail/skip counts. Compare protected products/Order #14 to baseline; verify no disposable data/fault state remains, PVC UIDs unchanged and WooCommerce Secret metadata untouched. Any difference blocks closure.

Required docs: `docs/phase-4/phase-4-master-technical-roadmap-and-checklist.md`, execution log, verification runbook, operational runbook, threat model, updated requirements traceability, architecture, README and relevant ADRs. Carry SEC-REG-01/02/03 accurately.

## 14. Requirement traceability

| Requirement | Proof | Gates |
|---|---|---|
| GTW-01 one endpoint | Authenticated protocol/catalog test | G3, G5, G9 |
| GTW-02 three upstreams | Separate services and outage isolation | G2, G5, G8, G9 |
| GTW-03 routing | Source-specific route tests | G5, G6, G9 |
| GTW-04 namespacing | Collision/malformed/stale/disabled tests | G1, G5, G6 |
| GTW-05 failure isolation | Stop/delay one upstream, others work | G5, G6, G9 |
| GTW-06 10s timeout | Config and measured timeout/cancellation | G1, G6, G9 |
| GTW-07 dynamic management | Auth and no-restart revision tests | G4, G7, G9 |
| GTW-08 health | Independent states; readiness survives partial outage | G3, G5–G7 |
| GTW-09 credential isolation | Synthetic leak tests across storage/API/log/output | G4, G7, G9 |
| GTW-10 Kubernetes Secrets | RBAC negatives and compensation tests | G1, G7–G9 |
| GTW-11 SQLite WAL/PVC | PRAGMA, mount, restart, backup/restore | G4, G8, G9 |

Statuses begin `PLANNED`; update only when evidence exists.

## 15. Git, worker and deployment governance

Before approval: only read-only inspection, G0 report and explicitly approved isolated spikes. No source/config edits, cluster changes, Secret/store mutations, commits/pushes or deployment.

After gate authorization: edit only approved paths; inspect worktree first; no force-push/reset-hard/destructive cleanup; no commit/push unless authorized; no production values/VPS/external credentials; every disposable resource has unique ID and approved cleanup. Out-of-scope changes need rationale, paths, risk, tests and rollback.

Before Helm upgrade, record history/rendered manifests without Secret values. Do not uninstall as routine rollback. Back up SQLite before schema changes; check compatibility before image revert. Never delete store PVCs or manually remove active WAL/SHM files. Preserve evidence before correcting unexpected store data.

## 16. Required AI-worker handoff

Every gate report must include:
1. Gate ID/status: `PASS`, `FAIL`, `BLOCKED` or `NOT RUN`.
2. Branch/HEAD/worktree status.
3. Exact files changed and rationale.
4. Commands run, exit codes and output evidence.
5. Tests by suite: pass/fail/skip/not run.
6. Rendered/live manifests and cluster evidence where applicable.
7. Requirement IDs covered/uncovered.
8. Security implications/deviations from accepted ADRs.
9. Protected baseline result.
10. Risks and rollback/recovery.
11. Evidence paths/commit SHAs if authorized.
12. Exact statement: **“Technical Head review requested; next gate not started.”**

An AI narrative is not acceptance evidence.

## 17. Authorization statement

**Current status: DRAFT / HOLD.** This document does not authorize implementation by itself. Authorize in sequence: (1) G0 read-only preflight; (2) G1 decision/contract preparation; (3) G2 only after explicit G1 approval; each later gate requires separate approval. Approval is not blanket permission to commit, push, deploy, change Secrets, mutate store data, use production credentials or deploy to a VPS.

**Required worker acknowledgement:** state the currently authorized gate, list prohibited actions, and confirm no later gate will begin without explicit approval.
