# Gate G4 — SQLite Persistence, Backup, and Disaster Recovery Runbook

**Service:** `apps/gateway` (Urumi Team MCP Gateway)  
**Database Engine:** Node.js 24 LTS core `node:sqlite` (`DatabaseSync`)  
**Storage Mode:** Write-Ahead Logging (WAL)  
**Mount Directory:** `/data` (Mounted from dedicated PVC `urumi-gateway-pvc`, 500Mi capacity)  
**Primary Database Path:** `/data/gateway.db`  
**Related Architecture Decisions:** [`ADR-012`](../decisions/ADR-012-gateway-persistence-node-sqlite-and-wal.md), [`ADR-013`](../decisions/ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md), [`ADR-014`](../decisions/ADR-014-two-phase-audit-logging-and-retention.md)

---

## 1. Storage Architecture & Invariants

### 1.1 File Layout & Companion Files
SQLite in Write-Ahead Logging (WAL) mode generates three active files on disk:
- `/data/gateway.db`: Primary database file containing table schemas and committed B-tree pages.
- `/data/gateway.db-wal`: Write-Ahead Log containing uncheckpointed transactions and newly committed frames.
- `/data/gateway.db-shm`: Shared-Memory index facilitating non-blocking concurrent reader index access.

> [!WARNING]
> **Companion File Consistency Invariant:**  
> A naive `cp` or `tar` of only `/data/gateway.db` while transactions are active produces a corrupted or inconsistent snapshot because recently written frames reside inside `/data/gateway.db-wal`. Live online backups **must** use SQLite's native `VACUUM INTO` mechanism, which flushes and consolidates WAL frames atomically into the destination snapshot.

### 1.2 Permissions and Security Boundaries
- **Pod UID/GID:** `10001:10001` (`mcpuser`), matching pod `securityContext.runAsUser: 10001`.
- **Directory `/data`:** `0700` (`drwx------`) — owned by `10001:10001`.
- **Database `/data/gateway.db`:** `0600` (`-rw-------`).
- **Backups `/data/backups/gateway-*.db`:** `0600` (`-rw-------`).
- *Rationale:* Stripping group and other permissions prevents unprivileged processes on shared Kubernetes nodes from inspecting database files containing API key hashes or audit trails.

### 1.3 Strict Single-Writer Deployment Rule
- Gateway Kubernetes Deployment is strictly configured with:
  ```yaml
  spec:
    replicas: 1
    strategy:
      type: Recreate
  ```
- SQLite does not support distributed multi-writer locks over network filesystems or shared block volumes. The `Recreate` strategy ensures that terminating pods cleanly unmount the volume before replacement pods initialize the database.

### 1.4 Active PRAGMA Settings
Every database connection executes:
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

---

## 2. Online Backup Procedure

### 2.1 Automated Snapshot Mechanism
Online backups are created using SQLite's native non-locking `VACUUM INTO`:
```typescript
import { backupDatabase } from './db/backup.js';

// Executes VACUUM INTO '/data/backups/gateway-<timestamp>.db'
// Verifies PRAGMA integrity_check on the snapshot
// Enforces 0600 permissions
// Retains last 7 daily snapshots
const result = backupDatabase(dbManager.getDb(), '/data/backups', 7);
```

### 2.2 Snapshot Verification
Immediately after snapshot generation, the backup manager opens the new snapshot independently and executes:
```sql
PRAGMA integrity_check;
```
If the check returns anything other than `'ok'`, the backup is immediately unlinked and an alert is raised.

---

## 3. Step-by-Step Disaster Recovery & Restore Procedure

When recovering from database corruption, pod crash loops, or volume data loss:

### Step 1: Scale Gateway to 0 Replicas
Halt all active gateway processes to release file locks on the PVC:
```bash
kubectl -n urumi scale deployment urumi-gateway --replicas=0
```

### Step 2: Launch Ephemeral Recovery Pod or Mount Volume
Run an ephemeral recovery container attaching the PVC `urumi-gateway-pvc`:
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: urumi-gateway-recovery
  namespace: urumi
spec:
  securityContext:
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
  restartPolicy: Never
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: urumi-gateway-pvc
  containers:
    - name: recovery
      image: node:24-bookworm-slim
      command: ["sleep", "3600"]
      volumeMounts:
        - name: data
          mountPath: /data
```

### Step 3: Verify Integrity of Target Backup Snapshot
Exec into the recovery pod and verify the selected snapshot:
```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/data/backups/gateway-<target-timestamp>.db');
const res = db.prepare('PRAGMA integrity_check;').get();
console.log('Integrity check:', res);
db.close();
"
# Expected output: Integrity check: { integrity_check: 'ok' }
```

### Step 4: Clean Stale Files and Restore Snapshot
Remove active database and companion WAL/SHM files to prevent replay of stale transactions:
```bash
# 1. Remove corrupted primary and companion files
rm -f /data/gateway.db /data/gateway.db-wal /data/gateway.db-shm

# 2. Copy verified snapshot to primary position
cp /data/backups/gateway-<target-timestamp>.db /data/gateway.db

# 3. Enforce strict permissions and ownership
chmod 600 /data/gateway.db
chown 10001:10001 /data/gateway.db
```

### Step 5: Terminate Recovery Pod & Scale Gateway to 1
```bash
kubectl -n urumi delete pod urumi-gateway-recovery
kubectl -n urumi scale deployment urumi-gateway --replicas=1
```

### Step 6: Verify Health Probes
```bash
kubectl -n urumi get pods -l app=urumi-gateway
kubectl -n urumi exec deploy/urumi-gateway -- curl -s http://localhost:3000/health/ready
# Expected: {"status":"ok","service":"urumi-gateway","ready":true}
```

---

## 4. Emergency Failure Scenarios

### 4.1 Disk-Full Condition (`SQLITE_FULL`)
- **Symptoms:** Container logs report `SQLITE_FULL: database or disk is full`.
- **Pre-execution Phase 1:** Mutations fail closed immediately with HTTP 500 (`AuditStartError`). Upstream live backends are never called without attribution.
- **Post-execution Phase 2:** If an upstream mutation succeeded before SQLite disk full, the gateway emits high-priority warning `AUDIT_FINALIZATION_DEGRADED` and returns the mutation result to the client with `X-Urumi-Audit-Status: finalization-degraded`.
- **Immediate Mitigation:**
  1. Trigger audit retention pruning:
     ```bash
     # Invokes pruneAuditLogs to delete records older than 30 days
     node -e "
     const { DatabaseManager } = require('./dist/db/connection.js');
     const { AuditRepository } = require('./dist/db/audit-repo.js');
     const { AuditService } = require('./dist/audit/audit-service.js');
     const mgr = new DatabaseManager({ dbPath: '/data/gateway.db' });
     mgr.initialize();
     const svc = new AuditService(new AuditRepository(mgr.getDb()));
     const pruned = svc.pruneAuditLogs(14); // aggressive 14-day pruning
     console.log('Pruned records:', pruned);
     mgr.close();
     "
     ```
  2. Prune old backups in `/data/backups/` keeping only the latest 3.
  3. Expand PVC capacity if volume is consistently near 85% watermark.

### 4.2 Incompatible Schema Version (Rollback Failure Protection)
- If a newer gateway container was deployed and later rolled back to an older image, the older gateway detects `db_version > code_version` during startup migrations.
- **Fail-Closed Invariant:** The gateway refuses to start (`IncompatibleSchemaError`) to prevent corrupting tables modified by the newer version.
- **Remediation:** Restore from a pre-migration backup snapshot or update the gateway image to the matching version.
