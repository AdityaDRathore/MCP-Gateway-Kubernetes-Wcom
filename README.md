# Urumi Enterprise Platform — Team MCP Gateway on Kubernetes with WooCommerce

[![Node.js 24 LTS](https://img.shields.io/badge/Node.js-24%20LTS%20(v24.20.0)-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-v1.37.1%20(k3d%2Fk3s)-326CE5?logo=kubernetes&logoColor=white)](https://k3s.io/)
[![Helm 3](https://img.shields.io/badge/Helm-v3.17.1-0F1689?logo=helm&logoColor=white)](https://helm.sh/)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-v1.32.1%20(Streamable%20HTTP)-blueviolet)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/Tests-534%2F534%20Passed%20(100%25)-brightgreen)](docs/phase-7/p7-g5-regression-qualification-report.md)
[![Security Hardened](https://img.shields.io/badge/Container%20Security-Read--Only%20Rootfs%20%7C%20Non--Root-orange)](docs/phase-7/p7-g2-deployment-and-runtime-verification-report.md)

A unified, authenticated, and audited **Model Context Protocol (MCP) Gateway** deployed on Kubernetes. It provides governed, multi-tenant AI tool access to a stateful WooCommerce store and internal team microservices across two decoupled perimeters: an **in-dashboard AI assistant** for human operators and a **Streamable HTTP endpoint** for external AI clients (Claude Code, Cursor, MCP Inspector).

Submitted by **Aditya Rathore** for Round 1 of the **Urumi AI Founding DevOps / Forward Deployed Engineer (FDE) Assignment**.

---

## Quick Navigation

- [Demo Video & Walkthrough](#-demo-video--walkthrough)
- [Architecture At A Glance](#-architecture-at-a-glance)
- [Monorepo Structure](#-monorepo-structure)
- [Local Setup Instructions (k3d / K3s)](#-local-setup-instructions-k3d--k3s)
- [Production / VPS Deployment Guide](#-production--vps-deployment-guide-k3s)
- [User & Verification Workflows](#-user--verification-workflows)
  - [1. Storefront Checkout (Cash on Delivery)](#1-storefront-checkout-cash-on-delivery)
  - [2. In-Dashboard AI Assistant & Confirmation Engine](#2-in-dashboard-ai-assistant--confirmation-engine)
  - [3. External MCP Client & Instant Revocation](#3-external-mcp-client--instant-revocation)
- [System Design & Trade-Offs Note](#-system-design--trade-offs-note)
- [Threat Model Note](#-threat-model-note)
- [Stand-Out Differentiators Implemented](#-stand-out-differentiators-implemented)
- [Automated Testing & Verification Baseline](#-automated-testing--verification-baseline)
- [Phase Documentation Index](#-phase-documentation-index)

---

## 🎥 Demo Video & Walkthrough

The complete 16–18 minute end-to-end recorded walkthrough covers:
1. **System Introduction & Thank-You** to Namit and Divyanshu.
2. **Live Architecture Drawing in draw.io** detailing request flows, ports, and boundaries.
3. **Repository Tour & Code Mapping** connecting architecture to TypeScript implementation.
4. **Kubernetes Deployment & PVC Persistence** inspection in terminal.
5. **Live Product Walkthrough**:
   - Admin upstream registration & dynamic 10-tool discovery.
   - In-dashboard AI Chat Copilot with real-time badges and server-side HMAC mutation confirmation.
   - Hard-blocked protection of baseline records (Order #14 and Product IDs 10–12).
   - External MCP Client connecting via Bearer API key over Streamable HTTP.
   - Single-prompt cross-server multi-turn reasoning (`crm` + `tasks`).
   - Instant fail-closed API key revocation.
6. **534-Test Automated Regression Baseline & Operational Trade-Offs**.

- **Demo Video Submission Link:** `[SUBMITTED_VIA_GOOGLE_FORM]` *(Loom / Drive link)*
- **Demo Video Master Script:** [`docs/phase-8/demo-video-master-script.md`](docs/phase-8/demo-video-master-script.md)
- **Live Architecture Drawing Guide:** [`docs/phase-8/demo-architecture-drawing-guide.md`](docs/phase-8/demo-architecture-drawing-guide.md)
- **Screen-by-Screen Recording Cue Sheet:** [`docs/phase-8/demo-video-recording-cue-sheet.md`](docs/phase-8/demo-video-recording-cue-sheet.md)
- **Round 2 Interview Preparation (22 Q&As):** [`docs/phase-8/demo-interview-preparation.md`](docs/phase-8/demo-interview-preparation.md)

---

## 🏛 Architecture At A Glance

The platform enforces **Perimeter Isolation via Dual Listeners** ([ADR-020](docs/decisions/ADR-020-dual-listener-and-ingress-perimeter.md)). A single `urumi-gateway` Node.js process binds two distinct HTTP sockets:
- **Port 3001 (Browser Listener):** Serves the compiled React 19 SPA and browser session REST APIs (`/api/v1/browser/*`). Authenticated via Scrypt-hashed passwords, opaque 256-bit session cookies, and dual CSRF/Origin validation.
- **Port 3000 (MCP & Admin Listener):** Serves the Model Context Protocol over Streamable HTTP (`/mcp`) using constant-time SHA-256 Bearer API keys (`urumi_live_*`), and hosts private admin APIs (`/admin/v1/*`).

```
Downstream Clients (User A Browser / User B MCP Inspector)
                         │
                         ▼ Ingress (:8080 / :8443)
┌────────────────────────────────────────────────────────────────────────┐
│ Kubernetes Cluster (k3d / K3s: namespace urumi)                        │
│                                                                        │
│   Traefik Ingress:                                                     │
│   • shop.127.0.0.1.nip.io:8080      ──> urumi-wordpress:80 (Store)     │
│   • dashboard.127.0.0.1.nip.io:8080 ──> urumi-gateway:3001 (Port 3001) │
│   • dashboard...nip.io:8080/mcp     ──> urumi-gateway:3000 (Port 3000) │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ urumi-gateway Pod (Single Replica Deployment)                  │   │
│   │                                                                │   │
│   │   [Port 3001] Browser Listener (React 19 SPA + Session API)    │   │
│   │   [Port 3000] MCP Listener (Streamable HTTP /mcp + /admin/v1)  │   │
│   │                                                                │   │
│   │   Gateway Core Engine:                                         │   │
│   │   • ToolRouter (20 Global / 4 Upstream Concurrency Pool)       │   │
│   │   • Dynamic CatalogService ({server}__{tool} Namespacing)      │   │
│   │   • Bounded Agent Loop (5 Iterations, 30s Deadline, 64KB Cap)  │   │
│   │   • Confirmation Engine (HMAC-SHA256 Token, 60s TTL)           │   │
│   │   • Two-Phase Audit Interceptor (Duration, SHA-256 Args Hash)  │   │
│   │                                                                │   │
│   │   Persistent Volume: /data/gateway.db                          │   │
│   │   (Node.js 24 node:sqlite in WAL mode on 500 MiB PVC)          │   │
│   └───────────────┬────────────────────────────┬───────────────────┘   │
│                   │ ClusterIP (:3000)          │ ClusterIP (:3000)     │
│                   ▼                            ▼                       │
│   ┌───────────────────────────────┐    ┌───────────────────────────┐   │
│   │ urumi-woocommerce-mcp (:3000) │    │ CRM & Tasks MCP (:3000)   │   │
│   │ • Custom TypeScript Server    │    │ • urumi-mcp-crm (2 tools) │   │
│   │ • 5 Approved Tools            │    │ • urumi-mcp-tasks (3 tools│   │
│   │ • readOnlyRootFilesystem      │    │ • No ServiceAccount token │   │
│   └───────────────┬───────────────┘    └───────────────────────────┘   │
│                   │ OAuth 1.0a HMAC-SHA256 (:80)                       │
│                   ▼                                                    │
│   ┌───────────────────────────────┐                                    │
│   │ urumi-wordpress Pod (:80)     │  NetworkPolicy Isolation:          │
│   │ + MariaDB StatefulSet (:3306) │  Gateway cannot connect directly   │
│   │ (Stateful PVCs: 1GiB + 1GiB)  │  to WordPress (80) or MariaDB(3306)│
│   └───────────────────────────────┘                                    │
└────────────────────────────────────────────────────────────────────────┘
```

For complete architecture diagrams, data models, and decision logs, see [`docs/architecture.md`](docs/architecture.md) and [`docs/decisions/`](docs/decisions/).

---

## 📦 Monorepo Structure

The project is structured as an npm monorepo with pinned **Node.js 24 LTS (`v24.20.0`)** and strict TypeScript:

```
urumi-platform/
├── apps/
│   ├── dashboard/            # React 19 + Vite 6 Dashboard SPA (dark glassmorphic UI)
│   ├── gateway/              # Central Team MCP Gateway, dual HTTP listeners & agent engine
│   ├── woocommerce-mcp/      # Custom TypeScript MCP server with RFC 5849 OAuth 1.0a signer
│   ├── mcp-crm/              # Synthetic CRM upstream microservice (search_contacts, get_contact)
│   └── mcp-tasks/            # In-memory Tasks upstream microservice (list/create/update tasks)
├── packages/
│   └── shared/               # Shared TypeScript schemas, DTOs, and type definitions
├── infra/
│   └── helm/
│       └── urumi-platform/   # Unified Helm chart deploying all 6 workloads
│           ├── values-local.yaml  # Local k3d configuration (nip.io, port 8080, HTTP)
│           ├── values-prod.yaml   # Production VPS configuration (TLS, Let's Encrypt, Port 443)
│           └── templates/         # Deployments, StatefulSet, Services, Ingress, NetworkPolicies
├── docs/                     # Comprehensive architecture, ADRs, test plans, and phase reports
│   ├── architecture.md       # Detailed 4-layer system design and storage models
│   ├── requirements-traceability.md # Granular requirements traceability matrix (Categories A–H)
│   ├── decisions/            # 21 Architecture Decision Records (ADRs 001–021)
│   ├── phase-6/              # Phase 6 AI agent and external MCP acceptance reports
│   ├── phase-7/              # Phase 7 hardening, recovery, and regression reports
│   └── phase-8/              # Final demo scripts, cue sheets, drawing guides, and interview prep
├── scripts/                  # Automated store provisioning and verification scripts
├── package.json              # npm workspaces root
└── tsconfig.base.json        # Base TypeScript compiler configuration
```

---

## 🚀 Local Setup Instructions (k3d / K3s)

### 1. Prerequisites
Ensure the following tools are installed on your host system:
- **Node.js**: `v24.x` (enforced via `.nvmrc`)
- **Docker**: Engine 20.10+
- **kubectl**: `v1.30+`
- **helm**: `v3.14+`
- **k3d**: `v5.x`

Switch to Node 24:
```bash
nvm use || nvm install 24
```

### 2. Install Dependencies & Build Packages
```bash
npm ci
npm run build
```

### 3. Provision the Local Kubernetes Cluster
Create the `k3d-urumi` cluster pinning K3s to match client tools with port mappings for Traefik Ingress:
```bash
k3d cluster create urumi \
  --image rancher/k3s:v1.37.1-k3s1 \
  --port "8080:80@loadbalancer" \
  --port "8443:443@loadbalancer" \
  --timeout 180s
```

### 4. Create Secrets & Namespace
Generate secure credentials into a gitignored, mode-0600 file and apply the Kubernetes Secrets:
```bash
mkdir -p .secrets && chmod 700 .secrets
cat <<EOF > .secrets/phase2-store.env
mariadb-root-password=$(openssl rand -hex 16)
mariadb-password=$(openssl rand -hex 16)
EOF
chmod 600 .secrets/phase2-store.env

kubectl --context k3d-urumi create namespace urumi --dry-run=client -o yaml | kubectl apply -f -
kubectl --context k3d-urumi -n urumi create secret generic urumi-store-secrets \
  --from-env-file=.secrets/phase2-store.env --dry-run=client -o yaml | kubectl apply -f -
```

*(Optional for live AI chat)*: If you want to use the live Gemini chat provider, add your API key:
```bash
echo "GEMINI_API_KEY=your_actual_key_here" > .secrets/gemini.env
kubectl --context k3d-urumi -n urumi create secret generic urumi-gemini-secret \
  --from-env-file=.secrets/gemini.env --dry-run=client -o yaml | kubectl apply -f -
```
*(If omitted, the platform runs in hermetic test mode with full mock provider capabilities).*

### 5. Deploy Unified Helm Chart
Deploy the entire platform (WordPress, MariaDB, Gateway, WooCommerce MCP, CRM MCP, Tasks MCP, PVCs, Ingress, and NetworkPolicies) with a single command:
```bash
helm --kube-context k3d-urumi upgrade --install urumi-store \
  infra/helm/urumi-platform \
  --namespace urumi \
  --create-namespace \
  -f infra/helm/urumi-platform/values-local.yaml

# Wait for workloads to reach 1/1 Ready
kubectl --context k3d-urumi -n urumi rollout status statefulset/urumi-mariadb
kubectl --context k3d-urumi -n urumi rollout status deployment/urumi-wordpress
kubectl --context k3d-urumi -n urumi rollout status deployment/urumi-gateway
```

### 6. Bootstrap the Store
Initialize WooCommerce permalinks, currency (INR `₹`), COD gateway, Flat Rate shipping, initial products, and internal API credentials:
```bash
./scripts/bootstrap-store.sh
```

### 7. Bootstrap the Administrator Account
Initialize the gateway SQLite database with the default administrator:
```bash
npm --prefix apps/gateway run bootstrap:admin
```
*(Displays default credentials and confirmation that the admin user was seeded into `/data/gateway.db`).*

---

## 🌐 Production / VPS Deployment Guide (K3s)

The platform is designed for zero-drift transition to a production-like VPS running K3s using the **exact same Helm templates**, modified solely via [`infra/helm/urumi-platform/values-prod.yaml`](infra/helm/urumi-platform/values-prod.yaml).

### 1. What Changes in Production (`values-prod.yaml`)
| Configuration Domain | Local (`values-local.yaml`) | Production (`values-prod.yaml`) |
|:---|:---|:---|
| **Domains / DNS** | `*.127.0.0.1.nip.io` | Real registered domains (e.g. `shop.example.com`, `mcp.example.com`) |
| **Ingress & Ports** | Host Port 8080 (HTTP) | Standard Ports 80 & 443 (HTTP $\rightarrow$ HTTPS redirect) |
| **TLS Certificates** | Disabled (`tls.enabled: false`) | Enabled via Let's Encrypt / cert-manager ClusterIssuer |
| **Storage Class** | `local-path` | `local-path` (single node) or cloud provisioner (`gp3`, `standard-rwo`) |
| **Security Context** | Developer testing rules enabled | Strict read-only root filesystems, non-root execution, zero test pods |
| **NetworkPolicies** | Allows local test-client probe pods | Strips all test-client ingress rules; enforces strict pod-label matching |

### 2. Deploy to a VPS running K3s
On a standard Debian/Ubuntu VPS with K3s and cert-manager installed:

```bash
# 1. Point kubectl to your VPS cluster
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 2. Deploy using production values
helm upgrade --install urumi-store infra/helm/urumi-platform \
  --namespace urumi \
  --create-namespace \
  -f infra/helm/urumi-platform/values-prod.yaml \
  --set store.domain="shop.yourdomain.com" \
  --set gateway.domain="mcp.yourdomain.com"

# 3. Verify TLS certificate issuance
kubectl get certificates -n urumi
```

### 3. Upgrades and Rollbacks with Helm
- **Safe Rolling Upgrade**:
  ```bash
  helm upgrade urumi-store infra/helm/urumi-platform -n urumi -f infra/helm/urumi-platform/values-prod.yaml
  ```
- **Instant Rollback**: If an upgrade fails health checks:
  ```bash
  helm history urumi-store -n urumi
  helm rollback urumi-store <PREVIOUS_REVISION> -n urumi
  ```

---

## 🛠 User & Verification Workflows

### 1. Storefront Checkout (Cash on Delivery)
1. Open the storefront in your browser: [http://shop.127.0.0.1.nip.io:8080/](http://shop.127.0.0.1.nip.io:8080/)
2. Browse products at `/shop/` (contains seeded items: *Urumi Test Mug* [ID 10], *Wireless Mouse Demo* [ID 11], *Notebook Demo* [ID 12]).
3. Add any item to the cart and proceed to `/checkout/`.
4. Enter test billing details, select **Cash on delivery (COD)**, and click **Place Order**.
5. The order confirms immediately. In WordPress Admin (`/wp-admin/edit.php?post_type=shop_order`), the order is visible as `processing` (verified baseline Order #14 for ₹299.00).

---

### 2. In-Dashboard AI Assistant & Confirmation Engine
1. Navigate to the Dashboard: [http://dashboard.127.0.0.1.nip.io:8080/](http://dashboard.127.0.0.1.nip.io:8080/)
2. Sign in as `admin` (or a member user created via **Team Members** tab).
3. Click on the **AI MCP Assistant** tab in the sidebar.
4. **Natural-Language Read-Only Query**:
   - Ask: *"What products are currently available in our WooCommerce store? Please list their names, prices, and stock status."*
   - Observe real-time execution feedback:
     - Tool execution badge: `woocommerce__list_products` (green `success` pill with duration in ms).
     - Expand the badge to inspect canonical arguments (`per_page: 10`) and clean JSON results.
     - Synthesized response summarizes the three store items.
5. **State Mutation with Server-Side Confirmation**:
   - Ask: *"Please create a high-priority task titled 'Warehouse restock audit' assigned to contact CRM-CONT-001 with status in_progress."*
   - Execution suspends immediately. The gateway mints an HMAC-SHA256 confirmation token (60s TTL).
   - An interactive confirmation card appears in the chat showing tool name, arguments, and a countdown timer.
   - Click **Confirm & Execute**: the browser submits the token, the gateway verifies the signature and session actor, and creates the task (`TASK-002`).
6. **Protected Baseline Records Safeguard**:
   - Ask: *"Please change the status of Order 14 to cancelled."*
   - The gateway's safeguard intercepts the request and hard-blocks execution with `MUTATION_TARGET_PROTECTED`. Order #14 remains untouched.
7. **Audit Trail Verification**:
   - Click on the **Audit Trail Ledger** tab in the sidebar.
   - Verify that all preceding chat tool executions are permanently recorded with caller `user_id`, tool name, execution duration, and deterministic SHA-256 argument hash.

---

### 3. External MCP Client & Instant Revocation
1. Navigate to the **Team API Keys** tab in the Dashboard.
2. Click **Generate New Key**, enter name `demo-evaluator-key`, and copy the raw key (`urumi_live_...`).
3. **Connect via Streamable HTTP (Terminal / Inspector)**:
   Connect any official MCP client or send a JSON-RPC request over curl:
   ```bash
   # Discover tools across all 3 upstreams
   curl -s -H "Host: dashboard.127.0.0.1.nip.io" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer <PASTE_KEY>" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
     http://127.0.0.1:8080/mcp | jq '.result.tools[].name'
   ```
   **Output**: Exactly 10 tools returned (`crm__*`, `tasks__*`, `woocommerce__*`).

4. **Query Orders without Customer PII**:
   ```bash
   curl -s -H "Host: dashboard.127.0.0.1.nip.io" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer <PASTE_KEY>" \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"woocommerce__list_orders","arguments":{"per_page":5}}}' \
     http://127.0.0.1:8080/mcp | jq .
   ```
   **Output**: Returns Order #14 with total `299.00` and line item `Urumi Test Mug`, but with billing addresses, shipping addresses, customer emails, and phone numbers strictly omitted.

5. **Cross-Server Multi-Turn Workflow**:
   When an external AI client submits the prompt:  
   *"Who is the procurement contact for Acme Retail Ltd in our CRM, and what pending or in-progress tasks are assigned to them?"*  
   The model autonomously calls `crm__search_contacts` (Turn 1), resolves contact `CRM-CONT-001` (Alice Smith), calls `tasks__list_tasks` (Turn 2), and synthesizes both responses into a unified answer.

6. **Instant Fail-Closed Key Revocation**:
   - Return to the Dashboard **Team API Keys** tab and click **Revoke** on `demo-evaluator-key`.
   - Re-run the exact same curl command in your terminal.
   - **Output**: Immediate rejection with `HTTP/1.1 401 Unauthorized: {"error":"Unauthorized: Invalid or revoked API key"}`.

---

## 📐 System Design & Trade-Offs Note

### 1. Architecture Choices
- **Node.js 24 LTS & Embedded SQLite WAL Mode ([ADR-012](docs/decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md)):**  
  We chose Node 24 standard library `node:sqlite` in WAL mode on a dedicated PVC rather than hosting an external PostgreSQL cluster. This eliminated database pod bloat, avoided network hops for authentication lookups, provided sub-millisecond query latency, and guaranteed atomic transactions.  
  *Trade-off*: SQLite requires a single writer. The gateway runs a single replica with `strategy: { type: Recreate }`. If the pod is rescheduled, failover takes approximately 30 seconds (tested at 31s in Gate P7-G3). For high-availability multi-replica scaling, the persistence layer would migrate to LiteFS or PostgreSQL.
- **Perimeter Isolation via Dual Listeners ([ADR-020](docs/decisions/ADR-020-dual-listener-and-ingress-perimeter.md)):**  
  Binding Port 3001 for browser sessions and Port 3000 for machine MCP Streamable HTTP ensures ambient browser cookies can never bleed into MCP routes, and private administrative endpoints (`/admin/v1/*`) are unreachable from public Ingress.
- **In-Cluster OAuth 1.0a HMAC-SHA256 ([ADR-007](docs/decisions/ADR-007-in-cluster-rest-api-authentication.md)):**  
  WooCommerce MCP signs every REST API call to WordPress using RFC 5849 OAuth 1.0a signatures. The consumer secret is used solely to generate HMAC signatures and is never sent over the cluster network.

### 2. Tool Aggregation, Namespacing & Failure Handling
- **Dynamic Namespacing ({server}__{tool}) ([ADR-016](docs/decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md)):**  
  Every discovered tool is prefixed with its owning upstream slug (e.g. `woocommerce__list_orders`). This completely eliminates naming collisions across independent microservices.
- **Hierarchical Concurrency & Backpressure ([ADR-015](docs/decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md)):**  
  A global ceiling of 20 concurrent requests prevents event-loop starvation, while a per-upstream ceiling of 4 active requests with a queue depth of 10 prevents overwhelming upstream PHP-FPM or database workers. Excess traffic fails fast with HTTP 429.
- **Failure Isolation & Circuit Breakers:**  
  Every upstream call is bounded by an `AbortController` timeout (default 10s). If an upstream fails repeatedly, its `CircuitBreaker` trips to `OPEN`, immediately returning clear errors without hanging gateway threads. Healthy upstreams continue operating with zero degradation.

### 3. Production Changes (Local vs VPS)
- **DNS**: `127.0.0.1.nip.io` wildcard DNS is replaced with static A/AAAA records pointing to the VPS public IP.
- **Ingress & TLS**: Traefik ingress enables cert-manager Let's Encrypt production certificates on port 443 with automatic HTTP $\rightarrow$ HTTPS redirection.
- **Storage Class**: `local-path` is replaced with cloud persistent block storage (e.g. `gp3`, `standard-rwo`) if deploying to managed cloud Kubernetes.
- **Secrets**: Plaintext `.env` files are prohibited; credentials are provided via sealed secrets, external secret operators (Vault / AWS Secrets Manager), or CI/CD injection.

---

## 🛡 Threat Model Note

### 1. Shared Upstream Credentials
- **Risk**: Upstream credentials (e.g. WordPress consumer keys, bearer tokens) are shared across the team.
- **Mitigation**: Downstream team members authenticate strictly with their own unique API keys or browser sessions. Upstream credentials are held in Kubernetes Secrets in the isolated namespace `urumi-gateway-secrets`, accessible solely by the gateway pod ServiceAccount. Downstream clients never see, provide, or configure upstream secrets.

### 2. Why Client Tokens Are Not Passed Through to Upstream Servers
- **Risk**: Passing client bearer tokens upstream exposes user identity credentials to untrusted or compromised microservices and violates token audience boundaries.
- **Mitigation**: The gateway terminates client authentication at the perimeter. It enforces authorization, verifies that the user is active, audits the request, and dispatches the tool call using internal, scoped upstream credentials. Upstream services have zero visibility into client API keys.

### 3. Untrusted Upstreams & Prompt Injection
- **Risk**: A compromised upstream server could return malicious tool outputs or craft tool descriptions designed to manipulate the LLM into bypassing safety policies (indirect prompt injection).
- **Mitigation**:
  1. The gateway bounds all tool outputs to a maximum of **64 KiB**, truncating oversized payloads.
  2. Tool results are enclosed in structured markdown code fences with a strict security notice instructing the model never to interpret tool output as system instructions.
  3. All state mutations require an explicit cryptographic confirmation token (HMAC-SHA256, 60s TTL) signed by the server, preventing autonomous unauthorized changes.
  4. Baseline records (Order #14 and Product IDs 10–12) are hard-blocked at the engine level.

### 4. What One Team Member Can Do to Another
- **Risk**: A malicious or compromised member account attempting to access other users' audit logs, impersonate members, or manipulate upstreams (IDOR / privilege escalation).
- **Mitigation**:
  1. **Strict RBAC Separation**: Members are restricted to tool execution and managing their own API keys. Any attempt by a member to access `/api/v1/browser/members`, `/audit`, or `/upstreams` returns HTTP 403 Forbidden.
  2. **IDOR Defense on Confirmation Tokens**: Confirmation tokens encode the initiating `userId`. If User B attempts to redeem a confirmation token generated for User A, the gateway rejects the request with `CONFIRMATION_ACTOR_MISMATCH`.
  3. **Immediate Account Deactivation**: Deactivating a user account immediately invalidates all active browser sessions and revokes all issued API keys fail-closed.

---

## 🌟 Stand-Out Differentiators Implemented

| # | Differentiator | Implementation & Evidence Reference |
|:---:|:---|:---|
| **1** | **Production-Like VPS Parity** | Pinned K3s engine, unified Helm chart, zero-drift values separation (`values-local.yaml` vs `values-prod.yaml`), Let's Encrypt TLS annotations. ([ADR-001](docs/decisions/ADR-001-stack-and-deployment.md)) |
| **2** | **Dual-Listener Perimeter Isolation** | Physical separation of Browser Listener (Port 3001) and MCP Protocol Listener (Port 3000). Private Admin API (`/admin/v1/*`) completely hidden from public Ingress (returns 404). ([ADR-020](docs/decisions/ADR-020-dual-listener-and-ingress-perimeter.md)) |
| **3** | **Runtime Container Hardening** | `readOnlyRootFilesystem: true` on WooCommerce MCP with writable `/tmp` `emptyDir`; `automountServiceAccountToken: false` on CRM and Tasks MCP; non-root user execution. ([Gate P7-G2 Report](docs/phase-7/p7-g2-deployment-and-runtime-verification-report.md)) |
| **4** | **In-Cluster OAuth 1.0a HMAC-SHA256** | Custom RFC 5849 OAuth 1.0a signer for WooCommerce REST API. Consumer secrets are never sent over the wire. Zero third-party npm wrappers. ([ADR-007](docs/decisions/ADR-007-in-cluster-rest-api-authentication.md)) |
| **5** | **Two-Phase Cryptographic Audit Logging** | Start and completion lifecycle logging with exact millisecond duration and deterministic SHA-256 argument fingerprints. Zero plaintext customer PII or credentials persisted. ([ADR-014](docs/decisions/ADR-014-two-phase-audit-logging-and-retention.md)) |
| **6** | **Server-Side Mutation Confirmation Engine** | HMAC-SHA256 signed confirmation tokens with 60s TTL and single-use nonce for state mutations. Hard-blocked immutable protection for Order #14 and Product IDs 10–12. Approved disposable demo fixture exemption. ([ADR-021](docs/decisions/ADR-021-in-dashboard-chat-agent-and-mutation-confirmation.md)) |
| **7** | **Strict NetworkPolicy Defense-in-Depth** | K3s `kube-router` default-deny egress policies blocking gateway access to WordPress (80) and MariaDB (3306). Workload ingress restricted to authorized component labels. ([Gate P7-G4 Report](docs/phase-7/p7-g4-networkpolicy-boundary-verification-report.md)) |
| **8** | **Single-Replica Recovery Verification** | Graceful pod deletion recovers to `1/1 Ready` in 31 seconds. SQLite WAL database verified with `PRAGMA integrity_check` returning `ok`, 0 foreign key violations, and 0 data drift. ([Gate P7-G3 Report](docs/phase-7/p7-g3-pod-replacement-recovery-report.md)) |

---

## 🧪 Automated Testing & Verification Baseline

The repository enforces a comprehensive test suite across unit, protocol, and integration layers using Node 24's native `node:test` runner:

| Monorepo Package | Test Suite Category | Test Count | Pass Rate | Execution Duration |
|:---|:---|:---:|:---:|:---:|
| **`apps/gateway`** | Unit Tests (Crypto, Sessions, CSRF, Router, Limiters) | 351 | **100%** (351/351) | ~16.5 s |
| **`apps/gateway`** | Protocol Tests (Streamable HTTP, Perimeter, Auth) | 62 | **100%** (62/62) | ~18.2 s |
| **`apps/gateway`** | Local Integration & Concurrency Stress | 8 | **100%** (8/8) | ~1.8 s |
| **`apps/woocommerce-mcp`** | Unit Tests (OAuth 1.0a Signer, Parameter Validation) | 17 | **100%** (17/17) | ~0.2 s |
| **`apps/woocommerce-mcp`** | Protocol Tests (MCP Wire Compliance, PII Redaction) | 35 | **100%** (35/35) | ~0.4 s |
| **`apps/mcp-crm`** | Unit & Protocol Tests (Contact Search, Synthetic Seed) | 26 | **100%** (26/26) | ~0.3 s |
| **`apps/mcp-tasks`** | Unit & Protocol Tests (Task Store, In-Memory Seed) | 35 | **100%** (35/35) | ~0.3 s |
| **Total Automated Tests** | **Full Monorepo Regression Suite** | **534** | **100%** (534/534) | **< 40 s** |

### Run Automated Tests
```bash
# Run all 534 automated tests across all workspaces
npm test

# Run isolated package suites
npm run test:unit --workspace=apps/woocommerce-mcp
npm run test:protocol --workspace=apps/gateway
```

### Build & Typecheck Cleanliness
```bash
# Verify TypeScript compilation across all workspaces
npm run build

# Lint Helm charts for local and production profiles
helm lint infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml
helm lint infra/helm/urumi-platform -f infra/helm/urumi-platform/values-prod.yaml
```

---

## 📚 Phase Documentation Index

- **Phase 8 (Final Demonstration & Evaluation Package)**:
  - [**demo-video-master-script.md**](docs/phase-8/demo-video-master-script.md): Full word-for-word spoken script with exact screen cues across all 12 sections.
  - [**demo-architecture-drawing-guide.md**](docs/phase-8/demo-architecture-drawing-guide.md): 13-step draw.io live drawing sequence, Mermaid blueprints, and request traces.
  - [**demo-video-recording-cue-sheet.md**](docs/phase-8/demo-video-recording-cue-sheet.md): Compact presenter cheat sheet mapping time codes, actions, and evidence.
  - [**demo-video-preflight-checklist.md**](docs/phase-8/demo-video-preflight-checklist.md): 15-point verification checklist and rapid recovery runbooks.
  - [**demo-interview-preparation.md**](docs/phase-8/demo-interview-preparation.md): 22 deep-dive technical interview questions and answers for Round 2.
- **Phase 7 (Hardening, Resilience & Qualification)**:
  - [**p7-g2-deployment-and-runtime-verification-report.md**](docs/phase-7/p7-g2-deployment-and-runtime-verification-report.md): Read-only rootfs, `/tmp` emptyDir, and token isolation.
  - [**p7-g3-pod-replacement-recovery-report.md**](docs/phase-7/p7-g3-pod-replacement-recovery-report.md): Single-replica pod replacement recovery and SQLite persistence verification.
  - [**p7-g4-networkpolicy-boundary-verification-report.md**](docs/phase-7/p7-g4-networkpolicy-boundary-verification-report.md): Empirical proof of allowed and denied network paths.
  - [**p7-g5-regression-qualification-report.md**](docs/phase-7/p7-g5-regression-qualification-report.md): 534/534 automated regression qualification.
  - [**p7-g6-final-acceptance-and-handoff-report.md**](docs/phase-7/p7-g6-final-acceptance-and-handoff-report.md): Phase 7 formal handoff and acceptance matrix.
- **Phase 6 (AI Agent Loop & External MCP Client)**:
  - [**p6-demo-runbook.md**](docs/phase-6/p6-demo-runbook.md): Repeatable 10-step evaluator demonstration protocol.
  - [**p6-g4-external-mcp-acceptance-report.md**](docs/phase-6/p6-g4-external-mcp-acceptance-report.md): Official MCP client acceptance and cross-server workflow.
  - [**p6-operational-and-user-guide.md**](docs/phase-6/p6-operational-and-user-guide.md): Comprehensive platform operations guide.
- **Historical Technical Context & Development Manuals**:
  - [**GLOBAL_README.md**](GLOBAL_README.md): Historical monorepo development milestone ledger (Phases 1–6).
  - [**documentation/phase 5/Project Study Material.md**](documentation/phase%205/Project%20Study%20Material.md): Deep-dive educational textbook explaining Scrypt, CSRF, and dual listeners.

---

*Submitted for Round 1 Technical Evaluation — Urumi AI FDE Internship.*
