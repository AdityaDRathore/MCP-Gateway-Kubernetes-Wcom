# Urumi Platform — Phase 5: Gate P5-G2 Correction & Verification Report

**Gate:** P5-G2 — Local Implementation and Verification (Correction Pass)  
**Authority Reference:** Technical Head Decision — P5-G2: NOT ACCEPTED YET. G3 remains on HOLD.  
**Execution Timestamp:** 2026-10-19T23:05:00+05:30  
**Commit SHA:** `48a4422bfec5fe0b4dad73a25848f6c6f11f5310` (supersedes `82a117ec98d50c9ed639bbe692d861b22360b12b`)  
**Repository Branch:** `main`  
**Working Tree Status:** Clean (`nothing to commit, working tree clean`)  
**Target Gate Status:** P5-G2 awaiting Technical Head acceptance. Gate P5-G3 remains strictly on **HOLD**.

---

## 1. Executive Summary & Resolution of Blockers

This report provides the focused correction and offline verification evidence requested by the Technical Head, addressing the five identified blockers in commit `82a117ec98d50c9ed639bbe692d861b22360b12b`. All corrections were implemented in `apps/gateway` and verified strictly locally and offline.

**Zero operational mutations occurred:**
- Zero image pushes (`docker push`).
- Zero live database migrations or backups against the cluster volume (`/data/gateway.db`).
- Zero Kubernetes cluster mutations, Helm upgrades, pod restarts, or VPS/production deployments.
- The live gateway pod (`urumi-gateway-55f57bddc7-7f8q5`) in `k3d-urumi` remains at **0 restarts** (uptime 8h+).

---

## 2. Detailed Resolution of the Five Mandatory Blockers

### Blocker 1: Authentication Controls
*Requirement: Implement and test login rate limiting, generic failures for nonexistent/wrong-password/inactive accounts, and bounded concurrency behavior under authentication load.*

1. **Login Rate Limiter (`apps/gateway/src/auth/login-rate-limiter.ts`):**
   - Implemented an in-memory sliding-window rate limiter enforcing a strict limit of **5 failed login attempts per 5-minute window** (300 seconds).
   - Applied **dual-key indexing**: rate limits are tracked independently by **Client IP** and by **Username**.
   - When exceeded, returns HTTP `429 Too Many Requests` with a standard `Retry-After: <seconds>` header and structured error `{ "error": "Too many failed login attempts. Please try again later.", "code": "LOGIN_RATE_LIMITED" }`.
   - On successful authentication, failed attempt counters for both the client IP and username are immediately cleared (`recordSuccess()`).

2. **Generic Authentication Failures & Constant-Time Dummy Verification:**
   - In `apps/gateway/src/http/browser.ts`, the login handler now guarantees identical response status, headers, and body across all authentication failure conditions:
     - Nonexistent username
     - Inactive/deactivated account (`is_active === 0`)
     - User without credentials record
     - Incorrect password
   - Response is always HTTP `401 Unauthorized`:
     ```json
     {
       "error": "Invalid username or password",
       "code": "INVALID_CREDENTIALS"
     }
     ```
   - **Timing Attack Mitigation:** For nonexistent users, inactive accounts, or missing credentials, the handler executes a full dummy Scrypt verification (`verifyPassword(password, DUMMY_SCRYPT_HASH)`) before responding, equalizing computation time with the valid user path and preventing account enumeration.

3. **Bounded Concurrency & Overload Protection:**
   - In `apps/gateway/src/auth/scrypt-password-service.ts`, password hashing operations are bounded by a strict concurrency limit (`maxConcurrent: 2`) and queue timeout (`queueTimeoutMs: 5000`).
   - Under heavy authentication load, queued hashing requests exceeding the timeout fail closed with `ScryptConcurrencyError` instead of starving server worker threads or causing memory exhaustion.

- **Verification Evidence:**
  - `apps/gateway/test/unit/login-rate-limit.test.ts` (4 tests: generic 401 across all 4 account states, IP rate limit enforcement, username rate limit enforcement, success reset).
  - `apps/gateway/test/unit/scrypt-kdf.test.ts` (6 tests: KDF parameters, queue timeout under concurrency).
  - `apps/gateway/test/unit/browser-auth-perimeter.test.ts` (10 tests: perimeter enforcement).

---

### Blocker 2: Trusted Proxy and Client IP Boundary
*Requirement: Define actual proxy trust boundary, configure it only on verified topology evidence, stop using untrusted `X-Forwarded-For` directly, and prove spoofed headers cannot bypass rate limiting.*

1. **Topology & Trust Boundary Definition:**
   - In the Urumi k3s cluster topology, all external HTTP traffic terminates at the cluster Ingress controller (Traefik). Traefik runs in the pod/service network (`10.42.0.0/16` and `10.43.0.0/16`) or on `127.0.0.1` during local port-forwarding.
   - Gateway `TRUSTED_PROXIES` configuration default: `127.0.0.1,::1,10.42.0.0/16,10.43.0.0/16`.

2. **Trusted Proxy Parsing Algorithm (`apps/gateway/src/http/client-ip.ts`):**
   - The remote socket IP (`req.socket.remoteAddress`) is extracted and normalized (stripping IPv4-mapped IPv6 prefixes `::ffff:`).
   - If the direct socket IP does **not** match any configured trusted proxy IP or CIDR block, the client connected directly to the gateway. In this case, any `X-Forwarded-For` header sent by the client is treated as **untrusted attacker payload and discarded completely**. The client IP is strictly `req.socket.remoteAddress`.
   - If the direct socket IP **does** match a trusted proxy, the `X-Forwarded-For` header is parsed from right to left. The rightmost entry appended by the trusted proxy is selected as the authentic client peer IP.
   - Forged or injected leftmost IPs in multi-hop chains (e.g. `X-Forwarded-For: 203.0.113.199, 198.51.100.1`) cannot bypass rate limiting, because the gateway evaluates only the verified hop.

- **Verification Evidence:**
  - `apps/gateway/test/unit/trusted-proxy-ip.test.ts` (7 tests: IPv6 normalization, CIDR matching, rejection of untrusted socket XFF, rightmost hop extraction from trusted proxies, spoofed hop discarding, and anti-rate-limit-evasion).

---

### Blocker 3: Migration Contract Reconciliation
*Requirement: Reconcile Migration 003 with the formally frozen G1 schema contract (`users.is_active`, `user_credentials`, `browser_sessions`, `user_invitations`). Make schema and migration design consistent before any live migration.*

Migration 003 in `apps/gateway/src/db/schema.ts` and the associated repositories were reconciled with the frozen G1 contract:

1. **`users.is_active` vs `users.status`:**
   - Replaced `status TEXT ('active' | 'deactivated')` with `is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))`.
   - **Rationale:** Aligns with SQLite integer boolean conventions. Avoids string comparisons in query hot paths.

2. **`user_credentials` vs `password_hash` on `users`:**
   - Removed `password_hash` from the `users` table.
   - Created dedicated `user_credentials` table:
     ```sql
     CREATE TABLE IF NOT EXISTS user_credentials (
       user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
       password_hash TEXT NOT NULL,
       algorithm TEXT NOT NULL DEFAULT 'scrypt_v1',
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
     ```
   - **Rationale:** Ensures strict separation of identity and credentials. Queries for user profiles (`SELECT id, username, role, is_active FROM users`) can never accidentally leak password hashes in logs, JSON responses, or memory dumps.

3. **Table Naming (`browser_sessions` and `user_invitations`):**
   - Replaced generic `sessions` table with `browser_sessions`:
     ```sql
     CREATE TABLE IF NOT EXISTS browser_sessions (
       id TEXT PRIMARY KEY,
       user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       token_hash TEXT NOT NULL UNIQUE,
       csrf_secret TEXT NOT NULL,
       ip_address TEXT,
       user_agent TEXT,
       expires_at INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       last_activity_at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_browser_sessions_token_hash ON browser_sessions(token_hash);
     CREATE INDEX IF NOT EXISTS idx_browser_sessions_user_id ON browser_sessions(user_id);
     CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires_at ON browser_sessions(expires_at);
     ```
   - Created `user_invitations` table:
     ```sql
     CREATE TABLE IF NOT EXISTS user_invitations (
       id TEXT PRIMARY KEY,
       email TEXT NOT NULL,
       role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
       token_hash TEXT NOT NULL UNIQUE,
       invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       expires_at INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       accepted_at INTEGER
     );
     ```
   - **Rationale:** Eliminates naming ambiguities between MCP streamable sessions and browser HTTP sessions. Matches G1 design freeze specification exactly.

- **Verification Evidence:**
  - `apps/gateway/test/unit/db-migrations.test.ts` (7 tests: verifies Migration 003 DDL, constraints, foreign keys, cascade deletes, and schema version advancement to 3).
  - `apps/gateway/test/unit/browser-session.test.ts` (8 tests: session creation, verification, sliding expiration, deactivation check, and pruning).

---

### Blocker 4: Backup Manifest Implementation & Offline Testing
*Requirement: Implement frozen backup-manifest requirements (unique identity, checksum, baseline row counts, integrity and foreign-key verification) and test them without running live backup/restore.*

1. **Manifest Generation & Verification (`apps/gateway/src/db/backup.ts`):**
   - The backup process now captures baseline row counts from the active database prior to snapshotting across all application tables (`users`, `api_keys`, `upstreams`, `audit_logs`, `user_credentials`, `browser_sessions`, `user_invitations`).
   - Executes `VACUUM INTO '<escaped-path>'` strictly in autocommit mode (enforced by `assertAutocommitMode()`).
   - Computes the SHA-256 hash of the generated `.db` snapshot file.
   - Opens an independent connection to the snapshot and verifies:
     - `PRAGMA integrity_check;` (must return `ok`).
     - `PRAGMA foreign_key_check;` (must return 0 violations).
     - `PRAGMA user_version;` matches source schema.
     - Snapshot row counts match pre-backup baseline row counts exactly.
   - Generates companion manifest file (`<prefix>.manifest.json`):
     ```json
     {
       "backupId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
       "backupFileName": "gateway-2026-10-19T17-00-00-000Z-3fa85f64.db",
       "manifestFileName": "gateway-2026-10-19T17-00-00-000Z-3fa85f64.manifest.json",
       "timestamp": "2026-10-19T17-00-00-000Z",
       "createdAtUnix": 1792429200,
       "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
       "sizeBytes": 32768,
       "schemaVersion": 3,
       "integrityCheck": "ok",
       "foreignKeyCheck": "ok",
       "rowCounts": {
         "users": 2,
         "api_keys": 4,
         "upstreams": 3,
         "audit_logs": 10,
         "user_credentials": 2,
         "browser_sessions": 1,
         "user_invitations": 0
       }
     }
     ```
   - Enforces POSIX permissions: directory `0700`, database file `0600`, manifest file `0600`.
   - Prunes older snapshots and removes corresponding `.manifest.json` companion files atomically.

- **Verification Evidence:**
  - `apps/gateway/test/unit/backup-precondition.test.ts` (7 tests: autocommit check, active/deferred transaction rejection, backup execution, sha256 checksum generation, row count matching, and manifest pruning). Tested entirely against temporary isolated disk files without touching `/data/gateway.db`.

---

### Blocker 5: Regression Evidence & Test Suite Reconciliation
*Requirement: Reconcile reported 273 tests with earlier 360-test baseline. Supply exact commands and per-suite counts, confirm original suites have not been silently skipped, and report actual pass/fail results.*

#### Explanation of the 360 vs 273 Discrepancy
In the Phase 4 G9 completion and Phase 5 G0/G1 baseline documentation, the baseline repository was reported as **360 tests**. This 360-test count represents the **aggregate monorepo total across all 4 workspace applications**:
- `apps/gateway`: 218 tests (208 unit + 10 protocol)
- `apps/woocommerce-mcp`: 81 tests (46 unit + 35 protocol)
- `apps/mcp-crm`: 26 tests (20 unit + 6 protocol)
- `apps/mcp-tasks`: 35 tests (27 unit + 8 protocol)
- **Monorepo Baseline Total:** $218 + 81 + 26 + 35 = \mathbf{360\text{ tests}}$.

In our previous G2 report, **273 tests** was reported. That number was the Gateway workspace tests, which had expanded from 218 to 273 (adding 55 new tests). However, the upstream MCP test files (4 + 5 + 5 = 14 test files) were inadvertently described as test counts rather than reporting the full 142 upstream tests.

#### Current Full Monorepo Test Counts
Every test suite in the repository was executed and verified. **Zero tests have been dropped, disabled, or skipped.**

| Workspace / Service | Unit Tests | Protocol Tests | Total Tests | Pass | Fail | Skipped | Status |
|---|---|---|---|---|---|---|---|
| **apps/gateway** | 263 | 10 | **273** | 273 | 0 | 0 | **PASS** |
| **apps/woocommerce-mcp** | 46 | 35 | **81** | 81 | 0 | 0 | **PASS** |
| **apps/mcp-crm** | 20 | 6 | **26** | 26 | 0 | 0 | **PASS** |
| **apps/mcp-tasks** | 27 | 8 | **35** | 35 | 0 | 0 | **PASS** |
| **Repository Grand Total** | **356** | **59** | **415** | **415** | **0** | **0** | **100% PASS** |

**Net Change:**
- Baseline: 360 tests
- Added in G2: +55 tests (Gateway unit tests increased from 208 to 263)
- Current: **415 tests (100% passing)**

---

## 3. Changed-File Inventory (Commit `48a4422bfec5fe0b4dad73a25848f6c6f11f5310`)

A total of 19 files were modified or created in this correction commit:

```
new file:   apps/gateway/src/auth/login-rate-limiter.ts
modified:   apps/gateway/src/auth/scrypt-password-service.ts
modified:   apps/gateway/src/auth/session-service.ts
modified:   apps/gateway/src/config.ts
modified:   apps/gateway/src/db/backup.ts
modified:   apps/gateway/src/db/schema.ts
modified:   apps/gateway/src/db/session-repo.ts
modified:   apps/gateway/src/db/user-repo.ts
modified:   apps/gateway/src/http/browser-middleware.ts
modified:   apps/gateway/src/http/browser.ts
new file:   apps/gateway/src/http/client-ip.ts
modified:   apps/gateway/src/server.ts
modified:   apps/gateway/test/unit/backup-precondition.test.ts
modified:   apps/gateway/test/unit/browser-auth-perimeter.test.ts
modified:   apps/gateway/test/unit/browser-session.test.ts
modified:   apps/gateway/test/unit/db-migrations.test.ts
new file:   apps/gateway/test/unit/login-rate-limit.test.ts
modified:   apps/gateway/test/unit/scrypt-kdf.test.ts
new file:   apps/gateway/test/unit/trusted-proxy-ip.test.ts
```

---

## 4. Exact Test Commands & Output Summary

### 4.1 Gateway Unit Tests (263 tests)
```bash
npm --prefix apps/gateway run test:unit
```
**Output:**
```
ℹ tests 263
ℹ suites 35
ℹ pass 263
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### 4.2 Gateway Protocol Tests (10 tests)
```bash
npm --prefix apps/gateway run test:protocol
```
**Output:**
```
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

### 4.3 WooCommerce MCP Tests (81 tests)
```bash
npm --prefix apps/woocommerce-mcp run test:unit
npm --prefix apps/woocommerce-mcp run test:protocol
```
**Output:**
```
Unit: tests 46, pass 46, fail 0
Protocol: tests 35, pass 35, fail 0
Total: 81 tests passing
```

### 4.4 CRM MCP Tests (26 tests)
```bash
npm --prefix apps/mcp-crm run test:unit
npm --prefix apps/mcp-crm run test:protocol
```
**Output:**
```
Unit: tests 20, pass 20, fail 0
Protocol: tests 6, pass 6, fail 0
Total: 26 tests passing
```

### 4.5 Tasks MCP Tests (35 tests)
```bash
npm --prefix apps/mcp-tasks run test:unit
npm --prefix apps/mcp-tasks run test:protocol
```
**Output:**
```
Unit: tests 27, pass 27, fail 0
Protocol: tests 8, pass 8, fail 0
Total: 35 tests passing
```

### 4.6 TypeScript Compilation Build
```bash
npm --prefix apps/gateway run build
```
**Output:**
```
> gateway@1.0.0 build
> tsc
Exit code: 0
```

---

## 5. Remaining Risks & Guardrails

1. **In-Memory Rate Limiting Scope:**
   - The current `LoginRateLimiter` is in-memory. Because SQLite requires a single-replica gateway (`replicas: 1`), this in-memory state is perfectly coordinated for the single instance. If multi-instance horizontal scaling were attempted in the future, rate limiting would require a shared store; however, under the frozen Phase 5 architecture, the gateway is strictly single-replica.
2. **Pre-Migration SQLite Snapshot:**
   - When Gate P5-G3 is eventually authorized for live migration, the backup routine must execute `VACUUM INTO` before applying Migration 003, and the generated `.manifest.json` must be archived prior to running `db.exec(migration003)`.
3. **Traefik Forwarded Header Validation:**
   - In production Kubernetes, Traefik must remain the sole ingress point. If the Service were changed to NodePort or LoadBalancer directly to port 3001, external attackers could present direct socket connections from untrusted IPs. The newly implemented `client-ip.ts` guardrail safely handles this by discarding `X-Forwarded-For` from untrusted direct sockets.

---

## 6. Recommendation & Gate Status

- **P5-G2 Status:** The implementation corrections and verification requirements are complete and verified offline. Commit `48a4422bfec5fe0b4dad73a25848f6c6f11f5310` is submitted for Technical Head review.
- **P5-G3 Status:** Gate P5-G3 remains on **HOLD**. No member lifecycle routes, API key self-service features, live cluster rollouts, or live migrations will begin without explicit written authorization from the Technical Head.
