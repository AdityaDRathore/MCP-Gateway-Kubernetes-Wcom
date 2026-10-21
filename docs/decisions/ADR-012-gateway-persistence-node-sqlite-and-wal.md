# ADR-012: Gateway Storage Engine via Node.js Built-in `node:sqlite`, WAL Concurrency, Permissions, and Disaster Recovery

**Status**: Accepted & Empirically Verified (Phase 5 Gate P5-G6 Stage 5)  
**Date**: 2026-10-15 (Revised: 2026-10-21)  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-001`](./ADR-001-stack-and-deployment.md), [`ADR-004`](./ADR-004-stateful-storage-and-workload-controllers.md), [`ADR-014`](./ADR-014-two-phase-audit-logging-and-retention.md), [`ADR-019`](./ADR-019-browser-identity-session-and-csrf.md), [`ADR-020`](./ADR-020-dual-listener-and-ingress-perimeter.md)  

---

## 1. Context & Problem Statement

Phase 4 requires persistent storage for the central Team MCP Gateway (`apps/gateway`) to maintain users, API keys, registered upstreams, and audit logs across pod replacements.

We must specify:
1. File paths, Linux filesystem ownership, and strict file permissions.
2. Complete disaster recovery, integrity verification, and step-by-step restore procedures.
3. Migration transaction atomicity and fail-closed startup semantics.
4. Disk-full behavior under SQLite WAL operation.

---

## 2. Decision & Technical Architecture

### 2.1 Driver Selection & Zero-Compilation Baseline
- **Driver**: Node.js core **`node:sqlite`** (`import { DatabaseSync } from 'node:sqlite'`), standard in Node.js 24 LTS.
- **Empirical Proof**: Verified live on Node `v24.20.0` in the local workspace.
- **Benefits**: Eliminates external native C++ modules (`better-sqlite3`, `sqlite3`), removes `python3`/`make`/`g++` build dependencies, and eliminates ABI incompatibilities across Alpine and Debian images.

### 2.2 Storage Layout, File Ownership & Permissions
- **PVC Mount Directory**: `/data` (Mounted from dedicated PVC `urumi-gateway-pvc`, 500Mi capacity, `local-path` StorageClass).
- **Primary Database File**: `/data/gateway.db`
- **WAL & SHM Files**: `/data/gateway.db-wal`, `/data/gateway.db-shm`
- **Backup Directory**: `/data/backups/`
- **Ownership**: UID `10001` (user `mcpuser`), GID `10001` (group `mcpuser`), matching pod `securityContext.runAsUser: 10001`.
- **Permissions**:
  - Directory `/data`: `0700` (`drwx------`)
  - Database file `/data/gateway.db`: `0600` (`-rw-------`)
  - Backup files `/data/backups/gateway-*.db`: `0600` (`-rw-------`)
- *Rationale*: Group-read and other-read permissions are strictly stripped to prevent unprivileged processes on the shared node from reading database files.

### 2.3 Required PRAGMA Configuration
Every database initialization executes the following PRAGMAs:
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

### 2.4 Workload Controller: Single-Replica & Single-Writer
- Gateway Deployment is strictly configured with **`replicas: 1`** and **`strategy: { type: Recreate }`**.
- SQLite does not support distributed multi-writer locks. `Recreate` ensures the terminating pod unmounts the volume before a replacement pod attempts initialization.

---

### 2.5 Migration Transaction Atomicity & Fail-Closed Startup

Database schema migrations are executed under strict transactional rules:

```typescript
export function runMigrations(db: DatabaseSync, migrations: Migration[]): void {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const currentVersionRow = db.prepare('SELECT MAX(version) as ver FROM schema_migrations').get() as { ver: number | null };
  const currentVersion = currentVersionRow?.ver ?? 0;

  // 1. Fail-Closed Check: Detect newer schema version
  const maxCodeVersion = Math.max(...migrations.map((m) => m.version), 0);
  if (currentVersion > maxCodeVersion) {
    throw new FatalDatabaseError(
      `Database schema version (${currentVersion}) is newer than application supported version (${maxCodeVersion}). Startup aborted to prevent corruption.`
    );
  }

  // 2. Execute Pending Migrations in Individual Immediate Transactions
  const pending = migrations.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);')
        .run(migration.version, migration.name, Math.floor(Date.now() / 1000));
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw new FatalDatabaseError(`Migration ${migration.version} (${migration.name}) failed. Transaction rolled back. Startup halted. Error: ${err}`);
    }
  }
}
```

#### Canonical Migration 001 Core Schema:
```sql
-- Migration 001: Initial Core Schema
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
  created_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE upstreams (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 10000 CHECK(timeout_ms BETWEEN 500 AND 30000),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('provisioning', 'active', 'disabled', 'deleting', 'cleanup_required', 'failed')),
  secret_ref_name TEXT,
  secret_ref_key TEXT,
  cleanup_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  upstream_slug TEXT,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed', 'timeout', 'client_disconnected', 'unconfirmed_outcome')),
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_audit_status_created ON audit_logs(status, created_at);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
```

---

### 2.6 Online Backup, Integrity Verification & Restore Procedures

#### Backup Execution (`backupDatabase()`):
- Triggered daily via cron or on administrator demand (`POST /admin/v1/database/backup`).
- Uses SQLite's native non-locking **`VACUUM INTO '<destination_path>'`**:
  ```typescript
  const backupFileName = `gateway-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  const backupPath = `/data/backups/${backupFileName}`;
  
  // 1. Snapshot database
  db.exec(`VACUUM INTO '${backupPath}';`);
  fs.chmodSync(backupPath, 0o600);

  // 2. Immediate Integrity Verification of Snapshot
  const verifyDb = new DatabaseSync(backupPath);
  const integrityRow = verifyDb.prepare('PRAGMA integrity_check;').get() as { integrity_check: string };
  verifyDb.close();

  if (integrityRow.integrity_check !== 'ok') {
    fs.unlinkSync(backupPath);
    throw new Error(`Backup integrity check failed: ${integrityRow.integrity_check}`);
  }

  // 3. Prune Old Backups (Retain last 7 daily snapshots)
  pruneBackups('/data/backups', 7);
  ```

#### Step-by-Step Restore Procedure:
1. **Scale Gateway to 0**:
   ```bash
   kubectl -n urumi scale deployment urumi-gateway --replicas=0
   ```
2. **Launch Recovery Pod**:
   Deploy an ephemeral recovery pod mounting `urumi-gateway-pvc` at `/data`.
3. **Verify Integrity of Selected Backup**:
   ```bash
   sqlite3 /data/backups/gateway-<target-timestamp>.db "PRAGMA integrity_check;"
   # Expected output: ok
   ```
4. **Replace Active Database**:
   ```bash
   # Remove corrupted or active DB and stale WAL/SHM files
   rm -f /data/gateway.db /data/gateway.db-wal /data/gateway.db-shm
   # Copy backup snapshot into primary position
   cp /data/backups/gateway-<target-timestamp>.db /data/gateway.db
   chmod 600 /data/gateway.db
   chown 10001:10001 /data/gateway.db
   ```
5. **Scale Gateway to 1**:
   ```bash
   kubectl -n urumi scale deployment urumi-gateway --replicas=1
   ```
6. **Verify Probes**:
   Verify `GET /health/ready` returns HTTP 200.

---

### 2.7 Disk-Full Failure Handling
- **Monitoring**: Alert when `/data` volume usage exceeds 85%.
- **Behavior**: If disk reaches 100% capacity:
  - SQLite operations return `SQLITE_FULL`.
  - Read queries (`SELECT`) continue to function without modification.
  - Inbound mutating tool calls fail Phase 1 audit-start and are rejected with HTTP 500, preserving fail-closed behavior.
  - Automatic pruning and temporary WAL truncation procedures trigger to reclaim storage.

---

## 3. Consequences & Verification
- **Positive**: Strict single-writer data safety, automated daily backups with integrity verification, explicit disaster recovery runbook.
- **Negative**: Restores require brief downtime (scaling replica to 0).
- **Verification**: 
  - Verified via synthetic corrupt-snapshot rejection tests, migration rollback tests, and simulated restore drills.
  - **Empirical Acceptance (Phase 5 Gate P5-G6 Stage 5)**: Verified live in cluster `k3d-urumi` across all 28 acceptance checks (`TEST-8.1.1` through `TEST-8.8.2`). Migration 003 successfully extended schema to 8 tables (`schema_migrations`, `users`, `user_credentials`, `browser_sessions`, `user_invitations`, `api_keys`, `upstreams`, `audit_logs`). 
  - Pre-Stage 5 live backup snapshot was archived to `backups/pre-stage5/gateway-pre-stage5.db` (SHA-256: `a9307df1231b0cf0446823214e52420c32c081ce7d7525aaa7e5df435377ff6f`), validating offline integrity check `PRAGMA integrity_check = 'ok'`.

