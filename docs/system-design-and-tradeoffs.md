# System Design and Trade-Offs Note

**Project:** Urumi Enterprise AI Gateway on Kubernetes with WooCommerce  
**Document:** Deliverable Note — System Design & Engineering Trade-Offs  
**Location:** `docs/system-design-and-tradeoffs.md`  
**Author:** Aditya Rathore  
**Reference:** [Context/Urumi AI FDE Internship - Round 1_ MCP Gateway on Kubernetes.txt](file:///home/rathore/Documents/Urumi%20Assignment/Context/Urumi%20AI%20FDE%20Internship%20-%20Round%201_%20MCP%20Gateway%20on%20Kubernetes.txt#L204-L208)

---

## 1. Architectural Choices

### 1.1 Node.js 24 LTS & Embedded SQLite in WAL Mode
- **Decision:** The gateway engine uses Node.js 24 LTS (`v24.20.0`) and its built-in `node:sqlite` module in Write-Ahead Logging (WAL) mode, mounted on a 500 MiB Kubernetes PersistentVolumeClaim (`urumi-gateway-pvc`).
- **Rationale:** 
  1. *Operational Simplicity:* Eliminates the resource overhead and operational complexity of running a dedicated PostgreSQL or MySQL database cluster for the gateway control plane.
  2. *Zero-Latency Auth Checks:* In-process database access provides sub-millisecond query execution for Bearer API key lookups and session verification, avoiding cross-network latency on high-frequency MCP calls.
  3. *Native C++ Freedom:* Using Node 24 standard library `node:sqlite` eliminates native binary dependencies (like `better-sqlite3`), avoiding compilation issues across Alpine/Debian container builds and multi-architecture Docker environments.
- **Trade-off & Scaling Boundary:**
  - SQLite is fundamentally a single-writer database. The gateway deployment runs a single replica (`replicas: 1`) with `strategy: { type: Recreate }` to avoid concurrent writer contention on the PVC.
  - In Phase 7 Gate P7-G3, we verified that pod replacement takes **31 seconds** to remount the PVC and recover to `1/1 Ready` with zero data corruption (`PRAGMA integrity_check` returning `ok`).
  - *Evolution Path:* To scale horizontally across multiple gateway replicas, the storage engine would transition to **LiteFS** (FUSE-based distributed SQLite replication over Raft) or migrate the repository interfaces (`UserRepository`, `ApiKeyRepository`, `AuditRepository`) to **PostgreSQL**.

### 1.2 Perimeter Isolation via Dual Listeners
- **Decision:** The single gateway container process binds two separate HTTP servers on distinct ports:
  - **Port 3001 (Browser Listener):** Serves static SPA assets from `/app/dist-dashboard` and the session REST API (`/api/v1/browser/*`).
  - **Port 3000 (MCP & Admin Listener):** Serves the Model Context Protocol over Streamable HTTP (`/mcp`) and private administrative APIs (`/admin/v1/*`).
- **Rationale:** 
  1. *Cross-Perimeter Token Isolation:* Ambient browser cookies cannot bleed into machine MCP tool routes on port 3000; Bearer API keys cannot access browser session routes on port 3001.
  2. *Ingress Hardening:* Traefik Ingress routes root path `/` to Port 3001, and `/mcp` to Port 3000. External internet requests to `/admin/v1/*` hit Port 3001 and return an immediate HTTP 404, guaranteeing that internal administrative routes cannot be accessed from outside the cluster.

### 1.3 In-Cluster OAuth 1.0a HMAC-SHA256 Signing
- **Decision:** WooCommerce MCP interacts with WordPress (`http://urumi-wordpress:80/wp-json/wc/v3`) using RFC 5849 OAuth 1.0a HMAC-SHA256 request signing.
- **Rationale:** Inside a Kubernetes cluster without mTLS service mesh, standard Basic Auth sends API keys in plaintext over HTTP. OAuth 1.0a signs every request with a unique cryptographic nonce and timestamp, meaning the consumer secret is never transmitted over the cluster network.

---

## 2. Tool Aggregation, Dynamic Routing & Failure Handling

### 2.1 Dynamic Namespacing (`{server}__{tool}`)
- **Mechanism:** When discovering tools across upstreams (`urumi-woocommerce-mcp`, `urumi-mcp-crm`, `urumi-mcp-tasks`), `CatalogService` prefixes each tool with its upstream slug (e.g. `woocommerce__list_orders`, `crm__search_contacts`, `tasks__create_task`).
- **Collision Protection:** If two independent microservices expose a tool with the same name (e.g. `list_items`), the prefix guarantees zero naming collisions.
- **Resolution:** When a tool call arrives at `POST /mcp`, `ToolRouter` looks up the public name in constant time ($O(1)$) using an internal `Map`, strips the prefix, validates the arguments against that specific tool's JSON Schema, and routes the call to the target upstream client.

### 2.2 Hierarchical Concurrency Limiter & Backpressure
- **Limits:**
  - Global Gateway Ceiling: **20 concurrent requests** FIFO.
  - Per-Upstream Ceiling: **4 concurrent requests** with a maximum queue depth of **10**.
  - Maximum Queue Wait Time: **1,000 ms**.
- **Rationale:** Protects upstream microservices (especially WordPress running on Apache/PHP-FPM) from connection exhaustion during AI agent swarm execution. Excess traffic fails fast with HTTP 429 (`CONCURRENCY_LIMIT_EXCEEDED`).

### 2.3 Per-Upstream Circuit Breakers & Timeouts
- **Timeout Enforcement:** Every upstream call is wrapped in an `AbortController` bounded by `timeout_ms` (default 10,000ms).
- **Circuit Breaker State Machine:**
  - Tracks consecutive failures per upstream.
  - If failures exceed the threshold, the circuit breaker enters `OPEN` state, immediately failing subsequent calls with a clear 504 error without waiting for timeouts.
  - After a reset timeout, it enters `HALF_OPEN` state, allowing a single probe request to test recovery.
- **Degraded Operation:** A dead or slow upstream does not break `tools/list` or calls to other servers. Degraded upstreams are marked `reachable: false`, while healthy upstreams continue operating normally.

---

## 3. Production VPS vs Local Changes

The platform achieves local-to-production parity using a **unified Helm chart** (`infra/helm/urumi-platform`), switching environments solely through values files:

| Dimension | Local Development (`values-local.yaml`) | Production VPS (`values-prod.yaml`) | Architectural Impact |
|:---|:---|:---|:---|
| **DNS / Domains** | Wildcard `*.127.0.0.1.nip.io` | Static public domains (e.g. `shop.example.com`, `mcp.example.com`) | External clients connect to verified hostnames without `/etc/hosts` hacks. |
| **Ingress Ports & TLS** | Port 8080 (HTTP plaintext) | Ports 80 & 443 with Let's Encrypt TLS via cert-manager | All client and dashboard traffic is encrypted in transit; HTTP redirects to HTTPS. |
| **Storage Provisioner** | `local-path` (k3d default) | `local-path` (single node) or cloud provisioner (`gp3`, `standard-rwo`) | Guarantees durable block storage matching the host provider SLA. |
| **Container Hardening** | Development testing rules | Strict `readOnlyRootFilesystem: true`, `/tmp` `emptyDir`, `runAsNonRoot: true` | Eliminates post-exploitation write persistence in containers. |
| **NetworkPolicies** | Allows local test-client probe pods | Strips all test-client ingress rules; enforces strict component label matching | Complete network isolation; only the gateway can reach upstream MCP pods. |
| **Secrets Management** | `.secrets/*.env` files | Sealed Secrets, Vault, or Cloud Secret Manager | Plaintext credentials are never committed or exposed on developer machines. |

---

*Authored for Urumi AI FDE Assignment.*
