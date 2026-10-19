import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionService, SESSION_COOKIE_NAME } from '../../src/auth/session-service.js';

describe('Browser SessionService Unit Tests (DEC-02 / DEC-07)', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let sessionService: SessionService;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);
    userRepo = new UserRepository(db);
    sessionRepo = new SessionRepository(db);
    sessionService = new SessionService(sessionRepo, userRepo, {
      idleTimeoutMs: 100, // 100ms for quick test
      absoluteLifetimeMs: 5000, // 5s for quick test
    });
  });

  it('creates an authenticated session for an active user with SHA-256 verifier', async () => {
    const user = userRepo.insertUser({
      id: 'usr-1',
      username: 'alice',
      role: 'admin',
      is_active: 1,
    });

    const result = await sessionService.createSession(user.id, {
      userAgent: 'Mozilla/5.0 TestBrowser',
      ipAddress: '127.0.0.1',
    });

    assert.strictEqual(typeof result.rawToken, 'string');
    assert.strictEqual(result.rawToken.length, 64);
    assert.strictEqual(typeof result.csrfToken, 'string');
    assert.strictEqual(result.csrfToken.length, 64);
    assert.strictEqual(result.session.user_id, 'usr-1');

    // Stored token_hash must NOT be equal to rawToken (verifier only)
    assert.notStrictEqual(result.session.token_hash, result.rawToken);
    assert.strictEqual(result.session.token_hash, sessionService.hashToken(result.rawToken));
  });

  it('rejects session creation for deactivated users', async () => {
    const user = userRepo.insertUser({
      id: 'usr-deact',
      username: 'bob',
      role: 'member',
      is_active: 0,
    });

    await assert.rejects(
      async () => {
        await sessionService.createSession(user.id);
      },
      /is deactivated/
    );
  });

  it('validates active session and slides activity window', async () => {
    const user = userRepo.insertUser({
      id: 'usr-2',
      username: 'charlie',
      role: 'member',
      is_active: 1,
    });

    const { rawToken, session: originalSession } = await sessionService.createSession(user.id);

    const auth = await sessionService.validateSession(rawToken);
    assert.notStrictEqual(auth, null);
    assert.strictEqual(auth?.user.id, 'usr-2');
    assert.strictEqual(auth?.user.username, 'charlie');
    assert(auth!.session.last_activity_at >= originalSession.last_activity_at);
  });

  it('fails validation and deletes session on idle timeout', async () => {
    const user = userRepo.insertUser({
      id: 'usr-idle',
      username: 'dave',
      role: 'member',
      is_active: 1,
    });

    const { rawToken } = await sessionService.createSession(user.id);

    // Wait beyond idleTimeoutMs (100ms)
    await new Promise((r) => setTimeout(r, 150));

    const auth = await sessionService.validateSession(rawToken);
    assert.strictEqual(auth, null);

    // Verify session record was deleted from database
    const rawCheck = sessionRepo.findSessionByTokenHash(sessionService.hashToken(rawToken));
    assert.strictEqual(rawCheck, null);
  });

  it('fails validation immediately when user is deactivated', async () => {
    const user = userRepo.insertUser({
      id: 'usr-deact-mid',
      username: 'eve',
      role: 'member',
      is_active: 1,
    });

    const { rawToken } = await sessionService.createSession(user.id);

    // Validate works while active
    const auth1 = await sessionService.validateSession(rawToken);
    assert.notStrictEqual(auth1, null);

    // Deactivate user in repo
    userRepo.updateActiveStatus(user.id, 0);

    // Next validation must fail and destroy session
    const auth2 = await sessionService.validateSession(rawToken);
    assert.strictEqual(auth2, null);

    // Session deleted from store
    const rawCheck = sessionRepo.findSessionByTokenHash(sessionService.hashToken(rawToken));
    assert.strictEqual(rawCheck, null);
  });

  it('invalidates individual session on logout', async () => {
    const user = userRepo.insertUser({
      id: 'usr-logout',
      username: 'frank',
      role: 'admin',
      is_active: 1,
    });

    const { rawToken } = await sessionService.createSession(user.id);
    await sessionService.invalidateSession(rawToken);

    const auth = await sessionService.validateSession(rawToken);
    assert.strictEqual(auth, null);
  });

  it('invalidates all sessions for a specific user upon bulk revocation', async () => {
    const user = userRepo.insertUser({
      id: 'usr-multi',
      username: 'grace',
      role: 'admin',
      is_active: 1,
    });

    const s1 = await sessionService.createSession(user.id);
    const s2 = await sessionService.createSession(user.id);

    const count = await sessionService.invalidateUserSessions(user.id);
    assert.strictEqual(count, 2);

    assert.strictEqual(await sessionService.validateSession(s1.rawToken), null);
    assert.strictEqual(await sessionService.validateSession(s2.rawToken), null);
  });

  it('builds cookie headers correctly respecting secure flag decoupling', () => {
    const token = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

    // Local / plain HTTP (port 8080)
    const insecureCookie = SessionService.buildCookieHeader(token, { secure: false });
    assert(insecureCookie.includes(`${SESSION_COOKIE_NAME}=${token}`));
    assert(insecureCookie.includes('Path=/'));
    assert(insecureCookie.includes('HttpOnly'));
    assert(insecureCookie.includes('SameSite=Lax'));
    assert(!insecureCookie.includes('Secure'));

    // Production / HTTPS
    const secureCookie = SessionService.buildCookieHeader(token, { secure: true });
    assert(secureCookie.includes('Secure'));

    // Clear cookie header
    const clearInsecure = SessionService.buildClearCookieHeader({ secure: false });
    assert(clearInsecure.includes('Max-Age=0'));
    assert(!clearInsecure.includes('Secure'));

    const clearSecure = SessionService.buildClearCookieHeader({ secure: true });
    assert(clearSecure.includes('Max-Age=0'));
    assert(clearSecure.includes('Secure'));
  });
});
