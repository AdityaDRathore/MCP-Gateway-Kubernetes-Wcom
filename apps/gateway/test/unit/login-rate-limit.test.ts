import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { SessionService } from '../../src/auth/session-service.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { LoginRateLimiter } from '../../src/auth/login-rate-limiter.js';
import { createBrowserRouter } from '../../src/http/browser.js';

describe('Login Rate Limiter & Generic Failure Contract Unit Tests', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let sessionService: SessionService;
  let passwordService: ScryptPasswordService;
  let rateLimiter: LoginRateLimiter;
  let app: express.Application;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);
    userRepo = new UserRepository(db);
    sessionRepo = new SessionRepository(db);
    sessionService = new SessionService(sessionRepo, userRepo);
    passwordService = new ScryptPasswordService();
    rateLimiter = new LoginRateLimiter({ maxAttempts: 5, windowMs: 60000 });

    app = express();
    app.use(express.json());
    app.use(
      '/api/v1/browser',
      createBrowserRouter({
        sessionService,
        userRepo,
        passwordService,
        cookieSecure: false,
        rateLimiter,
        trustedProxies: ['127.0.0.1'],
      })
    );

    // Seed active admin user
    userRepo.insertUser({
      id: 'admin-1',
      username: 'admin',
      role: 'admin',
      is_active: 1,
    });
    const hash = await passwordService.hashPassword('CorrectPassword123!');
    userRepo.setUserCredentials('admin-1', hash);

    // Seed deactivated user
    userRepo.insertUser({
      id: 'deact-1',
      username: 'deactivated_user',
      role: 'member',
      is_active: 0,
    });
    const deactHash = await passwordService.hashPassword('DeactPassword123!');
    userRepo.setUserCredentials('deact-1', deactHash);

    // Seed user with no credentials
    userRepo.insertUser({
      id: 'nocreds-1',
      username: 'no_creds_user',
      role: 'member',
      is_active: 1,
    });
  });

  async function postLogin(body: { username?: string; password?: string }, ip = '192.168.1.50') {
    const server = app.listen(0);
    const port = (server.address() as any).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/browser/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip, // Sent to trusted proxy 127.0.0.1
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, headers: res.headers, data };
    } finally {
      server.close();
    }
  }

  it('enforces identical generic 401 error response across nonexistent, wrong password, no creds, and inactive accounts', async () => {
    // 1. Non-existent username
    const res1 = await postLogin({ username: 'nonexistent_user', password: 'AnyPassword123!' });
    assert.strictEqual(res1.status, 401);
    assert.deepStrictEqual(res1.data, {
      error: 'Invalid username or password',
      code: 'INVALID_CREDENTIALS',
    });

    // 2. Existing user with wrong password
    const res2 = await postLogin({ username: 'admin', password: 'WrongPassword999!' });
    assert.strictEqual(res2.status, 401);
    assert.deepStrictEqual(res2.data, {
      error: 'Invalid username or password',
      code: 'INVALID_CREDENTIALS',
    });

    // 3. Existing user with no credentials configured
    const res3 = await postLogin({ username: 'no_creds_user', password: 'AnyPassword123!' });
    assert.strictEqual(res3.status, 401);
    assert.deepStrictEqual(res3.data, {
      error: 'Invalid username or password',
      code: 'INVALID_CREDENTIALS',
    });

    // 4. Deactivated user (is_active === 0)
    const res4 = await postLogin({ username: 'deactivated_user', password: 'DeactPassword123!' });
    assert.strictEqual(res4.status, 401);
    assert.deepStrictEqual(res4.data, {
      error: 'Invalid username or password',
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('triggers HTTP 429 LOGIN_RATE_LIMITED with Retry-After after 5 failed attempts on same IP', async () => {
    const testIp = '198.51.100.12';

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await postLogin({ username: `attempt_${i}`, password: 'WrongPassword!' }, testIp);
      assert.strictEqual(res.status, 401);
    }

    // 6th attempt must be blocked by rate limiter
    const blockedRes = await postLogin({ username: 'admin', password: 'CorrectPassword123!' }, testIp);
    assert.strictEqual(blockedRes.status, 429);
    assert.strictEqual(blockedRes.data.code, 'LOGIN_RATE_LIMITED');
    assert(blockedRes.headers.get('retry-after') !== null);

    // Another IP should NOT be blocked
    const otherIpRes = await postLogin({ username: 'admin', password: 'CorrectPassword123!' }, '198.51.100.99');
    assert.strictEqual(otherIpRes.status, 200);
  });

  it('triggers HTTP 429 LOGIN_RATE_LIMITED when targeting the same username across different IPs', async () => {
    // Target user 'admin' from 5 distinct IPs
    for (let i = 0; i < 5; i++) {
      const res = await postLogin({ username: 'admin', password: 'WrongPassword!' }, `198.51.100.${i + 1}`);
      assert.strictEqual(res.status, 401);
    }

    // 6th attempt targeting 'admin' from a fresh IP must be rate limited
    const blockedRes = await postLogin({ username: 'admin', password: 'CorrectPassword123!' }, '198.51.100.99');
    assert.strictEqual(blockedRes.status, 429);
    assert.strictEqual(blockedRes.data.code, 'LOGIN_RATE_LIMITED');
  });

  it('successful login resets rate limit counter for that user and IP', async () => {
    const testIp = '198.51.100.44';

    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await postLogin({ username: 'admin', password: 'WrongPassword!' }, testIp);
    }

    // Successful attempt resets failure history
    const successRes = await postLogin({ username: 'admin', password: 'CorrectPassword123!' }, testIp);
    assert.strictEqual(successRes.status, 200);

    // Now 4 more failures should NOT trigger 429 (counter was reset)
    for (let i = 0; i < 4; i++) {
      const res = await postLogin({ username: 'admin', password: 'WrongPassword!' }, testIp);
      assert.strictEqual(res.status, 401);
    }
  });
});
