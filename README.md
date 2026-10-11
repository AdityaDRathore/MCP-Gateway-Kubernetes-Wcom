# Urumi Platform — Team MCP Gateway on Kubernetes with WooCommerce

A unified, authenticated, and audited Model Context Protocol (MCP) gateway deployed on Kubernetes, providing multi-tenant AI tool access to a stateful WooCommerce store and internal team microservices.

Built for the **Urumi AI Founding DevOps / Forward Deployed Engineer (FDE) Assignment**.

---

## Architecture At A Glance

```
Downstream Clients (User A Chat / User B MCP Inspector)
                        │
                        ▼ Ingress (:8080)
┌─────────────────────────────────────────────────────────────────┐
│ Kubernetes Cluster (k3d / K3s)                                  │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Team MCP Gateway & Control Plane                        │   │
│   │ • React + Vite Admin Dashboard                          │   │
│   │ • TypeScript Dual Proxy (Streamable HTTP)               │   │
│   │ • User API Key Auth (SHA-256) & Instant Revocation      │   │
│   │ • Namespacing & Upstream Failure Isolation              │   │
│   │ • Persistent Audit Logging (SQLite on PVC)              │   │
│   └───────────────┬─────────────────────────┬───────────────┘   │
│                   │ ClusterIP               │ ClusterIP         │
│                   ▼                         ▼                   │
│   ┌─────────────────────────────┐   ┌───────────────────────┐   │
│   │ WooCommerce MCP Server      │   │ CRM & Tasks MCP       │   │
│   │ (Custom TypeScript / HTTP)  │   │ (Internal Mock MCPs)  │   │
│   └──────────────┬──────────────┘   └───────────────────────┘   │
│                  │ REST API                                     │
│                  ▼                                              │
│   ┌─────────────────────────────┐                               │
│   │ WordPress + WooCommerce Pod │                               │
│   │ + MariaDB Pod (Stateful PVC)│                               │
│   └─────────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

For full system architecture, network boundaries, and resource budgeting, see [`docs/architecture.md`](docs/architecture.md).

---

## Current Status: Phase 1 Complete (Foundation & Scaffolding)

- **Node.js LTS**: Pinned to **Node.js 24 LTS (`v24.20.0`)** via `.nvmrc` and `engines` (Node 20 reached EOL in April 2026).
- **MCP Wire Protocol**: Pinned to official `@modelcontextprotocol/sdk@1.32.1` using **Streamable HTTP** (wire version `2024-11-05`). Verified via automated 4/4 test suite in `spikes/mcp-echo/`.
- **Tooling Installed & Verified**:
  - `kubectl`: `v1.37.1`
  - `helm`: `v3.17.1`
  - `k3d`: `v5.8.3`
- **Monorepo & Packaging**: Root npm workspace with `packages/shared`, and unified Helm chart (`infra/helm/urumi-platform`) validated via `helm lint` and `helm template`.
- **Requirements Traceability**: 100% of mandatory requirements mapped to atomic tests in [`docs/requirements-traceability.md`](docs/requirements-traceability.md).

---

## Monorepo Layout

```
├── apps/
│   ├── dashboard/            # (Phase 5) React + Vite dashboard & chat UI
│   ├── gateway/              # (Phase 4) Team MCP Gateway backend
│   ├── mcp-woocommerce/      # (Phase 3) Custom WooCommerce MCP server
│   ├── mcp-crm/              # (Phase 4) Internal CRM upstream MCP server
│   └── mcp-tasks/            # (Phase 4) Internal Tasks upstream MCP server
├── packages/
│   └── shared/               # Shared TypeScript schemas, types, and utilities
├── infra/
│   └── helm/
│       └── urumi-platform/   # Unified Helm chart
│           ├── Chart.yaml
│           ├── values.yaml
│           ├── values-local.yaml  # k3d / nip.io on port 8080
│           ├── values-prod.yaml   # Production VPS on port 443
│           └── templates/
├── spikes/
│   └── mcp-echo/             # Standalone MCP Streamable HTTP protocol spike
├── docs/
│   ├── architecture.md       # 4-layer architecture & storage failure models
│   ├── requirements-traceability.md # Complete requirements matrix & DoD test plan
│   ├── decisions/            # Architecture Decision Records (ADRs)
│   │   ├── ADR-001-stack-and-deployment.md
│   │   ├── ADR-002-mcp-compatibility.md
│   │   └── ADR-003-secrets-and-access.md
│   └── phase-1/              # Phase 1 audit & verification reports
├── package.json              # npm workspaces root
└── tsconfig.base.json        # Base TypeScript compiler configuration
```

---

## Reproducible Setup & Verification Guide

### 1. Prerequisites
Ensure the following tools are available on your system:
- **Node.js**: `v24.x` (recommended via `nvm`)
- **Docker**: Engine 20.10+ (daemon running)
- **kubectl**: `v1.30+`
- **helm**: `v3.14+`
- **k3d**: `v5.x`

If you are using NVM, switch to the pinned Node version:
```bash
nvm use
# Output: Found '/path/to/.nvmrc' with version <24>
```

### 2. Install Workspace Dependencies & Build
Install all workspace dependencies and compile the shared TypeScript packages:
```bash
npm install
npm run build
```

### 3. Run the MCP Streamable HTTP Protocol Spike
The protocol spike verifies Streamable HTTP tool discovery, tool execution, and Bearer token authentication without hardcoded secrets:

```bash
cd spikes/mcp-echo
npm run build

# Start the spike server with a dynamic test key in the background
export MCP_SPIKE_API_KEY="test-spike-token-$(date +%s)"
export PORT=7788
export HOST="127.0.0.1"

node dist/server.js &
SERVER_PID=$!

# Run the test client against the live server
export MCP_SERVER_URL="http://127.0.0.1:7788/mcp"
export MCP_SPIKE_API_KEY="$MCP_SPIKE_API_KEY"

node dist/test-client.js

# Clean up server
kill $SERVER_PID
```
**Expected Outcome**: 4/4 tests pass (Authentication 401 barrier, Streamable HTTP handshake, Tool discovery, Tool execution).

### 4. Validate the Helm Packaging
Validate chart syntax and template generation for both local and production profiles:
```bash
# Add ~/.local/bin to PATH if helm was installed locally
export PATH="$HOME/.local/bin:$PATH"

# Lint the Helm chart
helm lint infra/helm/urumi-platform

# Render templates for local k3d development (nip.io, port 8080)
helm template test-local infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml

# Render templates for production VPS (port 443)
helm template test-prod infra/helm/urumi-platform -f infra/helm/urumi-platform/values-prod.yaml
```
**Expected Outcome**: 0 lint errors; templates render valid Kubernetes manifests.

---

## Architecture Decision Records (ADRs)

- [**ADR-001**](docs/decisions/ADR-001-stack-and-deployment.md): Application Stack, Node.js 24 LTS, and Local Kubernetes Strategy
- [**ADR-002**](docs/decisions/ADR-002-mcp-compatibility.md): MCP SDK `@modelcontextprotocol/sdk@1.32.1`, Streamable HTTP Transport, and Wire Revision `2024-11-05`
- [**ADR-003**](docs/decisions/ADR-003-secrets-and-access.md): Secrets Management, RBAC Boundaries, and Truthful LLM Cost Analysis

---

## Next Phase: Phase 2 (Stateful Store Deployment)

Phase 2 focuses on deploying the stateful WooCommerce store onto the local k3d cluster:
1. Create the local cluster:
   ```bash
   k3d cluster create urumi --port "8080:80@loadbalancer" --port "8443:443@loadbalancer"
   ```
2. Deploy MariaDB and WordPress with PersistentVolumeClaims.
3. Access storefront at `http://shop.127.0.0.1.nip.io:8080` and complete a test purchase (Cash on Delivery).
4. Restart the store pods and verify zero data loss.
