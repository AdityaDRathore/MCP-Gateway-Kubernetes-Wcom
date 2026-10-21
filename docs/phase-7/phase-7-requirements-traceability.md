# Phase 7 Requirements-to-Deliverables Traceability Matrix

**Source basis:** original assignment brief; `Resource/implementation/phase_1_master_roadmap_and_checklist.md`; `docs/requirements-traceability.md`; Phase 6 G7 handoff report.  
**Evidence caveat:** this matrix reflects a documentation review only. No live runtime checks were performed while planning. Status labels below are planning dispositions, not new acceptance results.

## 1. Status vocabulary

- **Reported complete:** prior report claims implementation/test evidence; Phase 7 should reuse that report and rerun only where needed.
- **Fresh verification required:** implementation is reported but the final candidate must be tested again.
- **Gap/inconsistency:** docs conflict or evidence does not conclusively prove the requirement.
- **Deferred/optional:** explicitly bonus or documented limitation; not automatically Phase 7 scope.
- **Phase 8 final demo:** required end-to-end demonstration is owned by final acceptance; Phase 7 prepares and regression-checks it.

## 2. Matrix

| Requirement / source | Assignment intent | Current documented state | Phase 7 deliverable | Acceptance test / evidence | Priority / disposition |
|---|---|---|---|---|---|
| INF-01 — all services in Kubernetes | Store, DB, MCPs, Gateway and dashboard run in cluster | Reported deployed in k3d; final candidate identity not rechecked | Baseline workload inventory | Sanitized `kubectl get pods,svc,ingress,pvc -n urumi` plus relevant secret namespace inventory; reconcile live images | Must; fresh verify |
| INF-02 — unified Helm chart | Same chart deploys full platform | Traceability matrix still says “Partial (Store Workloads Verified)” with outdated note that Gateway/upstreams not yet added; later README/reports describe full platform | G0 reconciliation + G1 chart review | `helm lint`, local/prod `helm template`; compare rendered resources to live release and all workload inventory | Must; resolve inconsistency before changing status |
| INF-03 — local and production values | Same chart, config-only differences | Previously marked Verified; current chart after Phase 6 needs fresh render | Helm profile report | Record command/exit code and inspect host/ingress/TLS/storage/secret differences | Must; fresh verify |
| INF-04 — probes every workload | Readiness/liveness checks on every workload | Matrix evidence primarily describes store; later architecture lists Gateway/MCP probes | Full workload probe inventory | Inspect rendered Deployment/StatefulSet probe config and live readiness; document any intentional exception | Must; fresh verify |
| INF-05 — resource requests/limits | Bounded resource use on all workloads | Matrix evidence primarily describes store; architecture reports all workload resources | Full resource inventory | Inspect rendered requests/limits; compare with current use if safe; no retuning without measured issue | Must; fresh verify |
| INF-06 — no hardcoded secrets | Kubernetes Secrets for credentials | Reported across store/Gateway; final code/config needs scan | Secret handling review | Safe tracked-file scan; inspect references and response/log redaction; never print secret values | Must; fresh verify |
| STR-01 — store on Kubernetes | WordPress/WooCommerce + MariaDB | Reported implemented and live | Readiness/store smoke test | Storefront HTTP status, pods ready, database connection status | Must; focused regression |
| STR-02 — persistent store content/database | PVC-backed WordPress and MariaDB | Phase 2 reports restart persistence; local-path is node-local | Safe persistence recheck if approved | Read-only baseline before/after approved restart; PVC UIDs unchanged | Must to preserve; restart is separately approval-gated |
| STR-03 — catalog/cart/COD checkout | Working store order flow | Previously verified with Order #14 | Disposable checkout smoke test for final demo | Create a disposable cart/order; confirm order in admin; clean only disposable fixtures per approved process | Must for final DoD; Phase 8 full demo |
| STR-04 — 3 seed products/order | Stable baseline store records | Products 10/11/12 and Order #14 documented | Read-only baseline guard | Compare ID/SKU/name/price/status/order status/line items; no mutations | Must; invariant |
| STR-05 — restart durability | Pod replacement causes no data loss | Phase 2 previously verified | Optional repeat only with approval and safe window | Verify baseline unchanged after approved restart | Must preserve; fresh run conditional |
| WMC-01..02 — custom MCP/Streamable HTTP | Written in TypeScript; MCP over Streamable HTTP | Reported complete; five tools | Regression, not rebuild | Build + MCP protocol tests; tool list contract | Must; focused regression |
| WMC-03..07 — five WooCommerce tools | list/create products, list/get/update order status | Reported complete; order PII excluded | Safe tool contract regression | Read-only calls to list products/orders/get order; write tests use disposable fixtures only | Must; never mutate protected IDs |
| WMC-08 — private upstream | Only Gateway can call WooCommerce MCP | Reported ClusterIP and NetworkPolicy | Perimeter review/test | No public Ingress/NodePort/hostPort; intended Gateway call succeeds, unauthorized path blocked | Must; fresh verify |
| GTW-01..04 — one Gateway endpoint, aggregation, namespacing, dynamic upstream lifecycle | All enabled upstream tools available through one endpoint; add/edit/disable/remove | Reported 3 upstreams, 10 tools, lifecycle APIs | Catalog/lifecycle regression | Compare enabled tool catalog; disable one upstream and verify tools disappear from chat and external MCP list; re-enable and verify recovery | Must; assignment DoD |
| GTW-05 — dead/slow upstream isolation | Other servers continue working; clear error | Reported failure isolation and timeouts; assignment explicitly requires pod kill + dashboard unreachable | Controlled fault test | Kill/recreate only disposable stateless upstream pod; unaffected call succeeds, dashboard shows unreachable, recovery works | Must; highest-value live proof |
| GTW-06 — timeouts/errors | Bounded per-upstream timeout and clear failure | Reported implemented | Targeted timeout/error regression | Existing harness or bounded test proves timeout maps to safe clear error without hanging other calls | Must; no unbounded stress |
| GTW-07..08 — tool namespacing / 3 upstreams | Collision handling and at least three upstreams | Reported 10 tools across WooCommerce/CRM/Tasks | MCP catalog regression | Tool names retain prefixes; all three upstreams discovered by external client | Must; focused regression |
| GTW-09..11 — credentials, secrets, SQLite persistence | Upstream secrets server-side; audit/catalog persists | Reported secret isolation, SQLite WAL/PVC | G1 security review + G3 integrity/restart | No credential in browser/tool DTO/audit; DB integrity and selected metadata persistence after approved Gateway replacement | Must |
| SEC-01..06 — Admin/Member, per-user key, hash/revoke | Roles, separate keys, revocation | Phase 5/6 reports test coverage | Auth regression | Admin-only server/member operations; valid member key works; revoked key denied; no token substitution between listeners | Must |
| AUD-01..04 — audit every call, Admin can view | Actor/server/tool/time/duration/outcome visible | Reported persistent audit and attribution | Audit regression | Run chat and external MCP read-only calls; verify actor/tool/status/duration rows; inspect redaction and Admin-only viewer | Must |
| CHT-02 — LLM chat | Chat calls tools via Gateway | Phase 6 G7 says live Gemini verified | Chat smoke test | Read-only natural-language question invokes expected namespaced tool and returns grounded result; mock provider used for deterministic tests | Must |
| CHT-03 — acting as logged-in user | Audit actor equals browser user | Phase 6 report has test evidence | Audit attribution regression | User A chat tool call creates audit record with User A ID, not system/admin actor | Must |
| CHT-04 — tool visibility | Show tools used and status/duration | Reported UI telemetry; “real-time” atomic turn updates | Dashboard smoke test | Tool name/status/duration visible after turn; do not require partial streaming | Must |
| EXT-01..02 — external MCP client/member key | One URL and member key discovers tools; revocation works | Phase 6 G7 reports official SDK/Inspector acceptance | External client regression | MCP Inspector/SDK connects to Gateway only, sees enabled tool catalog, safe read-only call works; revoked key rejected | Must |
| EXT-03 — cross-server prompt | One prompt invokes two upstreams | Phase 6 G7 reports live CRM+Tasks workflow | External client/chat regression | One natural-language prompt yields at least one CRM and one Tasks call; both appear in audit | Must |
| SEC-NET — only Gateway reaches upstreams | “Both chat agent and external clients reach every MCP server through gateway; nothing else talks directly” | Reported by architecture and NetworkPolicy evidence | G1 perimeter review | Upstream ClusterIP only; policy selectors match labels; no Gateway-to-WordPress/MariaDB bypass | Must |
| PROD-01 — production-like VPS using same chart | Same chart, config-only differences | `values-prod.yaml` exists; report does not establish actual VPS rollout | Render and document prerequisites | Production values render; identify required host/TLS/registry/secrets/storage configuration. Actual deployment only if explicitly approved | Must render; public rollout optional |
| BONUS-01 — multi-store | Store provisioning platform | Deferred optional bonus | None | No Phase 7 acceptance | Out of scope |
| BONUS-02 — OAuth/OIDC | OAuth on Gateway | Deferred optional bonus; API keys are mandatory | None | No Phase 7 acceptance | Out of scope |
| BONUS-03 — per-tool permissions | Fine-grained ACLs | Deferred optional bonus | Do not expand scope | No Phase 7 acceptance | Out of scope |
| BONUS-04 — tool search/vector retrieval | Handling many tools | Deferred optional differentiator; 10 tools currently | None unless a concrete grading issue appears | No Phase 7 acceptance | Out of scope |
| CHT-LIMIT-01 — streaming chat | Partial token streaming | Explicitly deferred in Phase 6 handoff | Document accurately | No SSE streaming acceptance added | Deferred |
| DR-LIMIT-01 — node-loss recovery | Off-host durability | Not proven; local-path PVC node-local | State limitation and validate backup copy only | Do not claim node-loss recovery | Limitation, not new requirement |

## 3. Evidence provenance required for each row marked freshly verified

For each test record: requirement ID; test ID; date/time; repository SHA; image ID/digest; Helm release/revision; cluster context/namespace; exact command or manual steps; exit code; expected/observed result; evidence path; cleanup status; and disposition PASS/FAIL/BLOCKED/NOT RUN.

Do not combine test counts from different scopes. The README currently cites 351 unit + 62 protocol tests, while the Phase 6 handoff details focused suite counts. Record the exact commands and per-suite results; resolve the discrepancy if the reports claim the same test run.
