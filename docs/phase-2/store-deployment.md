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

## 5. Store Bootstrap & Configuration

### 5.1 WordPress Installation & Permalinks
Once pods reach `Running`, initialize WordPress and enable Pretty Permalinks:

```bash
kubectl --context k3d-urumi -n urumi exec deployment/urumi-wordpress -- wp core install \
  --path=/var/www/html \
  --url=http://shop.127.0.0.1.nip.io:8080 \
  --title="Urumi Store Demo" \
  --admin_user=urumi_admin \
  --admin_password="<secure-admin-password>" \
  --admin_email=admin@demo.local \
  --allow-root

kubectl --context k3d-urumi -n urumi exec deployment/urumi-wordpress -- wp rewrite structure '/%postname%/' --path=/var/www/html --allow-root
kubectl --context k3d-urumi -n urumi exec deployment/urumi-wordpress -- wp rewrite flush --path=/var/www/html --allow-root
```

### 5.2 WooCommerce Installation & Settings
Install WooCommerce 11.2.1, configure INR currency, flat-rate shipping, and Cash on Delivery:

```bash
kubectl --context k3d-urumi -n urumi exec deployment/urumi-wordpress -- wp plugin install woocommerce --version=11.2.1 --activate --path=/var/www/html --allow-root

kubectl --context k3d-urumi -n urumi exec deployment/urumi-wordpress -- wp eval '
WC_Install::create_pages();
update_option("woocommerce_currency", "INR");
update_option("woocommerce_cod_settings", array(
    "enabled" => "yes",
    "title" => "Cash on delivery",
    "description" => "Pay with cash upon delivery.",
    "enable_for_virtual" => "yes"
));
$zone = new WC_Shipping_Zone(0);
if (empty($zone->get_shipping_methods())) {
    $id = $zone->add_shipping_method("flat_rate");
    $m = WC_Shipping_Zones::get_shipping_method($id);
    if ($m) {
        $m->set_post_data(array("woocommerce_flat_rate_cost" => "0", "woocommerce_flat_rate_title" => "Free Shipping"));
        $m->process_admin_options();
    }
}
' --path=/var/www/html --allow-root
```

### 5.3 Product Seeding
Seed the three test catalog items:
- `Urumi Test Mug` (SKU `URUMI-MUG-001`, ₹299, Accessories)
- `Wireless Mouse Demo` (SKU `URUMI-MOUSE-001`, ₹799, Electronics)
- `Notebook Demo` (SKU `URUMI-NOTE-001`, ₹149, Stationery)

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
3. Enter fictional customer information:
   - First Name: Aditya, Last Name: Demo
   - Address: 101 Marine Drive, Mumbai, 400020
   - Email: demo.customer@urumi.local, Phone: 9876543210
4. Select Cash on Delivery (COD) and submit the order.
5. Verify order receipt at `/checkout/order-received/{order_id}/`.
6. Verify order details in WooCommerce Admin (`/wp-admin/edit.php?post_type=shop_order`).

### 6.3 REST API Verification (`wc/v3`)
Retrieve credentials from Kubernetes Secret:
```bash
CK=$(kubectl --context k3d-urumi -n urumi get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-key}' | base64 -d)
CS=$(kubectl --context k3d-urumi -n urumi get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-secret}' | base64 -d)

# Negative test (expect 401)
curl -sS -I http://shop.127.0.0.1.nip.io:8080/wp-json/wc/v3/products

# Authenticated read (expect 200)
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

1. **Local HTTP Transport**: The local k3d environment operates on plain HTTP (`http://shop.127.0.0.1.nip.io:8080`). In production, TLS termination via Traefik and cert-manager is required to protect credentials in transit.
2. **Local-Path Storage Failure Boundary**: `local-path` PersistentVolumes store data directly on the host's filesystem. This preserves state across pod crashes, evictions, and rolling replacements, but does not provide off-host replication or multi-node disaster recovery.
3. **Full-Webroot Persistence Upgrade Boundary**: Because `/var/www/html` is fully mounted from `urumi-wordpress-pvc`, updating the container image tag will not overwrite or upgrade the WordPress installation already residing on that volume. Upgrades must be executed via WP-CLI or Admin.
