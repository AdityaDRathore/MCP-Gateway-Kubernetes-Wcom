# Gate G9 — End-to-End Acceptance, Verification, and Operations Runbook

**Service:** Urumi Team Platform MCP Gateway & Microservices  
**Components:** `apps/gateway`, `apps/woocommerce-mcp`, `apps/mcp-crm`, `apps/mcp-tasks`  
**Target Cluster:** Local Kubernetes (`k3d-urumi`)  
**Namespaces:** `urumi` (Workloads & PVCs), `urumi-gateway-secrets` (Upstream Credentials)  
**Primary Ingress:** `traefik` (`dashboard.127.0.0.1.nip.io:8080`, `shop.127.0.0.1.nip.io:8080`)  
**Gate:** G9 (Phase 4 Final Acceptance & Phase Closure)  
**Related Documents:** [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md), [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md), [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md), [`ADR-015`](../decisions/ADR-015-dynamic-tool-dispatch-and-resilience.md), [`G4 Recovery Runbook`](./g4-recovery-runbook.md)

---

## 1. Operational Overview & Architecture

The Urumi Platform MCP Gateway provides a single, unified Model Context Protocol (MCP) endpoint for AI agents, developers, and team tools while enforcing strict authentication, RBAC, audit logging, per-upstream rate limits, and network isolation across Kubernetes namespaces.

```
                                  [ AI Agent / MCP Client ]
                                             |
                              Bearer Token (urumi_live_...)
                                             |
                                             v
                             [ Traefik Ingress Controller ]
                                             |
                         dashboard.127.0.0.1.nip.io:8080/mcp
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
| Namespace: urumi                                                                        |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  | Pod: urumi-gateway (UID 10001:10001, ReadOnlyRootFS, Recreate Strategy)           |  |
|  |                                                                                   |  |
|  |  +-------------------------+  +----------------------+  +---------------------+   |  |
|  |  | Auth & Constant-Time    |  | Two-Phase Audit      |  | Dynamic Upstream    |   |  |
|  |  | SHA-256 Validator       |  | Hash Redaction       |  | Catalog Manager     |   |  |
|  |  +-------------------------+  +----------------------+  +---------------------+   |  |
|  |               |                            |                       |              |  |
|  |               v                            v                       v              |  |
|  |  +-----------------------------------------------------------------------------+  |  |
|  |  | WAL-Mode SQLite Database (/data/gateway.db, 0600 POSIX mode)                |  |  |
|  |  | Mount: urumi-gateway-pvc (Local-Path, 0700 POSIX mode)                      |  |  |
|  |  +-----------------------------------------------------------------------------+  |  |
|  +-----------------------------------------------------------------------------------+  |
|           |                                 |                                 |         |
|   (NetworkPolicy: 3000)             (NetworkPolicy: 3000)             (NetworkPolicy:   |
|           |                                 |                                3000)      |
|           v                                 v                                 v         |
|  +--------------------+             +--------------------+            +---------------+ |
|  | urumi-mcp-crm      |             | urumi-mcp-tasks    |            | urumi-        | |
|  | Port: 3000         |             | Port: 3000         |            | woocommerce-  | |
|  | Tools: 2           |             | Tools: 2           |            | mcp           | |
|  +--------------------+             +--------------------+            | Tools: 6      | |
|                                                                       +---------------+ |
|                                                                               |         |
|                                                                        (HTTP Port 80)   |
|                                                                               v         |
|                                                                       +---------------+ |
|                                                                       | WordPress /   | |
|                                                                       | WooCommerce   | |
|                                                                       +---------------+ |
|                                                                               |         |
|                                                                        (TCP Port 3306)  |
|                                                                               v         |
|                                                                       +---------------+ |
|                                                                       | MariaDB       | |
|                                                                       +---------------+ |
+-----------------------------------------------------------------------------------------+
| Namespace: urumi-gateway-secrets                                                        |
|  +-----------------------------------------------------------------------------------+  |
|  | K8s Secrets: upstream-sec-* (Encrypted bearer tokens, managed via Gateway SA)     |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Operator Verification Procedures

### 2.1 Cluster Baseline & Pod Readiness
Verify that all 6 pods are healthy and running with zero restarts:
```bash
kubectl get pods -n urumi -o wide
```
Expected output:
- `urumi-gateway-*`: `1/1 Running`
- `urumi-mariadb-0`: `1/1 Running`
- `urumi-mcp-crm-*`: `1/1 Running`
- `urumi-mcp-tasks-*`: `1/1 Running`
- `urumi-woocommerce-mcp-*`: `1/1 Running`
- `urumi-wordpress-*`: `1/1 Running`

Verify PVC volume bindings and UID preservation:
```bash
kubectl get pvc -n urumi -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,UID:.metadata.uid,VOLUME:.spec.volumeName
```
All PVCs (`urumi-gateway-pvc`, `urumi-mariadb-pvc`, `urumi-wordpress-pvc`) must show `STATUS: Bound`.

### 2.2 Ingress & Perimeter Isolation Check
Verify that the public gateway ingress only exposes the `/mcp` route and strictly rejects private admin endpoints:
```bash
# 1. MCP Endpoint (Expect 200 OK with valid token)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Host: dashboard.127.0.0.1.nip.io" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_OR_MEMBER_KEY>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://127.0.0.1:8080/mcp

# 2. Private Admin API via Ingress (Expect 404 Not Found)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Host: dashboard.127.0.0.1.nip.io" \
  http://127.0.0.1:8080/admin/v1/upstreams

# 3. Storefront Health (Expect 200 OK after following redirect)
curl -s -L -o /dev/null -w "%{http_code}\n" \
  -H "Host: shop.127.0.0.1.nip.io" \
  http://127.0.0.1:8080/
```

### 2.3 MCP Protocol Verification Drill
Execute an end-to-end MCP handshake and catalog list using standard JSON-RPC 2.0 payloads:
```bash
# 1. Initialize Handshake
curl -s -H "Host: dashboard.127.0.0.1.nip.io" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <API_KEY>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "operator-drill", "version": "1.0.0" }
    }
  }' http://127.0.0.1:8080/mcp

# 2. Tools Catalog (Verify 10 active tools with reachable: true)
curl -s -H "Host: dashboard.127.0.0.1.nip.io" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <API_KEY>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }' http://127.0.0.1:8080/mcp
```

### 2.4 Protected Store Invariant Verification
Confirm that baseline WooCommerce entities (Products 10, 11, 12 and Order #14) remain unmutated:
```bash
# Verify product and order records
kubectl exec -n urumi deployment/urumi-wordpress -- wp post list \
  --post_type=product,shop_order \
  --allow-root \
  --fields=ID,post_title,post_status,post_type

# Verify Order #14 integrity
kubectl exec -n urumi deployment/urumi-wordpress -- wp wc shop_order get 14 \
  --user=urumi_admin \
  --allow-root \
  --fields=id,status,total,currency,date_created
```
Expected output for Order #14: `status: processing`, `total: 299.00`, `currency: INR`.

---

## 3. Troubleshooting & Operational Runbooks

### 3.1 Defect Runbook: Storage InitContainer Permission Failures (`DAC_OVERRIDE`)

#### Symptom:
When the `urumi-gateway` pod restarts or is rescheduled, the `volume-permissions` initContainer fails with:
```
chown: /data: Permission denied
chmod: /data: Permission denied
```
Pod status displays `Init:CrashLoopBackOff` or `Init:Error`.

#### Root Cause:
The gateway volume (`urumi-gateway-pvc`) is mounted as a local-path directory with POSIX mode `0700` (`drwx------`) owned by UID `10001:10001`. The `volume-permissions` initContainer runs as `runAsUser: 0` (root) with dropped Linux capabilities. In Linux kernel security models, root cannot traverse or modify a directory owned by another user without the `CAP_DAC_OVERRIDE` capability.

#### Resolution:
Verify that `infra/helm/urumi-platform/templates/gateway-deployment.yaml` explicitly grants `DAC_OVERRIDE` to the initContainer:
```yaml
initContainers:
  - name: volume-permissions
    image: busybox:1.36
    command: ["sh", "-c", "chown -R 10001:10001 /data && chmod 0700 /data"]
    securityContext:
      runAsUser: 0
      capabilities:
        drop:
          - ALL
        add:
          - CHOWN
          - FOWNER
          - DAC_OVERRIDE
```
If missing, apply the Helm upgrade:
```bash
helm upgrade urumi-store infra/helm/urumi-platform -f infra/helm/urumi-platform/values-local.yaml -n urumi
```

---

### 3.2 NetworkPolicy Probing & Connectivity Troubleshooting

The gateway operates under a strict default-deny egress NetworkPolicy (`urumi-gateway-egress-policy`).

#### Permitted Outbound Destinations:
1. `urumi/urumi-mcp-crm`: TCP port `3000`
2. `urumi/urumi-mcp-tasks`: TCP port `3000`
3. `urumi/urumi-woocommerce-mcp`: TCP port `3000`
4. Kubernetes DNS (`kube-system/kube-dns`): UDP/TCP port `53`
5. Kubernetes API Server (`10.43.0.1` port `443` or node `172.19.0.2` port `6443`)

#### Forbidden Outbound Destinations:
- `urumi/urumi-wordpress`: TCP port `80` (BLOCKED)
- `urumi/urumi-mariadb`: TCP port `3306` (BLOCKED)
- External Internet IP blocks (BLOCKED)

#### Probe Diagnostic Command:
To probe connectivity from inside the running gateway container:
```bash
# Probe CRM (Expect 200 OK)
kubectl exec -n urumi deployment/urumi-gateway -c gateway -- node -e '
  fetch("http://urumi-mcp-crm:3000/health").then(r => console.log("CRM Status:", r.status)).catch(e => console.error("CRM Fail:", e.message));
'

# Probe WordPress (Must Fail Closed with TypeError: fetch failed)
kubectl exec -n urumi deployment/urumi-gateway -c gateway -- node -e '
  fetch("http://urumi-wordpress:80/").then(r => console.log("WP Status:", r.status)).catch(e => console.error("WP Blocked:", e.message));
'
```

---

### 3.3 Dynamic Upstream Credential Rotation

When an upstream microservice rotates its bearer token:

1. Obtain the upstream slug (e.g., `crm`, `tasks`, `woocommerce`).
2. Make an authenticated request to the Admin API:
   ```bash
   kubectl exec -n urumi deployment/urumi-gateway -c gateway -- node -e '
     const token = process.env.MCP_ADMIN_BOOTSTRAP_TOKEN;
     fetch("http://127.0.0.1:3000/admin/v1/upstreams/<SLUG>/credential", {
       method: "PUT",
       headers: {
         "Authorization": `Bearer ${token}`,
         "Content-Type": "application/json"
       },
       body: JSON.stringify({ credential: "<NEW_BEARER_TOKEN>" })
     }).then(r => r.json()).then(d => console.log("Rotation Result:", d));
   '
   ```
3. The gateway automatically:
   - Updates the corresponding Secret `upstream-sec-<SLUG>-<HASH>` in `urumi-gateway-secrets`.
   - Re-establishes the SSE/HTTP client connection with the new credential.
   - Preserves continuous downstream tool availability without restarting the pod.

---

### 3.4 Concurrency Queue Exhaustion & Rate Limiting

The gateway enforces two tiers of concurrency management:
1. **Global Concurrency Ceiling:** 20 simultaneous active requests. Requests exceeding 20 return HTTP `429 Too Many Requests`.
2. **Per-Upstream FIFO Queue:** Maximum 4 active requests + 10 queued requests per upstream microservice.

#### Symptoms:
- Client receives HTTP `429 Too Many Requests` or JSON-RPC internal error `-32603: Per-upstream concurrency queue full`.
- Gateway logs emit: `Per-upstream concurrency queue full for '<SLUG>'`.

#### Operational Response:
1. Check pod CPU and memory usage:
   ```bash
   kubectl top pod -n urumi -l app.kubernetes.io/component=gateway
   ```
2. If the upstream service is responding slowly, check its logs:
   ```bash
   kubectl logs -n urumi deployment/urumi-<SLUG> --tail=50
   ```
3. Verify upstream timeout configuration (default 10,000ms). Adjust via Admin API if legitimate operations require longer processing windows:
   ```bash
   PATCH /admin/v1/upstreams/<SLUG>
   { "timeoutMs": 15000 }
   ```

---

## 4. Non-Destructive Backup Drill Procedure

SQLite WAL mode writes dirty pages to `/data/gateway.db-wal`. Performing a standard `cp` or `tar` while the gateway is actively processing requests results in a corrupt or incomplete backup.

### 4.1 Native `VACUUM INTO` Backup Execution
Execute a non-locking, atomic backup directly into an isolated snapshot file:
```bash
# 1. Trigger online snapshot from inside the container
kubectl exec -n urumi deployment/urumi-gateway -c gateway -- node -e '
  const { backupDatabase } = require("./dist/db/backup.js");
  const result = backupDatabase();
  console.log("Snapshot Created:", result);
'

# 2. Verify snapshot integrity
kubectl exec -n urumi deployment/urumi-gateway -c gateway -- node -e '
  const { DatabaseSync } = require("node:sqlite");
  const fs = require("node:fs");
  const files = fs.readdirSync("/data/backups").filter(f => f.endsWith(".db"));
  const latest = "/data/backups/" + files.sort().pop();
  const db = new DatabaseSync(latest);
  const check = db.prepare("PRAGMA integrity_check").get();
  console.log("Backup File:", latest, "Integrity:", check);
'
```

### 4.2 Snapshot Export
Copy the verified snapshot out of the Kubernetes cluster to the operator workstation:
```bash
LATEST_BACKUP=$(kubectl exec -n urumi deployment/urumi-gateway -c gateway -- sh -c 'ls -1 /data/backups/*.db | tail -n 1')
kubectl cp -n urumi deployment/urumi-gateway:${LATEST_BACKUP} ./gateway-backup-latest.db -c gateway
ls -lh ./gateway-backup-latest.db
```

---

## 5. Benchmark Methodology & Execution Guide

The benchmark harness tests latency, throughput, error rates, and resource utilization across increasing concurrency tiers while enforcing non-destructive read operations.

### 5.1 Methodology Specifications
- **Timing Measurement:** Monotonic high-resolution clock (`performance.now()`).
- **Percentile Calculation:** NIST Nearest Rank Method with boundary clamping:
  $$\text{Rank} = \lceil \frac{P}{100} \times N \rceil, \quad \text{Index} = \max(0, \min(N - 1, \text{Rank} - 1))$$
- **Request Workload:** Rotates sequentially across:
  - CRM: `crm__search_contacts` (limit: 5)
  - Tasks: `tasks__list_tasks` (limit: 5)
  - WooCommerce: `woocommerce__get_order` (order_id: 14)
- **Concurrency Tiers:** $C \in \{1, 5, 10, 20\}$ with 100 requests per tier.
- **Resource Footprint:** Recorded via Kubernetes metrics server (`kubectl top pod`).

### 5.2 Executing the Benchmark
Run the automated benchmark suite against the local cluster:
```bash
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"
npm --workspace=gateway run test:benchmark
```

### 5.3 Baseline Benchmark Results (Gate G9)
```
================================================================================
📈 Gate G9 Empirical Performance Benchmark Summary
================================================================================
Concurrency | Total Reqs | Success | Failed | Throughput | p50 (ms) | p95 (ms) | p99 (ms) | Error Rate
------------|------------|---------|--------|------------|----------|----------|----------|-----------
1           | 100        | 100     | 0      |   10.2 rps |     20.6 |    301.2 |    463.7 | 0.0%
5           | 100        | 100     | 0      |   10.2 rps |    105.1 |   1654.4 |   1813.9 | 0.0%
10          | 100        | 99      | 1      |   11.2 rps |    501.1 |   2797.7 |   3279.2 | 1.0%
20          | 100        | 100     | 0      |   11.2 rps |   1091.6 |   3204.5 |   3516.0 | 0.0%
================================================================================
Initial Pod Usage: 2m CPU, 59Mi Memory
Final Pod Usage:   128m CPU, 54Mi Memory (Memory delta: -5Mi; Zero memory leaks)
================================================================================
```

---

## 6. Emergency Recovery Checklist

| Incident | Immediate Action | Runbook Section |
| :--- | :--- | :--- |
| **Pod CrashLoopBackOff after PVC mount** | Check for `DAC_OVERRIDE` capability in `volume-permissions` initContainer. | Section 3.1 |
| **Tool Call Egress Timeout** | Check upstream pod health (`kubectl get pods`) and verify NetworkPolicy rules. | Section 3.2 |
| **Admin Key Compromised** | Trigger emergency API key rotation via `bootstrap.ts` CLI tool in container. | ADR-013 & Section 3.3 |
| **Gateway 429 Too Many Requests** | Check concurrent traffic volume; inspect upstream queue fill warnings. | Section 3.4 |
| **Database Corruption Suspected** | Run `PRAGMA integrity_check`; restore from latest `VACUUM INTO` snapshot. | Section 4.1 |
