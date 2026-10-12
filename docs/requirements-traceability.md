# Requirements Traceability Matrix & Detailed Verification Model

---

## 1. Overview & Verification Model

This document maps **every mandatory requirement and architectural statement** from the Urumi AI Take-Home Brief to its owning component, implementation phase, verification test, and current status.

It strictly separates:
- **Scaffold / Protocol Spike Proof (Phase 1)**: Verifies foundational toolchains, syntax, packaging skeletons, and wire protocols.
- **Workload Implementation & Cluster Verification (Phases 2–7)**: Verifies live workloads, pods, PVC storage, ingress, and real end-to-end integration.
- **Bonus Capabilities**: Explicitly noted items that add value but are strictly frozen until all mandatory requirements pass.

---

## 2. Granular Requirements Traceability Matrix

### Category A: Infrastructure & Platform Packaging (Kubernetes & Helm)

| Req ID | Atomic Statement / Requirement | Owning Component | Verification Test | Phase | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **INF-01** | All services run inside Kubernetes (no host-side services except local cluster manager & client). | `infra/helm/urumi-platform` | `kubectl get pods -A` reveals all platform workloads inside cluster. Host only runs k3d/Docker. | Phase 2, 7 | **Verified (Phase 2 Store)** | WordPress 7.1 and MariaDB 11.4 run entirely inside `k3d-urumi` cluster. MariaDB is isolated to internal ClusterIP 3306; host ports 80 and 3001 remain untouched. |
| **INF-02** | Unified Helm chart deploying the entire platform. | `infra/helm/urumi-platform` | `helm lint` passes with 0 errors; `helm template` produces valid manifests. | Phase 1, 7 | **Partial (Store Workloads Verified)** | `helm lint` passes with 0 failures. Local and prod templates render valid manifests with digest-pinning support. Store workloads (StatefulSet, Deployment, PVCs, Services, Ingress) deployed and verified via release `urumi-store`. Overall platform requirement remains Partial until Gateway and Upstream MCP components are added in Phase 4. |
| **INF-03** | Environment values files: `values-local.yaml` (k3d, nip.io, port 8080) and `values-prod.yaml` (VPS, port 443). | `infra/helm/urumi-platform/` | `helm template -f values-local.yaml` and `helm template -f values-prod.yaml` render distinct valid configs. | Phase 1, 2 | **Verified** | Both values profiles render successfully. Local release running on port 8080. Production values maintain single gateway replica and TLS annotations. |
| **INF-04** | All workloads specify Kubernetes liveness and readiness probes. | Helm templates (`templates/*`) | `kubectl describe pod` confirms probes configured and passing. | Phase 2, 4, 7 | **Verified (Store)** | `urumi-mariadb` implements startup, readiness, and liveness probes via `/usr/local/bin/healthcheck.sh`. `urumi-wordpress` implements HTTP GET `/wp-login.php` startup/readiness probes and TCP liveness probe. All probes passing (1/1 Ready). |
| **INF-05** | All workloads specify sensible CPU and memory resource requests and limits. | `values.yaml` | `kubectl describe pod` confirms limits applied; pod RAM footprint fits within machine capacity (~1.4 GiB free). | Phase 2, 7 | **Verified (Store)** | Requests/limits enforced in manifests and live pods (WP: 100m/256Mi req, 500m/512Mi lim; DB: 100m/128Mi req, 500m/384Mi lim). Tuned to ensure concurrent WP-CLI execution alongside Apache without OOMKills. |
| **INF-06** | Zero hardcoded secrets in manifests; sensitive credentials mounted via Kubernetes Secrets. | `templates/secret.yaml` | `git grep` on `infra/` reveals zero committed API keys or passwords; manifests use `secretKeyRef`. | Phase 2, 7 | **Verified (Store)** | `.secrets/` gitignored; `urumi-store-secrets` created imperatively and mounted via `secretKeyRef` for `mariadb-root-password` and `mariadb-password`. REST API keys stored in `urumi-woocommerce-api`. Zero plaintext credentials committed. |

---

### Category B: Stateful Store Workload (WooCommerce on Kubernetes)

| Req ID | Atomic Statement / Requirement | Owning Component | Verification Test | Phase | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **STR-01** | WordPress + WooCommerce deployed on Kubernetes with MariaDB/MySQL. | `infra/helm/` (WordPress + MariaDB) | Pods reach `Running` state; `http://shop.127.0.0.1.nip.io:8080` loads WooCommerce storefront. | Phase 2 | **Verified** | Pods `urumi-mariadb-0` and `urumi-wordpress` are 1/1 Running & Ready. Storefront loads HTTP 200 via Traefik Ingress on `shop.127.0.0.1.nip.io:8080`. WooCommerce 11.2.1 active. |
| **STR-02** | Persistent storage for database and uploads (`wp-content`) via PersistentVolumeClaims. | PVC manifests (`local-path`) | Data persisted across pod restarts. | Phase 2 | **Verified** | Pre-created PVCs `urumi-mariadb-pvc` (/var/lib/mysql) and `urumi-wordpress-pvc` (/var/www/html) bound to `local-path`. State survives pod replacement. |
| **STR-03** | Working storefront: browse catalog, add to cart, complete checkout with Cash on Delivery (COD). | WooCommerce core | Place test order on storefront; order generated with valid Order ID. | Phase 2 | **Verified** | Customer session added product 10 to cart, completed COD checkout; Order 14 generated with `result: success` and verified in WooCommerce Admin as `processing` (INR 299.00). |
| **STR-04** | Initial test data seeded: at least 3 products with categories, pricing, and initial test orders. | WP-CLI / REST seed job | Query `GET /wp-json/wc/v3/products` returns seeded products. | Phase 2 | **Verified** | Three published products seeded: Urumi Test Mug (ID 10, ₹299), Wireless Mouse Demo (ID 11, ₹799), Notebook Demo (ID 12, ₹149). Visible in catalog and REST API. |
| **STR-05** | Pod restart durability: restarting MariaDB and WordPress pods causes zero data loss. | Kubernetes deployment | `kubectl rollout restart deployment/wordpress` and `mariadb`; re-query store, orders remain intact. | Phase 2 | **Verified** | Independent rollout restarts executed for both WordPress and MariaDB. PVC UIDs remained identical; new pod UIDs verified; all 3 products and Order 14 verified intact via REST API and storefront. |

---

### Category C: Custom WooCommerce MCP Server

| Req ID | Atomic Statement / Requirement | Owning Component | Verification Test | Phase | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **WMC-01** | Written from scratch in TypeScript (not an off-the-shelf wrapper). | `apps/mcp-woocommerce/` | Code inspection shows custom server implementation using `@modelcontextprotocol/sdk`. | Phase 3 | Planned | Implementation in Phase 3. |
| **WMC-02** | Uses official Streamable HTTP transport (not legacy HTTP+SSE). | `apps/mcp-woocommerce/` | Server uses `StreamableHTTPServerTransport`; verified over HTTP POST `/mcp`. | Phase 1, 3 | **Protocol Verified in Spike (App Planned)** | Transport architecture proven in `spikes/mcp-echo`. Application implementation planned for Phase 3. |
| **WMC-03** | Implements tool `list_products` (filtering by category, status, search). | `apps/mcp-woocommerce/` | Tool call returns array of products matching query. | Phase 3 | Planned | To be built in Phase 3. |
| **WMC-04** | Implements tool `create_product` (name, price, description, sku, category). | `apps/mcp-woocommerce/` | Tool call creates product; product immediately visible in store catalog. | Phase 3 | Planned | Test Step 2 of DoD. |
| **WMC-05** | Implements tool `list_orders` (filtering by status, customer, date range). | `apps/mcp-woocommerce/` | Tool call returns list of store orders including newly placed orders. | Phase 3 | Planned | Test Step 3 of DoD. |
| **WMC-06** | Implements tool `get_order` (order details, line items, billing/shipping address). | `apps/mcp-woocommerce/` | Tool call returns full order payload for valid Order ID. | Phase 3 | Planned | To be built in Phase 3. |
| **WMC-07** | Implements tool `update_order_status` (transitions between pending, processing, completed, cancelled). | `apps/mcp-woocommerce/` | Tool call updates order status; verified in WooCommerce Admin. | Phase 3 | Planned | To be built in Phase 3. |
| **WMC-08** | Cluster-internal service isolation: exposed via `ClusterIP` only, no external Ingress. | `infra/helm/` service manifest | Service has no Ingress; curl from host outside cluster fails; curl from gateway pod succeeds. | Phase 3 | Planned | Architectural invariant documented. |

---

### Category D: Team MCP Gateway Core (Aggregation, Routing, Reliability)

| Req ID | Atomic Statement / Requirement | Owning Component | Verification Test | Phase | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **GTW-01** | Aggregates multiple upstream MCP servers into a single downstream MCP endpoint. | `apps/gateway/` | Client connects to `/mcp` on gateway; `tools/list` returns tools from all registered upstreams. | Phase 4 | Planned | Core gateway functionality. |
| **GTW-02** | Connects to at least 3 distinct upstream servers (WooCommerce, CRM, Tasks). | `apps/gateway/` | Tool list contains tools from WooCommerce, CRM, and Tasks. | Phase 4 | Planned | CRM and Tasks provide deterministic test mocks. |
| **GTW-03** | Dynamic routing of tool calls to the correct upstream server. | `apps/gateway/` | Call to `woocommerce__create_product` routes to WooCommerce pod; call to `tasks__create_task` routes to Tasks pod. | Phase 4 | Planned | Test Step 6 of DoD. |
| **GTW-04** | Tool namespacing (`{server}__{tool}`) to prevent collisions across upstreams. | `apps/gateway/` | All aggregated tools follow `{server}__{tool}` naming format. | Phase 4 | Planned | Enforced in gateway tool registry. |
| **GTW-05** | Failure isolation: slow or dead upstream does not crash gateway or prevent calling healthy servers. | `apps/gateway/` | Terminate Upstream 2 pod; gateway responds to `tools/list` for remaining servers and executes calls normally. | Phase 4 | Planned | Test Step 9 of DoD. |
| **GTW-06** | Configurable per-upstream request timeouts (e.g. 10s default). | `apps/gateway/` | Simulated slow upstream returns timeout error cleanly without hanging client. | Phase 4 | Planned | Enforced in gateway proxy layer. |
| **GTW-07** | Upstream server management: dynamically add, remove, enable, disable upstreams without gateway restart. | `apps/gateway/`<br/>`apps/dashboard/` | Disable Upstream 3 via Dashboard; its tools immediately disappear from `tools/list` response. | Phase 4, 5 | Planned | Test Step 8 of DoD. |
| **GTW-08** | Upstream health tracking: unhealthy upstreams marked `Unreachable` in Dashboard. | `apps/gateway/`<br/>`apps/dashboard/` | Dead upstream shows status `Unreachable` in UI status pill. | Phase 4, 5 | Planned | Test Step 9 of DoD. |
| **GTW-09** | Upstream credential isolation: downstream clients never see or provide upstream credentials. | `apps/gateway/` | Downstream client uses only User API key; gateway injects internal upstream credentials. | Phase 4 | Planned | ADR-003 security invariant. |
| **GTW-10** | Dynamic upstream credentials stored in Kubernetes Secrets. | `apps/gateway/` K8s client | Gateway creates Secret in `urumi-gateway-secrets` namespace using dedicated ServiceAccount RBAC. | Phase 4, 5 | Planned | Outlined in ADR-003. |
| **GTW-11** | Gateway persistence: SQLite with WAL mode on PVC (`/data/gateway.db`). | `apps/gateway/` storage | Pod restart retains users, API keys, upstream configs, and audit logs. | Phase 4 | Planned | Storage failure model documented in architecture. |

---

### Category E: Team Access Control & API Key Lifecycle

| Req ID | Atomic Statement / Requirement | Owning Component | Verification Test | Phase | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **SEC-01** | User authentication on downstream MCP endpoint via `Authorization: Bearer <key>`. | `apps/gateway/` auth middleware | Request without key returns 401; request with valid key succeeds. | Phase 1, 5 | **Protocol Verified in Spike (App Planned)** | Spike Test 1 (missing + invalid key) and Test 2 verified 401 rejection and bearer acceptance. App middleware planned in Phase 5. |
| **SEC-02** | Each team member has a unique API key. | `apps/gateway/` user management | Distinct keys generated for User A and User B. | Phase 5 | Planned | Test Step 2 (User A) vs Test Step 4 (User B). |
| **SEC-03** | Plaintext key displayed exactly once upon creation; stored hashed (SHA-256). | `apps/gateway/` user management | Database dump reveals only SHA-256 hashes, zero plaintext keys. | Phase 5 | Planned | Security requirement from brief. |
| **SEC-04** | Instantaneous key revocation: revoked key rejected on the very next request. | `apps/gateway/` auth middleware | Revoke User B key; immediate tool call returns HTTP 401 Unauthorized. | Phase 5 | Planned | Test Step 7 of DoD. |
| **SEC-05** | Mandatory Admin role: manage upstreams, manage users/keys, view all audit logs, use tools. | `apps/gateway/`<br/>`apps/dashboard/` | Admin user accesses control plane endpoints and audit logs. | Phase 5 | Planned | Core role requirement. |
| **SEC-06** | Mandatory Member role: use permitted tools, view own usage/audit logs only. | `apps/gateway/`<br/>`apps/dashboard/` | Member cannot access admin APIs or view other users' logs. | Phase 5 | Planned | Core role requirement. |

---

### Category F: Audit Logging & Attribution

| Req ID | Atomic Statement / Requirement | Owning Component | Verification Test | Phase | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **AUD-01** | Audit log intercepts every tool call passing through the gateway. | `apps/gateway/` audit middleware | Every tool invocation produces a structured audit record. | Phase 5 | Planned | Interceptor in gateway proxy. |
| **AUD-02** | Full attribution: records User ID, Upstream Server, Tool Name, Timestamp, Duration, Status, Outcome. | `apps/gateway/` audit table | Query audit log: fields are populated with accurate values. | Phase 5 | Planned | Test Step 10 of DoD. |
| **AUD-03** | Audit logs persisted in SQLite on PVC across pod restarts. | `apps/gateway/` DB | Restart gateway pod; historical audit logs remain queryable. | Phase 5 | Planned | Durability requirement. |
| **AUD-04** | Dashboard Audit Log UI: searchable, filterable table of tool executions. | `apps/dashboard/` | Open audit log view; filter by user (User A vs User B) and status. | Phase 5 | Planned | Test Step 10 of DoD. |

---

### Category G: In-Dashboard Chat Agent

| Req ID | Atomic Statement / Requirement | Owning Component | Verification Test | Phase | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **CHT-01** | Web dashboard built in React + Vite with clean UI. | `apps/dashboard/` | Browser loads dashboard; responsive layout, tab navigation. | Phase 5 | Planned | Frontend SPA. |
| **CHT-02** | Chat interface communicating with an LLM (Gemini / Claude / OpenAI / Ollama). | `apps/dashboard/`<br/>`apps/gateway/` | User sends message; LLM streams response in chat UI. | Phase 6 | Planned | Chat implementation. |
| **CHT-03** | LLM executes tools through the gateway as the logged-in user (User A). | `apps/gateway/` agent loop | Chat agent calls `woocommerce__create_product`; audit log attributes execution to User A. | Phase 6 | Planned | Test Step 2 of DoD. |
| **CHT-04** | Real-time tool execution visibility in chat (tool name, inputs, status pill). | `apps/dashboard/` | Chat UI renders collapsible tool call block during execution. | Phase 6 | Planned | UX requirement from brief. |

---

### Category H: External MCP Client Support & Interoperability

| Req ID | Atomic Statement / Requirement | Owning Component | Verification Test | Phase | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **EXT-01** | External client (MCP Inspector, Claude Code, Cursor) connects to gateway URL. | `apps/gateway/` `/mcp` endpoint | Run `npx @modelcontextprotocol/inspector` connecting to gateway; discovery succeeds. | Phase 1, 6 | **Protocol Verified in Spike (App Planned)** | Protocol capability verified with SDK client in spike. Live gateway connection planned for Phase 6. |
| **EXT-02** | External client authenticates with User B's API key. | `apps/gateway/` `/mcp` endpoint | MCP Inspector connects using `Authorization: Bearer <user_b_key>`. | Phase 6 | Planned | Test Step 4 of DoD. |
| **EXT-03** | External client executes cross-server workflow combining tools from 2 servers. | `apps/gateway/` | Prompt combining WooCommerce and Tasks executed; composite result returned. | Phase 6 | Planned | Test Step 6 of DoD. |

---

## 3. Scope Boundaries: Bonus vs Mandatory Features

| Feature | Classification | Policy for Round 1 |
| :--- | :---: | :--- |
| **Admin and Member Roles** | **MANDATORY** | Fully implemented in Phase 5. |
| **Unique User API Keys + Instant Revocation** | **MANDATORY** | Fully implemented in Phase 5. |
| **Audit Logging with User Attribution** | **MANDATORY** | Fully implemented in Phase 5. |
| **Failure Isolation & Upstream Timeouts** | **MANDATORY** | Fully implemented in Phase 4. |
| **External Client Support (MCP Inspector)** | **MANDATORY** | Fully implemented in Phase 6. |
| **Per-Tool Granular Role Restrictions** | **BONUS** | Frozen until Steps 1–10 pass. |
| **Multi-Store Dynamic Provisioning** | **BONUS** | Frozen until Steps 1–10 pass. |
| **OAuth / OIDC Gateway Replacement** | **OUT OF SCOPE** | Out of scope (API keys required by brief). |
