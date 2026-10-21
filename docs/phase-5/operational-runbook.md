# Phase 5 Operational & Disaster Recovery Runbook

**Service**: `apps/gateway` & `apps/dashboard` (Urumi Enterprise Gateway Platform)  
**Environment**: Kubernetes (`k3d-urumi`), Namespace: `urumi`  
**Database**: SQLite via Node.js core `node:sqlite` in WAL Mode (`/data/gateway.db`)  
**Storage Volume**: PVC `urumi-gateway-pvc` (500Mi, `local-path` StorageClass)  
**Architecture References**: [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md), [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md), [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md), [`ADR-019`](../decisions/ADR-019-browser-identity-session-and-csrf.md), [`ADR-020`](../decisions/ADR-020-dual-listener-and-ingress-perimeter.md), [`architecture.md`](../architecture.md)

---

## 1. System Architecture & Runtime Topology

The Urumi Platform operates as a single-replica, dual-listener Node.js 24 LTS container running inside Kubernetes:

```
                            ┌────────────────────────────────────────────────────────┐
                            │                    Ingress Perimeter                   │
                            │              (Traefik on k3d-urumi)                    │
                            └───────────────┬────────────────────────┬───────────────┘
                                            │                        │
       http://urumi-gateway.local/mcp       │                        │  http://urumi-dashboard.local/
                     │                      ▼                        ▼                      │
                     │             ┌─────────────────┐      ┌─────────────────┐             │
                     │             │ Service Port    │      │ Service Port    │             │
                     │             │ http-mcp: 3000  │      │ http-browser:   │             │
                     │             └────────┬────────┘      │ 3001            │             │
                     │                      │               └────────┬────────┘             │
                     │                      ▼                        ▼                      │
                     │       ┌──────────────────────────────────────────────────────┐       │
                     │       │              urumi-gateway Pod (replicas: 1)         │       │
                     │       │                                                      │       │
                     └──────►│ Port 3000: MCP JSON-RPC 2.0 & SSE Stream             │◄──────┘
                             │  - Bearer Token Auth ONLY (mcp_live_...)             │
                             │  - Tools: WooCommerce, Mock CRM, Mock Tasks          │
                             │                                                      │
                             │ Port 3001: Browser Control Plane                     │
                             │  - Cookie Session Auth + Scrypt KDF + CSRF Defense   │
                             │  - Management API: /api/v1/browser/*                 │
                             │  - Static Dashboard SPA Distribution                 │
                             │                                                      │
                             │ Persistence Engine:                                  │
                             │  - File: /data/gateway.db (WAL Mode)                 │
                             │  - RunAsUser: 10001:10001, File Perms: 0600         │
                             └──────────────────────────────────────────────────────┘
```

---

## 2. Administrator Bootstrap Runbook

When deploying to a fresh environment or during initial commissioning, an initial `admin` account must be provisioned.

### 2.1 In-Cluster Bootstrap Execution
Execute the bootstrap CLI directly inside the running gateway container:

```bash
# Provision an initial administrator interactively or with generated credentials
kubectl -n urumi exec -it deployment/urumi-gateway -c gateway -- \
  node dist/cli/bootstrap-admin.js --username admin --role admin
```

### 2.2 Local / Non-Containerized Bootstrap
For local development against a local SQLite file:

```bash
npm --prefix apps/gateway run cli:bootstrap-admin -- --username admin --role admin
```

### 2.3 Bootstrap Verification Checklist
- [ ] Command outputs user UUID and initial temporary password.
- [ ] Record created in `users` (`role = 'admin'`, `is_active = 1`).
- [ ] Record created in `user_credentials` with algorithm `scrypt` and 32-byte unique salt.
- [ ] Verify administrative login via browser at `http://urumi-dashboard.local` or via curl:
  ```bash
  curl -s -X POST http://urumi-dashboard.local/api/v1/browser/session \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"<generated-password>"}' \
    -c /tmp/admin-cookie.txt
  ```

---

## 3. Team Member & Invitation Lifecycle

The Gateway platform supports invitation-only onboarding for team members with role-based segregation (`admin` vs `member`).

### 3.1 Issuing an Invitation (Admin Only)
Administrators create invitation tokens via the Dashboard UI or via API:

```bash
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/invitations \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/admin-cookie.txt \
  -d '{
    "email": "engineer@urumi.internal",
    "role": "member"
  }'
```
*Response returns an opaque invitation token expiring in 7 days.*

### 3.2 Redeeming an Invitation
The invited user completes onboarding without requiring administrative pre-shared passwords:

```bash
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/invitations/redeem \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<invitation-token>",
    "username": "engineer1",
    "password": "SecurePassword123!"
  }'
```
*Validation rules: Username must be alphanumeric, password minimum 8 characters, token must not be expired or previously redeemed.*

### 3.3 Member Management & Deactivation
Administrators can inspect and deactivate accounts without deleting historical audit attribution:

```bash
# List all active and inactive members
curl -s -X GET http://urumi-dashboard.local/api/v1/browser/members \
  -b /tmp/admin-cookie.txt

# Deactivate a member (revoking all active sessions immediately)
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/members/<user-id>/deactivate \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/admin-cookie.txt

# Reactivate a member
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/members/<user-id>/reactivate \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/admin-cookie.txt
```

---

## 4. Upstream Administration & Health Tracking

The Gateway dynamically aggregates upstream tools from WooCommerce, Mock CRM, and Mock Tasks.

### 4.1 Upstream Registry Operations
```bash
# Register an upstream service
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/upstreams \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/admin-cookie.txt \
  -d '{
    "id": "crm-service",
    "name": "Enterprise CRM",
    "url": "http://urumi-mock-crm:3000/mcp",
    "transport": "streamable-http",
    "enabled": true
  }'

# Inspect tools aggregated from an upstream
curl -s -X GET http://urumi-dashboard.local/api/v1/browser/upstreams/crm-service/tools \
  -b /tmp/admin-cookie.txt

# Disable an upstream (instantly unpublishes its tools from the MCP catalog)
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/upstreams/crm-service/disable \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/admin-cookie.txt
```

### 4.2 Upstream Circuit Breakers & Auto-Recovery
- **Circuit Breaker Threshold**: 5 consecutive failures / timeouts trip the upstream circuit breaker to `OPEN`.
- **Health Tracking**: Periodic background probe executes `tools/list` ping.
- **Fail-Open / Isolation**: A failing upstream does not impact healthy upstreams; healthy tools remain executable.
- **Retry / Cleanup**: `POST /api/v1/browser/upstreams/:id/retry-cleanup` forces circuit reset and cache eviction.

---

## 5. API Key Lifecycle & Rotation

Machine-to-machine agents accessing MCP tools over Port 3000 authenticate via cryptographically random Bearer tokens.

### 5.1 Issuing an API Key
```bash
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/keys \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/admin-cookie.txt \
  -d '{
    "name": "claude-desktop-agent",
    "scopes": ["mcp:tools:read", "mcp:tools:execute"],
    "expires_in_days": 90
  }'
```
*Note: The raw key (`mcp_live_<hex32>`) is displayed exactly once in the response. Only its SHA-256 hash is persisted.*

### 5.2 Key Revocation
```bash
curl -s -X POST http://urumi-dashboard.local/api/v1/browser/keys/<key-id>/revoke \
  -H "X-Requested-With: XMLHttpRequest" \
  -b /tmp/admin-cookie.txt
```
*Revocation is immediate; subsequent requests with the key return HTTP 401 Unauthorized.*

---

## 6. Audit Trail & Compliance Inspection

Every tool invocation executes two-phase audit logging in accordance with `ADR-014`.

### 6.1 Audit Inspection
```bash
# Query audit logs (Admin only, paginated, sorted descending by timestamp)
curl -s -X GET "http://urumi-dashboard.local/api/v1/browser/audit?page=1&limit=50" \
  -b /tmp/admin-cookie.txt
```

### 6.2 Data Redaction Invariant
- Customer email addresses, phone numbers, and physical billing addresses are masked before SQLite insertion (`*** REDACTED ***`).
- Financial amounts and product IDs are preserved for reconciliation.

---

## 7. Disaster Recovery & Backup Runbook

### 7.1 SQLite WAL Invariants & Companion Files
Under Write-Ahead Logging (`PRAGMA journal_mode = WAL`), active transactions write to:
- `/data/gateway.db-wal` (write frames)
- `/data/gateway.db-shm` (shared memory index)

> [!WARNING]
> **Do not use raw `cp /data/gateway.db` while the process is active.** Copying only the primary file leaves uncheckpointed frames behind, resulting in a corrupted database upon restore.

### 7.2 Non-Blocking Online Backup Procedure
The Gateway includes an automated online backup mechanism using SQLite's native `VACUUM INTO` command:

```bash
# Trigger an online backup inside the running container
kubectl -n urumi exec deployment/urumi-gateway -c gateway -- \
  node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/data/gateway.db');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = '/data/backups/gateway-' + ts + '.db';
    db.exec(\"VACUUM INTO '\" + dest + \"'\");
    console.log('Online backup complete:', dest);
  "
```

### 7.3 Complete Disaster Recovery & Restoration Procedure

> [!CAUTION]
> **DESTRUCTIVE OPERATION WARNING**  
> The following steps replace `/data/gateway.db`. Execute this procedure **only** during an authorized maintenance window or after confirmed database corruption. Do NOT execute against a live healthy cluster without explicit change approval.

#### Step 1: Quiesce Application Workload (Scale to 0)
Ensure no active connections hold locks on `/data/gateway.db`:
```bash
kubectl -n urumi scale deployment urumi-gateway --replicas=0
kubectl -n urumi wait --for=delete pod -l app.kubernetes.io/name=urumi-gateway --timeout=60s
```

#### Step 2: Deploy Temporary Maintenance Recovery Pod
Create a temporary pod mounting the persistent volume `urumi-gateway-pvc`:
```yaml
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: gateway-recovery
  namespace: urumi
spec:
  restartPolicy: Never
  securityContext:
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
  volumes:
    - name: gateway-data
      persistentVolumeClaim:
        claimName: urumi-gateway-pvc
  containers:
    - name: recovery
      image: urumi-gateway:1.0.0
      command: ["sh", "-c", "sleep 3600"]
      volumeMounts:
        - name: gateway-data
          mountPath: /data
EOF
```
Wait for pod readiness:
```bash
kubectl -n urumi wait --for=condition=Ready pod/gateway-recovery --timeout=60s
```

#### Step 3: Validate Selected Backup Snapshot Integrity
```bash
# Select desired backup file from /data/backups/
BACKUP_FILE="/data/backups/gateway-<target-timestamp>.db"

kubectl -n urumi exec gateway-recovery -- \
  node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('$BACKUP_FILE');
    const res = db.prepare('PRAGMA integrity_check;').get();
    if (res.integrity_check !== 'ok') {
      console.error('Integrity check failed:', res);
      process.exit(1);
    }
    console.log('Backup integrity verified: OK');
  "
```

#### Step 4: Atomic Database Replacement & File Permission Reset
```bash
kubectl -n urumi exec gateway-recovery -- sh -c "
  # Remove active database and companion WAL/SHM files
  rm -f /data/gateway.db /data/gateway.db-wal /data/gateway.db-shm
  
  # Copy validated snapshot into primary location
  cp $BACKUP_FILE /data/gateway.db
  
  # Ensure strict file permissions
  chmod 600 /data/gateway.db
  chown 10001:10001 /data/gateway.db
  echo 'Database restoration complete.'
"
```

#### Step 5: Clean Up Recovery Pod & Restore Workload
```bash
kubectl -n urumi delete pod gateway-recovery --grace-period=0 --force
kubectl -n urumi scale deployment urumi-gateway --replicas=1
kubectl -n urumi wait --for=condition=Available deployment/urumi-gateway --timeout=90s
```

#### Step 6: Post-Recovery Health & Data Integrity Verification
```bash
# 1. Verify Readiness Probe returns HTTP 200
curl -s -o /dev/null -w "%{http_code}\n" http://urumi-gateway.local/health/ready
# Expected: 200

# 2. Verify all 8 tables are present and queryable
kubectl -n urumi exec deployment/urumi-gateway -c gateway -- \
  node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/data/gateway.db');
    const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table';\").all();
    console.log('Active tables:', tables.map(t => t.name).sort().join(', '));
  "
# Expected: api_keys, audit_logs, browser_sessions, schema_migrations, upstreams, user_credentials, user_invitations, users

# 3. Verify WooCommerce Protected Catalog is intact
# Products 10, 11, 12 and Order #14 must remain untouched
```
