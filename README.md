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

## Current Status: Phase 5 Complete (Team Platform, Browser Dashboard, Scrypt Session Auth & Ingress Perimeter)

- **Phase 1 (Foundation & Scaffolding)**:
  - **Node.js LTS**: Pinned to **Node.js 24 LTS (`v24.20.0`)** via `.nvmrc` and `engines`.
  - **MCP Wire Protocol**: Pinned to official `@modelcontextprotocol/sdk@1.32.1` using **Streamable HTTP** (wire revision `2024-11-05`). Verified via automated 4/4 test suite in `spikes/mcp-echo/`.
  - **Toolchain**: `kubectl v1.37.1`, `helm v3.17.1`, `k3d v5.8.3`.
  - **Packaging**: Monorepo with root npm workspace and unified Helm chart (`infra/helm/urumi-platform`).
- **Phase 2 (Stateful Store Workload)**:
  - **Cluster**: Local k3d cluster `urumi` pinned to `rancher/k3s:v1.37.1-k3s1` (0 minor version skew with client `v1.37.1`).
  - **Container Images**: Pinned to `wordpress:7.1.3-php8.3-apache` and `mariadb:11.4.5` (digests locked in [`docs/phase-2/image-lock.md`](docs/phase-2/image-lock.md)).
  - **Stateful Storage**: MariaDB StatefulSet (`/var/lib/mysql`) and WordPress Deployment (`/var/www/html`) bound to `local-path` PersistentVolumes. Survives pod restarts with zero data loss.
  - **WooCommerce Storefront**: Active at `http://shop.127.0.0.1.nip.io:8080` with WooCommerce 11.2.1, INR (`₹`), COD, seeded with 3 products (Mug, Mouse, Notebook) and verified Order #14 (`processing`, INR 299.00).
- **Phase 3 (Custom WooCommerce MCP Server on Kubernetes)**:
  - **Stateless MCP Server**: Written from scratch in TypeScript (`apps/woocommerce-mcp`) using `@modelcontextprotocol/sdk@1.32.1` over **Streamable HTTP** (`POST /mcp`).
  - **Five Approved Tools**: Strictly exposes `list_products`, `create_product`, `list_orders`, `get_order`, and `update_order_status`. Zero debug or mock tools.
  - **In-Cluster Cryptographic Auth**: Uses RFC 5849 OAuth 1.0a HMAC-SHA256 for internal pod-to-pod communication (`urumi-wordpress:80`). Consumer secret is never sent over the wire ([ADR-007](docs/decisions/ADR-007-in-cluster-rest-api-authentication.md)).
  - **Private ClusterIP & NetworkPolicy**: Deployed as `urumi-woocommerce-mcp:3000` with zero public Ingress. Isolated via K3s `kube-router` NetworkPolicy packet filtering.
  - **Comprehensive Regression Suite**: 120/120 automated tests pass (46 unit, 35 protocol, 39 live integration), plus in-cluster verifier pod execution.
- **Phase 4 (Team MCP Gateway Core, Dynamic Federation & Security Hardening)**:
  - **Central Team MCP Gateway**: Implemented in TypeScript (`apps/gateway`) providing a unified downstream MCP entrypoint (`POST /mcp`) over Traefik Ingress on `dashboard.127.0.0.1.nip.io:8080/mcp`.
  - **Dynamic Tool Federation & Namespacing**: Dynamic discovery and aggregation across 3 upstream microservices (`woocommerce-mcp`, `mcp-crm`, `mcp-tasks`) with automated namespacing (`crm__*`, `tasks__*`, `woocommerce__*`). Exposes 10 active tools.
  - **Native Embedded Persistence**: Node.js 24 core `node:sqlite` in WAL mode on dedicated PVC (`urumi-gateway-pvc`, 500Mi) with non-locking online `VACUUM INTO` backup capability.
  - **Constant-Time Authentication & RBAC**: API keys hashed with SHA-256 and verified using `crypto.timingSafeEqual`. Enforces member vs admin role separation. Private Admin REST API (`/admin/v1/upstreams`) strictly hidden from public Ingress.
  - **Two-Phase Cryptographic Audit Logging**: Request ingress and egress logged with deterministic SHA-256 argument hashes (`args_hash`), guaranteeing zero cleartext credential or PII leakage.
  - **Resilience & Concurrency Control**: Global concurrency ceiling (20) with HTTP 429 backpressure, per-upstream FIFO queues (4 active, 10 queued), and 10,000ms fail-closed `AbortController` timeouts.
  - **Kubernetes Security Boundaries**: Upstream credentials isolated in `urumi-gateway-secrets` with strict SA RBAC scoping. Default-deny egress NetworkPolicies blocking direct access to WordPress (port 80) and MariaDB (port 3306). Hardened local-path storage with `DAC_OVERRIDE` capability for repeatable pod recreations.
- **Phase 5 (Team Platform, Browser Dashboard & Dual-Listener Architecture)**:
  - **React 19 + Vite 6 Dashboard**: Lightweight, responsive SPA built in TypeScript and Vanilla CSS (`apps/dashboard`), packaged inside the gateway multi-stage Docker build and served statically from `/app/dist-dashboard`.
  - **Dual-Listener Ingress Perimeter**: Gateway process binds two distinct HTTP ports:
    - **Port 3000**: Internal `/admin/v1/*` API and Downstream Streamable HTTP MCP endpoint (`/mcp`), mapped by Traefik Ingress exclusively for path `/mcp`.
    - **Port 3001**: Browser SPA static assets and session-authenticated Browser API (`/api/v1/browser/*`), mapped by Ingress for root path `/`. External requests to `/admin/v1/*` hit Port 3001 and return HTTP 404.
  - **Decoupled Authentication Architecture**: Complete physical and cryptographic separation between human browser sessions and MCP client tokens:
    - **Browser Human Identity**: Authenticates with username and password verified via Scrypt KDF (`N=16384, r=8, p=1`). Sessions use opaque 256-bit tokens hashed with SHA-256 in SQLite `browser_sessions`. Session cookies are `HttpOnly`, `SameSite=Lax`, path-scoped `/`, and `Secure` in TLS environments.
    - **Dual CSRF Protection**: All state-changing browser mutations (`POST`, `PATCH`, `DELETE`) require both an `X-Urumi-CSRF` header and a trusted Origin header matching allowed ingress hosts.
    - **Downstream MCP Clients**: Continue using constant-time verified Bearer API keys (`Authorization: Bearer urumi_live_<hex>`). Session cookies are strictly rejected on `/mcp`; Bearer tokens are rejected on `/api/v1/browser`.
  - **Team Onboarding & API Key Lifecycle**:
    - **Admin Bootstrap CLI**: Operator CLI (`npm --prefix apps/gateway run cli:bootstrap-admin`) provisions the initial admin account and temporary enrollment token idempotently.
    - **Member Invitations**: Admins generate single-use 72-hour invitation tokens. Prospective members redeem tokens via browser UI to register username and Scrypt password verifier.
    - **API Key Self-Service**: Members and admins generate scoped API keys. Raw plaintext key is returned exactly once; only SHA-256 hashes are persisted. Immediate revocation invalidates key on the very next MCP request.
  - **Audit Trail Viewer**: Paginated, filterable audit log reader (`/api/v1/browser/audit`) restricted to Admin role, with sanitized error messages and deterministic argument hashes.
  - **Empirical Deployment & Acceptance**: Deployed to `k3d-urumi` under Helm release `urumi-store` (Revision 10) with image `urumi-gateway:1.0.0` (`sha256:4cc76d09366b0d458ce59da1799dcfacfb063d2ba0409b21ee97b1111c05ef2b`). 28 of 28 live runtime acceptance tests pass; zero drift on protected WooCommerce records (Products 10, 11, 12 and Order #14).


---

## Monorepo Layout

```
├── apps/
│   ├── dashboard/            # (Phase 5 Verified) React 19 + Vite 6 Dashboard SPA
│   ├── gateway/              # (Phase 5 Verified) Team MCP Gateway Backend & Dual-Listener Host
│   ├── woocommerce-mcp/      # (Phase 3 Verified) Custom WooCommerce MCP Server
│   ├── mcp-crm/              # (Phase 4 Verified) Internal CRM Upstream MCP Server
│   └── mcp-tasks/            # (Phase 4 Verified) Internal Tasks Upstream MCP Server
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
│   ├── architecture.md       # 4-layer architecture, dual-listener & storage models
│   ├── requirements-traceability.md # Complete requirements matrix & DoD test plan
│   ├── decisions/            # Architecture Decision Records (ADRs 001–020)
│   ├── phase-1/              # Phase 1 audit & verification reports
│   ├── phase-2/              # Phase 2 store deployment runbooks
│   ├── phase-3/              # Phase 3 MCP contracts, runbooks & completion reports
│   ├── phase-4/              # Phase 4 execution logs, recovery & acceptance runbooks
│   └── phase-5/              # Phase 5 operational runbooks, demo scripts & completion reports
├── documentation/            # Comprehensive multi-phase study & technical reference manuals
│   ├── phase 1/
│   ├── phase 2/
│   ├── phase 3/
│   ├── phase 4/              # Phase 4 Study Material & Technical Context Reference
│   └── phase 5/              # Phase 5 Study Material & Technical Context Reference
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
Install root and workspace dependencies from the committed lockfile and compile the shared TypeScript packages:
```bash
npm ci
npm run build
```

### 3. Run the MCP Streamable HTTP Protocol Spike
The protocol spike verifies Streamable HTTP tool discovery, tool execution, and Bearer token authentication without hardcoded secrets. As a standalone technical spike, install its pinned dependencies from its committed lockfile and compile:

```bash
cd spikes/mcp-echo
npm ci
npm run build

# Start the spike server with a dynamic test key in the background
export MCP_SPIKE_API_KEY="test-spike-token-$(date +%s)"
export PORT=7788
export HOST="127.0.0.1"

node dist/server.js &
SERVER_PID=$!

# Run the test client against the live server (uses MCP_SERVER_URL)
export MCP_SERVER_URL="http://127.0.0.1:7788/mcp"
export MCP_SPIKE_API_KEY="$MCP_SPIKE_API_KEY"

node dist/test-client.js

# Clean up server
kill $SERVER_PID
```
**Expected Outcome**: 4/4 tests pass (Authentication 401 barrier on missing and invalid keys, Streamable HTTP handshake, Tool discovery, Tool execution).

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

### 5. Provision Local Cluster & Secrets (Phase 2)
Create the local k3d cluster with pinned K3s version matching host `kubectl v1.37.1` (0 minor version skew):
```bash
k3d cluster create urumi \
  --image rancher/k3s:v1.37.1-k3s1 \
  --port "8080:80@loadbalancer" \
  --port "8443:443@loadbalancer" \
  --timeout 180s
```

Generate secure database credentials into a gitignored, mode-0600 file and create the Kubernetes Secret:
```bash
mkdir -p .secrets && chmod 700 .secrets
cat <<EOF > .secrets/phase2-store.env
mariadb-root-password=$(openssl rand -hex 16)
mariadb-password=$(openssl rand -hex 16)
EOF
chmod 600 .secrets/phase2-store.env

kubectl --context k3d-urumi create namespace urumi --dry-run=client -o yaml | kubectl --context k3d-urumi apply -f -
kubectl --context k3d-urumi -n urumi create secret generic urumi-store-secrets \
  --from-env-file=.secrets/phase2-store.env \
  --dry-run=client -o yaml | kubectl --context k3d-urumi apply -f -
```

### 6. Deploy Stateful WooCommerce Store via Helm
Deploy the store workloads (MariaDB StatefulSet, WordPress Deployment, PVCs, Services, Ingress):
```bash
helm --kube-context k3d-urumi upgrade --install urumi-store \
  infra/helm/urumi-platform \
  --namespace urumi \
  --create-namespace \
  -f infra/helm/urumi-platform/values-local.yaml

# Wait for pods and PVCs to be ready
kubectl --context k3d-urumi -n urumi rollout status statefulset/urumi-mariadb
kubectl --context k3d-urumi -n urumi rollout status deployment/urumi-wordpress
```

### 7. Run Deterministic Store Bootstrap
Run the automated bootstrap script to initialize WordPress, WooCommerce, shipping, products, and API secrets idempotently:
```bash
./scripts/bootstrap-store.sh
```
What this script automates:
- **WP-CLI Lifecycle**: Provisions WP-CLI into `/usr/local/bin/wp` and caches it on the persistent volume (`/var/www/html/wp-cli.phar`) to survive container replacements.
- **Store Configuration**: Pretty permalinks (`/%postname%/`), WooCommerce 11.2.1 activation, INR (`₹`) currency, COD payment gateway, and Flat Rate shipping method in Zone 0.
- **Product Catalog**: Idempotently seeds `Urumi Test Mug` (₹299), `Wireless Mouse Demo` (₹799), and `Notebook Demo` (₹149).
- **API Secret Lifecycle**: Automatically creates Kubernetes Secret `urumi-woocommerce-api` (`consumer-key` and `consumer-secret`) and synchronizes local `.secrets/phase2-store.env`.

### 8. Access Storefront & Test Order Checkout (COD)
- **Storefront URL**: [http://shop.127.0.0.1.nip.io:8080/](http://shop.127.0.0.1.nip.io:8080/)
- **Catalog**: Browse products at `/shop/` (contains seeded items: `Urumi Test Mug`, `Wireless Mouse Demo`, `Notebook Demo`).
- **Checkout Flow**: Add any product to cart $\rightarrow$ navigate to `/checkout/` $\rightarrow$ fill test customer details $\rightarrow$ select **Cash on delivery (COD)** $\rightarrow$ Place Order.
- **Admin Verification**: Inspect orders in WooCommerce Admin at `/wp-admin/edit.php?post_type=shop_order` (verified Order #14 in `processing` status).

### 9. Verify WooCommerce REST API (`/wp-json/wc/v3`)
Retrieve API consumer credentials from Kubernetes Secret `urumi-woocommerce-api`:
```bash
CK=$(kubectl --context k3d-urumi -n urumi get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-key}' | base64 -d)
CS=$(kubectl --context k3d-urumi -n urumi get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-secret}' | base64 -d)

# Negative test (expect 401 Unauthorized)
curl -sS -I http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products

# Authenticated product listing (returns 3 seeded products)
curl -sS -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products | jq '.[].name'

# Authenticated order listing (returns placed COD order)
curl -sS -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/orders | jq '.[].id'
```

### 10. Verify Pod Restart Durability & Data Persistence
Verify that pod crashes or rolling replacements cause zero data loss:
```bash
# Capture PVC baseline UID
kubectl --context k3d-urumi -n urumi get pvc -o custom-columns=NAME:.metadata.name,UID:.metadata.uid

# Rollout restart store workloads
kubectl --context k3d-urumi -n urumi rollout restart deployment/urumi-wordpress
kubectl --context k3d-urumi -n urumi rollout status deployment/urumi-wordpress

kubectl --context k3d-urumi -n urumi rollout restart statefulset/urumi-mariadb
kubectl --context k3d-urumi -n urumi rollout status statefulset/urumi-mariadb

# Re-verify store data integrity via REST API
curl -sS -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products | jq '.[].name'
curl -sS -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/orders | jq '.[].id'
```

### 11. Verify Custom WooCommerce MCP Server (Phase 3)
Verify the custom WooCommerce MCP server running inside Kubernetes:

```bash
# 1. Run full 120-test automated regression suite
npm run test:unit --workspace=apps/woocommerce-mcp        # 46 unit tests pass
npm run test:protocol --workspace=apps/woocommerce-mcp    # 35 protocol tests pass
npm run test:integration --workspace=apps/woocommerce-mcp # 39 live integration tests pass

# 2. Verify in-cluster Streamable HTTP MCP endpoint
kubectl -n urumi run mcp-probe --rm -it --image=curlimages/curl --restart=Never \
  --labels="app.kubernetes.io/component=test-client" \
  -- curl -s http://urumi-woocommerce-mcp:3000/health
# Expected: {"status":"ok"}

# 3. Inspect live resource usage
kubectl -n urumi top pod -l app.kubernetes.io/name=woocommerce-mcp
# Expected: CPU ~1m, Memory ~39Mi

# 4. Confirm zero state drift on protected store data
kubectl -n urumi exec deployment/urumi-wordpress -- bash -c \
  "if [ ! -f /usr/local/bin/wp ]; then cp /var/www/html/wp-cli.phar /usr/local/bin/wp && chmod +x /usr/local/bin/wp; fi; \
   wp wc product list --user=1 --fields=id,name,sku,price,status --allow-root && \
   wp wc shop_order list --user=1 --fields=id,status,total,currency --allow-root"
# Expected: Products 10, 11, 12 published; Order #14 processing (₹299.00)
```

### 12. Verify Team MCP Gateway & Dynamic Upstreams (Phase 4)
Verify the central Team MCP Gateway aggregating WooCommerce, CRM, and Tasks:

```bash
# 1. Run full 360-test monorepo regression suite across all workspaces
npm test
# Expected: 360 tests pass, 0 fail (gateway: 218, woocommerce-mcp: 81, mcp-crm: 26, mcp-tasks: 35)

# 2. Run automated empirical performance & resilience benchmark
npm --workspace=gateway run test:benchmark
# Expected: p50 latency ~20ms, 0% error rate at standard load, stable memory usage (~54Mi)

# 3. Verify downstream MCP protocol handshake and catalog discovery via Ingress
curl -s -H "Host: dashboard.127.0.0.1.nip.io" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_OR_MEMBER_KEY>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://127.0.0.1:8080/mcp | jq '.result.tools[].name'
# Expected: 10 tools returned (crm__*, tasks__*, woocommerce__*)

# 4. Verify private Admin API perimeter isolation (expect 404 from public Ingress)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Host: dashboard.127.0.0.1.nip.io" \
  http://127.0.0.1:8080/admin/v1/upstreams
# Expected: 404

# 5. Confirm zero state drift on protected store data
kubectl -n urumi exec deployment/urumi-wordpress -- wp post list \
  --post_type=product,shop_order --allow-root --fields=ID,post_title,post_status,post_type
# Expected: Products 10, 11, 12 published; Order #14 processing (₹299.00)
```

### 13. Verify Phase 5 Team Platform & Browser Dashboard
Verify the Phase 5 React 19 dashboard, Scrypt session authentication, invitations, API keys, and audit logs:

```bash
# 1. Run full 471+ automated test suite across all monorepo workspaces under Node 24
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"
npm test

# 2. Verify dashboard build and static bundle generation
npm run --workspace=apps/dashboard build

# 3. Access Live Dashboard Ingress
# Browser UI: http://dashboard.127.0.0.1.nip.io:8080/
# Downstream MCP Streamable HTTP: http://dashboard.127.0.0.1.nip.io:8080/mcp

# 4. Execute non-destructive 28/28 live runtime acceptance suite
npx tsx scratch/test-stage5-acceptance.ts
# Expected: 28/28 passed (Browser sessions, CSRF, Invitations, RBAC, API keys, Audit API, SQLite WAL, NetworkPolicy)

# 5. Confirm zero state drift on protected store data
kubectl -n urumi exec deployment/urumi-wordpress -- wp post list \
  --post_type=product,shop_order --allow-root --fields=ID,post_title,post_status,post_type
# Expected: Products 10, 11, 12 published; Order #14 processing (₹299.00)
```

---

## Architecture Decision Records (ADRs)

- [**ADR-001**](docs/decisions/ADR-001-stack-and-deployment.md): Application Stack, Node.js 24 LTS, and Local Kubernetes Strategy
- [**ADR-002**](docs/decisions/ADR-002-mcp-compatibility.md): MCP SDK `@modelcontextprotocol/sdk@1.32.1`, Streamable HTTP Transport, and Wire Revision `2024-11-05`
- [**ADR-003**](docs/decisions/ADR-003-secrets-and-access.md): Secrets Management, RBAC Boundaries, and Truthful LLM Cost Analysis
- [**ADR-004**](docs/decisions/ADR-004-stateful-storage-and-workload-controllers.md): Stateful Storage Architecture and Workload Controller Selection
- [**ADR-005**](docs/decisions/ADR-005-local-rest-api-security-boundary.md): Local Development REST API Authentication and Security Boundary
- [**ADR-006**](docs/decisions/ADR-006-image-digest-locking-and-resource-tuning.md): Kubernetes Version Parity, Immutable Image Digest Locking, and Cgroup Memory Budgeting
- [**ADR-007**](docs/decisions/ADR-007-in-cluster-rest-api-authentication.md): In-Cluster REST API Authentication via RFC 5849 OAuth 1.0a HMAC-SHA256
- [**ADR-008**](docs/decisions/ADR-008-five-tool-contract-and-pii-redaction.md): Five-Tool Least-Privilege Contract, Bounded Input Validation, and Customer PII Redaction
- [**ADR-009**](docs/decisions/ADR-009-kubernetes-network-isolation-and-conditional-policies.md): Cluster-Internal Workload Isolation, Non-Root Execution, and Conditional NetworkPolicies
- [**ADR-010**](docs/decisions/ADR-010-container-image-identity-and-digest-pinning-boundary.md): Container Image Identity, Local CRI Resolution, and Production Immutability Separation
- [**ADR-011**](docs/decisions/ADR-011-gateway-dual-mcp-proxy-and-transport-lifecycle.md): Gateway Dual MCP Proxy Architecture, Shared Client Multiplexing, and Cancellation Semantics
- [**ADR-012**](docs/decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md): Gateway Storage Engine via Node.js Built-in `node:sqlite`, WAL Concurrency, Permissions, and Disaster Recovery (Accepted)
- [**ADR-013**](docs/decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md): API Key Format, Verifier Storage, Constant-Time Authentication, and One-Time Administrator Bootstrap
- [**ADR-014**](docs/decisions/ADR-014-two-phase-audit-logging-and-retention.md): Two-Phase Audit Logging, Failure Safety Invariants, and Retention Policy
- [**ADR-015**](docs/decisions/ADR-015-concurrency-limits-circuit-breaker-and-resilience.md): Concurrency Bounds, Circuit Breaker State Machine, and Performance Proposals
- [**ADR-016**](docs/decisions/ADR-016-upstream-catalog-snapshot-and-health-tracking.md): Upstream Tool Namespacing, Dynamic Catalog Snapshotting, and Health Tracking
- [**ADR-017**](docs/decisions/ADR-017-network-defense-ssrf-allowlist-and-secret-rbac.md): Network Defense Boundaries, SSRF URL Allowlisting, Ingress Scope, and Kubernetes Secret RBAC
- [**ADR-018**](docs/decisions/ADR-018-upstream-mock-contracts-crm-and-tasks.md): Upstream Mock Services Architecture: Synthetic CRM and In-Memory Tasks Contracts
- [**ADR-019**](docs/decisions/ADR-019-browser-identity-session-and-csrf.md): Browser Identity, Scrypt Password KDF, Opaque Session Tokens, and Dual-Layer CSRF Protection
- [**ADR-020**](docs/decisions/ADR-020-dual-listener-and-ingress-perimeter.md): Dual-Listener Architecture and Public Ingress Perimeter Isolation

---

## Project Study & Technical Context Manuals

For deep-dive self-study, interview preparation, and end-to-end technical breakdowns, refer to the curated documentation manuals:

- **Phase 5 (Management Platform, Browser Identity, Dual-Listener & Quality Gates 0–7)**:
  - [**Phase 5 Project Study Material**](documentation/phase%205/Project%20Study%20Material.md): Deep-dive educational textbook explaining simply and thoroughly every technology, Scrypt mathematics, session management, CSRF defense, dual listeners, gotchas, and 15 interview preparation Q&As.
  - [**Phase 5 Technical Context Material**](documentation/phase%205/Technical%20Context%20Material.md): Concrete technical reference detailing monorepo inventory, 8-table SQLite schema, REST API contracts, Kubernetes workload manifests, and reproduction guide.
- **Phase 4 (Team MCP Gateway Core, Dynamic Tool Catalog & Resilience)**:
  - [**Phase 4 Project Study Material**](documentation/phase%204/Project%20Study%20Material.md): In-depth conceptual guide covering MCP Streamable HTTP, WAL persistence, constant-time crypto, and upstream microservices.
  - [**Phase 4 Technical Context Material**](documentation/phase%204/Technical%20Context%20Material.md): Concrete technical breakdown and reproduction reference for Phase 4.

---

## Next Phase: Phase 6 (In-Dashboard Chat Agent & External MCP Client Integration)

Phase 6 connects downstream consumers to the unified Team MCP Gateway:
1. **In-Dashboard Chat Agent**: Interactive chat assistant in `apps/dashboard/` executing tools via the MCP Gateway as the logged-in user (`User A`).
2. **Tool Execution Visibility**: Collapsible tool execution blocks rendering tool names, inputs, and status pills in real time.
3. **External Client Support**: Official open-source **MCP Inspector** (`@modelcontextprotocol/inspector`), Claude Code, or Cursor connecting to `http://dashboard.127.0.0.1.nip.io:8080/mcp` using `User B`'s API key.
4. **Cross-Server Workflows**: Composite user prompts requiring tools from multiple upstream servers (e.g., WooCommerce + Tasks) executed in a single tool loop.



