#!/usr/bin/env bash
# ==============================================================================
# scripts/bootstrap-store.sh
#
# Deterministic, idempotent bootstrap and verification script for the stateful
# WordPress + WooCommerce store on Kubernetes (k3d / local-path).
#
# Usage:
#   ./scripts/bootstrap-store.sh
#
# Environment Overrides:
#   KUBECONTEXT   (default: k3d-urumi)
#   NAMESPACE     (default: urumi)
#   SITE_URL      (default: http://shop.127.0.0.1.nip.io:8080)
# ==============================================================================

set -euo pipefail

KUBECONTEXT="${KUBECONTEXT:-k3d-urumi}"
NAMESPACE="${NAMESPACE:-urumi}"
SITE_URL="${SITE_URL:-http://shop.127.0.0.1.nip.io:8080}"
ADMIN_USER="${ADMIN_USER:-urumi_admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@demo.local}"
INTEGRATION_USER="${INTEGRATION_USER:-urumi-mcp-integration}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== [1/7] Pre-flight: Verifying Cluster & Workload Readiness ==="
if ! kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" get deployment urumi-wordpress >/dev/null 2>&1; then
    echo "ERROR: Deployment 'urumi-wordpress' not found in namespace '${NAMESPACE}' on context '${KUBECONTEXT}'."
    echo "Please deploy the Helm release first:"
    echo "  helm upgrade --install urumi-store infra/helm/urumi-platform -n ${NAMESPACE} -f infra/helm/urumi-platform/values-local.yaml"
    exit 1
fi

echo "Waiting for WordPress deployment to be ready..."
kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" rollout status deployment/urumi-wordpress --timeout=120s

WP_POD=$(kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" get pods -l app.kubernetes.io/component=wordpress -o jsonpath='{.items[0].metadata.name}')
echo "Target WordPress Pod: ${WP_POD}"

echo "=== [2/7] Ensuring WP-CLI Availability ==="
kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- bash -c '
if [ ! -f /usr/local/bin/wp ]; then
    if [ -f /var/www/html/wp-cli.phar ]; then
        cp /var/www/html/wp-cli.phar /usr/local/bin/wp
        chmod +x /usr/local/bin/wp
    else
        echo "Downloading WP-CLI..."
        curl -sS -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
        chmod +x /usr/local/bin/wp
        cp /usr/local/bin/wp /var/www/html/wp-cli.phar
    fi
fi
wp --info >/dev/null
echo "WP-CLI is ready."
'

echo "=== [3/7] WordPress Core Setup & Permalinks ==="
IS_INSTALLED=$(kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- wp core is-installed --allow-root 2>&1 || true)
if [[ "${IS_INSTALLED}" != *"Error"* ]] && [[ "${IS_INSTALLED}" != *"not installed"* ]]; then
    echo "WordPress core is already installed."
else
    echo "Installing WordPress core..."
    ADMIN_PASS=$(openssl rand -hex 16)
    kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- wp core install \
        --path=/var/www/html \
        --url="${SITE_URL}" \
        --title="Urumi Store Demo" \
        --admin_user="${ADMIN_USER}" \
        --admin_password="${ADMIN_PASS}" \
        --admin_email="${ADMIN_EMAIL}" \
        --allow-root
    echo "WordPress core installed successfully."
fi

# Ensure pretty permalinks
kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- wp rewrite structure '/%postname%/' --path=/var/www/html --allow-root
kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- wp rewrite flush --path=/var/www/html --allow-root

echo "=== [4/7] WooCommerce Plugin Setup & Local SSL mu-plugin ==="
IS_WC_ACTIVE=$(kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- wp plugin is-active woocommerce --allow-root 2>&1 || true)
if [[ "${IS_WC_ACTIVE}" == *"active"* ]] && [[ "${IS_WC_ACTIVE}" != *"inactive"* ]]; then
    echo "WooCommerce plugin is already active."
else
    echo "Installing and activating WooCommerce 11.2.1..."
    kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- wp plugin install woocommerce --version=11.2.1 --activate --path=/var/www/html --allow-root
fi

# Install/update local REST SSL helper mu-plugin
MU_SRC="${REPO_ROOT}/infra/helm/urumi-platform/files/local-dev-rest-ssl.php"
if [ -f "${MU_SRC}" ]; then
    kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- mkdir -p /var/www/html/wp-content/mu-plugins
    kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" cp "${MU_SRC}" "${WP_POD}:/var/www/html/wp-content/mu-plugins/local-dev-rest-ssl.php"
    echo "Synchronized local-dev-rest-ssl.php mu-plugin."
fi

echo "=== [5/7] Configuring Store Settings (Currency, Shipping, COD) ==="
kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- wp eval '
// Ensure WooCommerce default pages exist
if (class_exists("WC_Install")) {
    WC_Install::create_pages();
}

// 1. Currency: INR
update_option("woocommerce_currency", "INR");

// 2. Cash on Delivery (COD) payment method
update_option("woocommerce_cod_settings", array(
    "enabled"             => "yes",
    "title"               => "Cash on delivery",
    "description"         => "Pay with cash upon delivery.",
    "instructions"        => "Pay with cash upon delivery.",
    "enable_for_virtual"  => "yes",
    "enable_for_methods"  => array(),
));

// 3. Flat Rate Shipping in "Rest of the World" zone (Zone 0)
$zone = new WC_Shipping_Zone(0);
$methods = $zone->get_shipping_methods();
$flat_rate_id = null;
foreach ($methods as $m) {
    if ($m->id === "flat_rate") {
        $flat_rate_id = $m->instance_id;
        break;
    }
}
if (!$flat_rate_id) {
    $flat_rate_id = $zone->add_shipping_method("flat_rate");
}

// Persist instance settings deterministically
update_option("woocommerce_flat_rate_" . $flat_rate_id . "_settings", array(
    "title"      => "Flat rate",
    "tax_status" => "none",
    "cost"       => "0",
));

echo "Store settings configured successfully.\n";
' --allow-root

echo "=== [6/7] Idempotent Product Catalog Seeding ==="
kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- wp eval '
$seed_products = array(
    array(
        "name"        => "Urumi Test Mug",
        "sku"         => "URUMI-MUG-001",
        "price"       => "299",
        "description" => "Official Urumi ceramic coffee mug.",
        "category"    => "Accessories",
    ),
    array(
        "name"        => "Wireless Mouse Demo",
        "sku"         => "URUMI-MOUSE-001",
        "price"       => "799",
        "description" => "Ergonomic wireless optical mouse.",
        "category"    => "Electronics",
    ),
    array(
        "name"        => "Notebook Demo",
        "sku"         => "URUMI-NOTE-001",
        "price"       => "149",
        "description" => "Hardcover lined notebook.",
        "category"    => "Stationery",
    ),
);

foreach ($seed_products as $data) {
    $existing_id = wc_get_product_id_by_sku($data["sku"]);
    if ($existing_id) {
        $product = wc_get_product($existing_id);
    } else {
        $product = new WC_Product_Simple();
    }
    $product->set_name($data["name"]);
    $product->set_sku($data["sku"]);
    $product->set_regular_price($data["price"]);
    $product->set_price($data["price"]);
    $product->set_status("publish");
    $product->set_catalog_visibility("visible");
    $product->set_short_description($data["description"]);
    $product_id = $product->save();

    // Ensure category exists and is attached
    $term = get_term_by("name", $data["category"], "product_cat");
    if (!$term) {
        $term_info = wp_insert_term($data["category"], "product_cat");
        $term_id = is_array($term_info) ? $term_info["term_id"] : 0;
    } else {
        $term_id = $term->term_id;
    }
    if ($term_id) {
        wp_set_object_terms($product_id, (int)$term_id, "product_cat");
    }
    echo "Product: " . $data["name"] . " [ID: " . $product_id . ", SKU: " . $data["sku"] . "] synchronized.\n";
}
' --allow-root

echo "=== [7/7] REST API Integration User & Secret Management ==="
SECRET_EXISTS=$(kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" get secret urumi-woocommerce-api >/dev/null 2>&1 && echo "yes" || echo "no")

if [ "${SECRET_EXISTS}" = "yes" ]; then
    echo "Kubernetes Secret 'urumi-woocommerce-api' already exists."
    CK=$(kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-key}' | base64 -d)
    CS=$(kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-secret}' | base64 -d)
else
    echo "Creating integration user and generating WooCommerce REST credentials..."
    KEYS_JSON=$(kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" exec "${WP_POD}" -- wp eval '
    $username = "urumi-mcp-integration";
    $user = get_user_by("login", $username);
    if (!$user) {
        $pass = wp_generate_password(24, true, true);
        $user_id = wp_create_user($username, $pass, "integration@urumi.local");
        $u = new WP_User($user_id);
        $u->set_role("shop_manager");
    } else {
        $user_id = $user->ID;
    }

    $consumer_key    = "ck_" . wc_rand_hash();
    $consumer_secret = "cs_" . wc_rand_hash();

    global $wpdb;
    $wpdb->insert(
        $wpdb->prefix . "woocommerce_api_keys",
        array(
            "user_id"         => $user_id,
            "description"     => "Urumi Phase 3 MCP Integration Key",
            "permissions"     => "read_write",
            "consumer_key"    => wc_api_hash($consumer_key),
            "consumer_secret" => $consumer_secret,
            "truncated_key"   => substr($consumer_key, -7),
        ),
        array("%d", "%s", "%s", "%s", "%s", "%s")
    );

    echo json_encode(array(
        "consumer_key"    => $consumer_key,
        "consumer_secret" => $consumer_secret,
    ));
    ' --allow-root)

    CK=$(echo "${KEYS_JSON}" | jq -r .consumer_key)
    CS=$(echo "${KEYS_JSON}" | jq -r .consumer_secret)

    # Create Kubernetes Secret
    kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" create secret generic urumi-woocommerce-api \
        --from-literal=consumer-key="${CK}" \
        --from-literal=consumer-secret="${CS}" \
        --dry-run=client -o yaml | kubectl --context "${KUBECONTEXT}" -n "${NAMESPACE}" apply -f -

    # Record into local gitignored .secrets/ if available
    mkdir -p "${REPO_ROOT}/.secrets" && chmod 700 "${REPO_ROOT}/.secrets"
    cat <<EOF >> "${REPO_ROOT}/.secrets/phase2-store.env"
woocommerce-consumer-key=${CK}
woocommerce-consumer-secret=${CS}
EOF
    chmod 600 "${REPO_ROOT}/.secrets/phase2-store.env"
    echo "Kubernetes Secret 'urumi-woocommerce-api' created successfully."
fi

# Self-verification of REST API
echo "Verifying WooCommerce REST API connectivity (/wp-json/wc/v3/products)..."
HTTP_CODE=$(curl -s -o /tmp/wc_api_check.json -w "%{http_code}" -u "${CK}:${CS}" "${SITE_URL}/wp-json/wc/v3/products")
if [ "${HTTP_CODE}" -eq 200 ]; then
    ITEM_COUNT=$(jq '. | length' /tmp/wc_api_check.json)
    echo "REST API verification SUCCESS (HTTP 200, returned ${ITEM_COUNT} products)."
    rm -f /tmp/wc_api_check.json
else
    echo "WARNING: REST API returned HTTP ${HTTP_CODE} instead of 200."
    cat /tmp/wc_api_check.json
    rm -f /tmp/wc_api_check.json
    exit 1
fi

echo "=== Bootstrap & Verification Complete ==="
echo "Storefront URL: ${SITE_URL}"
echo "Catalog URL:    ${SITE_URL}/shop/"
