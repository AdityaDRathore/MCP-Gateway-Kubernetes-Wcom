# Verification Runbook: Reproducible Test & Audit Procedures

**Document Type:** Reproducible Verification & Acceptance Testing Guide  
**Component:** `apps/woocommerce-mcp` & `infra/helm/urumi-platform`  
**Namespace:** `urumi`  
**Target Cluster:** `k3d-urumi`  
**Date:** 2026-10-13  
**Status:** Approved for Gate G8  

---

## 1. Prerequisites & Environment Setup

Verify the following pinned tool versions before executing the verification procedures:

| Tool | Required Version | Verification Command |
|---|---|---|
| **Node.js** | `v24.20.0` (LTS) | `node -v` |
| **npm** | `11.19.0` | `npm -v` |
| **Docker** | `26.x` or later | `docker version` |
| **k3d** | `v5.8.3` | `k3d version` |
| **kubectl** | `v1.37.1` | `kubectl version --client` |
| **Helm** | `v3.17.1` | `helm version --short` |

```bash
# Set Node version via nvm
cd "/home/rathore/Documents/Urumi Assignment"
nvm use 24.20.0

# Install dependencies if clean clone
npm ci
```

---

## 2. Container Build, Audit & Local Import

### 2.1 Multi-Stage Docker Build
Build the unprivileged, minimal container image using the pinned Node 24 runtime:
```bash
docker build -t urumi-woocommerce-mcp:1.0.0 apps/woocommerce-mcp
```

### 2.2 Image Layer & Non-Root Inspection
```bash
# Verify image size is compact (<200 MB)
docker images urumi-woocommerce-mcp:1.0.0 --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}"
# Expected: ~187 MB

# Inspect runtime files inside image (ensures no source TypeScript or dev tools)
docker run --rm --entrypoint /bin/sh urumi-woocommerce-mcp:1.0.0 -c "ls -la /app"
# Expected: only dist/, node_modules/, package.json owned by mcpuser (UID 10001)

# Verify non-root user execution
docker run --rm --entrypoint /bin/sh urumi-woocommerce-mcp:1.0.0 -c "id"
# Expected: uid=10001(mcpuser) gid=10001(mcpuser)
```

### 2.3 Import Image into Local k3d Cluster
```bash
k3d image import urumi-woocommerce-mcp:1.0.0 -c urumi
```

---

## 3. Helm Lint, Render & Deployment Verification

### 3.1 Helm Lint & Template Checks
```bash
# 1. Lint chart
helm lint infra/helm/urumi-platform

# 2. Render local profile (allowTestClient: true)
helm template test-local infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-local.yaml > /tmp/rendered-local.yaml

# 3. Render prod profile (allowTestClient: false)
helm template test-prod infra/helm/urumi-platform \
  -f infra/helm/urumi-platform/values-prod.yaml > /tmp/rendered-prod.yaml

# 4. Verify test-client is strictly omitted in prod NetworkPolicy
grep -n "component: test-client" /tmp/rendered-prod.yaml || echo "VERIFIED: No test-client in prod"
```

### 3.2 Deploy Release to Cluster
```bash
helm upgrade --install urumi-store infra/helm/urumi-platform \
  -n urumi \
  -f infra/helm/urumi-platform/values-local.yaml

kubectl -n urumi rollout status deployment/urumi-woocommerce-mcp --timeout=120s
```

---

## 4. Automated Test Suites (120 Tests)

Execute all test suites from the project root. All 120 tests must pass with 0 failures:

```bash
# 1. Unit Tests (46 tests: input validation, OAuth 1.0a signing, PII stripping)
npm run test:unit --workspace=apps/woocommerce-mcp

# 2. MCP Protocol Tests (35 tests: Streamable HTTP transport, handshake, error handling)
npm run test:protocol --workspace=apps/woocommerce-mcp

# 3. Live Integration Tests (39 tests: live WooCommerce store read/write, negative auth)
npm run test:integration --workspace=apps/woocommerce-mcp
```

### Expected Output Summary:
- **Unit Tests:** `Tests  46 passed (46)`
- **Protocol Tests:** `Tests  35 passed (35)`
- **Live Integration Tests:** `Tests  39 passed (39)`
- **Total:** `120 passed (120)`

---

## 5. In-Cluster Protocol Acceptance Test

To verify the live in-cluster network path, deploy a temporary test pod running an official MCP client:

```bash
# 1. Run in-cluster verifier script
kubectl -n urumi run mcp-verifier --rm -it \
  --image=node:24-alpine \
  --restart=Never \
  --labels="app.kubernetes.io/component=test-client" \
  -- sh -c '
    npm install -g @modelcontextprotocol/sdk@1.32.1 > /dev/null 2>&1
    node -e "
      const { Client } = require(\"@modelcontextprotocol/sdk/client/index.js\");
      const { StreamableHTTPClientTransport } = require(\"@modelcontextprotocol/sdk/client/streamableHttp.js\");
      async function main() {
        const transport = new StreamableHTTPClientTransport(new URL(\"http://urumi-woocommerce-mcp:3000/mcp\"));
        const client = new Client({ name: \"verifier\", version: \"1.0.0\" });
        await client.connect(transport);
        const tools = await client.listTools();
        console.log(\"DISCOVERED_TOOLS:\" + tools.tools.map(t => t.name).join(\",\"));
        const products = await client.callTool({ name: \"list_products\", arguments: { per_page: 5 } });
        console.log(\"PRODUCTS_TOOL_SUCCESS:\" + (products.content[0].text.includes(\"URUMI-MUG-001\")));
        const order = await client.callTool({ name: \"get_order\", arguments: { order_id: 14 } });
        console.log(\"ORDER_TOOL_SUCCESS:\" + (order.content[0].text.includes(\"299.00\")));
        const hasPII = order.content[0].text.includes(\"billing\") || order.content[0].text.includes(\"@\");
        console.log(\"ZERO_PII:\" + (!hasPII));
        await client.close();
      }
      main().catch(err => { console.error(err); process.exit(1); });
    "
  '
```

### Expected Output:
```text
DISCOVERED_TOOLS:list_products,create_product,list_orders,get_order,update_order_status
PRODUCTS_TOOL_SUCCESS:true
ORDER_TOOL_SUCCESS:true
ZERO_PII:true
```

---

## 6. NetworkPolicy Isolation Verification

### 6.1 Test Local Profile (Authorized `test-client`)
```bash
kubectl -n urumi run netpol-test --rm -it --image=curlimages/curl --restart=Never \
  --labels="app.kubernetes.io/component=test-client" \
  -- curl -sI http://urumi-woocommerce-mcp:3000/health
# Expected: HTTP/1.1 200 OK
```

### 6.2 Test Unauthorized Pod (Blocked by Packet Filter)
```bash
kubectl -n urumi run netpol-blocked --rm -it --image=curlimages/curl --restart=Never \
  --labels="app.kubernetes.io/component=unauthorized" \
  -- curl --connect-timeout 3 -sI http://urumi-woocommerce-mcp:3000/health || echo "BLOCKED_AS_EXPECTED"
# Expected: curl: (7) Failed to connect / BLOCKED_AS_EXPECTED
```

---

## 7. Store Baseline Invariance & Cleanup Verification

### 7.1 Verify Baseline Store Catalog via WP-CLI
```bash
kubectl -n urumi exec deployment/urumi-wordpress -- bash -c \
  "if [ ! -f /usr/local/bin/wp ]; then cp /var/www/html/wp-cli.phar /usr/local/bin/wp && chmod +x /usr/local/bin/wp; fi; \
   wp wc product list --user=1 --fields=id,name,sku,price,status --allow-root && \
   wp wc shop_order list --user=1 --fields=id,status,total,currency --allow-root"
```

### Expected Output:
```text
id	name	sku	price	status
12	Notebook Demo	URUMI-NOTE-001	149	publish
11	Wireless Mouse Demo	URUMI-MOUSE-001	799	publish
10	Urumi Test Mug	URUMI-MUG-001	299	publish
id	status	total	currency
14	processing	299.00	INR
```

### 7.2 Confirm Zero Leftover Test Fixtures
```bash
# Check for any temporary pods
kubectl -n urumi get pods
# Expected: exactly 3 pods (mariadb-0, woocommerce-mcp-*, wordpress-*)

# Check for disposable products
kubectl -n urumi exec deployment/urumi-wordpress -- bash -c \
  "wp wc product list --user=1 --search=URUMI-TEST --allow-root"
# Expected: empty table
```
