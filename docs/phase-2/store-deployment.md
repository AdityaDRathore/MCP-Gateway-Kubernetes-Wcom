# Urumi Store Deployment & Operations Runbook

**Document Type:** Operational Reproduction & Verification Runbook  
**Target Workload:** Stateful WordPress + WooCommerce on Kubernetes  
**Release Name:** `urumi-store`  
**Namespace:** `urumi`  
**Context:** `k3d-urumi`  

---

## 1. Prerequisites & Toolchain Verification

Ensure the following tools are available on the host:
- **Node.js**: `v24.20.0` (active LTS)
- **kubectl**: `v1.37.1` (installed in `~/.local/bin/kubectl`)
- **Helm**: `v3.17.1` (installed in `~/.local/bin/helm`)
- **k3d**: `v5.8.3` (installed in `~/.local/bin/k3d`)
- **Docker Engine**: 20.10+ (running)

Verify tools and path:
```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$HOME/.local/bin:$PATH"
node -v && kubectl version --client && helm version --short && k3d version
```

---

## 2. Cluster Creation & Version Skew Management

To avoid the 6-minor version skew between host `kubectl v1.37.1` and k3d's default K3s, create the cluster using the pinned image `rancher/k3s:v1.37.1-k3s1`:

```bash
k3d cluster create urumi \
  --image rancher/k3s:v1.37.1-k3s1 \
  --port "8080:80@loadbalancer" \
  --port "8443:443@loadbalancer" \
  --timeout 180s
```

Verify cluster readiness:
```bash
kubectl --context k3d-urumi version
kubectl --context k3d-urumi get nodes -o wide
kubectl --context k3d-urumi get storageclass,ingressclass
```
Expected classes:
- StorageClass: `local-path (default)`
- IngressClass: `traefik (default)`

---

## 3. Secret Provisioning Contract

Database passwords are generated locally, stored in a restricted mode-`0600` file, and applied to Kubernetes Secret `urumi-store-secrets` in namespace `urumi`:

```bash
mkdir -p .secrets && chmod 700 .secrets

ROOT_PASS=$(openssl rand -hex 16)
DB_PASS=$(openssl rand -hex 16)

cat <<EOF > .secrets/phase2-store.env
mariadb-root-password=${ROOT_PASS}
mariadb-password=${DB_PASS}
EOF
chmod 600 .secrets/phase2-store.env
unset ROOT_PASS DB_PASS

# Apply Secret
kubectl --context k3d-urumi create namespace urumi --dry-run=client -o yaml | kubectl --context k3d-urumi apply -f -
kubectl --context k3d-urumi -n urumi create secret generic urumi-store-secrets \
  --from-env-file=.secrets/phase2-store.env \
  --dry-run=client -o yaml | kubectl --context k3d-urumi apply -f -
```

> [!IMPORTANT]
> MariaDB container initialization variables (`MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD`) apply only when `/var/lib/mysql` is initially formatted. Updating the Kubernetes Secret later does not alter credentials on an existing volume.

---

## 4. Helm Deployment

Install or upgrade the store using the local profile:

```bash
helm --kube-context k3d-urumi upgrade --install urumi-store \
  infra/helm/urumi-platform \
  --namespace urumi \
  --create-namespace \
  -f infra/helm/urumi-platform/values-local.yaml
```

Inspect workload rollout:
```bash
kubectl --context k3d-urumi -n urumi get deploy,statefulset,pod,svc,pvc,ingress
```

Both PVCs will bind to `local-path`:
- `urumi-mariadb-pvc`: 1Gi, mounted at `/var/lib/mysql`
- `urumi-wordpress-pvc`: 1Gi, mounted at `/var/www/html`

---

## 5. Automated & Deterministic Store Bootstrap

To ensure complete, repeatable, and idempotent reproduction, the platform provides an automated bootstrap script: [`scripts/bootstrap-store.sh`](../../scripts/bootstrap-store.sh).

Execute the bootstrap script from the repository root:
```bash
./scripts/bootstrap-store.sh
```

### What `scripts/bootstrap-store.sh` Automates Idempotently:
1. **WP-CLI Detection & Persistence**: Checks for `/usr/local/bin/wp` in the WordPress container. If absent, downloads `wp-cli.phar`, sets executable permissions, and saves a copy to persistent volume storage (`/var/www/html/wp-cli.phar`) so it survives future container recreations.
2. **WordPress Core & Permalinks**: Idempotently checks `wp core is-installed`. If not installed, performs installation with site title "Urumi Store Demo" and configures Pretty Permalinks (`/%postname%/`), flushing rewrite rules.
3. **WooCommerce Installation**: Installs and activates WooCommerce 11.2.1, creating required core pages (`WC_Install::create_pages()`).
4. **Hardened Local SSL Helper**: Copies [`infra/helm/urumi-platform/files/local-dev-rest-ssl.php`](../../infra/helm/urumi-platform/files/local-dev-rest-ssl.php) into `/var/www/html/wp-content/mu-plugins/` to enable Basic Auth over local HTTP while strictly guarding against non-local activation.
5. **Store Settings & Shipping Persistence**:
   - Currency set to `INR` (`₹`).
   - Cash on Delivery (COD) enabled for physical and virtual items.
   - Flat Rate shipping method added to Zone 0, with instance options directly persisted in the options table (`woocommerce_flat_rate_{instance_id}_settings`).
6. **Product Catalog Seeding**: Idempotently synchronizes the 3 required test products:
   - `Urumi Test Mug` (SKU `URUMI-MUG-001`, ₹299.00, Category: `Accessories`)
   - `Wireless Mouse Demo` (SKU `URUMI-MOUSE-001`, ₹799.00, Category: `Electronics`)
   - `Notebook Demo` (SKU `URUMI-NOTE-001`, ₹149.00, Category: `Stationery`)
7. **REST API Credentials & Kubernetes Secret**:
   - Checks if Kubernetes Secret `urumi-woocommerce-api` exists.
   - If missing, creates integration user `urumi-mcp-integration` (role: `shop_manager`), generates read/write consumer keys, creates Kubernetes Secret `urumi-woocommerce-api` in namespace `urumi`, and records credentials in gitignored `.secrets/phase2-store.env` (permissions `0600`) without leaking them to stdout or history.
8. **Self-Verification**: Runs an authenticated check against `/wp-json/wc/v3/products` to verify HTTP 200 connectivity.

---

## 6. Verification Procedures

### 6.1 Storefront Browser / HTTP Smoke Check
```bash
curl -sS -I http://shop.127.0.0.1.nip.io:8080/
curl -sS http://shop.127.0.0.1.nip.io:8080/shop/ | grep -E "Urumi Test Mug"
```

### 6.2 Primary Acceptance: Browser COD Checkout
1. Open `http://shop.127.0.0.1.nip.io:8080/shop/` in a web browser.
2. Add "Urumi Test Mug" to cart and navigate to `/checkout/`.
3. Enter test customer billing details (e.g. Test Customer, Mumbai, Maharashtra).
4. Select Cash on Delivery (COD) and submit the order.
5. Verify order receipt confirmation rendered on the checkout confirmation page.
6. Verify order details in WooCommerce Admin (`/wp-admin/edit.php?post_type=shop_order`):
   - Confirmed Order #14 in `processing` status for `INR 299.00` via payment method `cod`.

### 6.3 REST API Verification (`wc/v3`)
Retrieve credentials from Kubernetes Secret:
```bash
CK=$(kubectl --context k3d-urumi -n urumi get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-key}' | base64 -d)
CS=$(kubectl --context k3d-urumi -n urumi get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-secret}' | base64 -d)

# Negative test (expect 401 Unauthorized)
curl -sS -I http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products

# Authenticated read (expect 200 OK)
curl -sS -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products | jq '.[].name'
curl -sS -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/orders | jq '.[].id'
```

### 6.4 Controlled Workload Replacement Test
```bash
# 1. Capture PVC and pod baseline
kubectl --context k3d-urumi -n urumi get pods,pvc -o custom-columns=NAME:.metadata.name,UID:.metadata.uid

# 2. Restart WordPress Deployment
kubectl --context k3d-urumi -n urumi rollout restart deployment/urumi-wordpress
kubectl --context k3d-urumi -n urumi rollout status deployment/urumi-wordpress

# 3. Restart MariaDB StatefulSet
kubectl --context k3d-urumi -n urumi rollout restart statefulset/urumi-mariadb
kubectl --context k3d-urumi -n urumi rollout status statefulset/urumi-mariadb

# 4. Confirm data retention
curl -sS -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products | jq '.[].name'
curl -sS -u "$CK:$CS" http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/orders | jq '.[].id'
```

---

## 7. Known Architectural Boundaries & Limitations

1. **Stateful Local Demonstration Environment**:  
   This deployment is designed as a local, single-node development and verification platform. It validates the stateful store layer before introducing the Team MCP Gateway (Phase 4). It is not an enterprise multi-node high-availability commerce cluster.
2. **Local-Path Storage Failure Boundary**:  
   `local-path` PersistentVolumes store data directly on the host's filesystem. This preserves state across pod crashes, evictions, and rolling replacements, but does not provide off-host replication or multi-node disaster recovery.
3. **Local HTTP Transport & REST SSL Security Boundary**:  
   The local k3d environment operates on plain HTTP (`http://shop.127.0.0.1.nip.io:8080`). To enable WooCommerce REST API Basic Authentication over local HTTP, a must-use plugin ([`local-dev-rest-ssl.php`](../../infra/helm/urumi-platform/files/local-dev-rest-ssl.php)) is installed.  
   **Security Boundary Guardrails:**
   - The plugin explicitly checks `WP_ENVIRONMENT_TYPE` and aborts if configured as staging or production.
   - The plugin strictly restricts execution to explicit local hostnames (`shop.127.0.0.1.nip.io`, `localhost`, `127.0.0.1`).
   - The plugin strictly scopes execution to `/wp-json/wc/` routes, setting `$_SERVER['HTTPS'] = 'on'` solely to satisfy WooCommerce's `is_ssl()` requirement. It does NOT bypass authentication; credentials and permissions are still fully validated.
   - **Production Requirement:** In production, `values-prod.yaml` enables TLS on port 443 with cert-manager. This mu-plugin MUST NOT be deployed to production environments.
4. **Full-Webroot Persistence Upgrade Boundary**:  
   Because `/var/www/html` is fully mounted from `urumi-wordpress-pvc`, updating the container image tag will not overwrite or upgrade the WordPress installation already residing on that volume. Upgrades must be executed via WP-CLI or Admin.

