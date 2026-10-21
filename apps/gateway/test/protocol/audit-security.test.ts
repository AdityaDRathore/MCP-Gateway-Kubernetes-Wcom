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
import { AuditRepository } from '../../src/db/audit-repo.js';
import { parseConfig } from '../../src/config.js';
import { logger } from '../../src/logging/logger.js';

describe('Audit Security, Role Enforcement & Canary Redaction Protocol Tests (P5-G5)', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let apiKeyRepo: ApiKeyRepository;
  let apiKeyService: ApiKeyService;
  let passwordService: ScryptPasswordService;
  let sessionService: SessionService;
  let auditRepo: AuditRepository;

  let browserServer: http.Server;
  let mcpServer: http.Server;
  let browserUrl: string;
  let mcpUrl: string;

  const allowedOrigin = 'http://localhost:3001';

  let adminSession: { rawToken: string; csrfToken: string; userId: string };
  let memberSession: { rawToken: string; csrfToken: string; userId: string };
  let adminApiKey: { rawKey: string; id: string };

  const adminUserId = '33333333-3333-4333-8333-333333333333';
  const memberUserId = '44444444-4444-4444-8444-444444444444';

  const canarySecretToken = 'CANARY_SEC_AUDIT_SUPERSECRET_999';

  before(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    userRepo = new UserRepository(db);
    sessionRepo = new SessionRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    apiKeyService = new ApiKeyService(apiKeyRepo);
    passwordService = new ScryptPasswordService();
    sessionService = new SessionService(sessionRepo, userRepo);
    auditRepo = new AuditRepository(db);

    // Seed Admin & Member
    userRepo.insertUser({ id: adminUserId, username: 'audit_sec_admin', role: 'admin', is_active: 1 });
    userRepo.insertUser({ id: memberUserId, username: 'audit_sec_member', role: 'member', is_active: 1 });

    const ak = apiKeyService.generateApiKey({ userId: adminUserId, name: 'Admin MCP Key' });
    adminApiKey = { rawKey: ak.rawKey, id: ak.apiKey.id };

    const sAdmin = await sessionService.createSession(adminUserId);
    adminSession = { rawToken: sAdmin.rawToken, csrfToken: sAdmin.csrfToken, userId: adminUserId };

    const sMember = await sessionService.createSession(memberUserId);
    memberSession = { rawToken: sMember.rawToken, csrfToken: sMember.csrfToken, userId: memberUserId };

    // Seed an audit row containing canary secret in error_message
    auditRepo.insertAuditStart({
      id: 'aud-canary-001',
      user_id: adminUserId,
      upstream_slug: 'woocommerce',
      tool_name: 'woocommerce_list_products',
      arguments_hash: 'canary-hash-xyz',
      created_at: 1729500000,
    });
    auditRepo.updateAuditFinalize('aud-canary-001', {
      status: 'failed',
      duration_ms: 65,
      error_code: 'UPSTREAM_SECRET_ERROR',
      error_message: `Upstream rejected secret token: urumi_live_${canarySecretToken} during execution`,
    });

    // Seed truthful pending & unconfirmed rows
    auditRepo.insertAuditStart({
      id: 'aud-pending-001',
      user_id: memberUserId,
      upstream_slug: 'crm',
      tool_name: 'crm_update_customer',
      arguments_hash: 'pending-hash-123',
      created_at: 1729500010,
    });

    auditRepo.insertAuditStart({
      id: 'aud-unconfirmed-001',
      user_id: memberUserId,
      upstream_slug: 'tasks',
      tool_name: 'tasks_create_task',
      arguments_hash: 'unconfirmed-hash-456',
      created_at: 1729500020,
    });
    auditRepo.updateAuditFinalize('aud-unconfirmed-001', {
      status: 'unconfirmed_outcome',
      duration_ms: 10050,
      error_code: 'FINALIZATION_TIMEOUT',
      error_message: 'Audit finalization timed out waiting for downstream acknowledgment',
    });

    const config = parseConfig({
      PORT: 3000,
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DB_PATH: ':memory:',
      ALLOWED_ORIGINS: allowedOrigin,
      TRUSTED_PROXIES: '127.0.0.1,::1',
      COOKIE_SECURE: false,
    });

    const browserApp = createBrowserApp({
      config,
      sessionService,
      userRepo,
      passwordService,
      auditRepo,
    });

    await new Promise<void>((resolve) => {
      browserServer = browserApp.listen(0, '127.0.0.1', () => {
        const bAddr = browserServer.address() as any;
        browserUrl = `http://127.0.0.1:${bAddr.port}/api/v1/browser`;
        resolve();
      });
    });

    const authenticator = new DatabaseAuthenticator(apiKeyService);
    const mcpApp = createExpressApp({
      config,
      authenticator,
    });

    await new Promise<void>((resolve) => {
      mcpServer = mcpApp.listen(0, '127.0.0.1', () => {
        const mAddr = mcpServer.address() as any;
        mcpUrl = `http://127.0.0.1:${mAddr.port}/mcp`;
        resolve();
      });
    });
  });

  after(() => {
    browserServer?.close();
    mcpServer?.close();
    db?.close();
  });

  it('AUD-SEC-01: anonymous request to /audit returns HTTP 401 Unauthorized', async () => {
    const res = await fetch(`${browserUrl}/audit`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'SESSION_MISSING');
  });

  it('AUD-SEC-02: authenticated Member request to /audit returns HTTP 403 Forbidden with zero data leak', async () => {
    const res = await fetch(`${browserUrl}/audit`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cookie': `${SESSION_COOKIE_NAME}=${memberSession.rawToken}`,
      },
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'FORBIDDEN');
    // Ensure no audit records or metadata leaked
    assert.equal(body.audits, undefined);
    assert.equal(body.total, undefined);
    assert.equal(body.count, undefined);
  });

  it('AUD-SEC-03: authenticated Admin request to /audit succeeds with HTTP 200 and safe schema', async () => {
    const res = await fetch(`${browserUrl}/audit?limit=10`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cookie': `${SESSION_COOKIE_NAME}=${adminSession.rawToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.limit, 10);
    assert.equal(body.offset, 0);
    assert.ok(Array.isArray(body.audits));
    assert.ok(body.audits.length >= 3);

    for (const item of body.audits) {
      assert.ok(typeof item.id === 'string');
      assert.ok(typeof item.toolName === 'string');
      assert.ok(typeof item.status === 'string');
      assert.ok(typeof item.createdAt === 'number');
      // Verify arguments_hash is completely excluded
      assert.equal(item.arguments_hash, undefined);
    }
  });

  it('AUD-SEC-04: downstream MCP Bearer API key presented to browser /audit is rejected with HTTP 401', async () => {
    const res = await fetch(`${browserUrl}/audit`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${adminApiKey.rawKey}`,
      },
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'SESSION_MISSING');
  });

  it('AUD-SEC-05: browser session cookie presented to core /mcp endpoint is rejected with HTTP 401', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `${SESSION_COOKIE_NAME}=${adminSession.rawToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      }),
    });

    assert.equal(res.status, 401);
  });

  it('AUD-SEC-06: canary secret token is never leaked in response body, headers, or server logs', async () => {
    // Intercept log output during request
    const capturedLogs: string[] = [];
    const origInfo = logger.info;
    const origError = logger.error;
    logger.info = (msg: string, meta?: any) => {
      capturedLogs.push(`${msg} ${JSON.stringify(meta || {})}`);
      origInfo.call(logger, msg, meta);
    };
    logger.error = (msg: string, meta?: any) => {
      capturedLogs.push(`${msg} ${JSON.stringify(meta || {})}`);
      origError.call(logger, msg, meta);
    };

    try {
      const res = await fetch(`${browserUrl}/audit`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Cookie': `${SESSION_COOKIE_NAME}=${adminSession.rawToken}`,
        },
      });

      assert.equal(res.status, 200);
      const rawText = await res.text();
      const allHeaders = JSON.stringify(Object.fromEntries(res.headers.entries()));

      // 1. Assert response body has zero canary token
      assert.ok(
        !rawText.includes(canarySecretToken),
        `Canary token leaked in audit API response body!`
      );

      // 2. Assert response headers have zero canary token
      assert.ok(
        !allHeaders.includes(canarySecretToken),
        `Canary token leaked in audit API response headers!`
      );

      // 3. Assert server logs have zero canary token
      const allLogsText = capturedLogs.join('\n');
      assert.ok(
        !allLogsText.includes(canarySecretToken),
        `Canary token leaked in server logs during audit query!`
      );
    } finally {
      logger.info = origInfo;
      logger.error = origError;
    }
  });

  it('AUD-SEC-07: truthfully reports pending and unconfirmed_outcome states without fabricated times', async () => {
    const res = await fetch(`${browserUrl}/audit`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cookie': `${SESSION_COOKIE_NAME}=${adminSession.rawToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();

    const pendingItem = body.audits.find((a: any) => a.id === 'aud-pending-001');
    assert.ok(pendingItem);
    assert.equal(pendingItem.status, 'pending');
    assert.equal(pendingItem.durationMs, null); // Truthful: not yet completed

    const unconfirmedItem = body.audits.find((a: any) => a.id === 'aud-unconfirmed-001');
    assert.ok(unconfirmedItem);
    assert.equal(unconfirmedItem.status, 'unconfirmed_outcome');
    assert.equal(unconfirmedItem.errorCode, 'FINALIZATION_TIMEOUT');
    assert.equal(unconfirmedItem.durationMs, 10050);
  });
});
