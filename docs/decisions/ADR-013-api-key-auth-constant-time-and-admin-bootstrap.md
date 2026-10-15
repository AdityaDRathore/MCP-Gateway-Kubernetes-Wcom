# ADR-013: API Key Format, Verifier Storage, Constant-Time Authentication, and One-Time Administrator Bootstrap

**Status**: Accepted  
**Date**: 2026-10-15  
**Decision Makers**: Aditya Rathore (FDE Candidate), Antigravity AI  
**Related Documents**: [`ADR-003`](./ADR-003-secrets-and-access.md)  

---

## 1. Context & Problem Statement

Downstream AI clients and team members access the Team MCP Gateway via HTTP requests. To satisfy multi-user team requirements and security baselines:
1. Each team member must authenticate via a unique API key.
2. Plaintext keys must never be stored in SQLite, logged in console outputs, or returned by administration endpoints.
3. Key verification must be immune to timing attacks.
4. Revoked keys must immediately fail on the very next request.
5. The initial administrator account must be provisioned through a secure, repeatable, and idempotent bootstrap mechanism that contains zero hardcoded default credentials.

---

## 2. Decision

### 2.1 API Key Format & Entropy
- **Entropy Source**: Cryptographically secure pseudorandom number generator (`crypto.randomBytes(32)`).
- **Format**: `urumi_live_<64_hex_characters>`
  - Example: `urumi_live_7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a`
  - Total length: 75 characters.
  - Prefix `urumi_live_` enables automated secret scanning engines (e.g. GitHub Secret Scanning) to detect accidental repository leaks.

### 2.2 Verifier Storage (Zero Plaintext Persistence)
- Plaintext keys are presented to the operator/user **exactly once** upon generation.
- The gateway computes a SHA-256 verifier:
  ```typescript
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 16); // e.g. "urumi_live_7f8a"
  ```
- Stored in SQLite table `api_keys`:
  - `key_prefix`: Stored for administrative identification in listings (`urumi_live_7f8a...`).
  - `key_hash`: SHA-256 hex digest, indexed with `UNIQUE`.
  - Zero plaintext keys are ever saved to disk.

### 2.3 Constant-Time Comparison
- To prevent timing side-channel attacks during authentication, inbound token hashes are matched using Node.js built-in `crypto.timingSafeEqual`:
  ```typescript
  function verifyKeyHash(providedKey: string, storedHashHex: string): boolean {
    const computedHashHex = crypto.createHash('sha256').update(providedKey).digest('hex');
    const computedBuf = Buffer.from(computedHashHex, 'hex');
    const storedBuf = Buffer.from(storedHashHex, 'hex');
    if (computedBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(computedBuf, storedBuf);
  }
  ```

### 2.4 Immediate Revocation Semantics
- When an administrator revokes a key (`POST /admin/v1/api-keys/:id/revoke`), SQLite sets:
  ```sql
  UPDATE api_keys SET revoked_at = unixepoch() WHERE id = ? AND revoked_at IS NULL;
  ```
- The authentication middleware queries active keys directly with:
  ```sql
  SELECT u.id, u.username, u.role 
  FROM api_keys k 
  JOIN users u ON k.user_id = u.id 
  WHERE k.key_hash = ? AND k.revoked_at IS NULL AND k.expires_at > unixepoch();
  ```
- Because SQLite in WAL mode executes point lookups in <0.1ms, no in-memory cache synchronization or distributed invalidation is required. Revocation is instantaneous on the next HTTP request.

### 2.5 Role-Based Authorization Model
- **`admin` Role**:
  - Full permissions: Manage upstreams (`POST/PATCH/DELETE /admin/v1/upstreams`), manage users and API keys (`POST /admin/v1/api-keys`), view global audit logs (`GET /admin/v1/audit`), and invoke all MCP tools.
- **`member` Role**:
  - Least-privilege permissions: Authenticate to `POST /mcp` and invoke approved tools.
  - Denied access to `/admin/v1/*` routes with **HTTP 403 Forbidden**.
  - May view only their own audit records.

### 2.6 Secure One-Time Administrator Bootstrap CLI
- Provisioned via CLI command: `node dist/cli/bootstrap.js --username admin --name "System Administrator"`.
- **Idempotency Guard**:
  - At startup, the script queries `SELECT id FROM users WHERE role = 'admin' LIMIT 1;`.
  - If an admin user already exists, the script halts with:
    `"Administrator account already provisioned. Bootstrap safely aborted."` (Exit code 0).
  - If no admin exists:
    1. Generates 32-byte cryptographically secure API key.
    2. Writes admin user and key hash inside a single SQLite transaction.
    3. Outputs the plaintext key to stdout exactly once with prominent warning:
       `"CRITICAL: Store this key securely now. It cannot be recovered."`
- **Zero Auth-Bypass Flag**: No environment variable exists to bypass authentication in production or staging configurations.

---

## 3. Consequences & Verification
- **Positive**: Immune to timing attacks, leak-proof storage, immediate revocation, clean CLI bootstrap.
- **Negative**: Operators must record the generated key at creation time; lost keys require generating a new key.
- **Verification**: Verified via unit tests (`crypto.timingSafeEqual`), invalid/revoked key rejection tests, and idempotent bootstrap execution suites.
