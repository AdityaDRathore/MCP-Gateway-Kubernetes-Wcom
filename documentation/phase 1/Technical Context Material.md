# Urumi Platform — Phase 1 Technical Context Material
## System Architecture, Repository Inventory, Technical Breakdown & Reproduction Guide

> **Project**: Team MCP Gateway on Kubernetes with WooCommerce  
> **Phase**: Phase 1 (Foundation, Technical Validation & Scaffolding)  
> **Repository**: [MCP-Gateway-Kubernetes-Wcom](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom)  
> **Target Runtime**: Node.js 24 LTS (`v24.20.0`) on Ubuntu 24.04 LTS (x86_64)  
> **Last Updated**: October 2026  

---

## 1. Executive Summary & Purpose

This document provides the **authoritative technical reference** for the current state of the Urumi Platform codebase at the completion of Phase 1. 

While the companion document [Project Study Material.md](Project%20Study%20Material.md) focuses on conceptual explanations and learning fundamentals, this document is an **exact technical breakdown** containing:
- Complete file and directory inventory.
- Exact commands and scripts to reproduce the environment from a fresh clone.
- Architectural network maps, port allocations, and socket bindings.
- Detailed implementation specifications for the MCP Streamable HTTP protocol spike and Helm packaging scaffold.
- Complete execution logs and verification evidence.

---

## 2. Repository Layout & File Inventory

```
MCP-Gateway-Kubernetes-Wcom/
├── .env.example                                  # Master environment variable template for local development
├── .gitignore                                    # Ignores node_modules, build artifacts, .env (lockfile unignored)
├── .nvmrc                                        # Pins Node.js version to 24 (v24.20.0)
├── package.json                                  # Monorepo root manifest with npm workspaces (apps/*, packages/*)
├── package-lock.json                             # Pinned root dependency tree
├── tsconfig.base.json                            # Base TypeScript compiler options extended by all packages
├── README.md                                     # Public project README with quickstart and architecture summary
├── packages/
│   └── shared/                                   # Shared TypeScript package (@urumi/shared)
│       ├── package.json                          # Package manifest for @urumi/shared
│       ├── tsconfig.json                         # Extends tsconfig.base.json
│       ├── src/
│       │   └── index.ts                          # Shared interfaces (Audit logs, tool schemas, user roles)
│       └── dist/                                 # Compiled TypeScript outputs (.js, .d.ts, .map)
├── spikes/
│   └── mcp-echo/                                 # Standalone MCP Streamable HTTP protocol spike
│       ├── .env.example                          # Spike-specific environment variable template
│       ├── package.json                          # Pinned dependencies (@modelcontextprotocol/sdk@1.32.1)
│       ├── package-lock.json                     # Pinned lockfile for the standalone spike
│       ├── tsconfig.json                         # TypeScript configuration for the spike
│       ├── src/
│       │   ├── server.ts                         # Streamable HTTP MCP server with dynamic Bearer auth
│       │   └── test-client.ts                    # Automated 4-stage test verification suite
│       └── dist/                                 # Compiled JavaScript output
├── infra/
│   └── helm/
│       └── urumi-platform/                       # Unified Kubernetes Helm chart
│           ├── Chart.yaml                        # Helm chart metadata (v1.0.0)
│           ├── values.yaml                       # Baseline default values across all components
│           ├── values-local.yaml                 # Local k3d cluster profile (nip.io, port 8080)
│           ├── values-prod.yaml                  # Production VPS profile (port 443, replicas: 1)
│           └── templates/
│               ├── _helpers.tpl                  # Standard Kubernetes template macros and labels
│               └── configmap.yaml                # Verified scaffold ConfigMap template
├── docs/
│   ├── architecture.md                           # System architecture, 4 layers, and storage failure model
│   ├── requirements-traceability.md              # 27-item granular requirements matrix and DoD test plan
│   ├── decisions/                                # Architecture Decision Records (ADRs)
│   │   ├── ADR-001-stack-and-deployment.md       # Stack, Node 24 LTS, k3d, and SQLite on PVC
│   │   ├── ADR-002-mcp-compatibility.md          # SDK 1.32.1, Streamable HTTP, wire revision 2024-11-05
│   │   └── ADR-003-secrets-and-access.md         # Key hashing, K8s Secrets, RBAC, and LLM costs
│   └── phase-1/
│       ├── environment-audit.md                  # Unvarnished host hardware, socket, and runtime audit
│       └── phase-1-completion-report.md          # Formal Phase 1 verification audit & sign-off
└── documentation/
    └── phase 1/
        ├── Project Study Material.md             # Conceptual learning handbook & interview study guide
        └── Technical Context Material.md         # This document: Technical architecture & reproduction guide
```

---

## 3. Step-by-Step Guide to Reproduce on Any System

Follow these exact steps to verify the project from a fresh clone.

### Step 3.1: Prerequisites Installation
The project requires the following host toolchain:
- **Git**: 2.34+
- **Docker Engine**: 20.10+ (daemon must be running)
- **Node.js Version Manager (NVM)**:
  ```bash
  # Install or activate Node 24 LTS
  nvm install 24
  nvm use 24
  node -v    # Expected: v24.20.0
  npm -v     # Expected: 11.19.0
  ```
- **Local Kubernetes Binaries** (Installed in `~/.local/bin` without root):
  ```bash
  export PATH="$HOME/.local/bin:$PATH"

  # kubectl v1.37.1
  curl -Lo ~/.local/bin/kubectl "https://dl.k8s.io/release/v1.37.1/bin/linux/amd64/kubectl"
  chmod +x ~/.local/bin/kubectl

  # helm v3.17.1
  curl -Lo /tmp/helm.tar.gz "https://get.helm.sh/helm-v3.17.1-linux-amd64.tar.gz"
  tar -zxvf /tmp/helm.tar.gz -C /tmp/ && mv /tmp/linux-amd64/helm ~/.local/bin/helm
  chmod +x ~/.local/bin/helm && rm -rf /tmp/helm.tar.gz /tmp/linux-amd64

  # k3d v5.8.3
  curl -Lo ~/.local/bin/k3d "https://github.com/k3d-io/k3d/releases/download/v5.8.3/k3d-linux-amd64"
  chmod +x ~/.local/bin/k3d
  ```

### Step 3.2: Root Workspace Installation & Compilation
```bash
# Clone the repository
git clone https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom.git
cd MCP-Gateway-Kubernetes-Wcom

# Ensure Node 24 is active
nvm use

# Clean install from committed root lockfile and build shared workspaces
npm ci
npm run build
```
*Expected Result*: Compiles `packages/shared/src/index.ts` using `tsc`, outputting declaration files to `packages/shared/dist/`.

### Step 3.3: Execute the MCP Streamable HTTP Protocol Spike
```bash
cd spikes/mcp-echo

# Install pinned dependencies from the spike's lockfile
npm ci
npm run build

# Generate a dynamic test secret and launch the server in the background
export MCP_SPIKE_API_KEY="test-key-$(date +%s)"
export PORT=7788
export HOST="127.0.0.1"

node dist/server.js &
SERVER_PID=$!

# Run the automated 4-stage test client against the live server
export MCP_SERVER_URL="http://127.0.0.1:7788/mcp"
export MCP_SPIKE_API_KEY="$MCP_SPIKE_API_KEY"

node dist/test-client.js
TEST_EXIT=$?

# Terminate background server process
kill $SERVER_PID

echo "Spike test exit code: $TEST_EXIT"
```
*Expected Result*: All 4 test stages pass (401 rejection for missing & invalid keys, Streamable HTTP handshake, tool discovery, and tool execution).

### Step 3.4: Validate Helm Chart Scaffold
```bash
cd ../../
export PATH="$HOME/.local/bin:$PATH"

# Lint the Helm chart
helm lint infra/helm/urumi-platform
# Expected: 1 chart(s) linted, 0 chart(s) failed

# Render manifests for local k3d environment (nip.io, port 8080)
helm template test-local infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml

# Render manifests for production VPS environment (port 443, replicas: 1)
helm template test-prod infra/helm/urumi-platform -f infra/helm/urumi-platform/values-prod.yaml
```

---

## 4. Technical Architecture Breakdown

### 4.1 System Overview
The platform connects AI reasoning agents to stateful Kubernetes applications through a secure, four-layer architecture:

```
+-------------------------------------------------------------------------+
| Layer 1: Downstream Clients                                             |
|  - User A: React Dashboard Chat Agent (in-browser)                      |
|  - User B: External MCP Client (MCP Inspector / Claude Code CLI)        |
+-------------------------------------------------------------------------+
                                    |
                                    | HTTP Ingress (:8080)
                                    v
+-------------------------------------------------------------------------+
| Layer 2: Kubernetes Ingress & Control Plane                             |
|  - Ingress Controller: Traefik (k3d built-in load balancer)             |
|  - Store Domain: http://shop.127.0.0.1.nip.io:8080                      |
|  - Dashboard/Gateway Domain: http://dashboard.127.0.0.1.nip.io:8080     |
+-------------------------------------------------------------------------+
                                    |
                  +-----------------+-----------------+
                  |                                   |
                  v                                   v
+-----------------------------------+   +---------------------------------+
| Layer 3: Team MCP Gateway Core    |   | Layer 4: Stateful Store Workload|
|  - Dual MCP Proxy Engine          |   |  - WordPress 6.7 + WooCommerce  |
|  - User Auth (SHA-256 Key Hashes) |   |    (PVC: 1 GiB /var/www/html)   |
|  - Tool Namespacing (server__tool)|   |  - MariaDB 11.4 Database        |
|  - Timeouts & Failure Isolation   |   |    (PVC: 1 GiB /var/lib/mysql)  |
|  - SQLite WAL on PVC (/data)      |   +---------------------------------+
+-----------------------------------+                    ^
                  |                                      |
                  | ClusterIP (Internal DNS)             |
                  v                                      |
+-----------------------------------+                    |
| Internal Upstream MCP Servers     |                    |
|  - WooCommerce MCP Server (Custom)| -------------------+
|  - CRM MCP Server (Mock Seed)     |   (Internal WP-REST API Calls)
|  - Tasks MCP Server (Mock Seed)   |
+-----------------------------------+
```

### 4.2 Network Socket & Port Allocation Map

| Port | Protocol | Binding Scope | Purpose / Service | Conflict Resolution Notes |
| :---: | :---: | :---: | :--- | :--- |
| **80** | TCP | Host Interface | Native Ubuntu `nginx/1.24.0` | **Conflict Avoidance**: Do NOT bind K8s to host port 80. |
| **3001** | TCP | Host Interface | Native Wekan Meteor service | **Conflict Avoidance**: Do NOT use port 3001 for dev tools. |
| **7777 / 7788** | TCP | Local Loopback (`127.0.0.1`) | MCP Echo Spike Server | Verified free; dedicated to technical validation tests. |
| **8080** | TCP | `0.0.0.0` (Mapped by k3d) | Local Ingress HTTP Traffic | Routes `shop.nip.io:8080` and `dashboard.nip.io:8080`. |
| **8443** | TCP | `0.0.0.0` (Mapped by k3d) | Local Ingress HTTPS Traffic | Reserved for TLS-enabled local development. |
| **6443** | TCP | `127.0.0.1` (Mapped by k3d) | Kubernetes API Server | Used by `kubectl` to manage the local k3d cluster. |

---

## 5. Technical Implementation Specifications

### 5.1 MCP Wire Protocol Specification
- **Package**: `@modelcontextprotocol/sdk@1.32.1` (pinned).
- **Transport**: `Streamable HTTP` via `StreamableHTTPServerTransport` (server) and `StreamableHTTPClientTransport` (client).
- **Negotiated Protocol Wire Version**: `2024-11-05` (exchanged in handshake header `mcp-protocol-version`).
- **Endpoint**: `POST /mcp`.
- **Request Lifecycle**: Stateless per-request architecture. Each incoming HTTP POST instantiates an isolated transport context, dispatches JSON-RPC execution, and closes gracefully on `res.on('close')`.
- **Authentication**: Custom HTTP header `Authorization: Bearer <api_key>`.
  - Missing header $\rightarrow$ **HTTP 401 Unauthorized** (`{"error": "Unauthorized"}`).
  - Invalid/tampered header $\rightarrow$ **HTTP 401 Unauthorized**.

### 5.2 Storage & Persistence Model
- **Store Workloads (Phase 2)**:
  - MariaDB: PersistentVolumeClaim mounted at `/var/lib/mysql` (`storageClassName: local-path`).
  - WordPress: PersistentVolumeClaim mounted at `/var/www/html` (`storageClassName: local-path`).
- **Gateway Workload (Phase 4)**:
  - SQLite with Write-Ahead Logging (WAL) mounted at `/data/gateway.db` (`storageClassName: local-path`).
  - **Single Replica Invariant**: `replicas: 1` is strictly enforced in both `values-local.yaml` and `values-prod.yaml` because SQLite over a single ReadWriteOnce volume does not support concurrent multi-pod writers.
  - **Memory Profile**: Consumes <15 MiB RAM, saving ~150 MiB compared to a standalone PostgreSQL container.

### 5.3 Kubernetes Resource Limits & Guardrails
Based on the unvarnished environment audit (~1.4 GiB available host RAM, 3.0 GiB swap active), the platform uses conservative baseline sizing:

| Service | CPU Request | CPU Limit | RAM Request | RAM Limit |
| :--- | :---: | :---: | :---: | :---: |
| **MariaDB 11.4** | `100m` | `500m` | `128Mi` | `384Mi` |
| **WordPress 6.7** | `100m` | `500m` | `192Mi` | `384Mi` |
| **Gateway & Dashboard** | `50m` | `300m` | `96Mi` | `256Mi` |
| **WooCommerce MCP** | `50m` | `250m` | `64Mi` | `192Mi` |
| **CRM MCP** | `50m` | `200m` | `64Mi` | `128Mi` |
| **Tasks MCP** | `50m` | `200m` | `64Mi` | `128Mi` |
| **Total Platform Budget** | **~400m** | **~1950m** | **~608 MiB** | **~1472 MiB** |

---

## 6. Verification Evidence Log

### 6.1 Toolchain Verification
```bash
$ node -v && npm -v
v24.20.0
11.19.0

$ kubectl version --client
Client Version: v1.37.1
Kustomize Version: v5.8.1

$ helm version --short
v3.17.1+g980d8ac

$ k3d version
k3d version v5.8.3
k3s version v1.31.5-k3s1 (default)
```

### 6.2 Spike Test Run Output (Port 7788)
```
====================================================
🧪 Starting MCP Streamable HTTP Protocol Spike Tests
Target: http://127.0.0.1:7788/mcp
Authentication: Dynamic test secret configured
====================================================

👉 [Test 1/4] Testing Authentication Enforcement (Reject Invalid/Missing Key)...
   ✅ Sub-test 1A: Request without Authorization header rejected (401).
   ✅ Sub-test 1B: Request with invalid Authorization token rejected (401).
   ✅ PASS: Authentication barrier verified for both missing and invalid credentials.

👉 [Test 2/4] Connecting with Valid Authorization Header over Streamable HTTP...
   ✅ Connected successfully over Streamable HTTP!
   ✅ Protocol handshake completed.
   ✅ PASS: Streamable HTTP connection & protocol handshake established.

👉 [Test 3/4] Testing Tool Discovery (client.listTools)...
   Found 1 tool(s):
   - Name: echo_message
     Description: Echoes back the received message with a server timestamp
     Input Schema: {"type":"object","properties":{"message":{"type":"string","description":"The message text to echo back"}},"required":["message"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}
   ✅ PASS: Tool "echo_message" discovered via protocol.

👉 [Test 4/4] Testing Tool Execution (client.callTool)...
   Tool call raw response: {
  "content": [
    {
      "type": "text",
      "text": "Echo from Streamable HTTP Server: Hello Urumi AI Take-Home Spike! (timestamp: 2026-10-09T15:04:09.018Z)"
    }
  ]
}
   ✅ PASS: Tool "echo_message" executed successfully with verified output.

🔌 Client disconnected cleanly.
====================================================
🏁 Spike Verification Summary: 4/4 tests passed
🎉 VERDICT: ALL MCP PROTOCOL COMPATIBILITY CHECKS PASSED!
====================================================
```

### 6.3 Helm Scaffold Verification Output
```bash
$ helm lint infra/helm/urumi-platform
==> Linting infra/helm/urumi-platform
[INFO] Chart.yaml: icon is recommended
1 chart(s) linted, 0 chart(s) failed

$ helm template test-local infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml
---
# Source: urumi-platform/templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: test-local-urumi-platform-config
  labels:
    helm.sh/chart: urumi-platform
    app.kubernetes.io/name: urumi-platform
    app.kubernetes.io/instance: test-local
    app.kubernetes.io/version: "1.0.0"
    app.kubernetes.io/managed-by: Helm
data:
  environment: "local"
  store-domain: "shop.127.0.0.1.nip.io"
  gateway-domain: "dashboard.127.0.0.1.nip.io"
  store-port: "8080"
  gateway-port: "8080"
```

---

## 7. Known Constraints, Invariants & Guardrails

1. **Host Safety Invariant**: Under no circumstances should host port 80 or host port 3001 be touched, killed, or rebound. Local cluster traffic must flow strictly through port 8080/8443.
2. **Git Ownership Invariant**: Aditya retains exclusive ownership of all Git branching, staging, committing, and pushing. The assistant creates clean files without executing Git state changes.
3. **Storage Invariant**: Multi-replica scaling for the Gateway is prohibited while backed by SQLite on PVC. Any horizontal scaling requirement must be preceded by an external database migration or distributed replication design.
4. **Credential Invariant**: Upstream credentials must never be passed to downstream clients, logged in server stdout, or committed to Git manifests. All secrets in manifests must use `secretKeyRef` or dynamic environment variables.
