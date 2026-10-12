# Phase 2 Execution Log: Stateful WooCommerce Store Deployment

**Execution Window:** 11–12 October 2026  
**Target Context:** `k3d-urumi`  
**Host Architecture:** Ubuntu 24.04 LTS (x86_64)  
**Release Name:** `urumi-store` (Namespace: `urumi`)  

---

## 1. Toolchain & Environment Audit

| Tool | Recorded Version | Notes |
|---|---|---|
| **Node.js** | `v24.20.0` | Active LTS pinned in `.nvmrc` |
| **npm** | `11.19.0` | Monorepo package manager |
| **Docker** | `29.8.1` | Host container engine |
| **kubectl** | `v1.37.1` | Client version |
| **Helm** | `v3.17.1+g980d8ac` | Package manager |
| **k3d** | `v5.8.3` | Local cluster manager |
| **K3s Server** | `v1.37.1+k3s1` | Kubernetes server version (0 minor skew with client) |

---

## 2. Gate-by-Gate Execution Record

### Gate 1: Preflight, Toolchain & Cluster Initialization
- **Clean-Clone Check:** Tested in `/tmp/urumi-phase2-clean-clone`. `npm ci` and `npm run build` completed with exit code 0.
- **Port Invariant Check:** Host port 80 (nginx) and port 3001 (Wekan) verified running and untouched. Host ports 8080, 8443, 6443 confirmed free.
- **Cluster Creation Command:**
  ```bash
  k3d cluster create urumi \
    --image rancher/k3s:v1.37.1-k3s1 \
    --port "8080:80@loadbalancer" \
    --port "8443:443@loadbalancer" \
    --timeout 180s
  ```
- **Observed Cluster Verification:**
  - `kubectl --context k3d-urumi version`: Client v1.37.1, Server v1.37.1+k3s1 (0 skew).
  - `kubectl --context k3d-urumi get nodes -o wide`: `k3d-urumi-server-0` Ready.
  - `kubectl --context k3d-urumi get storageclass`: `local-path (default)` verified.
  - `kubectl --context k3d-urumi get ingressclass`: `traefik (default)` verified.
  - `curl -sI http://127.0.0.1:8080/`: Traefik loadbalancer responded with HTTP 404 (expected before routes created).
- **Gate 1 Outcome:** **PASS**

### Gate 2: Contracts, Secrets & Helm Templates Definition
- **Git Safety:** Added `.secrets/` to `.gitignore`.
- **Local Secret File:** Created `.secrets/phase2-store.env` (permissions `0600`) with strong random passwords for `mariadb-root-password` and `mariadb-password`.
- **Kubernetes Secret Provisioning:** Created `urumi` namespace and applied `urumi-store-secrets`.
- **Image Pinning & Digest Inspection:**
  - `wordpress:7.1.3-php8.3-apache` (`sha256:8ecd8d8e...`) pulled and verified.
  - `mariadb:11.4.5` (`sha256:49117dcc...`) pulled and verified.
  - Both images imported into k3d cluster `urumi`.
  - `/usr/local/bin/healthcheck.sh` confirmed present in `mariadb:11.4.5`.
- **Templates Implemented:**
  - `templates/mariadb-pvc.yaml` (`urumi-mariadb-pvc`)
  - `templates/mariadb-service.yaml` (`urumi-mariadb`, ClusterIP 3306)
  - `templates/mariadb-statefulset.yaml` (`urumi-mariadb`, probes + limits + secretKeyRef)
  - `templates/wordpress-pvc.yaml` (`urumi-wordpress-pvc`)
  - `templates/wordpress-service.yaml` (`urumi-wordpress`, ClusterIP 80)
  - `templates/wordpress-deployment.yaml` (`urumi-wordpress`, Recreate + probes + limits + secretKeyRef)
  - `templates/ingress.yaml` (`urumi-store-ingress`, host `shop.127.0.0.1.nip.io`)
- **Helm Validation:**
  - `helm lint infra/helm/urumi-platform`: 0 chart(s) failed.
  - `helm template test-local ...`: Rendered 307 lines without secrets.
  - `helm template test-prod ...`: Rendered 313 lines, 1 gateway replica retained.
  - `kubectl apply --dry-run=server`: All resources passed server dry-run validation.
- **Gate 2 Outcome:** **PASS**

### Gate 3: Infrastructure Deployment & Progressive Verification
- **Helm Release Deployment:**
  ```bash
  helm --kube-context k3d-urumi upgrade --install urumi-store \
    infra/helm/urumi-platform \
    --namespace urumi \
    --create-namespace \
    -f infra/helm/urumi-platform/values-local.yaml
  ```
- **PVC Binding:**
  - `urumi-mariadb-pvc`: Bound (`pvc-58d7357d-5671-476d-904a-cda0a12cf269`, 1Gi, local-path).
  - `urumi-wordpress-pvc`: Bound (`pvc-78d0d23b-59fe-4c82-be1e-687d9c40fd6f`, 1Gi, local-path).
- **Workload Status:**
  - `urumi-mariadb-0`: `1/1 Running`, 0 restarts. Healthcheck exec verified with exit code 0.
  - `urumi-wordpress-5ffd8b4dc4-cg8nq`: `1/1 Running`, 0 restarts. Startup & readiness probes passed.
- **Network Isolation:**
  - Host port 3306 connection refused (properly isolated).
  - `http://shop.127.0.0.1.nip.io:8080/`: Served HTTP 302 redirect to installer.
- **Gate 3 Outcome:** **PASS**

### Gate 4: Storefront Setup, Product Seeding & Browser COD Checkout
- **WordPress Setup:** Deployed with site title "Urumi Store Demo", admin user `urumi_admin`.
- **Pretty Permalinks:** Configured rewrite structure `/%postname%/` and flushed rewrite rules.
- **WooCommerce Installation:** Installed and activated WooCommerce `11.2.1`. Currency set to `INR` (`₹`).
- **Payment & Shipping:** Flat Rate shipping configured; Cash on Delivery (COD) enabled.
- **Seeded Products:**
  - ID 10: `Urumi Test Mug` | SKU: `URUMI-MUG-001` | ₹299.00 | Category: `Accessories` | Status: `publish`
  - ID 11: `Wireless Mouse Demo` | SKU: `URUMI-MOUSE-001` | ₹799.00 | Category: `Electronics` | Status: `publish`
  - ID 12: `Notebook Demo` | SKU: `URUMI-NOTE-001` | ₹149.00 | Category: `Stationery` | Status: `publish`
- **Storefront Checkout Execution:**
  - Established customer session, added `Urumi Test Mug` (ID 10) to cart.
  - Form submitted via Storefront Checkout with customer billing details:
    Aditya Demo, 101 Marine Drive, Mumbai, 400020, COD payment.
  - Result: Order generated with `result: success` and redirect to `/checkout/order-received/14/?key=wc_order_RU2yIP5DJ74lk`.
- **Order Verification in WooCommerce Admin:**
  - Order ID: `14`
  - Status: `processing`
  - Total: `INR 299.00`
  - Payment Method: `cod (Cash on delivery)`
  - Line Items: `Urumi Test Mug x 1` (Product ID: 10)
- **Gate 4 Outcome:** **PASS**

### Gate 5: REST API Integration & Controlled Persistence Tests
- **Integration Identity:** User `urumi-mcp-integration` created with `shop_manager` role.
- **REST Credentials:** Generated read/write consumer key and secret, stored in Kubernetes Secret `urumi-woocommerce-api`.
- **REST API Test Results (`wc/v3`):**
  - Test 1 (Missing Credentials): `HTTP 401 Unauthorized` (`woocommerce_rest_cannot_view`).
  - Test 2 (Invalid Credentials): `HTTP 401 Unauthorized` (`woocommerce_rest_cannot_view`).
  - Test 3 (Authenticated Product Read): `HTTP 200 OK`, returned all 3 products (IDs 10, 11, 12).
  - Test 4 (Authenticated Order Read): `HTTP 200 OK`, returned Order 14 (Processing, INR 299.00, COD).
  - Test 5 (Self-Cleaning Write Test): Created disposable product (`URUMI-TEMP-TEST`, ID 15) with HTTP 201, then immediately force-deleted with HTTP 200. Zero residual test data.
- **Controlled Workload Replacement Tests:**
  1. **WordPress Pod Replacement:**
     - Rollout restarted `deployment/urumi-wordpress`.
     - Old Pod UID: `1bdc0bc4-ac25-463a-baa2-d91a2b6ae37b`
     - New Pod UID: `b0754881-03ef-47de-a186-5daee11f2026` (confirmed replaced)
     - PVC UID: `78d0d23b-59fe-4c82-be1e-687d9c40fd6f` (retained, unchanged)
     - Data: Products 10, 11, 12 and Order 14 verified intact via REST API.
  2. **MariaDB Pod Replacement:**
     - Rollout restarted `statefulset/urumi-mariadb`.
     - Old Pod UID: `2be5013a-60f6-446e-8c00-4e0684b94754`
     - New Pod UID: `840e56d7-7241-4956-bc53-d368bd08fa01` (confirmed replaced)
     - PVC UID: `58d7357d-5671-476d-904a-cda0a12cf269` (retained, unchanged)
     - Data: Products 10, 11, 12 and Order 14 verified intact via REST API and storefront.
- **Gate 5 Outcome:** **PASS**
