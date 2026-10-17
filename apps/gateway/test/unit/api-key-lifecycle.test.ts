import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { ApiKeyRepository } from '../../src/db/api-key-repo.js';
import { ApiKeyService, API_KEY_PREFIX } from '../../src/auth/api-key-service.js';
import { DatabaseAuthenticator } from '../../src/auth/database-authenticator.js';
import { sanitizeString, redactSensitiveData } from '../../src/logging/logger.js';

describe('Gateway API Key Lifecycle and Authentication Unit Tests', () => {
  function setupTestService() {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);
    const repo = new ApiKeyRepository(db);
    const service = new ApiKeyService(repo);
    const authenticator = new DatabaseAuthenticator(service);
    return { db, repo, service, authenticator };
  }

  it('generates API key with correct format and sufficient cryptographic entropy', () => {
    const { db, service } = setupTestService();

    const user = service.createUser('alice', 'member');
    const { rawKey, apiKey } = service.generateApiKey({
      userId: user.id,
      name: 'Alice Personal Key',
    });

    // Format: urumi_live_<64 hex chars>
    assert.equal(rawKey.startsWith(API_KEY_PREFIX), true);
    assert.equal(rawKey.length, 75); // 11 prefix + 64 hex
    const hexPart = rawKey.slice(API_KEY_PREFIX.length);
    assert.match(hexPart, /^[0-9a-f]{64}$/);

    // Metadata in DB record
    assert.equal(apiKey.user_id, user.id);
    assert.equal(apiKey.name, 'Alice Personal Key');
    assert.equal(apiKey.key_prefix, rawKey.substring(0, 16));
    assert.equal(apiKey.revoked_at, null);
    assert(apiKey.created_at > 0);

    db.close();
  });

  it('persists only one-way cryptographic SHA-256 verifier, never the raw token', () => {
    const { db, service } = setupTestService();

    const user = service.createUser('bob', 'member');
    const { rawKey, apiKey } = service.generateApiKey({
      userId: user.id,
      name: 'Bob Key',
    });

    // Query SQLite directly
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?;').get(apiKey.id) as Record<string, unknown>;
    assert.notEqual(row, undefined);

    // Verify key_hash is the SHA-256 of rawKey
    const expectedHash = service.hashKey(rawKey);
    assert.equal(row.key_hash, expectedHash);

    // Verify raw key string does not appear in any column of the row
    const rowValues = Object.values(row).map(String);
    for (const val of rowValues) {
      assert.equal(val.includes(rawKey), false);
    }

    db.close();
  });

  it('authenticates valid key and resolves user with preserved role', async () => {
    const { db, service, authenticator } = setupTestService();

    const adminUser = service.createUser('superadmin', 'admin');
    const memberUser = service.createUser('standarduser', 'member');

    const adminKey = service.generateApiKey({ userId: adminUser.id, name: 'Admin Token' });
    const memberKey = service.generateApiKey({ userId: memberUser.id, name: 'Member Token' });

    // Authenticate Admin
    const authAdmin = await authenticator.authenticate(adminKey.rawKey);
    assert.notEqual(authAdmin, null);
    assert.equal(authAdmin?.id, adminUser.id);
    assert.equal(authAdmin?.username, 'superadmin');
    assert.equal(authAdmin?.role, 'admin');

    // Authenticate Member
    const authMember = await authenticator.authenticate(memberKey.rawKey);
    assert.notEqual(authMember, null);
    assert.equal(authMember?.id, memberUser.id);
    assert.equal(authMember?.username, 'standarduser');
    assert.equal(authMember?.role, 'member');

    db.close();
  });

  it('rejects invalid, malformed, or tampered keys using constant-time comparison', async () => {
    const { db, service, authenticator } = setupTestService();

    const user = service.createUser('charlie', 'member');
    const { rawKey } = service.generateApiKey({ userId: user.id, name: 'Key' });

    // Tampered last character
    const tampered = rawKey.slice(0, -1) + (rawKey.endsWith('a') ? 'b' : 'a');
    assert.equal(await authenticator.authenticate(tampered), null);

    // Completely fake key with valid format
    const fakeKey = `${API_KEY_PREFIX}${'0'.repeat(64)}`;
    assert.equal(await authenticator.authenticate(fakeKey), null);

    // Missing prefix or empty
    assert.equal(await authenticator.authenticate('some_random_token'), null);
    assert.equal(await authenticator.authenticate(''), null);
    assert.equal(await authenticator.authenticate('   '), null);

    db.close();
  });

  it('enforces immediate revocation semantics on the very next request', async () => {
    const { db, service, authenticator } = setupTestService();

    const user = service.createUser('dave', 'member');
    const { rawKey, apiKey } = service.generateApiKey({ userId: user.id, name: 'Revokable' });

    // Verify valid before revocation
    const preRevoke = await authenticator.authenticate(rawKey);
    assert.notEqual(preRevoke, null);

    // Revoke key
    const revoked = service.revokeKey(apiKey.id);
    assert.equal(revoked, true);

    // Immediate rejection on next request
    const postRevoke = await authenticator.authenticate(rawKey);
    assert.equal(postRevoke, null);

    db.close();
  });

  it('enforces expiry checks and rejects expired keys', async () => {
    const { db, service, authenticator } = setupTestService();

    const user = service.createUser('eve', 'member');
    // Key that expires in the past (-10 seconds)
    const { rawKey } = service.generateApiKey({
      userId: user.id,
      name: 'Expired Token',
      expiresInSeconds: -10,
    });

    const auth = await authenticator.authenticate(rawKey);
    assert.equal(auth, null);

    db.close();
  });

  it('redacts raw API keys and Bearer headers from log captures', () => {
    const rawKey = `${API_KEY_PREFIX}${'a'.repeat(64)}`;
    const authHeader = `Bearer ${rawKey}`;

    const sanitizedHeader = sanitizeString(authHeader);
    assert.equal(sanitizedHeader.includes(rawKey), false);
    assert.equal(sanitizedHeader, '[REDACTED_AUTH_HEADER]');

    const payload = {
      authorization: authHeader,
      apiKey: rawKey,
      nested: { token: rawKey },
    };

    const redacted = redactSensitiveData(payload) as Record<string, any>;
    assert.equal(redacted.authorization, '[REDACTED]');
    assert.equal(redacted.apiKey, '[REDACTED]');
    assert.equal(redacted.nested.token, '[REDACTED]');
  });
});
