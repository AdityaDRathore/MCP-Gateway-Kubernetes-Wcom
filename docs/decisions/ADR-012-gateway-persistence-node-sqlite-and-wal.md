# ADR-012: Gateway Storage Engine via Node.js Built-in `node:sqlite`, WAL Concurrency, and Online Backup

**Status**: Accepted  
**Date**: 2026-10-15  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-001`](./ADR-001-stack-and-deployment.md), [`ADR-004`](./ADR-004-stateful-storage-and-workload-controllers.md)  

---

## 1. Context & Problem Statement

Phase 4 requires persistent storage for the central Team MCP Gateway (`apps/gateway`):
1. **Entities**: Team member records, hashed API keys, registered upstream configurations, and audit event logs.
2. **Resource Constraints**: Total host RAM is 7.6 GiB (~1.2–1.4 GiB available). Deploying a separate PostgreSQL or MySQL container consumes 120–180 MiB idle RAM, risking OOM kills.
3. **Packaging & Supply-Chain Hardening**: Native C++ SQLite modules (e.g. `better-sqlite3`, `sqlite3`) require `python3`, `make`, and `g++` toolchains in container build stages, introduce native ABI vulnerabilities across Node.js versions, and add ~300 MB of build layer bloat.

We must select a zero-compilation SQLite driver, configure concurrent WAL parameters, establish migration versioning, and define an online non-locking backup mechanism.

---

## 2. Decision

### 2.1 Driver Selection: Built-in `node:sqlite`
- Adopt Node.js core **`node:sqlite`** (`import { DatabaseSync } from 'node:sqlite'`), natively standard in Node.js 24 LTS.
- **Empirical Proof**: Verified live on Node `v24.20.0` in the local workspace.
- **Advantages**:
  - Zero external npm dependencies for database engine.
  - Zero native C++ compilation (`node-gyp`) during `npm ci` or Docker build.
  - Zero native ABI mismatch risks across Alpine/Debian or host/container architectures.
  - Synchronous API (`DatabaseSync`) guarantees strict sequential transaction boundaries with negligible execution overhead (<0.1ms per query).

### 2.2 Database File Location & Persistent Volume Mount
- **File Path**: `/data/gateway.db`
- **Volume Mount**: Mounted to a dedicated PersistentVolumeClaim `urumi-gateway-pvc` (500Mi capacity, `storageClassName: local-path`, `accessModes: [ReadWriteOnce]`).

### 2.3 Required PRAGMA Configuration at Startup
Every database initialization executes the following PRAGMAs:
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```
- **`journal_mode = WAL`**: Write-Ahead Logging allows concurrent readers while a single writer commits, eliminating reader-writer lock starvation.
- **`foreign_keys = ON`**: Enforces strict referential integrity across relational tables.
- **`busy_timeout = 5000`**: Queries encountering a temporary lock wait up to 5,000 ms before throwing `SQLITE_BUSY`.
- **`synchronous = NORMAL`**: In WAL mode, `NORMAL` guarantees full ACID safety across power losses while reducing disk sync fsync operations.

### 2.4 Workload Controller & Single-Writer Invariant
- Gateway Deployment is strictly configured with **`replicas: 1`** and **`strategy: { type: Recreate }`**.
- SQLite does not support multiple writers across distributed pods. `Recreate` ensures the terminating pod unmounts the volume before a replacement pod attempts database initialization.

### 2.5 Schema Migrations & Versioning
- Migrations are tracked in table `schema_migrations`:
  ```sql
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );
  ```
- Migrations are executed in numerical order within atomic transactions.
- If the database detects a higher migration version than supported by the running binary, the gateway **fails startup immediately (fails closed)** to prevent data corruption.

### 2.6 Online Non-Locking Backup Strategy
- Live database backups use SQLite’s native **`VACUUM INTO '<destination_path>'`**.
- **Empirical Proof**: Verified on live Node 24 that `VACUUM INTO` produces a transactionally consistent, vacuumed database snapshot without copying active WAL files or blocking concurrent readers.
- Backup procedure copies snapshot to `/data/backups/gateway-<timestamp>.db` and runs `PRAGMA integrity_check;` before confirming success.

---

## 3. Core Database Schemas

```sql
-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2. API Keys Table (Verifier Hash Only, Zero Plaintext)
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER DEFAULT NULL
);

-- 3. Upstream Services Table (Secret Reference Only, Zero Plaintext Secrets)
CREATE TABLE IF NOT EXISTS upstreams (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1)),
  secret_ref_name TEXT DEFAULT NULL,
  secret_ref_key TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 4. Audit Log Table (Two-Phase Audit, Zero Customer PII)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  upstream_slug TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed', 'timeout')),
  duration_ms INTEGER DEFAULT NULL,
  error_code TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  finalized_at INTEGER DEFAULT NULL
);
```

---

## 4. Consequences & Verification
- **Positive**: Zero native compilation dependencies, sub-millisecond query execution, robust relational integrity, clean online backups.
- **Negative**: Horizontal scaling is constrained to single replica (acceptable and intentional for Phase 4 architecture).
- **Verification**: Verified via Node 24 evaluation scripts and automated persistence test suite.
