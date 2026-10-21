# ADR-019: Browser Identity, Session Management, Scrypt KDF, and CSRF Defense

**Status**: Accepted & Empirically Verified (Phase 5 Gate P5-G6 Stage 5)  
**Date**: 2026-10-21  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-012`](./ADR-012-gateway-persistence-node-sqlite-and-wal.md), [`ADR-013`](./ADR-013-api-key-auth-constant-time-and-admin-bootstrap.md), [`ADR-020`](./ADR-020-dual-listener-and-ingress-perimeter.md), [`architecture.md`](../architecture.md)

---

## 1. Context & Problem Statement

Phase 4 of the Urumi Team Gateway established API-key authentication (`Authorization: Bearer mcp_live_...`) for automated machine-to-machine agents invoking MCP tools over HTTP. 

Phase 5 introduces the human administrative and team-member dashboard (`apps/dashboard`), requiring:
1. Human interactive login, session establishment, session validation, and logout.
2. Secure persistent storage of human passwords without storing plaintext or weak hashes.
3. Defense against Cross-Site Request Forgery (CSRF) and Cross-Site Scripting (XSS) session theft.
4. Role-based access control (RBAC) distinguishing `admin` from `member` roles for management operations (inviting members, rotating upstreams, reviewing audit trails).
5. Zero additional native C++ compilation dependencies, staying true to the Node.js 24 core runtime baseline.

---

## 2. Decision & Architecture

### 2.1 Password Hashing via Core `node:crypto` Scrypt KDF
Instead of introducing heavy external native packages like `bcrypt` or `argon2`, the Gateway standardizes on Node.js core **`crypto.scrypt`**:
- **Parameters**: `cost` $N = 16384$, `blockSize` $r = 8$, `parallelization` $p = 1$, key length = 64 bytes.
- **Salt**: 32 cryptographically random bytes generated via `crypto.randomBytes(32)` per user.
- **Storage**: Stored in `user_credentials` table:
  - `user_id`: UUID foreign key to `users(id)`.
  - `password_hash`: Hex-encoded 64-byte derived key.
  - `salt`: Hex-encoded 32-byte unique salt.
  - `algo`: Explicitly tracked as `'scrypt'`.
- **Timing Defense**: Hash verification uses `crypto.timingSafeEqual` over the derived key buffer to prevent timing side-channel attacks during authentication.

### 2.2 Opaque Browser Sessions & Cookie Lifecycle
- **Session Identifier**: 256-bit cryptographically secure token (`crypto.randomBytes(32).toString('hex')`).
- **Database Storage**: Table `browser_sessions`:
  - `id`: Opaque token primary key.
  - `user_id`: Foreign key referencing `users(id)`.
  - `expires_at`: ISO-8601 timestamp (default lifetime: 24 hours).
  - `created_at`: Creation timestamp.
- **Cookie Security Flags**:
  - `HttpOnly`: Strictly true, preventing JavaScript browser access via `document.cookie`.
  - `SameSite=Lax`: Defends against cross-origin ambient cookie submission on unauthorized cross-site requests.
  - `Path=/`: Scoped to root.
  - `Secure`: Dynamically toggled based on `NODE_ENV === 'production'` or HTTPS termination.
- **Logout / Session Termination**: `DELETE /api/v1/browser/session` explicitly deletes the session record from SQLite and sets cookie expiration to the past.

### 2.3 CSRF Protection & Request Origin Verification
Because cookies are automatically submitted by browsers, all state-mutating browser endpoints (`POST`, `PATCH`, `DELETE` under `/api/v1/browser/*`) enforce a multi-layered CSRF defense:
1. **Origin / Referer Validation**: Incoming requests are validated against the allowed dashboard origin (`DASHBOARD_ORIGIN` or `PUBLIC_ORIGIN`). Mismatched or unexpected foreign origins are immediately rejected with HTTP 403.
2. **Custom Header Check**: Requests must include custom frontend headers (such as `Content-Type: application/json` or `X-Requested-With: XMLHttpRequest`), which standard browser HTML forms or cross-origin `<img>`/`<form>` tags cannot forge without triggering a CORS preflight.
3. **No Ambient Auth on MCP Port**: The MCP protocol listener (Port 3000) does not accept or inspect browser cookies; it requires explicit `Authorization: Bearer <token>` headers, fully neutralizing CSRF on tool-execution pathways.

### 2.4 Role-Based Access Control (RBAC)
Session middleware verifies user identity and attaches user metadata:
- **`admin`**: Permitted to manage upstreams (`POST /upstreams`, `DELETE /upstreams/:id`), generate member invitations (`POST /invitations`), update member roles and active status (`PATCH /members/:id/role`), issue administrative API keys, and view full audit logs (`GET /audit`).
- **`member`**: Permitted to view active upstreams and tool catalog (`GET /upstreams`, `GET /upstreams/:id/tools`), view and issue personal API keys (`GET /keys`, `POST /keys`), and manage personal session state. Mutating upstream or member management requests return HTTP 403 Forbidden.

---

## 3. Database Schema

Tables introduced and managed via Migration 003 (`apps/gateway/src/db/migrations/003_auth_and_audit.sql`):

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  algo TEXT NOT NULL DEFAULT 'scrypt',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS browser_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_invitations (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
  invited_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(invited_by) REFERENCES users(id)
);
```

---

## 4. Consequences & Verification

- **Positive**:
  - Zero external npm packages required for cryptography or session management.
  - Complete architectural separation of machine credentials (API keys) and human credentials (passwords/sessions).
  - Explicit multi-layered CSRF defense.
- **Negative**:
  - Scaling requires SQLite access (enforced by single-replica architecture documented in ADR-012).
- **Empirical Verification**:
  - Unit and integration tests in `apps/gateway/test/integration/stage1-auth.test.ts`.
  - Phase 5 Gate P5-G6 Stage 5 acceptance suite: verified password verification, wrong password rejection, session cookie issuance, role enforcement, and member redemption (`TEST-8.1.1` to `TEST-8.2.3`).
