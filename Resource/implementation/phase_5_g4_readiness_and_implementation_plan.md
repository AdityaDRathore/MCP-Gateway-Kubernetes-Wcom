# Urumi Platform — Phase 5: Gate P5-G4 Readiness and Implementation Plan
## Technical Head Handoff, Scope Freeze, and Implementation Authorization Request

> [!IMPORTANT]
> **Authority, Governance & Gate Disposition:**
> - **Gate Disposition:** `DRAFT FOR TECHNICAL HEAD REVIEW` — Gate P5-G4 Readiness and Implementation Plan.
> - **Operational Status:** **Implementation HOLD is strictly active.**
> - **Mutation Authority:** ZERO code edits, ZERO package installations, ZERO image builds, ZERO schema migrations, ZERO cluster mutations, and ZERO deployments are authorized during plan review.
> - **Next Step:** Await Technical Head review, formal disposition of open decisions, and issuance of explicit written Gate P5-G4 Implementation Authorization.

---

## A. Repository and Environment Baseline

### 1. Version Control & Git Status
- **Current Branch:** `main` (tracked against `origin/main`, fully up to date).
- **Current HEAD Commit SHA:** `a38331a4f56fdf6ff91fc69fec18c3c9e92426cc`
- **Commit Subject:** `ph 5: test: add fault-injection canary test and qualify G3 inspection boundaries`
- **Working Tree State:** Completely clean (`nothing to commit, working tree clean`). Verified by `git status --short --branch`.
- **Recent Commit Lineage Relevant to Phase 5:**
  - `a38331a` (HEAD) — `ph 5: test: add fault-injection canary test and qualify G3 inspection boundaries`
  - `6ec6a65` — `feat(phase-5): implement P5-G3 upstream and tool management browser facade with role and SSRF controls`
  - `27c2115` — `ph 5: refactor: update Gate P5-G2 report to reflect correction pass and hold status`
  - `48a4422` — `fix(phase-5): reconcile G1 schema contract, login rate limiter, trusted proxy IP, and backup manifest`
  - `5630559` — `ph 5: docs: add phase 5 gate P5-G2 implementation and verification report`
  - `82a117e` — `feat(phase-5): implement Gate P5-G2 dashboard scaffold, dual listener, session auth, and offline verification`
  - `ab85feb` — `ph 5: docs: add Phase 5 planning and review package including roadmaps, gap analysis, and technical handoff documents`
  - `9acc924` — `docs: add Phase 4 Study Material, Technical Context Material, and update global README and architecture`
  - `c4a6e85` — `ph 4: feat: complete Gate G9 end-to-end acceptance, benchmarking, and runbooks`

### 2. Runtime Environment & Toolchain
- **Operating System:** Linux (Kernel 6.8.0, x86_64)
- **Node.js Active Runtime:** Node.js 24 LTS (`v24.20.0`), located at `/home/rathore/.nvm/versions/node/v24.20.0/bin/node`.
  *(Note: Shell commands must explicitly prefix `PATH="/home/rathore/.nvm/versions/node/v24.20.0/bin:$PATH"` to ensure Node 24 is executed instead of system Node 18, which lacks built-in `node:sqlite`).*
- **npm Package Manager:** `11.19.0` (supports Node >= 20.17.0).
- **TypeScript:** `5.7.3` (`apps/gateway/tsconfig.json`).
- **Dependencies:** `@modelcontextprotocol/sdk@1.32.1`, `express@^4.21.2`, `zod@^3.24.2`.
- **Database Engine:** Node.js native `node:sqlite` (`DatabaseSync`) operating in WAL mode on `/data/gateway.db` (or `:memory:` in unit tests).

### 3. Empirical Test Baseline (Independently Rerun & Runtime-Verified)
Every test suite was rerun locally under Node.js 24 LTS on 2026-10-21:
- `apps/gateway` Unit Tests: **275 passed, 0 failed, 36 suites** (`npm run --workspace=apps/gateway test:unit`).
- `apps/gateway` Protocol Tests: **10 passed, 0 failed, 6 suites** (`npm run --workspace=apps/gateway test:protocol`).
- `apps/mcp-crm` Test Suite: **26 passed, 0 failed** (20 unit + 6 protocol).
- `apps/mcp-tasks` Test Suite: **35 passed, 0 failed** (27 unit + 8 protocol).
- `apps/woocommerce-mcp` Test Suite: **81 passed, 0 failed** (46 unit + 35 protocol).
- **Total Local Verified Baseline:** **427 tests passing (100%), 0 failures, 0 skipped.**

### 4. CI / Remote Status
- **Inspection Finding:** Static inspection of `.git` and repository root confirms **no `.github/workflows` directory or CI pipeline configuration exists** in the repository.
- **Fact:** GitHub shows zero workflow runs or automated status checks. Test results reported here are runtime-verified on the local workspace, not from external CI runners.

---

## B. Source-of-Truth Reconciliation

Every G4 requirement is reconciled against the frozen governance and architecture documents:
1. `Resource/implementation/phase_5_g1_design_freeze_package.md` (G1 Design Freeze)
2. `Context/phase5-planning-package/docs/phase-5/phase-5-master-roadmap.md` (Phase 5 Master Roadmap)
3. `Context/phase5-planning-package/docs/phase-5/phase-5-gap-analysis.md` (Gap Analysis)
4. `apps/gateway/src/db/schema.ts` (Frozen Migration 003 DDL)

| Requirement / Subject | Citation in Source Documents | Exact Specification & Constraints | Reconciled Technical Position |
|---|---|---|---|
| **Member Invitations** | G1 Freeze §3.2 (lines 154–177), §5.1 (lines 494–500); Roadmap §9 (TEAM-02) | `POST /api/v1/browser/invitations`. Admin-only + CSRF + Origin. 32-byte secure random token. Store SHA-256 verifier in `user_invitations.token_hash`. Expiry: 72 hours. Displayed once in UI; zero plaintext token in DB/logs. | Reconciled. Token prefix `urumi_inv_` + 64 hex chars. URL: `/invite/:token`. Admin role required. |
| **Invitation Redemption** | G1 Freeze §3.2 (lines 178–200); Roadmap §9 (TEAM-02) | `POST /api/v1/browser/invitations/redeem`. Anonymous. Atomic transaction: check token hash, `expires_at > now`, `redeemed_at IS NULL`. Scrypt hash password ($N=16384, r=8, p=1$). Insert `users`, `user_credentials`. Mark redeemed. Issue session cookie. | Reconciled. Single-use enforcement via atomic `BEGIN IMMEDIATE`. Replay returns 400 `INVITATION_INVALID`. Duplicate user returns 409 `USERNAME_EXISTS`. |
| **Admin Invitations vs Member Invitations** | G1 Freeze §3.2 (line 162); Roadmap §9 (P5-09) | Request schema allows `"role": "admin" \| "member"`. Default: `"member"`. Admin role required to issue both. | Admins may invite other Admins or Members. In both cases, token is single-use and valid for 72 hours. |
| **Team Member Directory** | G1 Freeze §3.2 (lines 135–153); Gap Analysis §4 (P5-09) | `GET /api/v1/browser/members`. Admin-only. Returns `{ members: [{ id, username, role, isActive, createdAt, activeKeyCount }] }`. | Reconciled. Requires SQL join with `api_keys` counting non-revoked, unexpired keys. Member access returns `403 Forbidden`. |
| **Member Deactivation** | G1 Freeze §3.2 (lines 201–210), §5.4 (lines 521–559); Roadmap §9 (TEAM-07) | `POST /api/v1/browser/members/:id/deactivate`. Admin-only + CSRF. Atomic transaction: `users.is_active = 0`; delete all records in `browser_sessions`; update all active keys in `api_keys` setting `revoked_at = now`. | Reconciled. Immediate dual-plane invalidation: sessions deleted, keys revoked. Cannot deactivate self. Cannot deactivate last active admin. |
| **Member Reactivation** | G1 Freeze §3.2 (lines 211–215); Roadmap §9 (P5-09) | `POST /api/v1/browser/members/:id/reactivate`. Admin-only + CSRF. Sets `users.is_active = 1`. Does **not** un-revoke previously revoked API keys. | Reconciled. User must generate or be issued fresh API keys. |
| **Administrative Role Changes** | G1 Freeze §3.2 (lines 216–222), §5.4 (lines 553–558) | `PATCH /api/v1/browser/members/:id/role`. Admin-only + CSRF. Validates role (`admin` $\leftrightarrow$ `member`). Purges all sessions in `browser_sessions` for target user to force re-auth with new role. | Reconciled. Cannot demote last active admin. Session purge prevents privilege retention. Next request requires re-login. |
| **Last Active Admin Safeguard** | G1 Freeze §5.3 (lines 513–519); Roadmap §9 (DEC-07) | Before deactivating or demoting an admin, verify `SELECT count(*) FROM users WHERE role = 'admin' AND is_active = 1` $\ge 2$. | Reconciled. Rejects with `HTTP 400 Bad Request: { error: "Cannot demote or deactivate the last remaining active administrator.", code: "LAST_ADMIN_PROTECTED" }`. |
| **API-Key Self-Service (Listing)** | G1 Freeze §3.2 (lines 226–250); Roadmap §9 (TEAM-04, TEAM-05) | `GET /api/v1/browser/keys`. Admin sees all keys. Member queries are strictly bound to `WHERE user_id = req.user.id`; client-supplied `userId` parameter is ignored. | Reconciled. Returns safe DTO: `{ id, userId, username, name, keyPrefix, expiresAt, revokedAt, createdAt, lastUsedAt }`. `key_hash` is **never** included. |
| **API-Key Creation & One-Time Display** | G1 Freeze §3.2 (lines 251–279); Roadmap §9 (TEAM-03) | `POST /api/v1/browser/keys`. Admin may specify `userId`. Member target `userId` is strictly forced to `req.user.id`. Returns `{ apiKey: {...}, rawKey: "urumi_live_..." }`. | Reconciled. `rawKey` returned strictly once. Not persisted plaintext in DB. Backend ignores/overrides Member target user. |
| **API-Key Revocation & IDOR Protection** | G1 Freeze §3.2 (lines 280–289); Roadmap §9 (TEAM-04, TEAM-05, TEAM-07) | `POST /api/v1/browser/keys/:id/revoke`. Admin can revoke any key. Member can revoke only keys where `key.user_id === req.user.id`. Cross-user attempts return 403 or non-enumerating 404. | Reconciled. Revoked key fails immediately on `/mcp` with 401. Key remains revoked in SQLite. |
| **First-Admin Bootstrap / Recovery** | G1 Freeze §5.2 (lines 501–512); Roadmap §9 (TEAM-01); DEC-06 | CLI `apps/gateway/src/cli/bootstrap-admin.ts`. If active admin exists: exit code 0 (`already initialized`). If no active admin: outputs single-use enrollment token (valid 1h). | Reconciled. Separate from Phase 4 API-key `bootstrap.ts` to maintain 100% backward compatibility. Zero hardcoded passwords. |

---

## C. Current Implementation Gap Matrix

| Requirement | Existing Implementation | Missing / Change Required | Security Impact | Acceptance Test | Evidence Needed |
|---|---|---|---|---|---|
| **Member Invitations** | `user_invitations` table defined in `schema.ts`. | No repository, service, or HTTP endpoint for generating invitations. | Without secure verifiers, tokens could be leaked or replayed. | `POST /api/v1/browser/invitations` generates 32-byte token; returns `urumi_inv_...` once. | Test assertions on token verifier in DB and single-use return. |
| **Invitation Redemption** | `user_credentials` table and Scrypt hashing exist in `ScryptPasswordService`. | `POST /api/v1/browser/invitations/redeem` endpoint missing; atomic redemption transaction missing. | Race condition in concurrent redemptions or password hashing failures. | Concurrent redemptions of same token: exactly 1 succeeds, 2nd gets 400. | Negative test on duplicate redeem and expired token. |
| **Team Member Listing** | `UserRepository.listUsers()` exists. | Does not compute `activeKeyCount`; no `GET /api/v1/browser/members` route mounted. | Exposing inactive members without role controls. | Admin queries `GET /members`; Member gets 403. | HTTP test with Admin and Member cookies. |
| **Member Deactivation** | `UserRepository.updateActiveStatus()` and `SessionRepository.deleteUserSessions()` exist. | Atomic deactivation combining status change, session purge, and API-key revocation missing; endpoint missing. | Deactivated user retaining live API keys or active browser sessions. | Deactivated member's cookie gets 401; their API keys fail at `/mcp` with 401. | Direct HTTP probes to `/browser/session` and `/mcp`. |
| **Member Reactivation** | `updateActiveStatus()` exists. | `POST /members/:id/reactivate` route missing; guarantee that revoked keys remain revoked missing. | Reactivation mistakenly re-enabling compromised API keys. | Reactivated user can log in with password, but old API keys still return 401. | Login verification + `/mcp` key rejection. |
| **Role Modification** | `users.role` column exists. | `PATCH /members/:id/role` route missing; session invalidation on role change missing. | Privilege retention: demoted admin retaining admin capabilities in existing session. | Demoted admin's existing cookie is rejected (session deleted); re-login grants Member role. | Session purge assertion on role change. |
| **Last Admin Guard** | Not implemented. | Count check `SELECT count(*) WHERE role = 'admin' AND is_active = 1` before deactivating/demoting admin. | Operator lockout: zero active admins remaining on platform. | Attempt to deactivate or demote lone active admin returns 400 `LAST_ADMIN_PROTECTED`. | Negative test on single-admin fixture. |
| **API-Key Listing** | `ApiKeyRepository.listApiKeysByUser()` exists (returns raw `ApiKeyRecord` including `key_hash`). | `GET /api/v1/browser/keys` route missing; DTO projection missing; server-side IDOR check missing. | IDOR: Member viewing other members' keys; leakage of `key_hash` in response. | Member queries `/keys?userId=other`: returns Member's keys only; `key_hash` absent. | DTO assertion and query tampering test. |
| **API-Key Generation** | `ApiKeyService.generateApiKey()` exists. | `POST /api/v1/browser/keys` route missing; server-side override of Member `userId` missing. | Member issuing keys for other users (privilege escalation). | Member submits `{ userId: "admin" }`: key created is bound strictly to Member ID. | DB user_id assertion on created key. |
| **API-Key Revocation** | `ApiKeyService.revokeKey()` exists. | `POST /api/v1/browser/keys/:id/revoke` route missing; ownership validation missing. | IDOR: Member revoking Admin or colleague API keys. | Member A attempts to revoke Key B: returns 403/404; Key B remains active at `/mcp`. | Negative IDOR test + `/mcp` bearer test. |
| **Active Status in MCP Auth** | `ApiKeyRepository.findApiKeyByHash` joins `users` but does not select `is_active`. | `ApiKeyWithUser` interface and query must include `is_active`; `verifyKey()` must reject inactive users. | Deactivated user using previously active key if key revocation failed or was delayed. | API key of user with `is_active = 0` returns `null` from `verifyKey()` (401). | Unit test on `verifyKey()` with inactive user. |
| **First-Admin Bootstrap** | `src/cli/bootstrap.ts` exists (provisions Admin + API key only). | `src/cli/bootstrap-admin.ts` missing (must output browser enrollment URL without hardcoded password). | Inability to access dashboard upon clean deployment without manual DB manipulation. | Running `bootstrap:admin` prints enrollment URL; repeated run halts safely with code 0. | CLI invocation test in test harness. |
| **Migration Safety Test** | Migration 003 DDL written in `schema.ts`. | Offline disposable database copy test missing. | Migration corrupting live SQLite database during cluster rollout. | Migration 003 executed on database copy: row counts match baseline; `PRAGMA integrity_check` = ok. | Automated test comparing pre- and post-counts. |

---

## D. API and Data Contracts

All endpoints are mounted exclusively on **Port 3001** under `/api/v1/browser/*`.

### 1. Member & Invitation Management Endpoints

#### `GET /api/v1/browser/members`
- **Method:** `GET`
- **Authentication:** Authenticated, Admin role required (`sessionAuth`, `requireRole('admin')`).
- **Response (200 OK):**
  ```json
  {
    "members": [
      {
        "id": "b590e714-c575-4bab-862c-f74cb9a47b01",
        "username": "admin",
        "role": "admin",
        "isActive": true,
        "createdAt": 1792308540,
        "activeKeyCount": 1
      }
    ]
  }
  ```
- **Error Responses:** `401 UNAUTHORIZED`, `403 FORBIDDEN`.

#### `POST /api/v1/browser/invitations`
- **Method:** `POST`
- **Authentication:** Authenticated, Admin role + CSRF + Origin (`sessionAuth`, `requireRole('admin')`, `csrfAuth`).
- **Request Body:**
  ```json
  {
    "role": "member"
  }
  ```
  *(Validation: `role` optional enum `'admin' | 'member'`, default `'member'`)*.
- **Action:** Generates 32 bytes cryptographically secure random entropy. Computes SHA-256 verifier. Inserts into `user_invitations` with `expires_at = now + 72 hours`.
- **Response (201 Created):**
  ```json
  {
    "invitation": {
      "id": "inv_8f9a2b...",
      "role": "member",
      "expiresAt": 1792567740,
      "token": "urumi_inv_32byteshex...",
      "inviteUrl": "/invite/urumi_inv_32byteshex..."
    }
  }
  ```
- **Security Invariant:** `token` is returned **exactly once** upon issuance. Only SHA-256 verifier is stored.

#### `POST /api/v1/browser/invitations/redeem`
- **Method:** `POST`
- **Authentication:** Anonymous (Strict Rate Limit: 5 failed attempts per 5 minutes per IP).
- **Request Body:**
  ```json
  {
    "token": "urumi_inv_32byteshex...",
    "username": "alice",
    "password": "SecurePassword123!"
  }
  ```
  *(Validation: `token` non-empty string, `username` 3–32 chars `^[a-zA-Z0-9_-]+$`, `password` 8–128 chars)*.
- **Action (Atomic `BEGIN IMMEDIATE` Transaction):**
  1. Computes SHA-256 hash of `token`.
  2. Queries `user_invitations`: verifies token exists, `expires_at > now`, `redeemed_at IS NULL`.
  3. Verifies `username` is not taken in `users`.
  4. Hashes password via Scrypt ($N=16384, r=8, p=1$).
  5. Inserts new user in `users` (`role` taken from invitation, `is_active = 1`).
  6. Inserts row in `user_credentials`.
  7. Updates `user_invitations` setting `redeemed_at = now`, `redeemed_by_user_id = user.id`.
  8. Establishes session in `browser_sessions` and issues `urumi_session` cookie.
- **Response (201 Created):**
  ```json
  {
    "user": {
      "id": "usr_uuid...",
      "username": "alice",
      "role": "member"
    },
    "csrfToken": "csrf_hex..."
  }
  ```
  *Headers Set: `Set-Cookie: urumi_session=<token_hex>; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`*
- **Error Responses:** `400 INVITATION_INVALID`, `400 INVITATION_EXPIRED`, `409 USERNAME_EXISTS`, `429 RATE_LIMITED`.

#### `POST /api/v1/browser/members/:id/deactivate`
- **Method:** `POST`
- **Authentication:** Authenticated, Admin role + CSRF + Origin.
- **Action (Atomic Transaction):**
  1. Verifies target user exists.
  2. Guard: `target.id !== req.user.id` (cannot deactivate self).
  3. Guard: If target is admin, asserts `SELECT count(*) FROM users WHERE role = 'admin' AND is_active = 1` $\ge 2$ (cannot deactivate last active admin).
  4. Updates `users.is_active = 0`.
  5. Purges all sessions: `DELETE FROM browser_sessions WHERE user_id = ?`.
  6. Revokes all active API keys: `UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "userId": "usr_uuid...",
    "status": "deactivated"
  }
  ```
- **Error Responses:** `400 CANNOT_DEACTIVATE_SELF`, `400 LAST_ADMIN_PROTECTED`, `404 USER_NOT_FOUND`, `403 FORBIDDEN`.

#### `POST /api/v1/browser/members/:id/reactivate`
- **Method:** `POST`
- **Authentication:** Authenticated, Admin role + CSRF + Origin.
- **Action:** Updates `users.is_active = 1`. Does **not** un-revoke previously revoked API keys.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "userId": "usr_uuid...",
    "status": "active"
  }
  ```

#### `PATCH /api/v1/browser/members/:id/role`
- **Method:** `PATCH`
- **Authentication:** Authenticated, Admin role + CSRF + Origin.
- **Request Body:**
  ```json
  {
    "role": "member"
  }
  ```
  *(Validation: `role` enum `'admin' | 'member'`)*.
- **Action (Atomic Transaction):**
  1. If demoting an admin (`target.role === 'admin'` and `newRole === 'member'`), asserts `active_admins >= 2`.
  2. Updates `users.role = ?`.
  3. Purges all sessions: `DELETE FROM browser_sessions WHERE user_id = ?` (forces re-login so updated permissions are reflected in new session token).
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "userId": "usr_uuid...",
    "newRole": "member"
  }
  ```
- **Error Responses:** `400 LAST_ADMIN_PROTECTED`, `404 USER_NOT_FOUND`, `403 FORBIDDEN`.

---

### 2. API-Key Management & Self-Service Endpoints

#### `GET /api/v1/browser/keys`
- **Method:** `GET`
- **Authentication:** Authenticated (`sessionAuth`).
- **Authorization / Ownership Rule:**
  - If `req.user.role === 'admin'`: Returns all API keys across all users (with usernames).
  - If `req.user.role === 'member'`: Query parameter `userId` is **strictly ignored**. Query is hard-bound to `WHERE user_id = req.user.id`.
- **Response (200 OK):**
  ```json
  {
    "keys": [
      {
        "id": "d5e9b7a3-2c7c-490b-aceb-c1979a4e4785",
        "userId": "b590e714-c575-4bab-862c-f74cb9a47b01",
        "username": "admin",
        "name": "CLI Workstation Key",
        "keyPrefix": "urumi_live_13f4e",
        "expiresAt": null,
        "revokedAt": null,
        "createdAt": 1792308540,
        "lastUsedAt": 1792401126
      }
    ]
  }
  ```
- **Security Invariant:** `key_hash` is **never** included in this DTO.

#### `POST /api/v1/browser/keys`
- **Method:** `POST`
- **Authentication:** Authenticated + CSRF + Origin (`sessionAuth`, `csrfAuth`).
- **Request Body:**
  ```json
  {
    "name": "Integration Key",
    "userId": "optional_target_uuid",
    "expiresInSeconds": 2592000
  }
  ```
  *(Validation: `name` string 1–64 chars, `expiresInSeconds` optional positive integer)*.
- **Authorization / Ownership Rule:**
  - If Member: Target user is forced to `req.user.id`. Any client-supplied `userId` is overridden.
  - If Admin: May specify `userId` for an existing active user, or defaults to `req.user.id`.
- **Action:** Calls `ApiKeyService.generateApiKey()`.
- **Response (201 Created):**
  ```json
  {
    "apiKey": {
      "id": "k_uuid...",
      "userId": "usr_uuid...",
      "username": "alice",
      "name": "Integration Key",
      "keyPrefix": "urumi_live_abc12",
      "expiresAt": 1794900540,
      "createdAt": 1792308540
    },
    "rawKey": "urumi_live_abc1234567890abcdef..."
  }
  ```
- **Security Invariant:** `rawKey` is returned **strictly once** in this response.

#### `POST /api/v1/browser/keys/:id/revoke`
- **Method:** `POST`
- **Authentication:** Authenticated + CSRF + Origin.
- **Authorization / Ownership Rule:**
  - Queries key by `:id`. If not found, returns `404 NOT_FOUND`.
  - If Member: Asserts `key.user_id === req.user.id`. If mismatched, returns `403 FORBIDDEN` (or 404 to prevent ID enumeration).
  - If Admin: Can revoke any valid key.
- **Action:** Calls `ApiKeyService.revokeKey(keyId)`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "keyId": "k_uuid...",
    "revokedAt": 1792308999
  }
  ```
- **Protocol Impact:** On the very next downstream request to `/mcp`, presenting this key immediately fails with `HTTP 401 Unauthorized`.

---

## E. Migration and Recovery Plan

### 1. Schema Definition (Migration 003)
Migration 003 was reconciled in G2 and resides in `apps/gateway/src/db/schema.ts`:
- Adds `is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))` to `users`.
- Creates `user_credentials` table (Scrypt hashes).
- Creates `browser_sessions` table (SHA-256 session verifiers).
- Creates `user_invitations` table (SHA-256 invitation verifiers).

### 2. Pre-Flight Disposable Database Protocol (Mandatory in G4)
In G4, the migration runner will be tested against an isolated copy of the database:
1. **Creation of Sandboxed DB:** Copy current SQLite schema/database to a temporary file (`/tmp/disposable-m003-test.db`).
2. **Execute Forward Migrations:** Run `migration001`, `migration002`, and `migration003`.
3. **Assert Invariants & Integrity:**
   - Execute `PRAGMA integrity_check;` $\rightarrow$ must return `ok`.
   - Execute `PRAGMA foreign_key_check;` $\rightarrow$ must return empty (0 violations).
   - Assert baseline row preservation:
     - `SELECT count(*) FROM users;` (Unchanged).
     - `SELECT count(*) FROM api_keys;` (Unchanged).
     - `SELECT count(*) FROM upstreams;` (Unchanged).
     - `SELECT count(*) FROM audit_logs;` (Unchanged).
4. **Backup Verification:**
   - Verify `VACUUM INTO` creates an atomic, standalone snapshot file outside an active transaction.
   - Assert SHA-256 checksum and manifest generation (`apps/gateway/src/db/backup.ts`).
5. **Strict Boundary:**
   - **ZERO execution against `/data/gateway.db`** on any running pod or persistent volume during G4 implementation. Live migration remains locked until Gate P5-G6 cluster staging.

---

## F. Test Plan

Every acceptance criterion maps to a concrete test suite and expected assertion:

| Test ID | Test Suite | Specific Scenario | Expected Result |
|---|---|---|---|
| **INV-01** | `invitation-lifecycle.test.ts` | Admin issues invitation with default role (`member`) | 201 Created; returns 32-byte token; SHA-256 hash stored in `user_invitations`; `expires_at = now + 72h`. |
| **INV-02** | `invitation-lifecycle.test.ts` | Admin issues invitation with `admin` role | 201 Created; invitation stored with `role = 'admin'`. |
| **INV-03** | `invitation-lifecycle.test.ts` | Member attempts to create invitation | `HTTP 403 Forbidden`; no invitation record created. |
| **INV-04** | `invitation-lifecycle.test.ts` | Successful invitation redemption | 201 Created; user inserted into `users` with `is_active = 1`; credentials in `user_credentials`; invitation marked redeemed with timestamp and user ID; initial session cookie set. |
| **INV-05** | `invitation-lifecycle.test.ts` | Single-use replay protection | 1st redemption succeeds; 2nd attempt with same token returns `HTTP 400 INVITATION_INVALID`. |
| **INV-06** | `invitation-lifecycle.test.ts` | Expired invitation redemption | Token with `expires_at < now` returns `HTTP 400 INVITATION_EXPIRED`. |
| **INV-07** | `invitation-lifecycle.test.ts` | Duplicate username collision on redeem | Submitting existing username returns `HTTP 409 USERNAME_EXISTS`; invitation remains unredeemed. |
| **INV-08** | `invitation-lifecycle.test.ts` | Concurrent redemption race | Two concurrent `BEGIN IMMEDIATE` redemptions: exactly one succeeds; the other fails with 400. |
| **MEM-01** | `member-lifecycle.test.ts` | Admin lists team members | 200 OK; returns list of users with `id`, `username`, `role`, `isActive`, `activeKeyCount`. |
| **MEM-02** | `member-lifecycle.test.ts` | Member attempts to list team members | `HTTP 403 Forbidden`. |
| **MEM-03** | `member-lifecycle.test.ts` | Admin deactivates member | 200 OK; `users.is_active` set to 0; all active sessions deleted from `browser_sessions`; all keys marked `revoked_at = now` in `api_keys`. |
| **MEM-04** | `member-lifecycle.test.ts` | Deactivated member immediate session check | Next request with deactivated user's session cookie returns `HTTP 401 Unauthorized`. |
| **MEM-05** | `member-lifecycle.test.ts` | Deactivated member immediate MCP key check | Calling `/mcp` with deactivated user's key returns `HTTP 401 Unauthorized`. |
| **MEM-06** | `member-lifecycle.test.ts` | Admin deactivates self guard | Calling `POST /members/:selfId/deactivate` returns `HTTP 400 CANNOT_DEACTIVATE_SELF`. |
| **MEM-07** | `member-lifecycle.test.ts` | Last active admin deactivation guard | System with 1 active admin: deactivation returns `HTTP 400 LAST_ADMIN_PROTECTED`. |
| **MEM-08** | `member-lifecycle.test.ts` | Last active admin demotion guard | System with 1 active admin: demoting to `member` returns `HTTP 400 LAST_ADMIN_PROTECTED`. |
| **MEM-09** | `member-lifecycle.test.ts` | Role change session invalidation | Updating member role purges their records in `browser_sessions`; forces re-login. |
| **MEM-10** | `member-lifecycle.test.ts` | Admin reactivates member | 200 OK; `users.is_active` set to 1; previously revoked API keys remain revoked. |
| **KEY-01** | `api-key-idor.test.ts` | Admin lists all API keys | 200 OK; returns all keys across all users with usernames; `key_hash` absent from payload. |
| **KEY-02** | `api-key-idor.test.ts` | Member lists API keys (IDOR protection) | Member sends `GET /keys?userId=admin`; response contains **only** Member's own keys. |
| **KEY-03** | `api-key-idor.test.ts` | Member generates API key (Self-Service) | 201 Created; returns `rawKey` once; key is bound to Member's session `userId` even if body specifies `userId: "admin"`. |
| **KEY-04** | `api-key-idor.test.ts` | Admin generates API key for specific member | 201 Created; key is bound to target `userId`. |
| **KEY-05** | `api-key-idor.test.ts` | Member revokes own key | 200 OK; key marked `revoked_at` in DB; subsequent `/mcp` call with this key returns 401. |
| **KEY-06** | `api-key-idor.test.ts` | Member attempts to revoke another user's key (IDOR) | Member A calls `POST /keys/:keyBId/revoke`; returns `HTTP 403 Forbidden` (or 404); Key B remains active at `/mcp`. |
| **KEY-07** | `api-key-idor.test.ts` | Admin revokes any user's key | 200 OK; target key revoked immediately. |
| **KEY-08** | `api-key-idor.test.ts` | Revoking already revoked or nonexistent key | Revoking non-existent key returns 404; revoking already-revoked key is handled safely. |
| **MIG-01** | `disposable-migration.test.ts` | Migration 003 execution on disposable DB copy | Migrations 001–003 run cleanly; `PRAGMA integrity_check` = `ok`; `PRAGMA foreign_key_check` = 0. |
| **MIG-02** | `disposable-migration.test.ts` | Row preservation across Migration 003 | Pre- and post-migration counts for `users`, `api_keys`, `upstreams`, and `audit_logs` match 100%. |
| **MIG-03** | `disposable-migration.test.ts` | Pre-migration backup & checksum | `createDatabaseBackup()` generates valid snapshot and manifest with matching SHA-256. |
| **BOOT-01**| `bootstrap-admin.test.ts` | First-admin bootstrap on empty DB | Generates one-time enrollment token; records in `user_invitations` with `role = 'admin'`. |
| **BOOT-02**| `bootstrap-admin.test.ts` | Bootstrap idempotency on provisioned DB | Exits safely with code 0 (`already initialized`); zero mutations to existing admins or keys. |
| **SECR-01**| `api-key-idor.test.ts` | Canary secret scanning | Regex scan across all response bodies, headers, and logs confirms 0 canary secret matches. |

---

## G. File-by-File Work Order

Every proposed file change directly reuses existing Phase 4 primitives without introducing redundant services or new persistence engines:

### 1. New Files to Create

1. **`apps/gateway/src/db/invitation-repo.ts`**
   - **Purpose:** Data access repository for the `user_invitations` table.
   - **Methods:** `insertInvitation()`, `findInvitationByTokenHash()`, `markRedeemed()`, `countPendingInvitations()`, `pruneExpiredInvitations()`.
   - **Reuse:** Connects via existing `DatabaseSync` connection owner.

2. **`apps/gateway/src/auth/invitation-service.ts`**
   - **Purpose:** High-level invitation lifecycle management.
   - **Methods:** `createInvitation(role, invitedBy)`, `redeemInvitation(token, username, password, meta)`.
   - **Reuse:** Uses `ScryptPasswordService` for password hashing and `SessionService` for initial session cookie issuance. Implements atomic transaction (`BEGIN IMMEDIATE`) for redemption.

3. **`apps/gateway/src/cli/bootstrap-admin.ts`**
   - **Purpose:** Standalone CLI tool for first-admin browser enrollment per G1 §5.2.
   - **Behavior:** Checks for existing active admins. If present, exits code 0. If absent, generates enrollment token and prints one-time URL. Zero hardcoded passwords.
   - **Reuse:** Reuses `DatabaseManager` and `InvitationRepository`.

4. **Test Suites in `apps/gateway/test/`:**
   - `test/unit/invitation-lifecycle.test.ts`
   - `test/unit/member-lifecycle.test.ts`
   - `test/protocol/api-key-idor.test.ts`
   - `test/integration/disposable-migration.test.ts`
   - `test/unit/bootstrap-admin.test.ts`

### 2. Existing Files to Modify

1. **`apps/gateway/src/db/user-repo.ts`**
   - **Additions:**
     - `updateUserRole(userId: string, role: 'admin' | 'member'): void`
     - `countActiveAdmins(): number` (used for last-admin protection).
     - `listUsersWithKeyCounts(now: number): MemberWithKeyCount[]` (joins `api_keys` to provide exact `activeKeyCount` DTO).

2. **`apps/gateway/src/db/api-key-repo.ts`**
   - **Additions:**
     - Select `u.is_active` in `findApiKeyByHash` query and include in `ApiKeyWithUser`.
     - `listAllApiKeysWithUser(): ApiKeyWithUserSummary[]` (joins `users` to provide username for Admin key listing).
     - `listApiKeysByUserWithUser(userId: string): ApiKeyWithUserSummary[]` (for Member own-key listing).
     - `revokeAllUserApiKeys(userId: string, revokedAt?: number): number` (used during member deactivation).

3. **`apps/gateway/src/auth/api-key-service.ts`**
   - **Modifications:**
     - In `verifyKey(rawKey)`: Check `record.is_active === 1`. If user is deactivated, return `null` immediately (defense-in-depth).
     - Add helper methods for owner-authorized key operations.

4. **`apps/gateway/src/http/browser.ts`**
   - **Modifications:**
     - Extend `BrowserRouterOptions` with `apiKeyService`, `apiKeyRepo`, `invitationService`, `invitationRepo`.
     - Mount Member routes: `GET /members`, `POST /members/:id/deactivate`, `POST /members/:id/reactivate`, `PATCH /members/:id/role`.
     - Mount Invitation routes: `POST /invitations`, `POST /invitations/redeem`.
     - Mount API-Key routes: `GET /keys`, `POST /keys`, `POST /keys/:id/revoke`.
     - Add strict validation schemas via Zod for all request bodies.

5. **`apps/gateway/src/server.ts` & `apps/gateway/src/index.ts`**
   - **Modifications:**
     - Instantiate `InvitationRepository` and `InvitationService`.
     - Pass `apiKeyService`, `apiKeyRepo`, `invitationService`, `invitationRepo` to `createBrowserApp()` and `createBrowserRouter()`.

6. **`apps/gateway/package.json`**
   - **Modifications:**
     - Add script: `"bootstrap:admin": "tsx src/cli/bootstrap-admin.ts"`.

---

## H. Gate Boundaries

To maintain strict project boundaries, the workflow is split into non-overlapping permissions:

1. **Stage 1: Design and Contract Freeze (CURRENT)**
   - Scope: Review of this readiness and implementation plan.
   - Authorized Mutations: ZERO.
2. **Stage 2: Local Code Implementation (Awaiting Authorization)**
   - Scope: Writing code for repositories, services, and browser routes in `apps/gateway/src/`.
   - Prohibitions: No cluster mutation, no live migration, no image build.
3. **Stage 3: Local / Offline Automated Test Verification**
   - Scope: Running `npm run test:unit`, `test:protocol`, and new G4 test suites against in-memory SQLite and sandboxed DB copies.
4. **Stage 4: Container Multi-Stage Image Build**
   - Scope: Local Docker build verifying compilation and static asset inclusion. (Deferred to Gate P5-G6).
5. **Stage 5: Rendered Helm & Config Validation**
   - Scope: `helm lint` and `helm template` checks.
6. **Stage 6: Live Cluster Mutation & Staging Deployment**
   - Scope: Live migration against `/data/gateway.db`, pod rollout, Ingress testing.
   - **STRICT PROHIBITION:** Requires separate, explicit written authorization from Technical Head.

---

## I. Risks and Explicit Stop Conditions

### 1. Technical & Security Risks
- **IDOR on API-Key Revocation/Listing:** Mitigated by server-authoritative ownership checks (`req.user.id`) and unit/protocol tests sending cross-user UUIDs.
- **Last-Admin Lockout:** Mitigated by pre-mutation SQL count verification (`active_admins >= 2`).
- **Concurrent Invitation Redemption:** Mitigated by atomic `BEGIN IMMEDIATE` transactions checking `redeemed_at IS NULL`.
- **Secret & Token Leakage:** Mitigated by safe DTO projections, verifier-only DB storage, and automated canary secret scanning.
- **Timing Attacks on Login/Redeem:** Mitigated by constant-time Scrypt dummy calculations on non-existent users/tokens.

### 2. Explicit Stop Conditions
Execution must immediately halt and notify the Technical Head if:
- Any proposed test or route allows a Member to view or revoke an API key belonging to another user.
- Any API key or password verifier hash appears in an HTTP response, error body, or log sink.
- An invitation token can be redeemed more than once or after expiry.
- Deactivating an admin succeeds when only one active admin exists.
- Migration 003 pre-flight on the disposable database copy fails or modifies baseline row counts.
- Any session cookie is accepted by `POST /mcp` or any API key is accepted by `/api/v1/browser/*`.

---

## J. Acceptance Recommendation

Based on empirical test verification (427 tests passing), a clean git tree at commit `a38331a`, and complete reconciliation of all G4 requirements against the G1 design freeze:

**Recommendation:** `READY FOR TECHNICAL HEAD REVIEW`

*(The implementation HOLD remains active. Zero application code or cluster resources will be modified until explicit written authorization for Gate P5-G4 implementation is issued by the Technical Head).*
