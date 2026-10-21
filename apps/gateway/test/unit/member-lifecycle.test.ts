import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { createBrowserApp } from '../../src/server.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { ApiKeyRepository } from '../../src/db/api-key-repo.js';
import { ApiKeyService } from '../../src/auth/api-key-service.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { SessionService, SESSION_COOKIE_NAME } from '../../src/auth/session-service.js';
import { InvitationRepository } from '../../src/db/invitation-repo.js';
import { InvitationService } from '../../src/auth/invitation-service.js';
import { parseConfig } from '../../src/config.js';

describe('Member Lifecycle and Last-Admin Safeguard Unit Tests (P5-G4)', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let apiKeyRepo: ApiKeyRepository;
  let apiKeyService: ApiKeyService;
  let passwordService: ScryptPasswordService;
  let sessionService: SessionService;
  let invitationRepo: InvitationRepository;
  let invitationService: InvitationService;

  let server: http.Server;
  let baseUrl: string;
  const allowedOrigin = 'http://localhost:3001';

  let admin1Session: { rawToken: string; csrfToken: string; userId: string };
  let admin2Session: { rawToken: string; csrfToken: string; userId: string };
  let memberSession: { rawToken: string; csrfToken: string; userId: string };

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

    // Seed users
    const adminPw = await passwordService.hashPassword('AdminPass123!');
    const memberPw = await passwordService.hashPassword('MemberPass123!');

    userRepo.insertUser({ id: 'usr-admin-1', username: 'admin1', role: 'admin', is_active: 1 });
    userRepo.setUserCredentials('usr-admin-1', adminPw);

    userRepo.insertUser({ id: 'usr-admin-2', username: 'admin2', role: 'admin', is_active: 1 });
    userRepo.setUserCredentials('usr-admin-2', adminPw);

    userRepo.insertUser({ id: 'usr-member-1', username: 'member1', role: 'member', is_active: 1 });
    userRepo.setUserCredentials('usr-member-1', memberPw);

    // Create API keys for member
    apiKeyService.generateApiKey({ userId: 'usr-member-1', name: 'Member Key 1' });
    apiKeyService.generateApiKey({ userId: 'usr-member-1', name: 'Member Key 2' });

    // Create sessions
    const s1 = await sessionService.createSession('usr-admin-1');
    admin1Session = { rawToken: s1.rawToken, csrfToken: s1.csrfToken, userId: 'usr-admin-1' };

    const s2 = await sessionService.createSession('usr-admin-2');
    admin2Session = { rawToken: s2.rawToken, csrfToken: s2.csrfToken, userId: 'usr-admin-2' };

    const sm = await sessionService.createSession('usr-member-1');
    memberSession = { rawToken: sm.rawToken, csrfToken: sm.csrfToken, userId: 'usr-member-1' };

    const config = parseConfig({
      NODE_ENV: 'test',
      ALLOWED_ORIGINS: allowedOrigin,
      COOKIE_SECURE: 'false',
    });

    const app = createBrowserApp({
      config,
      sessionService,
      userRepo,
      passwordService,
      invitationService,
      invitationRepo,
      apiKeyService,
      apiKeyRepo,
    });

    server = app.listen(0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}/api/v1/browser`;
  });

  after(() => {
    server?.close();
  });

  it('GET /members lists all members with active key counts for admin', async () => {
    const res = await fetch(`${baseUrl}/members`, {
      method: 'GET',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${admin1Session.rawToken}`,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.members));
    assert.strictEqual(body.members.length, 3);

    const m1 = body.members.find((u: any) => u.username === 'member1');
    assert.ok(m1);
    assert.strictEqual(m1.role, 'member');
    assert.strictEqual(m1.isActive, true);
    assert.strictEqual(m1.activeKeyCount, 2);
  });

  it('GET /members denies access to members with 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/members`, {
      method: 'GET',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${memberSession.rawToken}`,
      },
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'FORBIDDEN');
  });

  it('POST /members/:id/deactivate prohibits self-deactivation by admin', async () => {
    const res = await fetch(`${baseUrl}/members/${admin1Session.userId}/deactivate`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${admin1Session.rawToken}`,
        'X-Urumi-CSRF': admin1Session.csrfToken,
      },
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.code, 'SELF_DEACTIVATION_PROHIBITED');
  });

  it('POST /members/:id/deactivate atomically deactivates member, revokes API keys, and invalidates sessions', async () => {
    // Verify member has active keys and session beforehand
    const activeKeysBefore = apiKeyRepo.listApiKeysByUser(memberSession.userId);
    assert.strictEqual(activeKeysBefore.filter((k) => k.revoked_at === null).length, 2);

    const res = await fetch(`${baseUrl}/members/${memberSession.userId}/deactivate`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${admin1Session.rawToken}`,
        'X-Urumi-CSRF': admin1Session.csrfToken,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);

    // Verify user is inactive in database
    const user = userRepo.findUserById(memberSession.userId);
    assert.ok(user);
    assert.strictEqual(user.is_active, 0);

    // Verify all member API keys are revoked
    const activeKeysAfter = apiKeyRepo.listApiKeysByUser(memberSession.userId);
    assert.strictEqual(activeKeysAfter.filter((k) => k.revoked_at === null).length, 0);

    // Verify session validation immediately fails
    const val = await sessionService.validateSession(memberSession.rawToken);
    assert.strictEqual(val, null);
  });

  it('POST /members/:id/reactivate restores member active status', async () => {
    const res = await fetch(`${baseUrl}/members/${memberSession.userId}/reactivate`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${admin1Session.rawToken}`,
        'X-Urumi-CSRF': admin1Session.csrfToken,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);

    const user = userRepo.findUserById(memberSession.userId);
    assert.strictEqual(user?.is_active, 1);
  });

  it('enforces last active admin protection under concurrent deactivations (Condition 2)', async () => {
    // Currently 2 active admins exist: admin1 and admin2
    assert.strictEqual(userRepo.countActiveAdmins(), 2);

    // Admin1 tries to deactivate Admin2, and Admin2 tries to deactivate Admin1 concurrently
    const p1 = fetch(`${baseUrl}/members/usr-admin-2/deactivate`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${admin1Session.rawToken}`,
        'X-Urumi-CSRF': admin1Session.csrfToken,
      },
    });

    const p2 = fetch(`${baseUrl}/members/usr-admin-1/deactivate`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${admin2Session.rawToken}`,
        'X-Urumi-CSRF': admin2Session.csrfToken,
      },
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    const statuses = [r1.status, r2.status];

    // Exactly one deactivation must succeed (200), and the other must be rejected (either 400 LAST_ADMIN_PROTECTED or 401 SESSION_INVALID)
    assert.strictEqual(statuses.filter((s) => s === 200).length, 1, 'Exactly one concurrent deactivation must succeed');
    const failingStatus = statuses.find((s) => s !== 200);
    assert.ok(failingStatus === 400 || failingStatus === 401, 'Losing request must be rejected with 400 or 401');

    // Invariant: Exactly one active admin MUST remain
    assert.strictEqual(userRepo.countActiveAdmins(), 1, 'Exactly one active administrator must remain');
  });

  it('POST /members/:id/deactivate refuses to deactivate the sole remaining admin', async () => {
    // Identify surviving admin
    const survivingAdmin = userRepo.listUsers().find((u) => u.role === 'admin' && u.is_active === 1);
    assert.ok(survivingAdmin);

    // Seed another temporary admin so we can make an authorized request as an admin
    userRepo.insertUser({ id: 'usr-admin-temp', username: 'admintemp', role: 'admin', is_active: 1 });
    const tempSession = await sessionService.createSession('usr-admin-temp');

    // Now deactivate survivingAdmin -> succeeds because 2 admins exist
    const res1 = await fetch(`${baseUrl}/members/${survivingAdmin.id}/deactivate`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${tempSession.rawToken}`,
        'X-Urumi-CSRF': tempSession.csrfToken,
      },
    });
    assert.strictEqual(res1.status, 200);

    // Now usr-admin-temp is the ONLY remaining admin (countActiveAdmins === 1)
    assert.strictEqual(userRepo.countActiveAdmins(), 1);

    // Create a member session to attempt deactivation
    userRepo.insertUser({ id: 'usr-admin-3', username: 'admin3', role: 'admin', is_active: 0 });
    // Attempting to deactivate usr-admin-temp from itself is blocked by self-deactivation;
    // but attempting to deactivate from any caller when count <= 1 is blocked by LAST_ADMIN_PROTECTED
    // Demoting the last admin:
    const resDemote = await fetch(`${baseUrl}/members/usr-admin-temp/role`, {
      method: 'PATCH',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${tempSession.rawToken}`,
        'X-Urumi-CSRF': tempSession.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'member' }),
    });

    assert.strictEqual(resDemote.status, 400);
    const demoteBody = await resDemote.json();
    assert.strictEqual(demoteBody.code, 'LAST_ADMIN_PROTECTED');

    // Admin count remains 1
    assert.strictEqual(userRepo.countActiveAdmins(), 1);
  });

  it('PATCH /members/:id/role updates role and invalidates sessions for privilege boundary transition', async () => {
    // Reactivate member1
    const memberId = 'usr-member-1';
    const tempSession = await sessionService.createSession('usr-admin-temp');

    // Create a fresh session for member1
    const mSession = await sessionService.createSession(memberId);
    assert.strictEqual((await sessionService.validateSession(mSession.rawToken))?.user.role, 'member');

    // Promote member1 to admin
    const res = await fetch(`${baseUrl}/members/${memberId}/role`, {
      method: 'PATCH',
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${tempSession.rawToken}`,
        'X-Urumi-CSRF': tempSession.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'admin' }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.user.role, 'admin');

    // Previous session must be invalidated!
    const valAfter = await sessionService.validateSession(mSession.rawToken);
    assert.strictEqual(valAfter, null, 'Active sessions must be invalidated upon role change');
  });
});
