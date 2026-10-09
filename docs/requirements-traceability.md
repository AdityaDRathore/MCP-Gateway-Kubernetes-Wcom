# Requirements Traceability Matrix & Scope Definition

---

## 1. Mandatory Requirements Traceability Matrix

Every mandatory requirement from the Urumi AI Take-Home Brief is mapped directly to an owning architectural component and its planned verification test:

| Requirement ID | Requirement Description | Owning Component | Planned Verification Test | Phase |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-01** | **Stateful Store Deployment**<br/>WooCommerce (WordPress + MariaDB) on Kubernetes with persistent storage for database and wp-content. | `infra/helm/templates/store/` | Deploy store chart with PVCs, access storefront at `http://shop.127.0.0.1.nip.io:8080`, place Cash on Delivery order, verify order in WP Admin. Restart pod and assert data persists. | Phase 2 |
| **REQ-02** | **Custom WooCommerce MCP Server**<br/>Custom server written from scratch in TypeScript speaking Streamable HTTP, exposing 5 tools: `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`. | `apps/mcp-woocommerce/` | Direct MCP protocol test: discover all 5 tools, invoke `create_product` and `list_orders`, assert changes reflected via WooCommerce REST API. Cluster internal only (no external Ingress). | Phase 3 |
| **REQ-03** | **Gateway Tool Aggregation & Routing**<br/>Single MCP endpoint aggregating at least 3 upstream servers (WooCommerce, CRM, Tasks). Calls routed dynamically to correct upstreams with namespacing. | `apps/gateway/` | Client connects to `/mcp` on gateway, discovers aggregated tool list (`woocommerce__*`, `crm__*`, `tasks__*`), invokes tools across all 3 upstreams. | Phase 4 |
| **REQ-04** | **Failure Isolation & Upstream Timeouts**<br/>A slow or dead upstream must not break tool listing or calls to other servers. Dead servers marked `Unreachable`. | `apps/gateway/` | Kill or simulate outage on Upstream 2 pod. List tools from Gateway: WooCommerce and Upstream 3 continue working cleanly; Dashboard shows Upstream 2 as `Unreachable`. | Phase 4 |
| **REQ-05** | **Team Access Control & API Key Lifecycle**<br/>Admin & Member roles. Each user has unique API key. Plaintext shown once, stored hashed (SHA-256). Support revocation. | `apps/gateway/`<br/>`apps/dashboard/` | Generate API key for User B. User B calls tools successfully. Admin revokes User B's key. Subsequent request from User B immediately rejected with HTTP 401 Unauthorized. | Phase 5 |
| **REQ-06** | **Audit Logging with Full Attribution**<br/>Audit log of every tool execution: who (user), server, tool, timestamp, duration, status, outcome. | `apps/gateway/`<br/>`apps/dashboard/` | Inspect Audit Log table in Dashboard: confirm exact entries for User A (Chat Agent) and User B (External Client) with matching parameters, latencies, and outcomes. | Phase 5 |
| **REQ-07** | **In-Dashboard Chat Agent**<br/>Chat in React dashboard using an LLM to call tools through the gateway as the logged-in user. | `apps/dashboard/`<br/>`apps/gateway/` | Log in as User A in Dashboard. Prompt: *"Create product 'Urumi Hoodie' for $49"*. Agent executes tool. Verify product live on storefront. | Phase 6 |
| **REQ-08** | **External MCP Client Integration**<br/>External client (MCP Inspector / Claude Code) connects using single gateway URL and User B's API key. | `apps/gateway/` | Connect MCP Inspector to Gateway URL with User B's API key. Execute tool queries. Execute cross-server prompt combining tools from 2 servers. | Phase 6 |
| **REQ-09** | **Declarative Kubernetes & Helm Packaging**<br/>Everything runs in cluster. Single Helm chart with `values-local.yaml` and `values-prod.yaml`. Readiness/liveness probes, resource limits, no hardcoded secrets. | `infra/helm/` | Run `helm lint` and `helm template`. Deploy on local k3d. Inspect all pods: probes passing, limits applied, zero plaintext secrets in manifests. | Phase 7 |

---

## 2. Definition of Done (End-to-End Test Matrix)

The final submission must execute and record this precise 10-step sequence with **two distinct users**:

| Step | Actor | Action | Expected Pass Criteria |
| :---: | :--- | :--- | :--- |
| **1** | **User (Storefront)** | Open storefront, add product to cart, check out with Cash on Delivery. | Order is placed with ID; order appears in WooCommerce Admin dashboard. |
| **2** | **User A (Dashboard Chat)** | Prompt chat agent: *"Create a product named 'DevOps T-Shirt' priced at $29.99"*. | Tool `woocommerce__create_product` invoked; product appears live on storefront. |
| **3** | **User A (Dashboard Chat)** | Manually place order for 'DevOps T-Shirt' on storefront, then ask agent: *"What orders came in today?"*. | Tool `woocommerce__list_orders` invoked; returns newly placed order with exact customer details. |
| **4** | **User B (External Client)** | Connect **MCP Inspector** (or Claude Code CLI) to Gateway using User B's API key. | External client lists tools from all 3 registered servers (WooCommerce, CRM, Tasks). |
| **5** | **User B (External Client)** | Run orders inquiry through external client. | Tool `woocommerce__list_orders` executed successfully; returns today's orders. |
| **6** | **User B (External Client)** | Run multi-server prompt requiring two upstreams (e.g. query order and record note in Tasks MCP). | Gateway routes calls to WooCommerce MCP and Tasks MCP sequentially and returns composite result. |
| **7** | **Admin (Dashboard)** | Admin revokes User B's API key in Dashboard. | User B's subsequent tool call is immediately rejected with HTTP 401 Unauthorized. |
| **8** | **Admin (Dashboard)** | Admin disables Upstream 3 (Tasks MCP) in Dashboard. | Tasks tools immediately disappear from both Chat Agent and External Client tool catalogs. |
| **9** | **Operator (Cluster)** | Operator kills Upstream 2 pod (`kubectl delete pod ...`). | WooCommerce tools continue working without crashing; Dashboard marks Upstream 2 as `Unreachable`. |
| **10** | **Admin (Dashboard)** | Open Dashboard Audit Log view. | Every previous call (Steps 2, 3, 5, 6, 7) appears in the table with exact timestamp, duration, status, and correct user attribution (User A vs User B). |

---

## 3. Explicit Non-Goals for Round 1 (Frozen Scope)

To ensure the mandatory core is 100% complete, reproducible, and verifiable, the following are explicitly **frozen as non-goals** until all mandatory requirements pass:

1. **Multi-Store Dynamic Provisioning (Bonus)**: Out of scope for MVP. Dynamic namespace creation and store tearing down will not be started before core completion.
2. **OAuth Gateway Replacement**: Out of scope for MVP. API key header authentication is strictly required by the Definition of Done.
3. **Advanced Tool Semantic Vector Search**: Out of scope for MVP. Clean `{upstream}__{tool}` namespacing fully satisfies aggregation across 3 upstream servers.
4. **Multiple Gateway Replicas / Distributed Consensus**: Out of scope for MVP. Single-replica gateway with SQLite on PVC is memory-efficient and reliable for local machine specs.
5. **Prometheus / Grafana Observability Stacks**: Out of scope for MVP. Built-in SQLite audit logging satisfies observability requirements without consuming 1GB+ of host RAM.
