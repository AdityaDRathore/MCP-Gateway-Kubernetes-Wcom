# Urumi Platform — Phase 2 Technical Context Material
## System Architecture, Repository Inventory, Stateful Store Deployment & Reproduction Guide

> **Project**: Team MCP Gateway on Kubernetes with WooCommerce  
> **Phase**: Phase 2 (Stateful WooCommerce Store Deployment)  
> **Repository**: [AdityaDRathore/MCP-Gateway-Kubernetes-Wcom](https://github.com/AdityaDRathore/MCP-Gateway-Kubernetes-Wcom)  
> **Target Runtime**: Kubernetes K3s `v1.37.1` on Ubuntu 24.04 LTS (`x86_64`)  
> **Release**: `urumi-store` (Namespace: `urumi`)  
> **Last Updated**: October 2026  

---

## 1. Executive Summary & Purpose

This document provides the **definitive, authoritative technical reference** for the complete state of the Urumi Platform at the conclusion of **Phase 2: Stateful WooCommerce Store Deployment**.

While its companion document [`Project Study Material.md`](Project%20Study%20Material.md) serves as a conceptual textbook explaining *why* technologies were chosen and *how* they function under the hood, this document is a **concrete, reproducible technical reference** containing:
- Complete file and directory inventory reflecting all Phase 2 additions.
- Exact Kubernetes workload specifications, resource allocations, and network boundaries.
- The step-by-step reproduction guide to recreate the entire store from scratch.
- Full verification logs, REST API validation data, and persistence test evidence.
- The technical contract and operational baseline required for **Phase 3 (Custom WooCommerce MCP Server)**.

---

## 2. Repository Layout & File Inventory

```
MCP-Gateway-Kubernetes-Wcom/
├── .env.example                                  # Master environment variable template for local development
├── .gitignore                                    # Ignores node_modules, build artifacts, and .secrets/
├── .nvmrc                                        # Pins Node.js version to 24 (v24.20.0)
├── package.json                                  # Monorepo root manifest with npm workspaces (apps/*, packages/*)
├── package-lock.json                             # Pinned root dependency tree
├── tsconfig.base.json                            # Base TypeScript compiler configuration
├── README.md                                     # Public project README with Phase 2 quickstart & operations guide
├── scripts/
│   └── bootstrap-store.sh                        # Deterministic, idempotent automated store bootstrap & verify script
├── infra/
│   └── helm/
│       └── urumi-platform/                       # Unified Kubernetes Helm chart
│           ├── Chart.yaml                        # Helm chart metadata (v1.0.0)
│           ├── values.yaml                       # Baseline default values with locked image digests & resource limits
│           ├── values-local.yaml                 # Local k3d cluster profile (nip.io, port 8080, tuned 512Mi WP limit)
│           ├── values-prod.yaml                  # Production VPS profile (port 443, TLS enabled, single gateway replica)
│           ├── files/
│           │   └── local-dev-rest-ssl.php        # Hardened mu-plugin enabling Basic Auth over local HTTP
│           └── templates/
│               ├── _helpers.tpl                  # Standard Kubernetes template macros and label helpers
│               ├── configmap.yaml                # Verified scaffold ConfigMap template
│               ├── mariadb-pvc.yaml              # 1Gi PersistentVolumeClaim for MariaDB (/var/lib/mysql)
│               ├── mariadb-service.yaml          # Internal-only ClusterIP Service on port 3306
│               ├── mariadb-statefulset.yaml      # StatefulSet deploying MariaDB 11.4 with health probes
│               ├── wordpress-pvc.yaml            # 1Gi PersistentVolumeClaim for WordPress (/var/www/html)
│               ├── wordpress-service.yaml        # Internal ClusterIP Service on port 80
│               ├── wordpress-deployment.yaml     # Deployment (Recreate strategy) deploying WordPress 7.1
│               └── ingress.yaml                  # Traefik Ingress routing shop.127.0.0.1.nip.io:8080
├── packages/
│   └── shared/                                   # Shared TypeScript package (@urumi/shared)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/index.ts                          # Shared types (Audit logs, tool schemas, user roles)
├── spikes/
│   └── mcp-echo/                                 # Verified Phase 1 MCP Streamable HTTP protocol spike
├── docs/
│   ├── architecture.md                           # 4-layer architecture & storage failure models
│   ├── requirements-traceability.md              # 27-item granular requirements matrix (INF & STR verified)
│   ├── decisions/                                # Architecture Decision Records (ADRs 001-003)
│   └── phase-2/
│       ├── image-lock.md                         # Locked image names, tags, and sha256 digests
│       ├── store-deployment.md                   # Operational reproduction runbook & verification procedures
│       └── phase-2-execution-log.md              # Chronological gate-by-gate CLI execution log & hardening record
└── documentation/
    ├── phase 1/
    │   ├── Project Study Material.md             # Phase 1 conceptual study guide
    │   └── Technical Context Material.md         # Phase 1 technical architecture & spike reference
    └── phase 2/
        ├── Project Study Material.md             # This phase: Conceptual guide to stateful K8s & WooCommerce
        └── Technical Context Material.md         # This document: Authoritative Phase 2 technical reference
```

---

## 3. Cluster Topology & Runtime Environment

### 3.1 Host Machine Baseline & Ports
- **Host OS**: Ubuntu 24.04 LTS (`x86_64`, Linux 7.0.0-38-generic)
- **Node.js**: `v24.20.0` (Active LTS) | **npm**: `11.19.0`
- **Docker Engine**: `29.8.1`
- **kubectl**: `v1.37.1` | **Helm**: `v3.17.1` | **k3d**: `v5.8.3`
- **Host Port Invariants**:
  - `80/TCP`: Bound to host system `nginx` (MUST NOT BE TOUCHED).
  - `3001/TCP`: Bound to host system `Wekan` (MUST NOT BE TOUCHED).
  - `8080/TCP`: Bound to k3d Traefik loadbalancer (`shop.127.0.0.1.nip.io`).
  - `8443/TCP`: Bound to k3d Traefik loadbalancer for HTTPS.
  - `3306/TCP`: Strictly NOT bound on host (internal cluster only).

### 3.2 Cluster Specifications
- **Cluster Name**: `k3d-urumi`
- **Control Plane Image**: `rancher/k3s:v1.37.1-k3s1` (matches host `kubectl v1.37.1` with **0 minor version skew**).
- **Default StorageClass**: `local-path` (dynamically provisions host-bind PVs under `/var/lib/rancher/k3s/storage/`).
- **Default IngressClass**: `traefik` (listens on cluster ports 80/443, forwarded to host 8080/8443).
- **DNS Subsystem**: CoreDNS (`10.43.0.10`).

---

## 4. Workload Specifications & Helm Configuration

### 4.1 MariaDB Database Workload
| Attribute | Specification | Rationale |
|---|---|---|
| **Controller** | `StatefulSet` (`urumi-mariadb`) | Guarantees stable ordinal pod name (`urumi-mariadb-0`) and dedicated volume binding. |
| **Container Image** | `mariadb:11.4.5@sha256:49117dcc565cf51aa57ac5fca59ab31213402ff0eae6ffc13c46a37b938f7e4b` | Immutable digest lock for reproducible supply-chain security. |
| **Volume Claim** | `urumi-mariadb-pvc` (1Gi, `ReadWriteOnce`, `local-path`) | Mounted at `/var/lib/mysql`. Holds all tables, redo logs, and grants. |
| **Internal Service** | `urumi-mariadb` (`ClusterIP: 10.43.48.147`, Port 3306/TCP) | Strictly internal. Zero external Ingress exposure. |
| **Resource Requests** | CPU: `100m`, Memory: `128Mi` | Guaranteed baseline scheduler allocation. |
| **Resource Limits** | CPU: `500m`, Memory: `384Mi` | Upper cgroup boundary preventing host memory starvation. |
| **Health Probes** | `exec: healthcheck.sh --connect --innodb_initialized` | Startup, readiness, and liveness probes validating socket and engine state. |
| **Secrets** | `urumi-store-secrets` via `secretKeyRef` | Populates `MARIADB_ROOT_PASSWORD` and `MARIADB_PASSWORD`. |

### 4.2 WordPress Application Workload
| Attribute | Specification | Rationale |
|---|---|---|
| **Controller** | `Deployment` (`urumi-wordpress`, `strategy: Recreate`) | Recreate strategy cleanly unmounts RWO storage before spawning replacement pods. |
| **Container Image** | `wordpress:7.1.3-php8.3-apache@sha256:8ecd8d8e374167ea22235acf30f80d1165b82f07ffa5bcef90c1cad8f7be251f` | Required by WooCommerce 11.2+ (declares WP 7.0+ minimum). |
| **Volume Claim** | `urumi-wordpress-pvc` (1Gi, `ReadWriteOnce`, `local-path`) | Mounted at `/var/www/html`. Holds core, themes, uploads, and plugins. |
| **Internal Service** | `urumi-wordpress` (`ClusterIP: 10.43.146.205`, Port 80/TCP) | Exposes HTTP internally to Traefik and cluster clients. |
| **Resource Requests** | CPU: `100m`, Memory: `256Mi` | Sized to ensure sufficient headroom for Apache worker pool. |
| **Resource Limits** | CPU: `500m`, Memory: `512Mi` | Tuned from 384Mi to ensure concurrent WP-CLI CLI processes do not trigger OOMKills. |
| **Health Probes** | Startup & Readiness: `http-get /wp-login.php` (port 80)<br/>Liveness: `tcp-socket :80` | Confirms web stack responsiveness without thrashing backend database during reloads. |

### 4.3 Ingress Routing
- **Ingress Name**: `urumi-store-ingress` (`IngressClass: traefik`)
- **Host Route**: `shop.127.0.0.1.nip.io`
- **Backend Service**: `urumi-wordpress:80`
- **External Port**: Accessible on host via `http://shop.127.0.0.1.nip.io:8080/`

---

## 5. Step-by-Step Deterministic Reproduction Guide

Follow these exact commands to reproduce the entire Phase 2 deployment on any clean environment:

### Step 1: Ensure Toolchain on PATH
```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$HOME/.local/bin:$PATH"
node -v && kubectl version --client && helm version --short && k3d version
```

### Step 2: Provision Local k3d Cluster (Zero Version Skew)
```bash
k3d cluster create urumi \
  --image rancher/k3s:v1.37.1-k3s1 \
  --port "8080:80@loadbalancer" \
  --port "8443:443@loadbalancer" \
  --timeout 180s
```

### Step 3: Generate Local Database Secret File & Kubernetes Secret
```bash
mkdir -p .secrets && chmod 700 .secrets

cat <<EOF > .secrets/phase2-store.env
mariadb-root-password=$(openssl rand -hex 16)
mariadb-password=$(openssl rand -hex 16)
EOF
chmod 600 .secrets/phase2-store.env

# Apply namespace and secret
kubectl --context k3d-urumi create namespace urumi --dry-run=client -o yaml | kubectl --context k3d-urumi apply -f -
kubectl --context k3d-urumi -n urumi create secret generic urumi-store-secrets \
  --from-env-file=.secrets/phase2-store.env \
  --dry-run=client -o yaml | kubectl --context k3d-urumi apply -f -
```

### Step 4: Deploy Store Workloads via Helm
```bash
helm --kube-context k3d-urumi upgrade --install urumi-store \
  infra/helm/urumi-platform \
  --namespace urumi \
  --create-namespace \
  -f infra/helm/urumi-platform/values-local.yaml

# Wait for workload rollout readiness
kubectl --context k3d-urumi -n urumi rollout status statefulset/urumi-mariadb
kubectl --context k3d-urumi -n urumi rollout status deployment/urumi-wordpress
```

### Step 5: Execute Automated Deterministic Bootstrap
```bash
./scripts/bootstrap-store.sh
```
*This automated script provisions WP-CLI, installs WordPress with Pretty Permalinks, installs WooCommerce 11.2.1, sets INR currency and COD payment, persists Flat Rate shipping options, seeds the 3 test products, creates Kubernetes Secret `urumi-woocommerce-api`, and validates REST API connectivity.*

---

## 6. Verification Evidence & Live Test Data

### 6.1 Live Kubernetes Resource Inventory
```text
NAMESPACE: urumi

NAME                                   READY   STATUS    RESTARTS   AGE
pod/urumi-mariadb-0                    1/1     Running   0          1h
pod/urumi-wordpress-d994966c6-frqvk    1/1     Running   0          1h

NAME                      TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
service/urumi-mariadb     ClusterIP   10.43.48.147    <none>        3306/TCP   1h
service/urumi-wordpress   ClusterIP   10.43.146.205   <none>        80/TCP     1h

NAME                                        STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
persistentvolumeclaim/urumi-mariadb-pvc     Bound    pvc-58d7357d-5671-476d-904a-cda0a12cf269   1Gi        RWO            local-path     1h
persistentvolumeclaim/urumi-wordpress-pvc   Bound    pvc-78d0d23b-59fe-4c82-be1e-687d9c40fd6f   1Gi        RWO            local-path     1h

NAME                                            CLASS     HOSTS                   ADDRESS      PORTS   AGE
ingress.networking.k8s.io/urumi-store-ingress   traefik   shop.127.0.0.1.nip.io   172.19.0.2   80      1h
```

### 6.2 Seeded Catalog Products
| ID | Title | SKU | Price | Category | Status |
|---|---|---|---|---|---|
| **10** | `Urumi Test Mug` | `URUMI-MUG-001` | ₹299.00 | Accessories | `publish` |
| **11** | `Wireless Mouse Demo` | `URUMI-MOUSE-001` | ₹799.00 | Electronics | `publish` |
| **12** | `Notebook Demo` | `URUMI-NOTE-001` | ₹149.00 | Stationery | `publish` |

### 6.3 Customer COD Checkout Evidence
- **Flow**: Add item (ID 10) to cart $\rightarrow$ Storefront Checkout (`/checkout/`).
- **Payment Method**: `cod` (`Cash on delivery`).
- **Customer Details**: Fictional test customer data (Mumbai, Maharashtra).
- **Result**: Order receipt confirmation rendered (`result: success`).
- **Order Record in WooCommerce**:
  - **Order ID**: **`14`**
  - **Status**: `processing`
  - **Total**: `INR 299.00`
  - **Line Items**: `Urumi Test Mug` $\times 1$

### 6.4 REST API Verification Suite (`/wp-json/wc/v3`)
Credentials extracted from Kubernetes Secret:
```bash
CK=$(kubectl -n urumi get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-key}' | base64 -d)
CS=$(kubectl -n urumi get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-secret}' | base64 -d)
```

1. **Negative Test (Missing Credentials)**:
   - `curl -sI http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products`
   - **Response**: `HTTP/1.1 401 Unauthorized` (`woocommerce_rest_cannot_view`)
2. **Negative Test (Invalid Credentials)**:
   - `curl -sI -u "ck_fake:cs_fake" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products`
   - **Response**: `HTTP/1.1 401 Unauthorized` (`woocommerce_rest_cannot_view`)
3. **Positive Test (Authenticated Catalog Read)**:
   - `curl -s -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products | jq '.[].name'`
   - **Response**: `HTTP/1.1 200 OK` (Returns all 3 seeded products)
4. **Positive Test (Authenticated Order Read)**:
   - `curl -s -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/orders | jq '.[] | {id: .id, status: .status, total: .total}'`
   - **Response**: `HTTP/1.1 200 OK` (Returns Order #14, `processing`, 299.00)
5. **Positive Test (Write Capability & Clean Deletion)**:
   - Created ephemeral product `URUMI-TEMP-TEST` (`HTTP 201 Created`).
   - Force-deleted `URUMI-TEMP-TEST` (`HTTP 200 OK`). 0 leftover test records.

### 6.5 Controlled Persistence & Workload Replacement Evidence
| Component | Action Taken | Pre-Restart Pod UID | Post-Restart Pod UID | PVC UID (Durability Proof) | Verification Result |
|---|---|---|---|---|---|
| **WordPress** | `rollout restart deployment` | `1bdc0bc4...` | `b0754881...` | `78d0d23b...` (Identical) | Webroot intact. Plugins, uploads, and catalog preserved. |
| **MariaDB** | `rollout restart statefulset` | `2be5013a...` | `840e56d7...` | `58d7357d...` (Identical) | InnoDB tables intact. Re-query returned all 3 products and Order #14. |

---

## 7. Security Architecture & Environmental Boundaries

### 7.1 Local REST SSL Helper Specification
- **File**: [`infra/helm/urumi-platform/files/local-dev-rest-ssl.php`](../../infra/helm/urumi-platform/files/local-dev-rest-ssl.php)
- **Deployment Location**: `/var/www/html/wp-content/mu-plugins/local-dev-rest-ssl.php`
- **Security Boundary**:
  1. Aborts execution if `WP_ENVIRONMENT_TYPE` is set to anything other than `local` or `development`.
  2. Restricts execution to explicit hostnames (`shop.127.0.0.1.nip.io`, `localhost`, `127.0.0.1`).
  3. Scopes execution strictly to `/wp-json/wc/` URIs.
  4. Only sets `$_SERVER['HTTPS'] = 'on'` to satisfy WooCommerce's `is_ssl()` check for Basic Auth over local HTTP.
  5. Does NOT bypass credential verification; full API key authentication is strictly enforced.
  6. **Production Requirement**: In production (`values-prod.yaml`), Traefik terminates TLS on port 443 via cert-manager. This mu-plugin MUST NOT be installed in production.

### 7.2 Storage Failure Boundary
- Storage utilizes `local-path` on the single node `k3d-urumi-server-0`.
- Data is durable across pod crashes, pod deletions, rollout restarts, and container image updates.
- Data is **not** replicated across multiple physical nodes or backed up off-host. This is appropriate for a local stateful development demonstration.

---

## 8. Phase 3 Readiness & Transition Contract

With Phase 2 successfully closed, the foundation for **Phase 3 (Custom WooCommerce MCP Server)** is fully in place:

| Integration Requirement | Phase 2 Provisioned Asset | How Phase 3 Consumes It |
|---|---|---|
| **Cluster-Internal Endpoint** | `http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/wc/v3` | The TypeScript MCP server connects via HTTP over the internal ClusterIP. |
| **API Consumer Key** | Kubernetes Secret `urumi-woocommerce-api` (`consumer-key`) | Mounted into the MCP server container via `secretKeyRef`. |
| **API Consumer Secret** | Kubernetes Secret `urumi-woocommerce-api` (`consumer-secret`) | Mounted into the MCP server container via `secretKeyRef`. |
| **Test Catalog** | 3 seeded products (Mug, Mouse, Notebook) | Used to verify MCP tool `list_products`. |
| **Test Orders** | Order #14 (`processing`, COD) | Used to verify MCP tools `list_orders`, `get_order`, and `update_order_status`. |
| **Write Capability** | Verified `shop_manager` permissions | Used to verify MCP tool `create_product`. |

---

*End of Phase 2 Technical Context Material.*
