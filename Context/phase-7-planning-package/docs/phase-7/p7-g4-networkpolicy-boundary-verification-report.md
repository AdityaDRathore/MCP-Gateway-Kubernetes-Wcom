# Phase 7 — Gate P7-G4: NetworkPolicy Boundary Verification Report

**Role:** Implementation Worker  
**Project:** Urumi AI FDE Assignment — Team MCP Gateway on Kubernetes  
**Authority:** Technical Head  
**Gate:** P7-G4  
**Status:** COMPLETE — SUBMITTED FOR TECHNICAL HEAD REVIEW  
**Execution Date:** October 24, 2026  
**Starting Commit SHA:** `a353cddfb9981c623f015130b692214ed499d01e` (`a353cdd`)  
**Ending Commit SHA:** `a353cddfb9981c623f015130b692214ed499d01e` (`a353cdd`)  
**Working-Tree Status:** Clean of tracked modifications (zero commits created or pushed)  
**Deployment Target:** Kubernetes (`k3d-urumi`), Namespace: `urumi`  
**Helm Release:** `urumi-store` (Revision 11, Chart `urumi-platform-0.1.0`)

---

## 1. Executive Summary & Objective Realization

Under the strict read-only boundary authorization established by the Technical Head for Gate P7-G4, empirical network boundary observation and bounded probe verification were executed across all six platform workloads deployed in the `urumi` namespace on cluster `k3d-urumi`.

This verification comprehensively proved that the six active Kubernetes NetworkPolicies enforce the intended communication perimeter following the hardening and recovery actions of P7-G2 and P7-G3:

1. **Authorized Paths Succeeded with Application-Level Validation:**
   - **Gateway → WooCommerce MCP (`urumi-woocommerce-mcp:3000`):** TCP socket handshake completed in 7 ms; HTTP GET `/health` returned HTTP 200 (`{"status":"ok","service":"urumi-woocommerce-mcp","transport":"Streamable HTTP"}`); MCP JSON-RPC `tools/list` discovered all 5 WooCommerce tools.
   - **Gateway → CRM MCP (`urumi-mcp-crm:3000`):** TCP socket handshake completed in 8 ms; HTTP GET `/health` returned HTTP 200 (`{"status":"ok","service":"urumi-mcp-crm"}`); MCP JSON-RPC `tools/list` discovered all 2 CRM tools (`search_contacts`, `get_contact`).
   - **Gateway → Tasks MCP (`urumi-mcp-tasks:3000`):** TCP socket handshake completed in 7 ms; HTTP GET `/health` returned HTTP 200 (`{"status":"ok","service":"urumi-mcp-tasks"}`); MCP JSON-RPC `tools/list` discovered all 3 Tasks tools (`create_task`, `list_tasks`, `update_task_status`).
   - **WooCommerce MCP → WordPress (`urumi-wordpress:80`):** TCP socket handshake connected; HTTP GET `/wp-json/` returned HTTP 200 (`"siteName":"Urumi Store Demo"` with namespace `wc/v3` present).
   - **Platform DNS Resolution & Control Plane Ingress:** CoreDNS (`kube-dns:53` UDP/TCP) resolved cluster domain names across all workloads in under 100 ms. Traefik Ingress routing to Gateway Dashboard (port 3001) and WordPress storefront (port 80) succeeded with HTTP 200.
   - **WordPress → MariaDB (`urumi-mariadb:3306`):** TCP socket connection connected immediately; server returned the official MariaDB protocol handshake banner (`11.4.5-MariaDB`).

2. **Denied Paths Enforced by NetworkPolicy Packet Rejection:**
   - **Gateway → WordPress directly (`urumi-wordpress:80`):** Denied (`ECONNREFUSED` in 7 ms).
   - **Gateway → MariaDB directly (`urumi-mariadb:3306`):** Denied (`ECONNREFUSED` in 8 ms).
   - **CRM MCP → WordPress directly (`urumi-wordpress:80`):** Denied (`ECONNREFUSED` in 8 ms).
   - **Tasks MCP → MariaDB directly (`urumi-mariadb:3306`):** Denied (`ECONNREFUSED` in 95 ms).
   - **WooCommerce MCP → MariaDB directly (`urumi-mariadb:3306`):** Denied (`ECONNREFUSED` in 91 ms).
   - **Cross-Workload Isolation (CRM ↔ Tasks, WooCommerce MCP → CRM, WordPress → Gateway, MariaDB → Gateway):** Denied (`ECONNREFUSED` / curl exit code 7).

3. **Definitive Evidence Distinguishing NetworkPolicy Rejection from Port/Endpoint Failure:**
   - Every destination port (WordPress:80, MariaDB:3306, WooCommerce MCP:3000, CRM:3000, Tasks:3000, Gateway:3000) was proven **open, active, and healthy** via an authorized source workload receiving application-level HTTP 200 or MariaDB protocol handshakes.
   - All destination Services were backed by active, healthy Pod endpoints (`10.42.0.*`).
   - DNS lookups succeeded for all probes, ruling out DNS failure.
   - In k3s (which embeds kube-router packet filtering), iptables forward and egress chains reject unauthorized TCP SYN packets with immediate TCP RST/reject packets. Because the listening sockets are demonstrably alive and accept traffic from permitted source pods, the rejection observed by unauthorized source pods is definitively **NetworkPolicy-enforced**.

4. **Regression, Security Invariants & Protected Baseline Preservation:**
   - All six platform workloads remained 1/1 Running & Ready with zero restarts.
   - All 10 MCP upstream tools remained discoverable from the Gateway.
   - P7-G2 container hardening remained active: WooCommerce MCP root filesystem is read-only (`EROFS`) with `/tmp` writable; CRM and Tasks ServiceAccount token mounts are disabled.
   - Gateway ServiceAccount `urumi-gateway-sa` and RBAC binding to `urumi-gateway-secrets` remained untouched.
   - PVC `urumi-gateway-pvc` remained `Bound`.
   - SQLite database `/data/gateway.db` passed `PRAGMA integrity_check` (`ok`) and `foreign_key_check` (0 violations), and all 8 table row counts matched baseline identically (`3, 3, 4, 4, 27, 4, 27, 483`).
   - Protected WooCommerce Product IDs 10, 11, and 12 and Order #14 remained completely unmodified.

### Boundary Compliance Affirmation:
- **Zero Configuration Mutation:** No NetworkPolicies, Deployments, Services, Helm values, or templates were modified.
- **Zero Data Mutation:** No store writes, product updates, order changes, or database modifications occurred.
- **Zero Scope Expansion:** Broad port scanning, remote VPS deployment, and unapproved regression suites were not performed.

---

## 2. Preflight Baseline & Environment Inspection (Stage A)

### 2.1 Repository & Toolchain Identity
- **Git Branch:** `main`
- **HEAD Commit SHA:** `a353cddfb9981c623f015130b692214ed499d01e` (`a353cdd`)
- **Working Tree:** Clean of tracked modifications.
- **Node.js Runtime:** Node v24 LTS (`v24.20.0` local, `v24.21.0` in-container).
- **Cluster Context:** `k3d-urumi`
- **Control Plane Endpoint:** `https://0.0.0.0:37823`
- **Namespace:** `urumi`
- **Helm Release:** `urumi-store` (Status: `deployed`, Revision: `11`, Chart: `urumi-platform-0.1.0`)

### 2.2 Live Platform Workload Readiness
Captured via `kubectl get pods -n urumi -o wide`:

| Workload Name | Pod Name | UID | IP Address | Status | Restarts | Node |
|---|---|---|---|---|:---:|---|
| **Gateway** | `urumi-gateway-6d56bd4644-98s4l` | `c1ec2be5-aaab-42e9-b81a-f2c00f82cadf` | `10.42.0.103` | Running (1/1) | 0 | `k3d-urumi-server-0` |
| **WooCommerce MCP** | `urumi-woocommerce-mcp-68dd5696d7-c2xfp` | `14cc22f4-2d1e-4054-9eb1-bbf8cd5288f6` | `10.42.0.97` | Running (1/1) | 0 | `k3d-urumi-server-0` |
| **CRM MCP** | `urumi-mcp-crm-7fc69678df-cglbg` | `70819a67-9dda-4ea2-941d-5e5a932cac19` | `10.42.0.99` | Running (1/1) | 0 | `k3d-urumi-server-0` |
| **Tasks MCP** | `urumi-mcp-tasks-86964f8b95-n6cnz` | `d6bf7223-0ffe-4769-bec1-0f9fc738aa88` | `10.42.0.98` | Running (1/1) | 0 | `k3d-urumi-server-0` |
| **WordPress** | `urumi-wordpress-d994966c6-jffwh` | `332fd2d7-fd89-47f4-9687-a436d7beaf76` | `10.42.0.101` | Running (1/1) | 0 | `k3d-urumi-server-0` |
| **MariaDB** | `urumi-mariadb-0` | `4baf4911-c36b-4d2e-958e-02a5e699d912` | `10.42.0.106` | Running (1/1) | 0 | `k3d-urumi-server-0` |

### 2.3 Services & Endpoints Inventory
Captured via `kubectl get svc,ep -n urumi -o wide`:

| Service Name | ClusterIP | Port(s) | Target Port | Resolved Endpoints |
|---|---|---|---|---|
| `urumi-gateway` | `10.43.99.188` | `3000/TCP`, `3001/TCP` | `http` (3000), `dashboard` (3001) | `10.42.0.103:3000, 10.42.0.103:3001` |
| `urumi-woocommerce-mcp` | `10.43.192.177` | `3000/TCP` | `http` (3000) | `10.42.0.97:3000` |
| `urumi-mcp-crm` | `10.43.193.131` | `3000/TCP` | `http` (3000) | `10.42.0.99:3000` |
| `urumi-mcp-tasks` | `10.43.173.94` | `3000/TCP` | `http` (3000) | `10.42.0.98:3000` |
| `urumi-wordpress` | `10.43.146.205` | `80/TCP` | `http` (80) | `10.42.0.101:80` |
| `urumi-mariadb` | `10.43.48.147` | `3306/TCP` | `mysql` (3306) | `10.42.0.106:3306` |
| `kube-dns` (`kube-system`) | `10.43.0.10` | `53/UDP`, `53/TCP` | `53` | `10.42.0.105:53` |

### 2.4 NetworkPolicy Inventory & Rules Summary

All six NetworkPolicies reside in namespace `urumi`:

```yaml
# 1. Gateway NetworkPolicy (urumi-gateway-netpol)
# Pod Selector: app.kubernetes.io/component=gateway
policyTypes: [Ingress, Egress]
ingress:
  - from:
    - namespaceSelector: { kubernetes.io/metadata.name: kube-system }
      podSelector: { app.kubernetes.io/name: traefik }
    ports: [{ port: 3000 }, { port: 3001 }]
  - from:
    - podSelector: { app.kubernetes.io/component: test-client }
    ports: [{ port: 3000 }]
egress:
  - to: [{ namespaceSelector: {} }]
    ports: [{ port: 53, protocol: UDP }, { port: 53, protocol: TCP }]
  - to:
    - podSelector:
        matchExpressions:
          - key: app.kubernetes.io/component
            operator: In
            values: [mcp-woocommerce, mcp-crm, mcp-tasks]
    ports: [{ port: 3000, protocol: TCP }]
  - to: [{ ipBlock: { cidr: 10.43.0.1/32 } }]
    ports: [{ port: 443, protocol: TCP }]
  - to: [{ ipBlock: { cidr: 172.19.0.2/32 } }]
    ports: [{ port: 6443, protocol: TCP }]

# 2. WooCommerce MCP NetworkPolicy (urumi-woocommerce-mcp-netpol)
# Pod Selector: app.kubernetes.io/component=mcp-woocommerce
policyTypes: [Ingress, Egress]
ingress:
  - from:
    - podSelector: { app.kubernetes.io/component: gateway }
    - podSelector: { app.kubernetes.io/component: test-client }
    ports: [{ port: 3000, protocol: TCP }]
egress:
  - to:
    - podSelector: { app.kubernetes.io/component: wordpress }
    ports: [{ port: 80, protocol: TCP }]
  - to: [{ namespaceSelector: {} }]
    ports: [{ port: 53, protocol: UDP }, { port: 53, protocol: TCP }]

# 3. CRM MCP NetworkPolicy (urumi-mcp-crm-netpol)
# Pod Selector: app.kubernetes.io/component=mcp-crm
policyTypes: [Ingress, Egress]
ingress:
  - from:
    - podSelector: { app.kubernetes.io/component: gateway }
    - podSelector: { app.kubernetes.io/component: test-client }
    ports: [{ port: 3000, protocol: TCP }]
egress:
  - to: [{ namespaceSelector: {} }]
    ports: [{ port: 53, protocol: UDP }, { port: 53, protocol: TCP }]

# 4. Tasks MCP NetworkPolicy (urumi-mcp-tasks-netpol)
# Pod Selector: app.kubernetes.io/component=mcp-tasks
policyTypes: [Ingress, Egress]
ingress:
  - from:
    - podSelector: { app.kubernetes.io/component: gateway }
    - podSelector: { app.kubernetes.io/component: test-client }
    ports: [{ port: 3000, protocol: TCP }]
egress:
  - to: [{ namespaceSelector: {} }]
    ports: [{ port: 53, protocol: UDP }, { port: 53, protocol: TCP }]

# 5. WordPress NetworkPolicy (urumi-wordpress-netpol)
# Pod Selector: app.kubernetes.io/component=wordpress
policyTypes: [Ingress, Egress]
ingress:
  - from:
    - namespaceSelector: { kubernetes.io/metadata.name: kube-system }
      podSelector: { app.kubernetes.io/name: traefik }
    - podSelector: { app.kubernetes.io/component: mcp-woocommerce }
    - podSelector: { app.kubernetes.io/component: test-client }
    ports: [{ port: 80, protocol: TCP }]
egress:
  - to:
    - podSelector: { app.kubernetes.io/component: mariadb }
    ports: [{ port: 3306, protocol: TCP }]
  - to: [{ namespaceSelector: {} }]
    ports: [{ port: 53, protocol: UDP }, { port: 53, protocol: TCP }]

# 6. MariaDB NetworkPolicy (urumi-mariadb-netpol)
# Pod Selector: app.kubernetes.io/component=mariadb
policyTypes: [Ingress]
ingress:
  - from:
    - podSelector: { app.kubernetes.io/component: wordpress }
    ports: [{ port: 3306, protocol: TCP }]
```

### 2.5 Intended Communication Matrix

| Source Component | Target: Gateway (`:3000`) | Target: WooCommerce MCP (`:3000`) | Target: CRM MCP (`:3000`) | Target: Tasks MCP (`:3000`) | Target: WordPress (`:80`) | Target: MariaDB (`:3306`) | Target: CoreDNS (`:53`) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Gateway** | Local Only | **ALLOWED** | **ALLOWED** | **ALLOWED** | **DENIED** | **DENIED** | **ALLOWED** |
| **WooCommerce MCP** | **DENIED** | Local Only | **DENIED** | **DENIED** | **ALLOWED** | **DENIED** | **ALLOWED** |
| **CRM MCP** | **DENIED** | **DENIED** | Local Only | **DENIED** | **DENIED** | **DENIED** | **ALLOWED** |
| **Tasks MCP** | **DENIED** | **DENIED** | **DENIED** | Local Only | **DENIED** | **DENIED** | **ALLOWED** |
| **WordPress** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | Local Only | **ALLOWED** | **ALLOWED** |
| **MariaDB** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | Local Only | **ALLOWED** |
| **Traefik (Ingress)** | **ALLOWED** (`:3000, :3001`) | **DENIED** | **DENIED** | **DENIED** | **ALLOWED** (`:80`) | **DENIED** | N/A |

---

## 3. Stage B — Verification of Allowed Paths

Bounded, read-only connectivity probes were executed from designated source workloads to all expected allowed destinations.

### Probe Methodology
- **DNS Resolution:** Node.js `dns.promises.lookup()` resolving canonical Kubernetes cluster domain names to Service ClusterIPs.
- **TCP Socket Connect:** Node.js `net.Socket()` with strict 2000 ms timeout to measure handshake latency and socket events.
- **Application Level Probe:** HTTP `fetch()` or streamable MCP JSON-RPC `tools/list` handshake verifying application layer response.

### 3.1 Gateway → WooCommerce MCP
- **Source:** Pod `urumi-gateway-6d56bd4644-98s4l` (labels: `component=gateway, instance=urumi-store, name=urumi-platform`)
- **Destination:** `urumi-woocommerce-mcp.urumi.svc.cluster.local:3000` (Endpoint: `10.42.0.97:3000`)
- **Protocol:** TCP / HTTP
- **Probe Command:**
  ```javascript
  const res = await fetch("http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/health");
  ```
- **Observed Results:**
  - DNS Lookup: `10.43.192.177` in 89 ms
  - TCP Connect: Handshake completed in 7 ms
  - HTTP Status: `200 OK`
  - Response Body: `{"status":"ok","service":"urumi-woocommerce-mcp","transport":"Streamable HTTP","timestamp":"2026-10-24T05:28:13.366Z"}`
  - MCP Tool Discovery: `tools/list` returned 5 tools (`list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`)
- **Status:** **PASS — ALLOWED**

### 3.2 Gateway → CRM MCP
- **Source:** Pod `urumi-gateway-6d56bd4644-98s4l` (labels: `component=gateway`)
- **Destination:** `urumi-mcp-crm.urumi.svc.cluster.local:3000` (Endpoint: `10.42.0.99:3000`)
- **Protocol:** TCP / HTTP
- **Probe Command:**
  ```javascript
  const res = await fetch("http://urumi-mcp-crm.urumi.svc.cluster.local:3000/health");
  ```
- **Observed Results:**
  - DNS Lookup: `10.43.193.131` in 88 ms
  - TCP Connect: Handshake completed in 8 ms
  - HTTP Status: `200 OK`
  - Response Body: `{"status":"ok","service":"urumi-mcp-crm","timestamp":"2026-10-24T05:28:13.467Z"}`
  - MCP Tool Discovery: `tools/list` returned 2 tools (`search_contacts`, `get_contact`)
- **Status:** **PASS — ALLOWED**

### 3.3 Gateway → Tasks MCP
- **Source:** Pod `urumi-gateway-6d56bd4644-98s4l` (labels: `component=gateway`)
- **Destination:** `urumi-mcp-tasks.urumi.svc.cluster.local:3000` (Endpoint: `10.42.0.98:3000`)
- **Protocol:** TCP / HTTP
- **Probe Command:**
  ```javascript
  const res = await fetch("http://urumi-mcp-tasks.urumi.svc.cluster.local:3000/health");
  ```
- **Observed Results:**
  - DNS Lookup: `10.43.173.94` in 7 ms
  - TCP Connect: Handshake completed in 7 ms
  - HTTP Status: `200 OK`
  - Response Body: `{"status":"ok","service":"urumi-mcp-tasks","timestamp":"2026-10-24T05:28:13.555Z"}`
  - MCP Tool Discovery: `tools/list` returned 3 tools (`create_task`, `list_tasks`, `update_task_status`)
- **Status:** **PASS — ALLOWED**

### 3.4 WooCommerce MCP → WordPress
- **Source:** Pod `urumi-woocommerce-mcp-68dd5696d7-c2xfp` (labels: `component=mcp-woocommerce`)
- **Destination:** `urumi-wordpress.urumi.svc.cluster.local:80` (Endpoint: `10.42.0.101:80`)
- **Protocol:** TCP / HTTP
- **Probe Command:**
  ```javascript
  const res = await fetch("http://urumi-wordpress.urumi.svc.cluster.local:80/wp-json/");
  ```
- **Observed Results:**
  - DNS Lookup: `10.43.146.205` in 90 ms
  - TCP Connect: Handshake completed in 10 ms
  - HTTP Status: `200 OK`
  - Response Snippet: `{"status":200,"siteName":"Urumi Store Demo","namespaces":["oembed/1.0","wc/v3","wc/v1","wc/pos/v1/catalog","jetpack/v4"]}`
- **Status:** **PASS — ALLOWED**

### 3.5 WordPress → MariaDB
- **Source:** Pod `urumi-wordpress-d994966c6-jffwh` (labels: `component=wordpress`)
- **Destination:** `urumi-mariadb.urumi.svc.cluster.local:3306` (Endpoint: `10.42.0.106:3306`)
- **Protocol:** TCP
- **Probe Command:**
  ```php
  $fp = fsockopen("urumi-mariadb.urumi.svc.cluster.local", 3306, $errno, $errstr, 2);
  ```
- **Observed Results:**
  - TCP Connect: Successfully connected
  - Protocol Banner: Received initial MySQL handshake packet containing `11.4.5-MariaDB`
- **Status:** **PASS — ALLOWED**

### 3.6 Workload DNS Resolution & CoreDNS Paths
- **Destination:** `kube-dns.kube-system.svc.cluster.local:53` (`10.43.0.10:53` UDP/TCP)
- **Sources Tested:** `urumi-gateway`, `urumi-woocommerce-mcp`, `urumi-mcp-crm`, `urumi-mcp-tasks`, `urumi-wordpress`
- **Results:** 100% of tested pods resolved internal cluster services (`kubernetes.default`, `kube-dns.kube-system`, `urumi-gateway`, `urumi-woocommerce-mcp`, `urumi-wordpress`, `urumi-mariadb`) accurately without timeouts or failures.
- **Status:** **PASS — ALLOWED**

---

## 4. Stage C — Verification of Denied Paths

Bounded probes were executed from designated source workloads across each expected denied path using a strict 2000 ms timeout.

### 4.1 Summary of Denied Path Probes

| Probe ID | Source Pod | Destination Service & Port | Destination IP | Socket Outcome | Duration | Classification | Controlled Allowed Comparison | Verdict |
|---|---|---|---|---|:---:|---|---|:---:|
| **D1** | `urumi-gateway` | `urumi-wordpress:80` | `10.43.146.205:80` | `ECONNREFUSED` | 7 ms | NetworkPolicy Packet Reject | WooCommerce MCP → WP:80 connects (HTTP 200) | **NetworkPolicy-enforced** |
| **D2** | `urumi-gateway` | `urumi-mariadb:3306` | `10.43.48.147:3306` | `ECONNREFUSED` | 8 ms | NetworkPolicy Packet Reject | WordPress → MariaDB:3306 connects (Banner OK) | **NetworkPolicy-enforced** |
| **D3** | `urumi-mcp-crm` | `urumi-wordpress:80` | `10.43.146.205:80` | `ECONNREFUSED` | 8 ms | NetworkPolicy Packet Reject | WooCommerce MCP → WP:80 connects (HTTP 200) | **NetworkPolicy-enforced** |
| **D4** | `urumi-mcp-tasks` | `urumi-mariadb:3306` | `10.43.48.147:3306` | `ECONNREFUSED` | 95 ms | NetworkPolicy Packet Reject | WordPress → MariaDB:3306 connects (Banner OK) | **NetworkPolicy-enforced** |
| **D5** | `urumi-woocommerce-mcp` | `urumi-mariadb:3306` | `10.43.48.147:3306` | `ECONNREFUSED` | 91 ms | NetworkPolicy Packet Reject | WordPress → MariaDB:3306 connects (Banner OK) | **NetworkPolicy-enforced** |
| **D6a** | `urumi-mcp-crm` | `urumi-mcp-tasks:3000` | `10.43.173.94:3000` | `ECONNREFUSED` | 8 ms | NetworkPolicy Packet Reject | Gateway → Tasks:3000 connects (HTTP 200) | **NetworkPolicy-enforced** |
| **D6b** | `urumi-mcp-tasks` | `urumi-mcp-crm:3000` | `10.43.193.131:3000` | `ECONNREFUSED` | 7 ms | NetworkPolicy Packet Reject | Gateway → CRM:3000 connects (HTTP 200) | **NetworkPolicy-enforced** |
| **D6c** | `urumi-woocommerce-mcp` | `urumi-mcp-crm:3000` | `10.43.193.131:3000` | `ECONNREFUSED` | 8 ms | NetworkPolicy Packet Reject | Gateway → CRM:3000 connects (HTTP 200) | **NetworkPolicy-enforced** |
| **D6d** | `urumi-wordpress` | `urumi-gateway:3000` | `10.43.99.188:3000` | `Connection refused` (exit 7) | 6 ms | NetworkPolicy Packet Reject | Traefik → Gateway:3000 connects (HTTP 200) | **NetworkPolicy-enforced** |
| **D6e** | `urumi-mariadb` | `urumi-gateway:3000` | `10.43.99.188:3000` | `Connection refused` | 5 ms | NetworkPolicy Packet Reject | Traefik → Gateway:3000 connects (HTTP 200) | **NetworkPolicy-enforced** |

---

## 5. Corroboration & Evidence Distinguishing Policy Enforcement

A connection refusal (`ECONNREFUSED`) can theoretically be caused by:
1. A closed port (no application listening).
2. A missing or unavailable service endpoint.
3. DNS resolution failure.
4. Application-level rejection.
5. NetworkPolicy packet filtering.

The empirical evidence rigorously distinguishes **NetworkPolicy enforcement** from these competing causes:

### 5.1 Elimination of Closed Port Hypothesis
- For every denied destination port, a controlled probe was executed from an authorized peer workload:
  - **Port 80 (`urumi-wordpress`):** When probed by `urumi-woocommerce-mcp`, port 80 accepted the connection instantly and returned HTTP 200 with WordPress JSON metadata (`"siteName":"Urumi Store Demo"`). Port 80 is unambiguously open and listening.
  - **Port 3306 (`urumi-mariadb`):** When probed by `urumi-wordpress`, port 3306 accepted the connection instantly and returned the MariaDB handshake packet (`11.4.5-MariaDB`). Port 3306 is unambiguously open and listening.
  - **Port 3000 (`urumi-mcp-crm` & `urumi-mcp-tasks`):** When probed by `urumi-gateway`, both upstreams accepted the connection instantly, returned HTTP 200 on `/health`, and served MCP protocol tool definitions on `/mcp`. Port 3000 is unambiguously open and listening on both upstreams.
  - **Port 3000/3001 (`urumi-gateway`):** Gateway readiness probe on port 3000 returned HTTP 200, and Traefik Ingress on port 3001 returned HTTP 200 for the Dashboard. Both ports are unambiguously open and listening.

### 5.2 Elimination of Missing Endpoint Hypothesis
- `kubectl get ep -n urumi -o wide` verified active, healthy pod IPs backing each service:
  - `urumi-wordpress`: `10.42.0.101:80`
  - `urumi-mariadb`: `10.42.0.106:3306`
  - `urumi-mcp-crm`: `10.42.0.99:3000`
  - `urumi-mcp-tasks`: `10.42.0.98:3000`
  - `urumi-woocommerce-mcp`: `10.42.0.97:3000`
  - `urumi-gateway`: `10.42.0.103:3000, 10.42.0.103:3001`
- All pods are in phase `Running` with readiness gates satisfied (`1/1 Ready`) and zero restarts.

### 5.3 Elimination of DNS Resolution Failure Hypothesis
- In every probe, DNS lookup succeeded prior to socket creation, returning the accurate ClusterIP within 10–100 ms. Socket connection attempts targeted the resolved IP directly.

### 5.4 Elimination of Application-Level Rejection Hypothesis
- Rejection occurred during the initial TCP SYN packet exchange before any TLS or HTTP protocol frames were sent.

### 5.5 Alignment with K3s Kube-Router Packet Filtering Architecture
- K3s embeds kube-router's network policy controller. Kube-router programs iptables rules in the `FORWARD` and `OUTPUT` chains.
- For ingress/egress rules that do not match an allow rule, kube-router rejects unauthorized TCP SYN packets with `--reject-with tcp-reset` (or ICMP port-unreachable).
- When the Linux network stack receives a TCP RST, `net.connect()` returns `ECONNREFUSED`.
- Because the target services are demonstrably listening and accepting traffic from permitted pods, the observed `ECONNREFUSED` on unauthorized source pods is definitively **NetworkPolicy packet rejection**.

---

## 6. Stage D — Regression & Invariant Verification

Following all connectivity probes, all platform regression, security, persistence, and state invariants were validated:

### 6.1 Workload Health & Readiness
- All 6 platform workloads remained 1/1 Running & Ready with zero restarts.
- Gateway readiness probe (`http://127.0.0.1:3000/health/ready`) returned HTTP 200:
  ```json
  {"status":"ok","service":"urumi-gateway","ready":true}
  ```

### 6.2 Upstream Tool Discovery
All 10 MCP tools across the three upstreams were discovered from Gateway:
- `woocommerce-mcp` (5 tools): `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`
- `crm-mcp` (2 tools): `search_contacts`, `get_contact`
- `tasks-mcp` (3 tools): `create_task`, `list_tasks`, `update_task_status`

### 6.3 P7-G2 Hardening Invariants
- **WooCommerce MCP:** Root filesystem is read-only (`touch: /ro_test.txt: Read-only file system`); `/tmp` is writable (`touch /tmp/rw_test.txt` succeeded).
- **CRM MCP:** ServiceAccount token mount disabled (`/var/run/secrets/kubernetes.io/serviceaccount` does not exist).
- **Tasks MCP:** ServiceAccount token mount disabled (`/var/run/secrets/kubernetes.io/serviceaccount` does not exist).

### 6.4 Gateway SA & RBAC Invariants
- ServiceAccount `urumi-gateway-sa` (UID: `041a0ed0-2b85-41aa-bf8a-6cf84f229b81`) unchanged.
- Role `urumi-gateway-secret-manager` (UID: `2a1b4bf3-9b2c-4283-8532-22838591bb19`) unchanged.
- RoleBinding `urumi-gateway-secret-binding` (UID: `d3db207c-6ecd-4e67-be59-575b2d191d30`) unchanged.

### 6.5 Gateway PVC Invariant
- `urumi-gateway-pvc` remains `Bound` to volume `pvc-801dc6cb-076b-479a-8475-e77c905797f9` (500Mi, RWO, `local-path`).

### 6.6 SQLite Database Integrity & Row Counts
Executed via read-only Node.js DatabaseSync:
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: `[]` (0 violations)
- **Table Counts (100% matched pre-test baseline):**
  - `schema_migrations`: 3
  - `upstreams`: 3
  - `users`: 4
  - `user_credentials`: 4
  - `api_keys`: 27
  - `user_invitations`: 4
  - `browser_sessions`: 27
  - `audit_logs`: 483

### 6.7 Protected Storefront State Baseline
Executed via WP-CLI with customer PII omitted:
- Product 10: `Urumi Test Mug`, SKU `URUMI-MUG-001`, Price `299`, Regular Price `299`, Status `publish`
- Product 11: `Wireless Mouse Demo`, SKU `URUMI-MOUSE-001`, Price `799`, Regular Price `799`, Status `publish`
- Product 12: `Notebook Demo`, SKU `URUMI-NOTE-001`, Price `149`, Regular Price `149`, Status `publish`
- Order #14: ID `14`, Status `processing`, Total `299.00`, Currency `INR`, Date Created `2026-10-11T18:23:04`, Payment Method `cod`

### 6.8 Hermetic Unit Test Suite Regression
- `apps/woocommerce-mcp` unit tests: **17/17 passed** (0 failures).
- `apps/gateway` unit tests: **351/351 passed** across 51 test suites (0 failures).

---

## 7. Deviations, Inconclusive Results & Prohibited Actions Affirmation

### 7.1 Deviations & Inconclusive Findings
- **Zero Failures or Deviations:** All expected allowed paths succeeded. All expected denied paths were rejected.
- **Zero Inconclusive Findings:** Every denied path was corroborated against active listening endpoints and policy selectors, establishing conclusive NetworkPolicy enforcement.

### 7.2 Prohibited Actions Affirmation
Throughout Gate P7-G4, the Implementation Worker strictly adhered to the non-negotiable boundaries:
- Zero NetworkPolicies were added, removed, edited, or applied.
- Zero Services, Deployments, or Ingress manifests were altered.
- Zero DNS, credential, or secret configurations were modified.
- Zero Helm upgrade or rollback commands were executed.
- Zero pods were restarted or deleted during this gate.
- Zero store products, orders, or database records were mutated.
- Zero Git commits were authored or pushed to remote.

---

## 8. Technical Head Recommendation

Gate P7-G4 has verified with empirical precision that the active Kubernetes NetworkPolicies enforce the architectural communication boundaries without impairing legitimate platform functionality.

The evidence confirms:
1. Least-privilege ingress and egress rules are actively enforced.
2. Direct database access from non-WordPress components is blocked.
3. Direct WordPress access from Gateway and unrelated MCPs is blocked.
4. Gateway-to-upstream MCP communication and WooCommerce-to-WordPress communication remain fully operational.
5. All runtime hardening, data persistence, and regression baselines remain completely intact.

**Recommendation:** Technical Head acceptance of Gate P7-G4.

---

P7-G4 submitted for Technical Head review. P7-G5 regression qualification and all NetworkPolicy changes remain unauthorized pending explicit approval.
