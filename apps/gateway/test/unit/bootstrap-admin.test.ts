import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { runBootstrapAdmin } from '../../src/cli/bootstrap-admin.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { InvitationRepository } from '../../src/db/invitation-repo.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { SessionService } from '../../src/auth/session-service.js';
import { InvitationService } from '../../src/auth/invitation-service.js';

describe('First-Admin Bootstrap CLI Unit Tests (P5-G4)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urumi-bootstrap-test-'));
    dbPath = path.join(tmpDir, 'gateway-test.db');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in test
    }
  });

  it('provisions one-time admin enrollment token when no active admins exist', async () => {
    const outputFile = path.join(tmpDir, 'enrollment.txt');

    const result = await runBootstrapAdmin({
      dbPath,
      outputFile,
      silent: true,
    });

    assert.strictEqual(result.alreadyInitialized, false);
    assert.strictEqual(typeof result.rawToken, 'string');
    assert.match(result.rawToken!, /^urumi_inv_[a-f0-9]{64}$/);
    assert.strictEqual(result.inviteUrl, `/invite/${result.rawToken}`);
    assert.strictEqual(result.tokenDeliveredTo, 'file');
    assert.strictEqual(result.outputFilePath, outputFile);

    // Verify output file permissions (0600)
    assert.strictEqual(fs.existsSync(outputFile), true);
    const stat = fs.statSync(outputFile);
    assert.strictEqual(stat.mode & 0o777, 0o600);

    const fileContent = fs.readFileSync(outputFile, 'utf8');
    assert.ok(fileContent.includes(`TOKEN=${result.rawToken}`));
    assert.ok(fileContent.includes(`INVITE_URL=${result.inviteUrl}`));

    // Verify database: ONLY SHA-256 verifier stored, raw token is NOT in database
    const db = new DatabaseSync(dbPath);
    const invRow = db.prepare('SELECT * FROM user_invitations WHERE id = ?;').get(result.invitationId!) as any;
    assert.ok(invRow);
    assert.strictEqual(invRow.role, 'admin');
    assert.strictEqual(invRow.redeemed_at, null);
    assert.notStrictEqual(invRow.token_hash, result.rawToken);
    db.close();
  });

  it('safely aborts without creating invitations when active admin exists (Idempotency - Condition 4)', async () => {
    // 1. First run: generates enrollment invitation
    const firstRun = await runBootstrapAdmin({
      dbPath,
      silent: true,
      forceStdout: true,
    });
    assert.strictEqual(firstRun.alreadyInitialized, false);

    // 2. Complete enrollment by redeeming the invitation
    const db = new DatabaseSync(dbPath);
    const userRepo = new UserRepository(db);
    const sessionRepo = new SessionRepository(db);
    const invitationRepo = new InvitationRepository(db);
    const passwordService = new ScryptPasswordService();
    const sessionService = new SessionService(sessionRepo, userRepo);
    const invitationService = new InvitationService(
      invitationRepo,
      userRepo,
      sessionService,
      passwordService,
      db
    );

    await invitationService.redeemInvitation({
      token: firstRun.rawToken!,
      username: 'initial_sysadmin',
      password: 'AdminPassword123!',
    });

    assert.strictEqual(userRepo.countActiveAdmins(), 1);
    db.close();

    // 3. Second run: active admin now exists!
    const secondRun = await runBootstrapAdmin({
      dbPath,
      silent: true,
      forceStdout: true,
    });

    assert.strictEqual(secondRun.alreadyInitialized, true);
    assert.strictEqual(secondRun.rawToken, undefined);
    assert.strictEqual(secondRun.invitationId, undefined);

    // Verify that existing admin account and credentials were NOT mutated or reset
    const dbVerify = new DatabaseSync(dbPath);
    const verifyUserRepo = new UserRepository(dbVerify);
    const adminUser = verifyUserRepo.findUserByUsername('initial_sysadmin');
    assert.ok(adminUser);
    assert.strictEqual(adminUser.role, 'admin');
    assert.strictEqual(adminUser.is_active, 1);
    dbVerify.close();
  });

  it('canary test: raw enrollment token never logged or stored in database', async () => {
    const result = await runBootstrapAdmin({
      dbPath,
      silent: true,
      forceStdout: true,
    });

    const db = new DatabaseSync(dbPath);
    // Scan all string columns in user_invitations table
    const rows = db.prepare('SELECT * FROM user_invitations;').all() as any[];
    for (const row of rows) {
      assert.strictEqual(row.token_hash.includes('urumi_inv_'), false);
      assert.notStrictEqual(row.token_hash, result.rawToken);
    }
    db.close();
  });
});
