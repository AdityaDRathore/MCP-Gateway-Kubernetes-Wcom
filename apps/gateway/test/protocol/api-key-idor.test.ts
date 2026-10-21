import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { createBrowserApp, createExpressApp } from '../../src/server.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { ApiKeyRepository } from '../../src/db/api-key-repo.js';
import { ApiKeyService } from '../../src/auth/api-key-service.js';
import { DatabaseAuthenticator } from '../../src/auth/database-authenticator.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { SessionService, SESSION_COOKIE_NAME } from '../../src/auth/session-service.js';
import { InvitationRepository } from '../../src/db/invitation-repo.js';
import { InvitationService } from '../../src/auth/invitation-service.js';
import { parseConfig } from '../../src/config.js';

describe('API Key Self-Service, IDOR Defense, and Deactivated MCP Fail-Closed Protocol Tests (P5-G4)', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let apiKeyRepo: ApiKeyRepository;
  let apiKeyService: ApiKeyService;
  let passwordService: ScryptPasswordService;
  let sessionService: SessionService;
  let invitationRepo: InvitationRepository;
  let invitationService: InvitationService;

  let browserServer: http.Server;
  let mcpServer: http.Server;
  let browserUrl: string;
  let mcpUrl: string;
  const allowedOrigin = 'http://localhost:3001';

  let adminSession: { rawToken: string; csrfToken: string; userId: string };
  let member1Session: { rawToken: string; csrfToken: string; userId: string };
  let member2Session: { rawToken: string; csrfToken: string; userId: string };

  let adminKey: { rawKey: string; id: string };
  let member1Key: { rawKey: string; id: string };
  let member2Key: { rawKey: string; id: string };

  before(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    userRepo = new UserRepository(db);
    sessionRepo = new SessionRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    apiKeyService = new ApiKeyService(apiKeyRepo);
    passwordService = new ScryptPasswordService();
    sessionService = new SessionService(sessionRepo, userRepo);
    invitationRepo = new InvitationRepository(db);
    invitationService = new InvitationService(
      invitationRepo,
      userRepo,
      sessionService,
      passwordService,
      db
    );

    // Seed Admin, Member 1, Member 2
    userRepo.insertUser({ id: 'usr-admin', username: 'admin_alice', role: 'admin', is_active: 1 });
    userRepo.insertUser({ id: 'usr-member-1', username: 'member_bob', role: 'member', is_active: 1 });
    userRepo.insertUser({ id: 'usr-member-2', username: 'member_charlie', role: 'member', is_active: 1 });

    // Seed API Keys
    const ak = apiKeyService.generateApiKey({ userId: 'usr-admin', name: 'Alice Admin Key' });
    adminKey = { rawKey: ak.rawKey, id: ak.apiKey.id };

    const mk1 = apiKeyService.generateApiKey({ userId: 'usr-member-1', name: 'Bob Key' });
    member1Key = { rawKey: mk1.rawKey, id: mk1.apiKey.id };

    const mk2 = apiKeyService.generateApiKey({ userId: 'usr-member-2', name: 'Charlie Key' });
    member2Key = { rawKey: mk2.rawKey, id: mk2.apiKey.id };

    // Seed Sessions
    const sAdmin = await sessionService.createSession('usr-admin');
    adminSession = { rawToken: sAdmin.rawToken, csrfToken: sAdmin.csrfToken, userId: 'usr-admin' };

    const sM1 = await sessionService.createSession('usr-member-1');
    member1Session = { rawToken: sM1.rawToken, csrfToken: sM1.csrfToken, userId: 'usr-member-1' };

    const sM2 = await sessionService.createSession('usr-member-2');
    member2Session = { rawToken: sM2.rawToken, csrfToken: sM2.csrfToken, userId: 'usr-member-2' };

    const config = parseConfig({
      NODE_ENV: 'test',
      ALLOWED_ORIGINS: allowedOrigin,
      COOKIE_SECURE: 'false',
    });

    const browserApp = createBrowserApp({
      config,
      sessionService,
      userRepo,
      passwordService,
      invitationService,
      invitationRepo,
      apiKeyService,
      apiKeyRepo,
    });

    browserServer = browserApp.listen(0);
    const bAddr = browserServer.address() as any;
    browserUrl = `http://127.0.0.1:${bAddr.port}/api/v1/browser`;

    // Instantiate MCP listener with DatabaseAuthenticator
    const authenticator = new DatabaseAuthenticator(apiKeyService);
    const mcpApp = createExpressApp({
      config,
      authenticator,
    });

    mcpServer = mcpApp.listen(0);
    const mAddr = mcpServer.address() as any;
    mcpUrl = `http://127.0.0.1:${mAddr.port}/mcp`;
  });

  after(() => {
    browserServer?.close();
    mcpServer?.close();
  });

  it('GET /keys allows admin to list all keys across all users without exposing key hashes', async () => {
    const res = await fetch(`${browserUrl}/keys`, {
      method: 'GET',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${adminSession.rawToken}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.keys));
    assert.ok(body.keys.length >= 3);

    // Verify DTO structure and that key_hash is NEVER exposed
    for (const key of body.keys) {
      assert.strictEqual(typeof key.id, 'string');
      assert.strictEqual(typeof key.userId, 'string');
      assert.strictEqual(typeof key.username, 'string');
      assert.strictEqual(typeof key.keyPrefix, 'string');
      assert.strictEqual(key.key_hash, undefined, 'key_hash must never be exposed');
      assert.strictEqual(key.rawKey, undefined, 'rawKey must never be in list response');
    }
  });

  it('GET /keys enforces strict IDOR protection for members: ignores requested userId query parameter', async () => {
    // Member 1 calls /keys?userId=usr-member-2 attempting to view Member 2's keys
    const res = await fetch(`${browserUrl}/keys?userId=${member2Session.userId}`, {
      method: 'GET',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${member1Session.rawToken}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.keys));

    // Every returned key MUST belong to member 1 only
    for (const key of body.keys) {
      assert.strictEqual(key.userId, member1Session.userId, 'Member must never see keys belonging to other users');
    }
    assert.ok(body.keys.some((k: any) => k.id === member1Key.id));
    assert.ok(!body.keys.some((k: any) => k.id === member2Key.id));
  });

  it('POST /keys enforces member IDOR defense: members cannot create keys for another user', async () => {
    // Member 1 attempts to create a key for Member 2
    const res = await fetch(`${browserUrl}/keys`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${member1Session.rawToken}`,
        'X-Urumi-CSRF': member1Session.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Malicious Injected Key',
        userId: member2Session.userId, // Attempting IDOR
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.apiKey);
    assert.ok(body.rawKey);
    assert.match(body.rawKey, /^urumi_live_[a-f0-9]{64}$/);

    // The key MUST be assigned to Member 1, NOT Member 2!
    assert.strictEqual(body.apiKey.userId, member1Session.userId, 'Server must enforce member ownership');
    assert.strictEqual(body.apiKey.username, 'member_bob');
  });

  it('POST /keys allows admins to provision keys for other active users', async () => {
    const res = await fetch(`${browserUrl}/keys`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${adminSession.rawToken}`,
        'X-Urumi-CSRF': adminSession.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Admin Provisioned for Charlie',
        userId: member2Session.userId,
        expiresInDays: 30,
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.apiKey.userId, member2Session.userId);
    assert.strictEqual(body.apiKey.username, 'member_charlie');
    assert.ok(body.apiKey.expiresAt !== null);
  });

  it('POST /keys/:id/revoke enforces ownership: members cannot revoke other users keys (403 Forbidden)', async () => {
    // Member 1 attempts to revoke Member 2's key
    const res = await fetch(`${browserUrl}/keys/${member2Key.id}/revoke`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${member1Session.rawToken}`,
        'X-Urumi-CSRF': member1Session.csrfToken,
      },
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'FORBIDDEN');

    // Key must remain unrevoked
    const key = apiKeyRepo.findApiKeyById(member2Key.id);
    assert.strictEqual(key?.revoked_at, null);
  });

  it('POST /keys/:id/revoke allows members to revoke their own keys', async () => {
    const res = await fetch(`${browserUrl}/keys/${member1Key.id}/revoke`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${member1Session.rawToken}`,
        'X-Urumi-CSRF': member1Session.csrfToken,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);

    // Verify key revoked in database
    const key = apiKeyRepo.findApiKeyById(member1Key.id);
    assert.ok(key?.revoked_at !== null);
  });

  it('MCP authentication contract: active key works on /mcp', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminKey.rawKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        id: 1,
      }),
    });

    // Valid authenticated key is accepted (200 OK from MCP Streamable HTTP)
    assert.strictEqual(res.status, 200);
  });

  it('MCP authentication contract: deactivated user fails closed with 401 even if key is not revoked (Condition 3)', async () => {
    // Create an active key for Member 2
    const freshKey = apiKeyService.generateApiKey({
      userId: member2Session.userId,
      name: 'Member 2 Unrevoked Key',
    });
    assert.strictEqual(freshKey.apiKey.revoked_at, null);

    // Now deactivate Member 2 directly in userRepo (simulating failure of revocation step or DB desync)
    userRepo.updateActiveStatus(member2Session.userId, 0);

    // Attempt to authenticate at /mcp with Member 2's unrevoked key
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${freshKey.rawKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        id: 2,
      }),
    });

    // MUST FAIL CLOSED WITH 401 UNAUTHORIZED!
    assert.strictEqual(res.status, 401, 'Deactivated user must fail closed at /mcp immediately');

    // Reactivate Member 2 and verify key works again
    userRepo.updateActiveStatus(member2Session.userId, 1);
    const resReactivated = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${freshKey.rawKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
        id: 3,
      }),
    });
    assert.strictEqual(resReactivated.status, 200, 'Reactivated user key works again');
  });
});
