# Phase 5 Demonstration Script: Evaluator & Operator Verification Walkthrough

**Purpose**: Repeatable, non-destructive demonstration protocol for evaluating Urumi Enterprise Gateway & Dashboard capabilities.  
**Audience**: Technical Evaluators, Field Engineers, System Administrators  
**Prerequisites**:
- Kubernetes Cluster (`k3d-urumi`) with Helm Release `urumi-store` at Revision 10+
- Gateway Image: `urumi-gateway:1.0.0`
- DNS / `/etc/hosts` mapped:
  - `127.0.0.1 urumi-gateway.local`
  - `127.0.0.1 urumi-dashboard.local`
- Protected WooCommerce Baseline: Products 10, 11, 12 and Order #14 must be present and will remain untouched.

---

## 1. Demo Scenario Overview

This walkthrough guides an evaluator through the end-to-end capabilities implemented in Phase 5:
1. **System Health & Ingress Boundary Verification**: Confirm dual-listener isolation (Port 3000 vs Port 3001).
2. **Administrator Authentication & Session Establishment**: Interactive browser login.
3. **Upstream Catalog & Tool Aggregation**: Inspect live WooCommerce, Mock CRM, and Mock Tasks tools.
4. **Member Invitation & Onboarding Lifecycle**: Invite a new team member and redeem the invitation.
5. **Machine API Key Issuance**: Issue a scoped MCP API key for an automated agent.
6. **Live MCP Tool Invocation via Gateway**: Authenticate an MCP client and execute a read-only catalog query.
7. **Two-Phase Audit Inspection**: Review tamper-evident audit logs with PII redaction.
8. **Security Boundary Enforcement**: Verify key revocation and CSRF protection.
9. **Protected Baseline Verification**: Confirm WooCommerce store data integrity.

---

## 2. Step-by-Step Execution Protocol

### Step 1: Ingress Boundary & Health Probes Check

Verify that the Ingress separates the MCP protocol plane from the browser control plane:

```bash
# 1. MCP Health Probes (Port 3000 via urumi-gateway.local)
curl -s http://urumi-gateway.local/health/live
# Expected: {"status":"ok"}

curl -s http://urumi-gateway.local/health/ready
# Expected: {"status":"ready","database":"connected","upstreams":3}

# 2. Verify Perimeter Isolation: Browser API unreachable on MCP host
curl -s -o /dev/null -w "%{http_code}\n" http://urumi-gateway.local/api/v1/browser/session
# Expected: 404 (Browser endpoints are NOT routed to Port 3000)

# 3. Verify Dashboard Host Reachability (Port 3001 via urumi-dashboard.local)
curl -s -I http://urumi-dashboard.local/ | grep -i "content-type"
# Expected: Content-Type: text/html; charset=utf-8
```

---

### Step 2: Administrator Interactive Login

Open `http://urumi-dashboard.local` in a web browser, or simulate via API:

```bash
# Authenticate as Administrator (using synthetic credentials for demo)
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/session \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' \
  -c /tmp/demo-admin-cookie.txt

# Verify active session
curl -s http://urumi-dashboard.local/api/v1/browser/session \
  -b /tmp/demo-admin-cookie.txt
```
**Expected Output**:
```json
{
  "user": {
    "username": "admin",
    "role": "admin"
  }
}
```

---

### Step 3: Upstream Catalog & Tool Inspection

In the Dashboard UI, navigate to the **Upstreams** tab.

**API Demonstration**:
```bash
# List all registered upstreams
curl -s http://urumi-dashboard.local/api/v1/browser/upstreams \
  -b /tmp/demo-admin-cookie.txt
```
**Expected Result**:
- `woocommerce`: Status `HEALTHY` (5 core tools: `list_products`, `get_product`, `list_orders`, `get_order`, `update_order_status`).
- `mock-crm`: Status `HEALTHY` (CRM tools).
- `mock-tasks`: Status `HEALTHY` (Task management tools).

Inspect tools registered under WooCommerce:
```bash
curl -s http://urumi-dashboard.local/api/v1/browser/upstreams/woocommerce/tools \
  -b /tmp/demo-admin-cookie.txt
```

---

### Step 4: Member Invitation & Onboarding

In the Dashboard UI, navigate to **Team Members** and click **Invite Member**.

**API Demonstration**:
```bash
# 1. Admin generates an invitation
INVITE_RESP=$(curl -s -X POST http://urumi-dashboard.local/api/v1/browser/invitations \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/demo-admin-cookie.txt \
  -d '{"email":"demo-engineer@urumi.internal","role":"member"}')

INVITE_TOKEN=$(echo $INVITE_RESP | jq -r '.token // .id')
echo "Generated Invitation Token: $INVITE_TOKEN"

# 2. Member redeems invitation with synthetic password
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/invitations/redeem \
  -H "Content-Type: application/json" \
  -d "{
    \"token\": \"$INVITE_TOKEN\",
    \"username\": \"demo_member\",
    \"password\": \"DemoSecure123!\"
  }"

# 3. Verify member can authenticate
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/session \
  -H "Content-Type: application/json" \
  -d '{"username":"demo_member","password":"DemoSecure123!"}' \
  -c /tmp/demo-member-cookie.txt
```

---

### Step 5: Issue Scoped Machine API Key

In the Dashboard UI, navigate to **API Keys** and click **Create Key**.

**API Demonstration**:
```bash
KEY_RESP=$(curl -s -X POST http://urumi-dashboard.local/api/v1/browser/keys \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/demo-admin-cookie.txt \
  -d '{
    "name": "evaluator-mcp-agent",
    "scopes": ["mcp:tools:read", "mcp:tools:execute"],
    "expires_in_days": 30
  }')

DEMO_KEY=$(echo $KEY_RESP | jq -r '.key')
KEY_ID=$(echo $KEY_RESP | jq -r '.id')
echo "Issued Key ID: $KEY_ID"
echo "Issued Key: $DEMO_KEY"
```

---

### Step 6: Authenticated MCP Protocol Tool Invocation

Use the newly issued API key to invoke a read-only tool through the Gateway MCP endpoint (Port 3000):

```bash
# 1. Initialize MCP Session / List Tools
curl -s -X POST http://urumi-gateway.local/mcp \
  -H "Authorization: Bearer $DEMO_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "demo-req-1",
    "method": "tools/list",
    "params": {}
  }'
# Expected: JSON response listing all aggregated tools across WooCommerce, CRM, and Tasks.

# 2. Execute Read-Only Tool (List WooCommerce Products)
curl -s -X POST http://urumi-gateway.local/mcp \
  -H "Authorization: Bearer $DEMO_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "demo-req-2",
    "method": "tools/call",
    "params": {
      "name": "list_products",
      "arguments": { "limit": 5 }
    }
  }'
# Expected: Returns products, including Product 10, 11, 12.
```

---

### Step 7: Audit Trail & Compliance Verification

In the Dashboard UI, navigate to **Audit Logs**.

**API Demonstration**:
```bash
curl -s "http://urumi-dashboard.local/api/v1/browser/audit?page=1&limit=5" \
  -b /tmp/demo-admin-cookie.txt | jq '.'
```
**Verification Points**:
- [ ] Log entry records tool invocation `list_products`.
- [ ] Correlation ID matches JSON-RPC transaction ID.
- [ ] API Key identifier is tracked (`key_id`).
- [ ] Execution latency in milliseconds is recorded.
- [ ] Any customer PII is masked (`*** REDACTED ***`).

---

### Step 8: Security Boundary & Revocation Verification

Demonstrate immediate revocation of compromised machine credentials:

```bash
# 1. Revoke the API key
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/keys/$KEY_ID/revoke \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/demo-admin-cookie.txt

# 2. Attempt tool execution with the revoked key
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://urumi-gateway.local/mcp \
  -H "Authorization: Bearer $DEMO_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "demo-req-3",
    "method": "tools/list",
    "params": {}
  }'
# Expected HTTP Code: 401 Unauthorized (Immediate revocation confirmed)
```

Demonstrate CSRF protection on the browser control plane:
```bash
# Attempt mutating action without custom CSRF header or valid origin
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://urumi-dashboard.local/api/v1/browser/keys \
  -H "Content-Type: application/json" \
  -H "Origin: http://malicious-attacker.com" \
  -b /tmp/demo-admin-cookie.txt \
  -d '{"name":"csrf-key","scopes":["mcp:tools:read"]}'
# Expected HTTP Code: 403 Forbidden (CSRF defense confirmed)
```

---

### Step 9: Non-Destructive Data Integrity Check

Verify that all baseline WooCommerce store records remain completely intact and uncorrupted:

```bash
# In-cluster verification query
kubectl -n urumi exec -it deployment/urumi-store-wordpress -c wordpress -- \
  wp post list --post_type=product --post__in=10,11,12 --allow-root

# Verify Order #14
kubectl -n urumi exec -it deployment/urumi-store-wordpress -c wordpress -- \
  wp post get 14 --allow-root
```
**Acceptance Criteria**:
- Products 10, 11, and 12 are returned with unchanged prices and titles.
- Order #14 exists with preserved line items and billing details.
- SQLite database `/data/gateway.db` passes `PRAGMA integrity_check = 'ok'`.
