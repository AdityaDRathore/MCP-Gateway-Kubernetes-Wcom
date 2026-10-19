import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { parseConfig } from '../../src/config.js';
import { createExpressApp, createBrowserApp } from '../../src/server.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { SessionService, SESSION_COOKIE_NAME } from '../../src/auth/session-service.js';
import { parseCookies } from '../../src/http/browser-middleware.js';

describe('Dual-Listener Security Perimeter Protocol Tests (DEC-02 / DEC-04)', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let passwordService: ScryptPasswordService;
  let sessionService: SessionService;

  let mcpServer: http.Server;
  let browserServer: http.Server;
  let mcpPort: number;
  let browserPort: number;

  const allowedOrigin = 'http://dashboard.127.0.0.1.nip.io:8080';

  before(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    userRepo = new UserRepository(db);
    sessionRepo = new SessionRepository(db);
    passwordService = new ScryptPasswordService();
    sessionService = new SessionService(sessionRepo, userRepo);

    // Seed test users: admin (active), member (active), deactivated_user
    const adminPasswordHash = await passwordService.hashPassword('AdminPassword123!');
    userRepo.insertUser({
      id: 'usr-admin-1',
      username: 'admin',
      role: 'admin',
      is_active: 1,
    });
    userRepo.setUserCredentials('usr-admin-1', adminPasswordHash);

    const memberPasswordHash = await passwordService.hashPassword('MemberPassword123!');
    userRepo.insertUser({
      id: 'usr-member-1',
      username: 'member',
      role: 'member',
      is_active: 1,
    });
    userRepo.setUserCredentials('usr-member-1', memberPasswordHash);

    const deactPasswordHash = await passwordService.hashPassword('DeactPassword123!');
    userRepo.insertUser({
      id: 'usr-deact-1',
      username: 'deactivated',
      role: 'member',
      is_active: 0,
    });
    userRepo.setUserCredentials('usr-deact-1', deactPasswordHash);

    const config = parseConfig({
      PORT: '3000',
      BROWSER_PORT: '3001',
      ALLOWED_ORIGINS: allowedOrigin,
      COOKIE_SECURE: 'false',
      DASHBOARD_STATIC_PATH: path.resolve(process.cwd(), '../dashboard/dist'),
      TRUSTED_PROXIES: '127.0.0.1,::1',
    });

    const mcpApp = createExpressApp({ config });
    const browserApp = createBrowserApp({
      config,
      sessionService,
      userRepo,
      passwordService,
    });

    mcpServer = http.createServer(mcpApp);
    browserServer = http.createServer(browserApp);

    await new Promise<void>((resolve) => mcpServer.listen(0, '127.0.0.1', () => resolve()));
    await new Promise<void>((resolve) => browserServer.listen(0, '127.0.0.1', () => resolve()));

    mcpPort = (mcpServer.address() as any).port;
    browserPort = (browserServer.address() as any).port;
  });

  after(async () => {
    await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
    await new Promise<void>((resolve) => browserServer.close(() => resolve()));
    db.close();
  });

  it('rejects login on Port 3001 when Origin is missing on state-changing request (fail closed)', async () => {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: 'admin', password: 'AdminPassword123!' }),
    });

    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'CSRF_ORIGIN_MISSING');
  });

  it('rejects login on Port 3001 when Origin is unauthorized', async () => {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://malicious.example.com',
      },
      body: JSON.stringify({ username: 'admin', password: 'AdminPassword123!' }),
    });

    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'CSRF_ORIGIN_FORBIDDEN');
  });

  it('rejects login on Port 3001 with generic error for invalid credentials', async () => {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: allowedOrigin,
      },
      body: JSON.stringify({ username: 'admin', password: 'WrongPassword' }),
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.deepStrictEqual(data, {
      error: 'Invalid username or password',
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('rejects login on Port 3001 with identical generic error for deactivated accounts (zero user enumeration)', async () => {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: allowedOrigin,
      },
      body: JSON.stringify({ username: 'deactivated', password: 'DeactPassword123!' }),
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.deepStrictEqual(data, {
      error: 'Invalid username or password',
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('completes full browser session lifecycle (login -> get session -> logout)', async () => {
    // 1. Login
    const loginRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: allowedOrigin,
      },
      body: JSON.stringify({ username: 'admin', password: 'AdminPassword123!' }),
    });

    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.user.username, 'admin');
    assert.strictEqual(loginData.user.role, 'admin');
    assert.strictEqual(typeof loginData.csrfToken, 'string');
    assert.strictEqual(loginData.csrfToken.length, 64);

    const setCookie = loginRes.headers.get('set-cookie');
    assert.notStrictEqual(setCookie, null);
    const cookies = parseCookies(setCookie!);
    const rawSessionToken = cookies[SESSION_COOKIE_NAME];
    assert.strictEqual(typeof rawSessionToken, 'string');
    assert.strictEqual(rawSessionToken.length, 64);

    // 2. Get active session
    const getRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'GET',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${rawSessionToken}`,
      },
    });

    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.user.username, 'admin');
    assert.strictEqual(getData.csrfToken, loginData.csrfToken);

    // 3. Attempt logout without CSRF token -> Rejected 403
    const badLogoutRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'DELETE',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${rawSessionToken}`,
        origin: allowedOrigin,
      },
    });
    assert.strictEqual(badLogoutRes.status, 403);
    const badLogoutData = await badLogoutRes.json();
    assert.strictEqual(badLogoutData.code, 'CSRF_TOKEN_INVALID');

    // 4. Logout with valid CSRF token -> 200 and cleared cookie
    const logoutRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'DELETE',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${rawSessionToken}`,
        origin: allowedOrigin,
        'x-urumi-csrf': loginData.csrfToken,
      },
    });

    assert.strictEqual(logoutRes.status, 200);
    const logoutData = await logoutRes.json();
    assert.strictEqual(logoutData.success, true);

    const clearCookie = logoutRes.headers.get('set-cookie');
    assert(clearCookie?.includes('Max-Age=0'));

    // 5. Subsequent request with invalidated session -> 401
    const postLogoutRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'GET',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${rawSessionToken}`,
      },
    });
    assert.strictEqual(postLogoutRes.status, 401);
  });

  it('cross-perimeter isolation: cookie on Port 3000 /mcp is rejected with 401 (requires Bearer token)', async () => {
    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'urumi_session=some_session_token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert(data.error.includes('Missing Authorization header'));
  });

  it('cross-perimeter isolation: Bearer token on Port 3001 is rejected with 401 (requires session cookie)', async () => {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'GET',
      headers: {
        authorization: 'Bearer urumi_live_testkey1234567890abcdef',
      },
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.code, 'SESSION_MISSING');
  });

  it('cross-perimeter isolation: Port 3001 returns 404 for unmounted private /admin/v1 routes', async () => {
    const res = await fetch(`http://127.0.0.1:${browserPort}/admin/v1/upstreams`, {
      method: 'GET',
    });

    assert.strictEqual(res.status, 404);
  });

  it('cross-perimeter isolation: Port 3001 returns 404 for unmounted downstream /mcp route', async () => {
    const res = await fetch(`http://127.0.0.1:${browserPort}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    assert.strictEqual(res.status, 404);
  });

  it('serves SPA dashboard index.html on Port 3001 root / and client routes', async () => {
    const res = await fetch(`http://127.0.0.1:${browserPort}/`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type') || '';
    assert(contentType.includes('text/html'));
    const html = await res.text();
    assert(html.includes('Urumi Team MCP Gateway'));
  });
});
