import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { InvitationRepository } from '../../src/db/invitation-repo.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { SessionService } from '../../src/auth/session-service.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { InvitationService, InvitationError } from '../../src/auth/invitation-service.js';

describe('Invitation Lifecycle and Concurrency Unit Tests (P5-G4)', () => {
  let db: DatabaseSync;
  let invitationRepo: InvitationRepository;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let sessionService: SessionService;
  let passwordService: ScryptPasswordService;
  let invitationService: InvitationService;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);
    invitationRepo = new InvitationRepository(db);
    userRepo = new UserRepository(db);
    userRepo.insertUser({
      id: 'admin-1',
      username: 'admin',
      role: 'admin',
      is_active: 1,
    });
    sessionRepo = new SessionRepository(db);
    passwordService = new ScryptPasswordService();
    sessionService = new SessionService(sessionRepo, userRepo);
    invitationService = new InvitationService(
      invitationRepo,
      userRepo,
      sessionService,
      passwordService,
      db
    );
  });

  it('creates an invitation with 32 bytes entropy, prefix urumi_inv_, and 72-hour expiry', () => {
    const inv = invitationService.createInvitation({ role: 'member', invitedBy: 'admin-1' });

    assert.strictEqual(typeof inv.rawToken, 'string');
    assert.match(inv.rawToken, /^urumi_inv_[a-f0-9]{64}$/);
    assert.strictEqual(inv.role, 'member');
    assert.strictEqual(inv.inviteUrl, `/invite/${inv.rawToken}`);

    const now = Math.floor(Date.now() / 1000);
    // Expires in approximately 72 hours (259200 seconds)
    assert.ok(inv.expiresAt >= now + 259100 && inv.expiresAt <= now + 259300);

    // Verify database record: rawToken must NEVER be in database; only SHA-256 verifier hash
    const record = invitationRepo.findInvitationById(inv.id);
    assert.ok(record);
    assert.strictEqual(record.role, 'member');
    assert.strictEqual(record.invited_by, 'admin-1');
    assert.strictEqual(record.redeemed_at, null);
    assert.strictEqual(record.redeemed_by_user_id, null);
    assert.notStrictEqual(record.token_hash, inv.rawToken);
    assert.strictEqual(record.token_hash, invitationService.hashToken(inv.rawToken));
  });

  it('validates invitation tokens correctly without consuming them', () => {
    const inv = invitationService.createInvitation({ role: 'admin' });

    // Valid check
    const valGood = invitationService.validateInvitation(inv.rawToken);
    assert.strictEqual(valGood.valid, true);
    assert.strictEqual(valGood.role, 'admin');

    // Malformed check
    const valBadFormat = invitationService.validateInvitation('invalid_token');
    assert.strictEqual(valBadFormat.valid, false);
    assert.strictEqual(valBadFormat.code, 'INVITATION_INVALID');

    // Unknown hash check
    const valUnknown = invitationService.validateInvitation(`urumi_inv_${'a'.repeat(64)}`);
    assert.strictEqual(valUnknown.valid, false);
    assert.strictEqual(valUnknown.code, 'INVITATION_INVALID');
  });

  it('successfully redeems an invitation, creates user, credentials, and session atomically', async () => {
    const inv = invitationService.createInvitation({ role: 'member' });

    const result = await invitationService.redeemInvitation({
      token: inv.rawToken,
      username: 'carol_engineer',
      password: 'StrongPassword123!',
      meta: { ipAddress: '192.168.1.100', userAgent: 'Mozilla/5.0 Test' },
    });

    assert.ok(result.user);
    assert.strictEqual(result.user.username, 'carol_engineer');
    assert.strictEqual(result.user.role, 'member');
    assert.strictEqual(result.user.is_active, 1);

    assert.ok(result.session);
    assert.strictEqual(result.session.session.user_id, result.user.id);
    assert.strictEqual(typeof result.session.rawToken, 'string');
    assert.strictEqual(typeof result.session.csrfToken, 'string');

    // Verify user credentials in database
    const creds = userRepo.getUserCredentials(result.user.id);
    assert.ok(creds);
    assert.ok(creds.password_hash.startsWith('$scrypt$'));
    const isPwValid = await passwordService.verifyPassword('StrongPassword123!', creds.password_hash);
    assert.strictEqual(isPwValid, true);

    // Verify invitation marked as redeemed
    const updatedInv = invitationRepo.findInvitationById(inv.id);
    assert.ok(updatedInv);
    assert.strictEqual(updatedInv.redeemed_by_user_id, result.user.id);
    assert.ok(updatedInv.redeemed_at !== null);

    // Token validation now fails because already redeemed
    const reval = invitationService.validateInvitation(inv.rawToken);
    assert.strictEqual(reval.valid, false);
    assert.strictEqual(reval.code, 'INVITATION_INVALID');
  });

  it('enforces single-use under concurrent redemption requests (Condition 2 race safety)', async () => {
    const inv = invitationService.createInvitation({ role: 'member' });

    // Dispatch two concurrent redemption attempts for the same token with different usernames
    const p1 = invitationService.redeemInvitation({
      token: inv.rawToken,
      username: 'concurrent_user_1',
      password: 'SecurePassword123!',
    });
    const p2 = invitationService.redeemInvitation({
      token: inv.rawToken,
      username: 'concurrent_user_2',
      password: 'SecurePassword123!',
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed, and exactly one must fail
    assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent redemption must succeed');
    assert.strictEqual(rejected.length, 1, 'Exactly one concurrent redemption must be rejected');

    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(rejectionReason instanceof InvitationError);
    assert.strictEqual(rejectionReason.code, 'INVITATION_INVALID');

    // Invitation must be redeemed by the successful user only
    const updatedInv = invitationRepo.findInvitationById(inv.id);
    assert.ok(updatedInv?.redeemed_at !== null);

    // Exactly two users must exist in users table (admin-1 + the newly registered user)
    const users = userRepo.listUsers();
    assert.strictEqual(users.length, 2);
  });

  it('rejects replay attempts on an already redeemed token', async () => {
    const inv = invitationService.createInvitation({ role: 'member' });

    await invitationService.redeemInvitation({
      token: inv.rawToken,
      username: 'original_user',
      password: 'SecurePassword123!',
    });

    // Replay attempt
    await assert.rejects(
      async () => {
        await invitationService.redeemInvitation({
          token: inv.rawToken,
          username: 'replayer_user',
          password: 'AnotherPassword123!',
        });
      },
      (err: unknown) => {
        return err instanceof InvitationError && err.code === 'INVITATION_INVALID' && err.statusCode === 400;
      }
    );
  });

  it('rejects expired invitation tokens', async () => {
    const inv = invitationService.createInvitation({ role: 'member' });

    // Manually force expiry in past in SQLite
    const pastTime = Math.floor(Date.now() / 1000) - 100;
    db.prepare('UPDATE user_invitations SET expires_at = ? WHERE id = ?;').run(pastTime, inv.id);

    // Pre-validation rejects
    const val = invitationService.validateInvitation(inv.rawToken);
    assert.strictEqual(val.valid, false);
    assert.strictEqual(val.code, 'INVITATION_EXPIRED');

    // Redemption attempt rejects
    await assert.rejects(
      async () => {
        await invitationService.redeemInvitation({
          token: inv.rawToken,
          username: 'late_user',
          password: 'SecurePassword123!',
        });
      },
      (err: unknown) => {
        return err instanceof InvitationError && err.code === 'INVITATION_EXPIRED' && err.statusCode === 400;
      }
    );
  });

  it('rejects redemption if requested username already exists, leaving invitation unredeemed', async () => {
    // Seed existing user
    userRepo.insertUser({
      id: 'usr-existing',
      username: 'existing_admin',
      role: 'admin',
      is_active: 1,
    });

    const inv = invitationService.createInvitation({ role: 'member' });

    await assert.rejects(
      async () => {
        await invitationService.redeemInvitation({
          token: inv.rawToken,
          username: 'existing_admin',
          password: 'NewUserPassword123!',
        });
      },
      (err: unknown) => {
        return err instanceof InvitationError && err.code === 'USERNAME_EXISTS' && err.statusCode === 409;
      }
    );

    // Invitation remains valid and unredeemed!
    const invCheck = invitationRepo.findInvitationById(inv.id);
    assert.ok(invCheck);
    assert.strictEqual(invCheck.redeemed_at, null);
  });

  it('rolls back atomic transaction completely on injected failure', async () => {
    const inv = invitationService.createInvitation({ role: 'member' });

    // Inject a failure into markRedeemed by temporarily breaking the statement
    const origMarkRedeemed = invitationRepo.markRedeemed.bind(invitationRepo);
    invitationRepo.markRedeemed = () => {
      throw new Error('Simulated SQLite disk write failure during redemption');
    };

    await assert.rejects(
      async () => {
        await invitationService.redeemInvitation({
          token: inv.rawToken,
          username: 'unlucky_user',
          password: 'Password12345!',
        });
      },
      (err: unknown) => {
        return err instanceof Error && err.message.includes('Simulated SQLite disk write failure');
      }
    );

    invitationRepo.markRedeemed = origMarkRedeemed;

    // Verify rollback: user record was NOT created, invitation remains unredeemed
    const user = userRepo.findUserByUsername('unlucky_user');
    assert.strictEqual(user, null, 'User creation must be rolled back');

    const invRecord = invitationRepo.findInvitationById(inv.id);
    assert.strictEqual(invRecord?.redeemed_at, null, 'Invitation must remain unredeemed');
  });

  it('rolls back completely if session creation fails, leaving user uncreated and invitation unredeemed (Condition 1)', async () => {
    const inv = invitationService.createInvitation({ role: 'member' });

    // Inject a failure into session creation (synchronous session creation failure)
    const origCreateSessionSync = sessionService.createSessionSync.bind(sessionService);
    sessionService.createSessionSync = () => {
      throw new Error('Simulated session insert failure: SQLite table lock / disk full');
    };

    await assert.rejects(
      async () => {
        await invitationService.redeemInvitation({
          token: inv.rawToken,
          username: 'session_fail_user',
          password: 'Password12345!',
        });
      },
      (err: unknown) => {
        return err instanceof Error && err.message.includes('Simulated session insert failure');
      }
    );

    // Restore original session creation method
    sessionService.createSessionSync = origCreateSessionSync;

    // 1. Verify user record was NOT created in users table
    const user = userRepo.findUserByUsername('session_fail_user');
    assert.strictEqual(user, null, 'User creation must be rolled back');

    // 2. Verify credentials were NOT created
    const credCount = db.prepare('SELECT count(*) as count FROM user_credentials WHERE password_hash LIKE ?;').get('%') as any;
    assert.strictEqual(credCount.count, 0, 'Credentials must not be persisted');

    // 3. Verify session was NOT created
    const sessionCount = db.prepare('SELECT count(*) as count FROM browser_sessions;').get() as any;
    assert.strictEqual(sessionCount.count, 0, 'Session must not be persisted');

    // 4. Verify invitation remains UNREDEEMED and valid
    const invRecord = invitationRepo.findInvitationById(inv.id);
    assert.ok(invRecord);
    assert.strictEqual(invRecord.redeemed_at, null, 'Invitation must remain unredeemed');
    assert.strictEqual(invRecord.redeemed_by_user_id, null);

    // 5. Subsequent redemption of the SAME invitation token now succeeds cleanly
    const retryResult = await invitationService.redeemInvitation({
      token: inv.rawToken,
      username: 'session_fail_user',
      password: 'Password12345!',
    });
    assert.ok(retryResult.user);
    assert.strictEqual(retryResult.user.username, 'session_fail_user');
    assert.ok(retryResult.session);
    assert.ok(retryResult.session.rawToken);
  });

  it('canary secret test: database never stores raw invitation tokens or plaintext passwords', async () => {
    const canaryTokenPrefix = 'urumi_inv_';
    const canaryPlaintextPassword = 'TopSecretCanaryPassword999!';

    const inv = invitationService.createInvitation({ role: 'member' });
    await invitationService.redeemInvitation({
      token: inv.rawToken,
      username: 'canary_user',
      password: canaryPlaintextPassword,
    });

    // Inspect all rows in SQLite database tables
    const invitations = db.prepare('SELECT * FROM user_invitations;').all() as any[];
    for (const row of invitations) {
      assert.strictEqual(row.token_hash.startsWith(canaryTokenPrefix), false);
      assert.notStrictEqual(row.token_hash, inv.rawToken);
    }

    const credentials = db.prepare('SELECT * FROM user_credentials;').all() as any[];
    for (const row of credentials) {
      assert.strictEqual(row.password_hash.includes(canaryPlaintextPassword), false);
    }
  });
});
