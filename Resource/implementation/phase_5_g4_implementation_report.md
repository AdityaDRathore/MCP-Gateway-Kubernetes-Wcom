# Urumi Phase 5 — Gate P5-G4 Implementation & Verification Report
**Team & API-Key Management (Local Implementation & Offline Verification Only)**

- **Date:** 2026-10-21
- **Environment:** Local / Offline Development Environment (Node 24 LTS, Linux)
- **Branch:** `main` (Baseline: `a38331a`, Implementation Commit: `c43b825`)
- **Scope Authority:** Gate P5-G4 Stage 2 Authorized with Conditions by Technical Head
- **Status:** **COMPLETE & VERIFIED — READY FOR TECHNICAL HEAD REVIEW (STAGE 3/4/5/6 ON HOLD)**

---

## 1. Executive Summary

In strict accordance with the Technical Head's conditional Stage 2 authorization for **Gate P5-G4 (Team and API-Key Management)**, all approved backend modules, services, CLI tools, and HTTP routes have been implemented and offline-verified across the test suites.

### Strict Boundary Adherence
- **100% Local & Offline:** No Docker images built or pushed; no Kubernetes cluster resources mutated; no Helm upgrades executed; no live database migrations or PVC access performed; zero pod restarts.
- **Fail-Closed Guarantees:** Deactivated user accounts fail closed immediately at `/mcp` (HTTP 401) regardless of key revocation timing; member role accounts are strictly prevented from viewing, creating, or revoking other users' API keys (IDOR defense).
- **Concurrency & Transaction Safety:** Invitation redemptions use atomic `BEGIN IMMEDIATE` transactions with single-use verification; Scrypt password hashing is executed *prior* to transaction acquisition; last-active-admin counts are verified *within* the write transaction to prevent concurrent administrative lockouts.
- **Secret Zero-Exposure:** Plaintext invitation tokens, passwords, and API keys are never persisted in the database; verifier hashes (SHA-256 for tokens/keys, Scrypt for passwords) are stored exclusively. Automated canary scans verify zero secret leakage in logs, headers, and responses.

---

## 2. Verification of Technical Head Conditions

Every condition mandated in the Technical Head's Stage 2 authorization has been fulfilled with reproducible test evidence:

| # | Technical Head Condition | Implementation Architecture & Verifiable Proof | Test Suite & Status |
|---|---|---|---|
| **1** | **G1 API & Schema Authority** | Implemented all 9 browser endpoints (`POST /invitations`, `POST /invitations/redeem`, `GET /members`, `POST /members/:id/deactivate`, `POST /members/:id/reactivate`, `PATCH /members/:id/role`, `GET /keys`, `POST /keys`, `POST /keys/:id/revoke`) with exact G1 DTO schemas, HTTP status codes, and route paths. | `invitation-lifecycle.test.ts`<br>`member-lifecycle.test.ts`<br>`api-key-idor.test.ts`<br>**(PASS)** |
| **2** | **Transaction Integrity & Password Hashing** | Invitation redemption executes in an atomic `BEGIN IMMEDIATE` transaction checking `redeemed_at IS NULL`. Password hashing via Scrypt ($N=16384, r=8, p=1$) is completed **before** transaction start. Deactivation atomically marks `users.is_active = 0`, deletes all active `browser_sessions`, and sets `revoked_at` on all user `api_keys`. Last-active-admin check evaluates `countActiveAdmins() >= 2` inside the write transaction. | `invitation-lifecycle.test.ts`<br>`member-lifecycle.test.ts`<br>**(PASS)** |
| **3** | **Server-Authoritative IDOR Defense & MCP Fail-Closed** | `GET /keys` ignores `?userId` queries for members, returning only their keys. `POST /keys` forces `targetUserId = req.browserSession.user.id` for members. `POST /keys/:id/revoke` checks key ownership and returns 403 Forbidden on foreign key revocation. `ApiKeyService.verifyKey()` verifies `record.is_active === 1`, rejecting deactivated users with HTTP 401 on `/mcp`. | `api-key-idor.test.ts`<br>**(PASS)** |
| **4** | **Bootstrap & Invitation Secret Protection** | Stored verifiers only: tokens and API keys hashed with SHA-256; passwords hashed with Scrypt. First-admin bootstrap CLI (`apps/gateway/src/cli/bootstrap-admin.ts`) generates one-time enrollment token with mode `0600` or writes to safe TTY. Bootstrap checks for existing active admins and exits code 0 idempotently without mutating records or keys. Canary scan proves 0 raw secrets logged or stored. | `bootstrap-admin.test.ts`<br>**(PASS)** |
| **5** | **Disposable Migration & Backup Isolation** | Migration 003 (`003_invitations.sql`) tested exclusively against disposable database copies in `/tmp`. Verifies clean upgrade from pre-migration state (Migrations 001 & 002), passes `PRAGMA integrity_check` (`ok`), `PRAGMA foreign_key_check` (0 errors), 100% row preservation across all tables, and automated pre-migration backup snapshot generation with verified SHA-256 checksums in companion `.manifest.json`. Zero interaction with live `/data/gateway.db`. | `disposable-migration.test.ts`<br>**(PASS)** |
| **6** | **Exhaustive Failure-Path Testing** | Validated: concurrent redemption race, token replay, expired tokens, duplicate usernames (409), rollback on injected database error, concurrent last-admin deactivation races, self-deactivation guard (400), foreign key revocation attempts (403), role demotion session purge, immediate `/mcp` 401 rejection on deactivation, bootstrap idempotency, and canary secret scans across responses, headers, and logs. | 5 dedicated test suites<br>(29 new tests)<br>**(PASS)** |
| **7** | **Strict Gate Boundary Adherence** | Zero new dependencies added to `package.json`. Added only `"bootstrap:admin"` script. No container image builds or pushes, no Helm upgrades, no cluster mutations, no live PVC access, no deployment to VPS. | Verified clean repo state<br>**(PASS)** |

---

## 3. Architecture & Implementation Details

### 3.1 Invitation Lifecycle & Atomic Single-Use Redemption (`invitation-service.ts`)
- **Token Generation:** 32 bytes of cryptographic entropy (`crypto.randomBytes(32)`), prefixed with `urumi_inv_` (total 74 chars).
- **Verifier Storage:** Stored as SHA-256 hash in `user_invitations.token_hash`. Expiry set to 72 hours (`now + 72 * 3600`).
- **Scrypt Password Hashing:** Executed **before** database transaction start to prevent transaction lock contention:
  ```typescript
  // Hash password before starting SQLite write transaction
  const { salt, passwordHash } = await this.passwordService.hashPassword(input.password);
  ```
- **Atomic `BEGIN IMMEDIATE` Transaction:**
  ```typescript
  this.db.exec('BEGIN IMMEDIATE');
  try {
    const inv = this.invitationRepo.findInvitationByTokenHash(tokenHash);
    if (!inv || inv.expires_at <= now || inv.redeemed_at !== null) {
      throw new Error('INVITATION_INVALID');
    }
    const marked = this.invitationRepo.markRedeemed(inv.id, userId, now);
    if (!marked) {
      throw new Error('INVITATION_ALREADY_REDEEMED');
    }
    this.userRepo.createUserWithCredentials(userId, username, inv.role, salt, passwordHash, now);
    this.db.exec('COMMIT');
  } catch (err) {
    this.db.exec('ROLLBACK');
    throw err;
  }
  ```

### 3.2 Member Lifecycle & Last-Active-Admin Protection (`browser.ts`)
- **Self-Deactivation Guard:** `if (targetId === req.browserSession!.user.id)` returns `HTTP 400 CANNOT_DEACTIVATE_SELF`.
- **Concurrent-Safe Admin Protection:**
  ```typescript
  db.exec('BEGIN IMMEDIATE');
  try {
    if (targetUser.role === 'admin') {
      const activeAdmins = userRepo.countActiveAdmins();
      if (activeAdmins <= 1) {
        db.exec('ROLLBACK');
        res.status(400).json({ error: 'Cannot deactivate the last active administrator', code: 'LAST_ADMIN_PROTECTED' });
        return;
      }
    }
    userRepo.deactivateUser(targetId);
    sessionService.invalidateUserSessions(targetId);
    apiKeyRepo.revokeAllUserApiKeys(targetId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  ```
- **Session Purge on Role Modification:** When an administrator updates a member's role (`PATCH /members/:id/role`), `sessionService.invalidateUserSessions(targetId)` is called immediately, forcing re-authentication so the updated role claim is reflected in the new session.

### 3.3 Server-Side API-Key Ownership & IDOR Protection (`browser.ts`)
- **List Keys (`GET /keys`):**
  - Admin: Returns all keys across all users joined with `username` (`apiKeyRepo.listAllApiKeysWithUser()`). `key_hash` is stripped from output.
  - Member: Strictly bounded to `req.browserSession.user.id` (`apiKeyRepo.listApiKeysByUserWithUser(sessionUserId)`). Any requested `?userId=` query parameter is ignored.
- **Create Key (`POST /keys`):**
  - Member: Always generates key for `req.browserSession.user.id`, ignoring any `userId` in request body.
  - Admin: May provision keys for other active users (`body.userId`).
  - Single-Use Raw Display: The raw API key (`urumi_live_...`) is returned exactly once in the 201 Created response.
- **Revoke Key (`POST /keys/:id/revoke`):**
  - Server retrieves key record.
  - If user is a member and `keyRecord.user_id !== sessionUserId`, returns `HTTP 403 FORBIDDEN` (`FORBIDDEN_KEY_OWNERSHIP`).

### 3.4 MCP Authentication Fail-Closed Check (`api-key-service.ts`)
In `verifyKey(rawKey: string)`:
```typescript
const record = this.apiKeyRepo.findApiKeyByHash(keyHash);
if (!record) return null;
if (record.revoked_at !== null) return null;
if (record.expires_at !== null && record.expires_at <= now) return null;
// Active status check: deactivated user fails closed even if key wasn't revoked
if (record.is_active !== 1) {
  return null;
}
```
Protocol verification confirms that sending an active key belonging to a deactivated user to `POST /mcp` immediately returns `HTTP 401 UNAUTHORIZED`.

### 3.5 First-Admin Bootstrap CLI (`bootstrap-admin.ts`)
- Standalone CLI invoked via `npm run --workspace=apps/gateway bootstrap:admin`.
- Performs initialization check: `userRepo.countActiveAdmins()`.
- If active admins exist: outputs info message and exits with status code 0 without modifying the database.
- If zero active admins exist: generates a 32-byte enrollment invitation token with role `admin`, writes to `--output-file` with POSIX file mode `0600` (or prints to terminal if `--stdout` is passed), and logs enrollment metadata.

---

## 4. Test Verification Evidence

### 4.1 Gateway Test Execution Summary
Ran full test suite for `apps/gateway`:
```bash
export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" && npm run --workspace=apps/gateway test
```

- **Unit Tests:**
  ```
  ℹ tests 296
  ℹ suites 40
  ℹ pass 296
  ℹ fail 0
  ℹ duration_ms 12879.86938
  ```
- **Protocol Tests:**
  ```
  ℹ tests 18
  ℹ suites 7
  ℹ pass 18
  ℹ fail 0
  ℹ duration_ms 13206.938934
  ```
- **Gateway Workspace Total:** **314 passed**, 0 failed (up from baseline 285 tests; +29 tests added for G4).

### 4.2 Monorepo Regression Verification

All upstream and tool mock services passed 100% with zero regressions:

| Workspace | Unit Tests | Protocol Tests | Total Tests | Status |
|---|---|---|---|---|
| `apps/gateway` | 296 passed | 18 passed | 314 passed | **PASS** |
| `apps/mcp-crm` | 20 passed | 6 passed | 26 passed | **PASS** |
| `apps/mcp-tasks` | 27 passed | 8 passed | 35 passed | **PASS** |
| `apps/woocommerce-mcp` | 46 passed | 35 passed | 81 passed | **PASS** |
| **Total Monorepo** | **389 passed** | **67 passed** | **456 passed** | **PASS (100%)** |

*(Total tests across monorepo increased from reported baseline 427 to 456 tests).*

### 4.3 Static Type Checking & Build Verification
- **Gateway TypeScript Compilation:**
  ```bash
  npm run --workspace=apps/gateway typecheck
  # Output: tsc --noEmit (Exit code: 0, zero errors)
  ```
- **Dashboard Production Build:**
  ```bash
  npm run --workspace=apps/dashboard build
  # Output: tsc && vite build (Exit code: 0, built in 2.21s, zero errors)
  ```

---

## 5. Code & Repository Changes Inventory

### 5.1 Modified Files
- `apps/gateway/package.json`: Added `"bootstrap:admin": "tsx src/cli/bootstrap-admin.ts"`.
- `apps/gateway/src/auth/api-key-service.ts`: Added `record.is_active === 1` fail-closed verification.
- `apps/gateway/src/db/api-key-repo.ts`: Added `listAllApiKeysWithUser`, `listApiKeysByUserWithUser`, `revokeAllUserApiKeys`, and `is_active` query join.
- `apps/gateway/src/db/user-repo.ts`: Added `updateUserRole`, `countActiveAdmins`, `listUsersWithKeyCounts`.
- `apps/gateway/src/http/browser.ts`: Implemented 9 member/invitation/key routes with Zod validation, CSRF checks, and IDOR defenses.
- `apps/gateway/src/server.ts`: Wired `invitationRepo`, `invitationService`, `apiKeyRepo`, `apiKeyService` into `createBrowserApp`.
- `apps/gateway/src/index.ts`: Initialized `InvitationRepository` and `InvitationService` in gateway startup flow.

### 5.2 Newly Created Files
- `apps/gateway/src/db/invitation-repo.ts`: Data access repository for `user_invitations`.
- `apps/gateway/src/auth/invitation-service.ts`: Invitation token generation, Scrypt pre-hashing, and atomic redemption.
- `apps/gateway/src/cli/bootstrap-admin.ts`: First-admin bootstrap enrollment CLI tool.
- `apps/gateway/test/unit/invitation-lifecycle.test.ts`: 9 unit tests for invitation creation, redemption, replay, expiry, concurrency, and rollback.
- `apps/gateway/test/unit/member-lifecycle.test.ts`: 8 unit tests for directory listing, self-deactivation guard, last-admin protection, atomic deactivation, reactivation, and role demotion session purge.
- `apps/gateway/test/protocol/api-key-idor.test.ts`: 8 protocol tests for API-key listing, creation, revocation IDOR defense, and deactivated user fail-closed at `/mcp`.
- `apps/gateway/test/unit/bootstrap-admin.test.ts`: 3 unit tests for admin bootstrap token generation, mode 0600 file permissions, idempotency, and secret canary checks.
- `apps/gateway/test/unit/disposable-migration.test.ts`: 1 integration test verifying Migration 003 execution on disposable DB copies, integrity check, foreign keys check, row preservation, and backup manifest generation.
- `Resource/implementation/phase_5_g4_implementation_report.md`: This comprehensive implementation report.

### 5.3 Git Status
```
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
	modified:   apps/gateway/package.json
	modified:   apps/gateway/src/auth/api-key-service.ts
	modified:   apps/gateway/src/db/api-key-repo.ts
	modified:   apps/gateway/src/db/user-repo.ts
	modified:   apps/gateway/src/http/browser.ts
	modified:   apps/gateway/src/index.ts
	modified:   apps/gateway/src/server.ts

Untracked files:
	Resource/implementation/phase_5_g4_implementation_report.md
	Resource/implementation/phase_5_g4_readiness_and_implementation_plan.md
	apps/gateway/src/auth/invitation-service.ts
	apps/gateway/src/cli/bootstrap-admin.ts
	apps/gateway/src/db/invitation-repo.ts
	apps/gateway/test/protocol/api-key-idor.test.ts
	apps/gateway/test/unit/bootstrap-admin.test.ts
	apps/gateway/test/unit/disposable-migration.test.ts
	apps/gateway/test/unit/invitation-lifecycle.test.ts
	apps/gateway/test/unit/member-lifecycle.test.ts
```

---

## 6. Formal Gate Recommendation & Hold Notice

**Recommendation:** **STAGE 2 LOCAL IMPLEMENTATION & OFFLINE VERIFICATION COMPLETE — SUBMITTED FOR TECHNICAL HEAD REVIEW**

### Gate Boundary Enforcement
- **Stage 2 Work:** Fully implemented and verified against in-memory SQLite and sandboxed disposable database copies.
- **Stage 3/4/5/6 Prohibitions Maintained:**
  - Zero live migrations against `/data/gateway.db` or PVC storage.
  - Zero Kubernetes manifests applied, Helm charts upgraded, or cluster state modified.
  - Zero Docker container images built or pushed to any registry.
  - Zero pod restarts or VPS deployments.
- **Pending Review:** Gate P5-G4 final acceptance remains on HOLD pending formal Technical Head review of this implementation report and test evidence.

---

## 7. Addendum — Technical Head Evidence Reconciliation

This addendum resolves the evidence reconciliation items requested in the Technical Head's Stage 2 review:

### 7.1 Commit State & Current HEAD SHA Reconciliation
- **Baseline Git SHA:** `a38331a` (state prior to uncommitted Stage 2 edits).
- **Implementation Commit SHA:** `c43b8254d35616b9c0b56e74b2cad02d3aad16aa` (short: `c43b825`).
- **Commit Message:** `ph 5: feat(gateway): implement P5-G4 bootstrap admin CLI, invitation management, and secure token lifecycle`
- **Current Working Tree Status:**
  ```
  On branch main
  Your branch is up to date with 'origin/main'.
  nothing to commit, working tree clean
  ```
- **Reconciliation Note:** All 17 implementation files, test suites, CLI tools, and documentation are committed cleanly under `c43b825`. The prior discrepancy between the clean baseline commit `a38331a` and the uncommitted files in Section 5.3 is fully reconciled by commit `c43b825`.

### 7.2 Final Test Execution & Monorepo Totals
A fresh, comprehensive test run was executed on clean HEAD `c43b825` across all workspaces:

1. **`apps/gateway`:**
   - Command: `export PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH" && npm run --workspace=apps/gateway test`
   - Unit tests: 296 passed, 0 failed (40 test suites)
   - Protocol tests: 18 passed, 0 failed (7 test suites)
   - Gateway Total: **314 passed**, 0 failed (Exit code: 0)

2. **`apps/mcp-crm`:**
   - Command: `npm run --workspace=apps/mcp-crm test`
   - Unit: 20 passed, Protocol: 6 passed, Total: **26 passed**, 0 failed (Exit code: 0)

3. **`apps/mcp-tasks`:**
   - Command: `npm run --workspace=apps/mcp-tasks test`
   - Unit: 27 passed, Protocol: 8 passed, Total: **35 passed**, 0 failed (Exit code: 0)

4. **`apps/woocommerce-mcp`:**
   - Command: `npm run --workspace=apps/woocommerce-mcp test`
   - Unit: 46 passed, Protocol: 35 passed, Total: **81 passed**, 0 failed (Exit code: 0)

**Monorepo Verification Result:** Exactly **456 tests passed out of 456** across all workspaces with 0 failures, 0 skipped, and 0 cancellations in the same verified workspace.

### 7.3 Atomicity of Invitation Redemption, Session Issuance, and Consumption
- **Pre-Transaction Hashing:** Scrypt password hashing is executed *prior* to beginning the SQLite transaction to avoid holding locks during cryptographic computation.
- **Atomic Database Transaction (`BEGIN IMMEDIATE`):**
  1. Validates token hash, expiration (`expires_at > now`), and unredeemed status (`redeemed_at IS NULL`).
  2. Executes single-use consumption: `UPDATE user_invitations SET redeemed_at = ?, redeemed_by_user_id = ? WHERE id = ? AND redeemed_at IS NULL`. Throws `INVITATION_ALREADY_REDEEMED` if affected rows is 0.
  3. Verifies username uniqueness in `users`.
  4. Inserts user row into `users` (`is_active = 1`).
  5. Inserts credentials row into `user_credentials`.
  6. Commits transaction (`COMMIT`).
- **Rollback Guarantee:** If any error occurs inside the transaction block, `ROLLBACK` executes immediately. No partial user, credential, or invitation records are persisted.
- **Session Issuance Separation:** `sessionService.createSession(userId, meta)` is called strictly *after* successful transaction commit.
- **Empirical Proof:**
  - `invitation-lifecycle.test.ts` (Test 4): 10 concurrent requests against a single invitation token resulted in exactly 1 success (201) and 9 rejections (400), proving single-use race safety.
  - `invitation-lifecycle.test.ts` (Test 8): Injected failure during transaction verified complete rollback: 0 users inserted, 0 sessions created, invitation remained unredeemed.

### 7.4 Disposable Migration Isolation & Zero PVC Interaction
- **Isolated Sandbox:** `disposable-migration.test.ts` operates strictly inside a temporary directory created via `fs.mkdtempSync(path.join(os.tmpdir(), 'urumi-disposable-migration-'))`.
- **Database Scope:** Operates on `/tmp/urumi-disposable-migration-XXXXXX/disposable.db`.
- **Verification Chain:**
  1. Applies Migration 001 and 002.
  2. Seeds baseline records across `users`, `api_keys`, `upstreams`, and `audit_logs`.
  3. Executes `createDatabaseBackup()` to a temporary `/backups/` directory and verifies the generated `.manifest.json` SHA-256 hash.
  4. Applies Migration 003 (`003_invitations.sql`).
  5. Asserts `PRAGMA integrity_check` = `ok`.
  6. Asserts `PRAGMA foreign_key_check` returns 0 rows.
  7. Confirms 100% row preservation across all tables.
  8. Cleans up temporary directory recursively in `after()`.
- **Zero Live Database Access:** The live database file `/data/gateway.db` and live Kubernetes PVCs were neither opened, queried, nor modified at any point.

