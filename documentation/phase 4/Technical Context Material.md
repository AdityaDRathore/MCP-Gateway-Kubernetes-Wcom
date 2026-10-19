# Urumi Platform — Phase 4 Technical Context Material
## System Architecture, Technical Breakdown, Reproduction Guide & Operational State

> **Project**: Team MCP Gateway on Kubernetes with WooCommerce  
> **Phase**: Phase 4 (Team MCP Gateway Core, Multi-Upstream Dynamic Catalog, Security Hardening & Acceptance)  
> **Repository**: [AdityaDRathore/MCP-Gateway-Kubernetes-Wcom](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom)  
> **Target Runtime**: Kubernetes K3s `v1.37.1` on Ubuntu 24.04 LTS (`x86_64`)  
> **Release**: `urumi-store` (Namespace: `urumi`, Secrets: `urumi-gateway-secrets`)  
> **Last Updated**: October 2026  

---

## 1. Executive Summary & Purpose

This document serves as the **authoritative technical reference** for the complete state of the Urumi Platform following the successful completion and closure of **Phase 4: Team MCP Gateway Core** (Gates G0 through G9).

While its companion document [`Project Study Material.md`](Project%20Study%20Material.md) serves as an in-depth conceptual textbook explaining *why* technologies were chosen and *how* they function under the hood, this document is a **concrete, rigorous technical reference** containing:
- Complete monorepo file and directory inventory reflecting all Phase 4 additions.
- Complete architectural breakdown of the Gateway engine, upstream microservices, and persistence layers.
- Exact Kubernetes workload specifications, container security contexts, resource metrics, and network boundaries.
- The step-by-step reproduction guide to build, deploy, test, and audit the complete platform from scratch.
- Full empirical verification data across unit, protocol, dynamic lifecycle, security regression, and performance benchmark suites.
- Operational runbook links and disaster recovery procedures.

---

## 2. Repository Layout & File Inventory

```
MCP-Gateway-Kubernetes-Wcom/
├── .dockerignore                                     # Excludes node_modules, .git, .secrets from Docker context
├── .env.example                                      # Master environment variable template for local development
├── .gitignore                                        # Ignores node_modules, build artifacts, and .secrets/
├── .nvmrc                                            # Pins Node.js version to 24 (v24.20.0)
├── package.json                                      # Monorepo root manifest with npm workspaces (apps/*, packages/*)
├── package-lock.json                                 # Pinned root dependency tree
├── tsconfig.base.json                                # Base TypeScript compiler configuration
├── README.md                                         # Public project README with Phase 4 architecture & setup guide
├── apps/
│   ├── gateway/                                      # Phase 4: Central Team MCP Gateway Core
│   │   ├── Dockerfile                                # Multi-stage Dockerfile (Node 24 Alpine, non-root UID 10001)
│   │   ├── package.json                              # Gateway dependencies (express, node:sqlite, zod, mcp/sdk)
│   │   ├── tsconfig.json                             # Strict TypeScript configuration
│   │   ├── src/
│   │   │   ├── index.ts                              # Application bootstrap, Express server & signal handlers
│   │   │   ├── config.ts                             # Zod-validated environment configuration (fail-fast startup)
│   │   │   ├── auth/
│   │   │   │   ├── key-service.ts                    # Constant-time API key verification (crypto.timingSafeEqual)
│   │   │   │   └── middleware.ts                     # Express authentication & RBAC middleware (admin vs member)
│   │   │   ├── db/
│   │   │   │   ├── database.ts                       # node:sqlite DatabaseSync wrapper, WAL mode & PRAGMA setup
│   │   │   │   ├── migrations.ts                     # Schema migrations (users, api_keys, upstreams, audit_logs)
│   │   │   │   └── backup.ts                         # Non-locking online VACUUM INTO backup engine
│   │   │   ├── audit/
│   │   │   │   └── audit-service.ts                  # Two-phase audit logger with SHA-256 argument redaction
│   │   │   ├── catalog/
│   │   │   │   ├── upstream-catalog-manager.ts       # Dynamic upstream connection manager & SSE client pool
│   │   │   │   └── tool-registry.ts                  # Namespaced prefix tool federation (<slug>__<tool>)
│   │   │   ├── resilience/
│   │   │   │   ├── concurrency-limiter.ts            # Global concurrency limiter (max 20) with HTTP 429
│   │   │   │   └── queue-manager.ts                  # Per-upstream FIFO queue (4 active, 10 queued)
│   │   │   ├── k8s/
│   │   │   │   └── secret-client.ts                  # Scoped K8s client for urumi-gateway-secrets with TLS
│   │   │   ├── logging/
│   │   │   │   └── logger.ts                         # Structured single-line JSON logging with secret redaction
│   │   │   ├── mcp/
│   │   │   │   └── protocol-handler.ts               # JSON-RPC 2.0 downstream MCP protocol controller
│   │   │   ├── admin/
│   │   │   │   └── routes.ts                         # Private Admin REST API routes (/admin/v1/upstreams)
│   │   │   └── cli/
│   │   │       └── bootstrap.ts                      # CLI tool to initialize database & bootstrap admin key
│   │   └── test/
│   │       ├── unit/                                 # 27 unit test suites (auth, db, audit, queues, crypto)
│   │       ├── protocol/                             # 6 protocol test suites (MCP handshake, JSON-RPC, errors)
│   │       └── benchmarks/
│   │           └── load-test.ts                      # Automated load, latency & resilience benchmark harness
│   ├── mcp-crm/                                      # Phase 4: Mock CRM MCP Microservice
│   │   ├── Dockerfile                                # Multi-stage Dockerfile (Node 24 Alpine, non-root UID 10001)
│   │   ├── package.json                              # CRM dependencies (@modelcontextprotocol/sdk, express)
│   │   ├── tsconfig.json                             # Strict TypeScript configuration
│   │   ├── src/
│   │   │   ├── index.ts                              # Application entrypoint & SSE transport on /sse
│   │   │   ├── server.ts                             # Express server, Bearer auth middleware & /health probe
│   │   │   └── tools/
│   │   │       ├── get-contact.ts                    # Tool: get_contact
│   │   │       └── search-contacts.ts                # Tool: search_contacts
│   │   └── test/                                     # 26 unit and protocol tests
│   ├── mcp-tasks/                                    # Phase 4: Mock Tasks MCP Microservice
│   │   ├── Dockerfile                                # Multi-stage Dockerfile (Node 24 Alpine, non-root UID 10001)
│   │   ├── package.json                              # Tasks dependencies (@modelcontextprotocol/sdk, express)
│   │   ├── tsconfig.json                             # Strict TypeScript configuration
│   │   ├── src/
│   │   │   ├── index.ts                              # Application entrypoint & SSE transport on /sse
│   │   │   ├── server.ts                             # Express server, Bearer auth middleware & /health probe
│   │   │   └── tools/
│   │   │       ├── get-task.ts                       # Tool: get_task
│   │   │       └── list-tasks.ts                     # Tool: list_tasks
│   │   └── test/                                     # 35 unit and protocol tests
│   └── woocommerce-mcp/                              # Phase 3: Custom WooCommerce MCP Microservice
│       ├── Dockerfile                                # Multi-stage Dockerfile (Node 24 Alpine, non-root UID 10001)
│       ├── package.json                              # Locked dependencies (@modelcontextprotocol/sdk@1.32.1)
│       ├── tsconfig.json                             # Strict TypeScript configuration
│       ├── src/                                      # 6 tools: products, orders, OAuth 1.0a client
│       └── test/                                     # 81 unit, protocol, and live integration tests
├── infra/
│   └── helm/
│       └── urumi-platform/                           # Unified Kubernetes Helm chart
│           ├── Chart.yaml                            # Helm chart metadata (v1.0.0)
│           ├── values.yaml                           # Baseline defaults
│           ├── values-local.yaml                     # Local profile (nip.io:8080, local-path storage)
│           ├── values-prod.yaml                      # Production profile (TLS, strict limits)
│           └── templates/
│               ├── gateway-deployment.yaml           # Deployment for urumi-gateway (DAC_OVERRIDE, non-root)
│               ├── gateway-service.yaml              # ClusterIP Service on port 3000
│               ├── gateway-pvc.yaml                  # 500Mi PVC on local-path for /data/gateway.db
│               ├── gateway-rbac.yaml                 # SA, Role, RoleBinding scoped to urumi-gateway-secrets
│               ├── gateway-ingress.yaml              # Traefik Ingress routing dashboard.127.0.0.1.nip.io:8080/mcp
│               ├── crm-deployment.yaml               # Deployment for urumi-mcp-crm
│               ├── crm-service.yaml                  # ClusterIP Service on port 3000
│               ├── tasks-deployment.yaml             # Deployment for urumi-mcp-tasks
│               ├── tasks-service.yaml                # ClusterIP Service on port 3000
│               ├── mcp-deployment.yaml               # Deployment for urumi-woocommerce-mcp
│               ├── mcp-service.yaml                  # ClusterIP Service on port 3000
│               ├── networkpolicy.yaml                # NetPols for Gateway, CRM, Tasks, WooCommerce, MariaDB
│               ├── wordpress-deployment.yaml         # Deployment for WordPress
│               ├── wordpress-service.yaml            # ClusterIP Service on port 80
│               ├── wordpress-pvc.yaml                # 1Gi PVC on local-path for WordPress
│               ├── mariadb-statefulset.yaml          # StatefulSet for MariaDB 11.4.5
│               ├── mariadb-service.yaml              # ClusterIP Service on port 3306
│               ├── mariadb-pvc.yaml                  # 1Gi PVC on local-path for MariaDB
│               └── ingress.yaml                      # Traefik Ingress routing shop.127.0.0.1.nip.io:8080
├── docs/
│   ├── architecture.md                               # Comprehensive system architecture & data flows
│   ├── phase-4/
│   │   ├── phase-4-execution-log.md                  # Comprehensive execution logs for Gates G0 through G9
│   │   ├── g4-recovery-runbook.md                    # SQLite persistence & online backup runbook
│   │   ├── g9-e2e-acceptance-runbook.md              # End-to-end acceptance, operations, and benchmark runbook
│   │   ├── phase-4-g1-architecture-decision-register.md # Master ADR compilation (ADR-011 through ADR-015)
│   │   └── urumi_phase_4_Master_Technical_Roadmap_Checklist.md # Master Roadmap & Criteria
│   └── decisions/                                    # Individual ADR documents (ADR-001 through ADR-015)
└── documentation/
    ├── phase 1/                                      # Phase 1 Study and Context Material
    ├── phase 2/                                      # Phase 2 Study and Context Material
    ├── phase 3/                                      # Phase 3 Study and Context Material
    └── phase 4/                                      # Phase 4 Study and Context Material
        ├── Project Study Material.md                 # Self-study textbook covering all concepts & gates
        └── Technical Context Material.md             # This document: authoritative technical reference
```

---

## 3. Technical Breakdown of Workloads

### 3.1 Gateway Engine (`apps/gateway`)

The Central Team MCP Gateway exposes a single MCP protocol endpoint while managing authentication, persistence, dynamic federation, and resilience.

#### Database Schema (`node:sqlite` in WAL Mode)
The SQLite schema is managed deterministically via `src/db/migrations.ts`:

```sql
-- Users and Roles
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hashed API Keys (Never Plaintext)
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    name TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Dynamic Upstream Configurations
CREATE TABLE IF NOT EXISTS upstreams (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    transport TEXT NOT NULL CHECK(transport IN ('sse', 'http')),
    secret_ref_name TEXT NOT NULL,
    secret_ref_key TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL DEFAULT 10000,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Two-Phase Audit Logs (Cryptographically Redacted)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    api_key_id TEXT NOT NULL,
    upstream_slug TEXT,
    tool_name TEXT NOT NULL,
    args_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'error')),
    status_code INTEGER,
    duration_ms INTEGER,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

#### API Endpoints
| Route | Method | Access | Description |
| :--- | :---: | :---: | :--- |
| `/mcp` | POST | Member / Admin | Public MCP protocol endpoint (JSON-RPC 2.0). |
| `/health` | GET | Public | Unauthenticated liveness and readiness probe. |
| `/admin/v1/upstreams` | GET | Admin | Lists registered upstream microservices. |
| `/admin/v1/upstreams` | POST | Admin | Dynamically registers a new upstream. |
| `/admin/v1/upstreams/:slug` | PATCH | Admin | Updates configuration (`timeoutMs`, `enabled`). |
| `/admin/v1/upstreams/:slug/credential` | PUT | Admin | In-place secret rotation in `urumi-gateway-secrets`. |
| `/admin/v1/upstreams/:slug` | DELETE | Admin | Removes upstream and purges associated K8s Secret. |

---

## 4. Kubernetes Infrastructure State

### 4.1 Pod & Workload Specifications (Namespace: `urumi`)

```
NAME                                     READY   STATUS    RESTARTS   PORT / ROLE
urumi-gateway-55f57bddc7-7f8q5           1/1     Running   0          3000 (Central Gateway)
urumi-mariadb-0                          1/1     Running   1          3306 (StatefulSet Store DB)
urumi-mcp-crm-6b6ccc5769-s2hfn           1/1     Running   0          3000 (Mock CRM SSE Service)
urumi-mcp-tasks-b7bdc9c5f-9nvks          1/1     Running   0          3000 (Mock Tasks SSE Service)
urumi-woocommerce-mcp-69dc88fbcb-j66mb   1/1     Running   1          3000 (WooCommerce MCP Service)
urumi-wordpress-d994966c6-zhcvm          1/1     Running   1          80 (WordPress & WooCommerce)
```

### 4.2 Persistent Volume Claims
| PVC Name | Status | Volume Capacity | Mode | Exact Persistent UID |
| :--- | :---: | :---: | :---: | :--- |
| `urumi-gateway-pvc` | Bound | 500Mi | `ReadWriteOnce` | `801dc6cb-076b-479a-8475-e77c905797f9` |
| `urumi-mariadb-pvc` | Bound | 1Gi | `ReadWriteOnce` | `58d7357d-5671-476d-904a-cda0a12cf269` |
| `urumi-wordpress-pvc` | Bound | 1Gi | `ReadWriteOnce` | `78d0d23b-59fe-4c82-be1e-687d9c40fd6f` |

### 4.3 Container Security Hardening
All microservices implement strict Kubernetes security boundaries:
- **`runAsNonRoot: true`**
- **`runAsUser: 10001`**, **`runAsGroup: 10001`**
- **`readOnlyRootFilesystem: true`**
- **`allowPrivilegeEscalation: false`**
- **`capabilities.drop: ["ALL"]`**
- **`seccompProfile.type: RuntimeDefault`**

### 4.4 Ingress Routing Matrix (Traefik)
- **Gateway Ingress:** `http://dashboard.127.0.0.1.nip.io:8080/mcp`
  - Routes only `POST /mcp` to `urumi-gateway:3000`.
  - All `/admin/*` routes return `404 Not Found` externally.
- **Storefront Ingress:** `http://shop.127.0.0.1.nip.io:8080/`
  - Routes web traffic to `urumi-wordpress:80`.

---

## 5. Step-by-Step System Reproduction Guide

This section describes how to reproduce the entire Phase 4 platform from a fresh machine.

### Prerequisites
- OS: Linux (Ubuntu 22.04/24.04 recommended)
- Node.js: `v24.20.0` LTS (via `nvm`)
- Container Engine: Docker `24.0+`
- Kubernetes Tooling: `k3d`, `kubectl`, `helm` (v3.12+)

### Step 1: Environment Setup & Node Toolchain
```bash
git clone https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom.git
cd MCP-Gateway-Kubernetes-Wcom

# Activate Node 24 toolchain
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"
node --version # Must output v24.20.0

# Install dependencies across all monorepo workspaces
npm install
```

### Step 2: Build Container Images
Build the 4 microservice container images using multi-stage Docker builds:
```bash
# 1. Gateway Core
docker build -t urumi-gateway:1.0.0 -f apps/gateway/Dockerfile .

# 2. CRM MCP
docker build -t mcp-crm:1.0.0 -f apps/mcp-crm/Dockerfile .

# 3. Tasks MCP
docker build -t mcp-tasks:1.0.0 -f apps/mcp-tasks/Dockerfile .

# 4. WooCommerce MCP
docker build -t urumi-woocommerce-mcp:1.0.0 -f apps/woocommerce-mcp/Dockerfile .
```

### Step 3: Cluster Provisioning & Image Import
If using `k3d`:
```bash
# Import images into the k3d cluster
k3d image import -c urumi urumi-gateway:1.0.0 mcp-crm:1.0.0 mcp-tasks:1.0.0 urumi-woocommerce-mcp:1.0.0
```

### Step 4: Helm Deployment
Deploy or upgrade the unified platform chart:
```bash
helm upgrade --install urumi-store infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-local.yaml \
  -n urumi --create-namespace
```

Wait for all pods to reach ready status:
```bash
kubectl wait --namespace urumi \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/part-of=urumi-platform \
  --timeout=180s
```

### Step 5: Database Initialization & Admin Bootstrap
Bootstrap the gateway SQLite database with initial schema and admin API key:
```bash
# Generate bootstrap credentials inside the gateway container
kubectl exec -n urumi deployment/urumi-gateway -c gateway -- \
  npm run bootstrap
```
This generates an admin API key formatted as:
`urumi_live_13f4e3682b703936e71d7b1e41412d9b4f86fb45769f2b08c3f13aefeecef348`

### Step 6: Verify MCP Catalog via Ingress
Execute a live catalog discovery drill:
```bash
curl -s -H "Host: dashboard.127.0.0.1.nip.io" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <BOOTSTRAP_ADMIN_KEY>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://127.0.0.1:8080/mcp
```
Output will return all 10 registered tools across CRM, Tasks, and WooCommerce with `_meta.reachable: true`.

---

## 6. Empirical Verification & Test Matrix

### 6.1 Automated Test Suites (360 Passed, 0 Failed)
```
================================================================================
🧪 Monorepo Automated Test Suite Summary
================================================================================
Workspace              | Test Files | Tests Run | Passed | Failed | Status
-----------------------|------------|-----------|--------|--------|---------
apps/gateway           | 33 suites  | 218 tests | 218    | 0      | PASSED
apps/woocommerce-mcp   | 11 suites  | 81 tests  | 81     | 0      | PASSED
apps/mcp-crm           | 4 suites   | 26 tests  | 26     | 0      | PASSED
apps/mcp-tasks         | 5 suites   | 35 tests  | 35     | 0      | PASSED
-----------------------|------------|-----------|--------|--------|---------
TOTALS                 | 53 suites  | 360 tests | 360    | 0      | 100% PASS
================================================================================
```

### 6.2 Empirical Performance Benchmarks (Gate G9)
Benchmark executed via `npm --workspace=gateway run test:benchmark` against the live Kubernetes cluster:

```
================================================================================
📈 Gate G9 Performance & Resilience Benchmark Results
================================================================================
Protocol Latency:
  - Initialize Handshake (20 samples): p50 = 20.4ms | p95 = 106.8ms | p99 = 490.5ms
  - Catalog tools/list   (20 samples): p50 = 16.0ms | p95 =  69.6ms | p99 = 101.1ms

Concurrency Sweeps (100 requests per tier across CRM, Tasks, and WooCommerce):
Concurrency | Total Reqs | Success | Failed | Throughput | p50 (ms) | p95 (ms) | p99 (ms) | Error Rate
------------|------------|---------|--------|------------|----------|----------|----------|-----------
1           | 100        | 100     | 0      |   10.2 rps |     20.6 |    301.2 |    463.7 | 0.0%
5           | 100        | 100     | 0      |   10.2 rps |    105.1 |   1654.4 |   1813.9 | 0.0%
10          | 100        | 99      | 1      |   11.2 rps |    501.1 |   2797.7 |   3279.2 | 1.0%
20          | 100        | 100     | 0      |   11.2 rps |   1091.6 |   3204.5 |   3516.0 | 0.0%
================================================================================
Pod Resource Footprint & Stability:
  - Initial Usage: 2m CPU, 59Mi Memory
  - Final Usage:   128m CPU, 54Mi Memory (Memory delta: -5Mi; Zero memory leak)
================================================================================
```

---

## 7. Operational Reference & Related Documents

- [docs/phase-4/g9-e2e-acceptance-runbook.md](file:///home/rathore/Documents/Urumi%20Assignment/docs/phase-4/g9-e2e-acceptance-runbook.md): Operator procedures, troubleshooting guide, `DAC_OVERRIDE` recovery, and benchmark methodology.
- [docs/phase-4/g4-recovery-runbook.md](file:///home/rathore/Documents/Urumi%20Assignment/docs/phase-4/g4-recovery-runbook.md): SQLite persistence, online `VACUUM INTO` non-destructive backup drill, and crash recovery.
- [docs/phase-4/phase-4-execution-log.md](file:///home/rathore/Documents/Urumi%20Assignment/docs/phase-4/phase-4-execution-log.md): Granular execution transcript, exact command lines, and empirical evidence across Gates G0–G9.
- [docs/architecture.md](file:///home/rathore/Documents/Urumi%20Assignment/docs/architecture.md): Four-layer architectural model and cross-system interaction topologies.
- [documentation/phase 4/Project Study Material.md](file:///home/rathore/Documents/Urumi%20Assignment/documentation/phase%204/Project%20Study%20Material.md): Conceptual textbook explaining tech stack, why it was chosen, and how every gate was executed.
