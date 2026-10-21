# Gate P5-G6 Stage 3: Local Integration & Concurrency Stress Testing Report

**Date:** October 21, 2026  
**Status:** COMPLETE & STOPPED (Stage 4 Gated)  
**Baseline Commit:** `6c87b164dd24353dd4197dbcaed7ef4d484b6f80`  
**Stage 3 Commit:** `73e5cf18d3d343a9e91e06f762fe0ff0f82aae4a`  
**Branch:** `main`  
**Environment:** Local Linux, Node.js v24.20.0 (Native `node:sqlite`), Offline Sandboxes (`/tmp/gtw-stage3-*`)

---

## 1. Executive Summary & Baseline Adherence

In accordance with the **Stage 3 Worker Authorization**, local offline integration and concurrency stress testing has been executed against isolated SQLite databases and real application service components.

- **Baseline Commit Confirmed:** `6c87b164dd24353dd4197dbcaed7ef4d484b6f80` was verified present at HEAD prior to changes.
- **Stage 3 Code Commit:** `73e5cf18d3d343a9e91e06f762fe0ff0f82aae4a` (`ph 5: test(gateway): stage 3 local integration and concurrency stress test suite`).
- **All 8 Concurrency & Integration Scenarios Passed:** 8/8 tests passed in `apps/gateway/test/integration/stage3-concurrency-stress.test.ts`.
- **Monorepo Regressions:** 0 failures across the entire monorepo suite (487 passing tests total: Gateway 345, CRM 26, Tasks 35, WooCommerce 81).
- **Prohibited Live Operations:** ZERO live operations performed. Zero `kubectl`, `k3d`, `helm`, Docker, or live PVC mutations.
- **Stop Condition Enforced:** Stage 3 execution is halted; Stage 4 live-cluster preflight remains strictly gated.

---

## 2. Files Changed and Technical Explanation

| File | Change Type | Technical Explanation |
| :--- | :--- | :--- |
| `apps/gateway/src/db/backup.ts` | Modified | Added precondition lock check in `restoreDatabase()`. Prior to modifying the target path or unlinking existing database and companion files (`-wal`, `-shm`), the helper opens a connection with `PRAGMA busy_timeout = 100` and attempts `BEGIN EXCLUSIVE; ROLLBACK;`. If another process holds an active write connection or lock, `restoreDatabase()` fails closed with `RestoreError` and leaves the active target untouched. If the target is physically corrupted or unreadable (disaster scenario), the lock check is safely bypassed. |
| `apps/gateway/package.json` | Modified | Added `"test:integration": "tsx --test test/integration/*.test.ts"` script, and chained it to `"test"` so standard `npm test` automatically executes unit, protocol, and integration test suites. |
| `apps/gateway/test/integration/stage3-concurrency-stress.test.ts` | Added | 610-line comprehensive integration and concurrency stress test suite covering 8 scenarios with deterministic synchronization, high concurrency levels, invariant verification, and disposable sandbox directories. |

---

## 3. Concurrency Scenarios, Invariants, & Observed Results

### Scenario 1: Concurrent Audit Writes and Paginated Reads
- **Scenario:** High-throughput concurrent audit logging alongside parallel paginated audit querying across 80 concurrent writes (8 batches × 10 concurrent requests) and 40 concurrent paginated reads.
- **Invariants Tested:**
  1. No SQLite WAL lock contention errors or unhandled rejections under concurrent burst.
  2. Audit records are durably committed with exact row count matching writes (80 rows).
  3. Concurrent paginated queries return valid ordered results without sensitive credential exposure (`metadata` redacted).
- **Workers/Iterations:** 80 write workers, 40 read workers across multiple pages (`page=1..4, limit=20`).
- **Observed Result:** PASSED (39.5ms). Exact 80 records written; all paginated reads returned consistent slices; zero lock errors.

### Scenario 2: Concurrent Single-Use Invitation Redemption Race
- **Scenario:** 15 concurrent workers race to redeem the exact same single-use invitation token with identical or different passwords simultaneously.
- **Invariants Tested:**
  1. Exactly 1 worker wins the race and obtains HTTP 201/200 with an active session token and user ID.
  2. Exactly 14 workers fail closed with `already redeemed or invalid` error.
  3. Exactly 1 user record is created in the database; zero orphaned accounts or dangling sessions created.
  4. Invitation status atomically transitions to `redeemed` with `redeemed_at` timestamp.
- **Workers/Iterations:** 15 concurrent workers synchronized via `Promise.all`.
- **Observed Result:** PASSED (248.8ms, CPU scrypt hashing across 15 parallel workers). Exactly 1 redemption succeeded; exactly 14 failed closed; exactly 1 user in database.

### Scenario 3: Concurrent Session Validation & Instant User Deactivation
- **Scenario:** An active user with a valid session is suddenly deactivated by an administrator (`is_active = 0`) while 20 concurrent session validation requests are in flight.
- **Invariants Tested:**
  1. Fail-closed contract: The moment the user record becomes inactive, every subsequent session validation request is immediately rejected (`null`).
  2. Deactivated user cannot resuscitate active sessions; session lookup joins user table and enforces `is_active = 1`.
- **Workers/Iterations:** 20 concurrent session validations + 1 admin status update.
- **Observed Result:** PASSED (3.1ms). Pre-deactivation returned valid user; post-deactivation all 20 concurrent workers failed closed (`null`).

### Scenario 4: Concurrent API-Key Verification & Immediate Revocation
- **Scenario:** An active API key is revoked by an admin (`revoked_at` timestamp set) while 20 concurrent requests attempt to authenticate using that key.
- **Invariants Tested:**
  1. Active key successfully validates prior to revocation.
  2. Instant fail-closed: All 20 concurrent verification attempts after revocation return `null`.
  3. Database constraint: Revoked key is never revived or re-authorized.
- **Workers/Iterations:** 20 concurrent API key verifications + 1 admin revocation.
- **Observed Result:** PASSED (4.5ms). Active verification succeeded; post-revocation all 20 parallel validations rejected with `null`.

### Scenario 5: Online `VACUUM INTO` Backup During High-Throughput Concurrent Writes
- **Scenario:** 100 concurrent audit writes execute in parallel while an online backup is triggered via `backupDatabase()`.
- **Invariants Tested:**
  1. Backup completes cleanly without throwing `EBUSY` or blocking active writes.
  2. Resulting snapshot passes `PRAGMA integrity_check` (`ok`) and `PRAGMA foreign_key_check` (empty).
  3. Snapshot manifest matches SHA-256 and byte length.
  4. Write transactions succeed without being aborted by the backup process.
- **Workers/Iterations:** 100 concurrent writers (10 parallel workers × 10 batches) + 1 simultaneous backup execution.
- **Observed Result:** PASSED (43.4ms). 100 rows committed to live DB; backup snapshot contained complete, consistent snapshot; integrity verified.

### Scenario 6: Restore Safety Enforcement When Target Connection is Active
- **Scenario:** `restoreDatabase()` is called when the target database has an active open connection holding a lock.
- **Invariants Tested:**
  1. Precondition enforcement: `restoreDatabase()` must refuse to overwrite or delete files while an active lock is held.
  2. Fails closed with `RestoreError` matching `/cannot restore while target database has an active connection or lock/`.
  3. Active connection and target database file remain completely uncorrupted.
  4. Once the active connection is closed cleanly, `restoreDatabase()` executes and succeeds.
- **Workers/Iterations:** 2 attempts (1 with active lock, 1 after clean close).
- **Observed Result:** PASSED (114.7ms). Active lock attempt threw `RestoreError`; post-close restore succeeded and verified.

### Scenario 7: Repeated Backup, Corruption, and Restore Cycles
- **Scenario:** 5 consecutive cycles of: write data → take verified WAL backup → inject catastrophic failure (corrupt live database file with random garbage bytes) → execute `restoreDatabase()` → verify integrity and data functionality.
- **Invariants Tested:**
  1. Multi-cycle stability: 5 full disaster recovery cycles without file descriptor leaks or corruption carryover.
  2. Every restored database passes `PRAGMA integrity_check` = `ok` and `PRAGMA foreign_key_check` = 0 errors.
  3. Restored database retains exact row counts across cycles.
  4. Restored database remains fully writable for subsequent transactions.
- **Workers/Iterations:** 5 full cycles (5 backups, 5 injected corruptions, 5 restores, 5 functional write-after-restore checks).
- **Observed Result:** PASSED (730.8ms). All 5 cycles completed with 100% data integrity and zero foreign-key errors.

### Scenario 8: Upstream Configuration Reads Under Concurrent Status Updates
- **Scenario:** 30 parallel read queries for upstream configurations while 5 concurrent admin mutations update upstream health and status.
- **Invariants Tested:**
  1. Upstream secret headers (e.g., Bearer tokens, passwords) are never leaked in plain text or unauthorized fields.
  2. All concurrent reads receive valid, consistent upstream objects.
  3. Concurrent updates complete without deadlocks.
- **Workers/Iterations:** 30 concurrent readers + 5 concurrent mutators.
- **Observed Result:** PASSED (23.3ms). Zero deadlocks; secrets safely isolated; all reads consistent.

---

## 4. Exact Commands and Actual Output

### A. Stage 3 Integration & Concurrency Stress Test Suite
```bash
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" && npx tsx --test apps/gateway/test/integration/stage3-concurrency-stress.test.ts
```
**Output:**
```text
✔ STAGE 3 - SCENARIO 1: Concurrent audit writes and paginated reads under high load (39.467406ms)
✔ STAGE 3 - SCENARIO 2: Concurrent single-use invitation redemption race (15 parallel workers) (248.825232ms)
✔ STAGE 3 - SCENARIO 3: Concurrent session validation under instant user deactivation (3.111868ms)
✔ STAGE 3 - SCENARIO 4: Concurrent API-key verification under immediate revocation (4.484832ms)
✔ STAGE 3 - SCENARIO 5: Online VACUUM INTO backup during high-throughput concurrent writes (43.435773ms)
✔ STAGE 3 - SCENARIO 6: Restore safety enforcement when target database connection is active (114.708304ms)
✔ STAGE 3 - SCENARIO 7: Repeated backup, corruption, and restore cycles (5 full consecutive recovery cycles) (730.763022ms)
✔ STAGE 3 - SCENARIO 8: Upstream configuration reads under concurrent status updates (23.34449ms)
✔ Gate P5-G6 Stage 3: Local Integration & Concurrency Stress Test Suite (1607.839714ms)
ℹ tests 8
ℹ suites 1
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1840.94262
```

### B. Monorepo Build
```bash
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" && npm run --workspaces --if-present build
```
**Output:**
```text
> dashboard@1.0.0 build
> tsc && vite build
✓ built in 2.25s

> gateway@1.0.0 build
> tsc

> mcp-crm@1.0.0 build
> tsc

> mcp-tasks@1.0.0 build
> tsc

> woocommerce-mcp@1.0.0 build
> tsc

> @urumi/shared@1.0.0 build
> tsc
```
All packages compiled cleanly with exit code 0.

### C. Monorepo Test Suite
```bash
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" && npm test --workspaces --if-present
```
**Output Breakdown:**
- `gateway`: 312 unit + 25 protocol + 8 integration = **345 passed, 0 failed**
- `mcp-crm`: 20 unit + 6 protocol = **26 passed, 0 failed**
- `mcp-tasks`: 27 unit + 8 protocol = **35 passed, 0 failed**
- `woocommerce-mcp`: 46 unit + 35 protocol = **81 passed, 0 failed**
- **Monorepo Total: 487 passed, 0 failed, 0 skipped.**

### D. Monorepo Typecheck / Lint
```bash
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" && npm run --workspaces --if-present lint
```
**Output:** Clean pass across all workspaces with exit code 0.

---

## 5. Failures Discovered, Root Causes, and Remediations

### Discovery 1: `restoreDatabase()` lacked active connection lock check
- **Condition:** In Scenario 6, when a target database was actively open with a write lock, calling `restoreDatabase()` directly proceeded to `fs.unlinkSync()`, which on Linux unlinks the directory inode while the file descriptor remains open, risking silent file divergence.
- **Root Cause:** While Stage 2 established path protection against `/data/gateway.db`, it did not verify whether a local sandbox target was actively held by another process before initiating file replacement.
- **Fix:** In `apps/gateway/src/db/backup.ts`, added a pre-restore connection verification step. It opens a brief connection with `PRAGMA busy_timeout = 100;` and executes `BEGIN EXCLUSIVE; ROLLBACK;`. If the database is locked or busy, it throws `RestoreError("Precondition failed: cannot restore while target database has an active connection or lock")`. If the file is corrupted (disaster scenario), the check catches the error and safely bypasses lock checking to allow disaster restoration.
- **Regression Test:** Added Scenario 6 in `apps/gateway/test/integration/stage3-concurrency-stress.test.ts`.

---

## 6. Separation of Evidence

- **Actual Local Integration Evidence:**
  - Real SQLite WAL databases created in temporary directories (`/tmp/gtw-stage3-*`).
  - Real database queries, schema migrations (`up(db)`), and constraints (`FOREIGN KEYS = ON`).
  - Real concurrent async promises executing against actual repositories (`AuditRepository`, `InvitationRepository`, `UserRepository`, `ApiKeyRepository`, `UpstreamRepository`).
  - Real file operations (`fs.writeFileSync`, `fs.copyFileSync`, `fs.unlinkSync`, `PRAGMA integrity_check`).
  - Real Node.js native crypto password hashing (`scryptSync`) during concurrent invitation redemption races.
- **Test Double / Mock Evidence:**
  - In Scenario 8, upstream network calls to external mock servers (e.g. WooCommerce/CRM remote endpoints) are mocked at the HTTP boundary, while upstream configuration persistence and secret boundaries are tested against the real SQLite database.
- **Unverified Live Runtime Behavior (Strictly Gated for Stage 4/5):**
  - Real Kubernetes PVC persistent mounts (`/data/gateway.db` on HostPath/Longhorn/Ceph).
  - Multi-pod replica scaling (current gateway architecture is single-replica with WAL mode).
  - Real Kubernetes Secret volume mounts and RBAC permissions.
  - Live Ingress routing through Traefik/NGINX.

---

## 7. Working Tree and Safety Boundary Confirmation

- **Baseline Commit Preserved:** `6c87b164dd24353dd4197dbcaed7ef4d484b6f80` is preserved in git history.
- **Final Commit:** `73e5cf18d3d343a9e91e06f762fe0ff0f82aae4a`
- **Working Tree Status:** Clean (`nothing to commit, working tree clean`).
- **Confirmation of Prohibited Operations:**
  - ZERO `kubectl` commands executed.
  - ZERO `k3d` commands executed.
  - ZERO `helm` commands executed.
  - ZERO Docker build or push commands executed.
  - ZERO access to `/data/gateway.db` or live cluster PVCs.
  - ZERO git resets, force pushes, or history rewrites.

---

## 8. Stop Condition and Next Step

Stage 3 work is **100% complete**. In strict compliance with Section 5 of the authorization, execution is **HALTED**.

No Stage 4 live-cluster preflight or deployment actions will be taken until explicit review and authorization are provided by the Technical Head.
