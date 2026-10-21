
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseManager } from '../../src/db/connection.js';
import { ApiKeyRepository } from '../../src/db/api-key-repo.js';
import { ApiKeyService } from '../../src/auth/api-key-service.js';
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService } from '../../src/audit/audit-service.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { InvitationRepository } from '../../src/db/invitation-repo.js';
import { UpstreamRepository } from '../../src/db/upstream-repo.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { SessionService } from '../../src/auth/session-service.js';
import { InvitationService } from '../../src/auth/invitation-service.js';
import {
  backupDatabase,
  restoreDatabase,
  assertSafeDatabasePath,
  RestoreError,
  BackupError,
} from '../../src/db/backup.js';

describe('Gate P5-G6 Stage 3: Local Integration & Concurrency Stress Test Suite', () => {
  // Path safety invariant assertion helper
  function assertSandboxPath(p: string): void {
    assert.notStrictEqual(p, '/data/gateway.db');
    assert.ok(!p.startsWith('/data/'), `Sandbox path must not target /data/: ${p}`);
  }

  it('STAGE 3 - SCENARIO 1: Concurrent audit writes and bounded paginated reads (20 workers, 100 operations)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-stage3-audit-stress-'));
    const dbPath = path.join(tmpDir, 'gateway.db');
    assertSandboxPath(dbPath);

    try {
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager.initialize();
      const db = dbManager.getDb();
      const auditRepo = new AuditRepository(db);
      const auditService = new AuditService(auditRepo);
      const userRepo = new UserRepository(db);

      // Seed test callers
      const callerAdmin = userRepo.insertUser({
        id: 'usr-stress-admin',
        username: 'stress_admin',
        role: 'admin',
        is_active: 1,
      });
      const callerMember = userRepo.insertUser({
        id: 'usr-stress-member',
        username: 'stress_member',
        role: 'member',
        is_active: 1,
      });

      const NUM_WRITES = 80;
      const NUM_READS = 40;
      const startTime = Date.now();

      // Launch concurrent write operations
      const writePromises = Array.from({ length: NUM_WRITES }, async (_, i) => {
        const userId = i % 2 === 0 ? callerAdmin.id : callerMember.id;
        const upstreamSlug = i % 3 === 0 ? 'woocommerce' : i % 3 === 1 ? 'crm' : 'tasks';
        const toolName = `${upstreamSlug}_tool_${i % 5}`;
        const canSecret = `canary-secret-token-${i}`;

        const auditId = auditService.startAudit({
          userId,
          upstreamSlug,
          toolName,
          arguments: { item: i, canary: canSecret },
        });

        // Yield slightly to interleave execution
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)));

        const status = i % 10 === 0 ? 'failed' : i % 15 === 0 ? 'timeout' : 'success';
        auditService.finalizeAudit(auditId, {
          status,
          startTimeMs: Date.now() - (10 + (i % 20)),
          errorCode: status === 'failed' ? 'UPSTREAM_ERROR' : undefined,
          errorMessage: status === 'failed' ? `Error with canary ${canSecret}` : undefined,
        });

        return auditId;
      });

      // Launch concurrent paginated reads concurrently with writes
      const readPromises = Array.from({ length: NUM_READS }, async (_, i) => {
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8)));
        const limit = 10 + (i % 15);
        const offset = (i % 4) * 5;
        const statusFilter = i % 3 === 0 ? 'failed' : i % 3 === 1 ? 'success' : undefined;

        const results = auditRepo.listAudits({
          limit,
          offset,
          status: statusFilter,
        });

        assert.ok(Array.isArray(results));
        assert.ok(results.length <= limit);

        // Invariant: error_message in audit repo should exist, but status must be consistent
        for (const row of results) {
          assert.ok(row.id);
          assert.ok(['success', 'failed', 'timeout', 'pending'].includes(row.status));
          if (statusFilter) {
            assert.strictEqual(row.status, statusFilter);
          }
        }
        return results.length;
      });

      const [auditIds, readCounts] = await Promise.all([
        Promise.all(writePromises),
        Promise.all(readPromises),
      ]);

      const durationMs = Date.now() - startTime;
      assert.strictEqual(auditIds.length, NUM_WRITES);
      assert.strictEqual(readCounts.length, NUM_READS);

      // Verify final database state
      const finalCountRow = db.prepare('SELECT count(*) as count FROM audit_logs;').get() as any;
      assert.strictEqual(finalCountRow.count, NUM_WRITES, 'Total audit rows must match total completed writes');

      // Verify PRAGMA integrity
      const integrity = db.prepare('PRAGMA integrity_check;').get() as any;
      assert.strictEqual(integrity?.integrity_check, 'ok');

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('STAGE 3 - SCENARIO 2: Concurrent single-use invitation redemption race (15 workers, exactly 1 winner)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-stage3-invitation-race-'));
    const dbPath = path.join(tmpDir, 'gateway.db');
    assertSandboxPath(dbPath);

    try {
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager.initialize();
      const db = dbManager.getDb();

      const userRepo = new UserRepository(db);
      const passwordService = new ScryptPasswordService();
      const sessionRepo = new SessionRepository(db);
      const sessionService = new SessionService(sessionRepo, userRepo);
      const invitationRepo = new InvitationRepository(db);
      const invitationService = new InvitationService(invitationRepo, userRepo, sessionService, passwordService, db);

      // Create an admin user who issues an invitation
      const admin = userRepo.insertUser({
        id: 'usr-inviter-admin',
        username: 'inviter_admin',
        role: 'admin',
        is_active: 1,
      });

      // Issue single-use member invitation
      const invitation = invitationService.createInvitation({
        role: 'member',
        invitedBy: admin.id,
      });

      const NUM_CONCURRENT_ATTEMPTS = 15;
      const results: { success: boolean; username: string; error?: string }[] = [];

      // Launch 15 concurrent redemption attempts simultaneously
      const attempts = Array.from({ length: NUM_CONCURRENT_ATTEMPTS }, async (_, i) => {
        const candidateUsername = `race_user_${i}`;
        try {
          const res = await invitationService.redeemInvitation({
            token: invitation.rawToken,
            username: candidateUsername,
            password: `RacePassword123!_${i}`,
          });
          results.push({ success: true, username: res.user.username });
        } catch (err: unknown) {
          results.push({
            success: false,
            username: candidateUsername,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      await Promise.all(attempts);

      // INVARIANT 1: Exactly ONE redemption succeeds
      const successes = results.filter((r) => r.success);
      assert.strictEqual(successes.length, 1, `Expected exactly 1 success, got ${successes.length}`);

      // INVARIANT 2: Exactly 14 redemptions fail closed with INVITATION_ALREADY_REDEEMED
      const failures = results.filter((r) => !r.success);
      assert.strictEqual(failures.length, NUM_CONCURRENT_ATTEMPTS - 1);
      for (const f of failures) {
        assert.match(
          f.error ?? '',
          /invalid, expired, or already redeemed|INVITATION_ALREADY_REDEEMED|Invitation has already been redeemed/i,
          `Expected already-redeemed failure, got: ${f.error}`
        );
      }

      // INVARIANT 3: Exactly 2 users exist in the database (admin + winning user)
      const allUsers = db.prepare('SELECT username FROM users ORDER BY username;').all() as any[];
      assert.strictEqual(allUsers.length, 2);
      assert.ok(allUsers.some((u) => u.username === successes[0].username));

      // INVARIANT 4: Exactly 1 session created for the winning user
      const allSessions = db.prepare('SELECT user_id FROM browser_sessions;').all() as any[];
      assert.strictEqual(allSessions.length, 1);

      // INVARIANT 5: Invitation record has redeemed_at set and cannot be reused
      const invRecord = invitationRepo.findInvitationById(invitation.id);
      assert.ok(invRecord);
      assert.notStrictEqual(invRecord.redeemed_at, null);

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('STAGE 3 - SCENARIO 3: Concurrent session validation and instant deactivation fail-closed contract', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-stage3-session-stress-'));
    const dbPath = path.join(tmpDir, 'gateway.db');
    assertSandboxPath(dbPath);

    try {
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager.initialize();
      const db = dbManager.getDb();

      const userRepo = new UserRepository(db);
      const sessionRepo = new SessionRepository(db);
      const sessionService = new SessionService(sessionRepo, userRepo);

      // Seed active user and session
      const user = userRepo.insertUser({
        id: 'usr-deact-test',
        username: 'deact_user',
        role: 'member',
        is_active: 1,
      });

      const session = await sessionService.createSession(user.id, {
        ipAddress: '127.0.0.1',
        userAgent: 'Stress-Agent',
      });

      // 1. Concurrent validations before deactivation -> All must succeed
      const preValidations = await Promise.all(
        Array.from({ length: 20 }, () => sessionService.validateSession(session.rawToken))
      );
      for (const v of preValidations) {
        assert.ok(v);
        assert.strictEqual(v.user.id, user.id);
      }

      // 2. Concurrently execute deactivation while 20 validation calls are in-flight
      const deactPromise = Promise.resolve().then(() => {
        userRepo.updateActiveStatus(user.id, 0);
      });

      const inFlightValidations = Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          await new Promise((r) => setTimeout(r, i % 2));
          return sessionService.validateSession(session.rawToken);
        })
      );

      const [, inFlightResults] = await Promise.all([deactPromise, inFlightValidations]);

      // 3. Post-deactivation validations -> Must ALL return null (zero session resuscitation)
      const postValidations = await Promise.all(
        Array.from({ length: 20 }, () => sessionService.validateSession(session.rawToken))
      );

      for (const post of postValidations) {
        assert.strictEqual(post, null, 'Session for deactivated user must return null');
      }

      // Verify user table state
      const dbUser = userRepo.findUserById(user.id);
      assert.ok(dbUser);
      assert.strictEqual(dbUser.is_active, 0, 'User is_active must be 0');

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('STAGE 3 - SCENARIO 4: Concurrent API-key verification and immediate revocation fail-closed contract', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-stage3-apikey-stress-'));
    const dbPath = path.join(tmpDir, 'gateway.db');
    assertSandboxPath(dbPath);

    try {
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager.initialize();
      const db = dbManager.getDb();

      const userRepo = new UserRepository(db);
      const apiKeyRepo = new ApiKeyRepository(db);
      const apiKeyService = new ApiKeyService(apiKeyRepo);

      const user = userRepo.insertUser({
        id: 'usr-key-stress',
        username: 'key_stress_user',
        role: 'member',
        is_active: 1,
      });

      const { rawKey, apiKey } = apiKeyService.generateApiKey({
        userId: user.id,
        name: 'Stress Test Key',
      });

      // 1. Pre-revocation validations -> All must succeed
      const preChecks = await Promise.all(
        Array.from({ length: 20 }, () => apiKeyService.verifyKey(rawKey))
      );
      for (const p of preChecks) {
        assert.ok(p);
        assert.strictEqual(p.username, 'key_stress_user');
      }

      // 2. Revoke key
      const revoked = apiKeyRepo.revokeApiKey(apiKey.id);
      assert.strictEqual(revoked, true);

      // 3. Post-revocation concurrent verifications -> Must ALL return null
      const postChecks = await Promise.all(
        Array.from({ length: 25 }, () => apiKeyService.verifyKey(rawKey))
      );
      for (const p of postChecks) {
        assert.strictEqual(p, null, 'Revoked API key must fail verification on every concurrent call');
      }

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('STAGE 3 - SCENARIO 5: Online VACUUM INTO backup during high-throughput concurrent writes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-stage3-backup-load-'));
    const dbPath = path.join(tmpDir, 'gateway.db');
    const backupDir = path.join(tmpDir, 'backups');
    assertSandboxPath(dbPath);

    try {
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager.initialize();
      const db = dbManager.getDb();

      const auditRepo = new AuditRepository(db);
      const auditService = new AuditService(auditRepo);
      const userRepo = new UserRepository(db);
      userRepo.insertUser({ id: 'usr-load', username: 'load_user', role: 'admin', is_active: 1 });

      let stopWrites = false;
      let writeCount = 0;

      // Background writer simulating continuous insert activity in SQLite WAL
      const writerPromise = (async () => {
        while (!stopWrites && writeCount < 100) {
          writeCount++;
          const id = auditService.startAudit({
            userId: 'usr-load',
            upstreamSlug: 'woocommerce',
            toolName: 'woocommerce_list_products',
            arguments: { count: writeCount },
          });
          auditService.finalizeAudit(id, { status: 'success', startTimeMs: Date.now() - 5 });
          await new Promise((r) => setTimeout(r, 2));
        }
      })();

      // Wait for writes to be actively underway
      await new Promise((r) => setTimeout(r, 30));

      // Execute VACUUM INTO online backup while writes are actively occurring
      const backupResult = backupDatabase(db, backupDir, 3);
      assert.ok(fs.existsSync(backupResult.backupPath));
      assert.ok(fs.existsSync(backupResult.manifestPath));

      // Stop writes
      stopWrites = true;
      await writerPromise;

      // Verify backup snapshot integrity and foreign keys
      assert.strictEqual(backupResult.manifest.integrityCheck, 'ok');
      assert.strictEqual(backupResult.manifest.foreignKeyCheck, 'ok');
      assert.ok(backupResult.manifest.rowCounts.audit_logs > 0);

      // Verify that the backup file is completely self-contained
      const testDb = new DatabaseManager({ dbPath: backupResult.backupPath, autoMigrate: false });
      testDb.initialize();
      const integrity = testDb.getDb().prepare('PRAGMA integrity_check;').get() as any;
      assert.strictEqual(integrity?.integrity_check, 'ok');
      testDb.close();

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('STAGE 3 - SCENARIO 6: Restore safety enforcement when target database connection is active', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-stage3-active-lock-'));
    const targetDbPath = path.join(tmpDir, 'active-target.db');
    const backupDir = path.join(tmpDir, 'backups');
    assertSandboxPath(targetDbPath);

    try {
      // 1. Create auxiliary valid backup
      const auxDbPath = path.join(tmpDir, 'aux.db');
      const auxManager = new DatabaseManager({ dbPath: auxDbPath, autoMigrate: true });
      auxManager.initialize();
      const userRepo = new UserRepository(auxManager.getDb());
      userRepo.insertUser({ id: 'usr-aux', username: 'aux_user', role: 'admin', is_active: 1 });
      const backupResult = backupDatabase(auxManager.getDb(), backupDir);
      auxManager.close();

      // 2. Open target database with an active connection holding an exclusive transaction
      const targetManager = new DatabaseManager({ dbPath: targetDbPath, autoMigrate: true });
      targetManager.initialize();
      const targetDb = targetManager.getDb();
      targetDb.exec('BEGIN EXCLUSIVE;');

      // 3. Attempt restoreDatabase against the active database: must fail closed without damaging file
      assert.throws(
        () => {
          restoreDatabase({
            snapshotPath: backupResult.backupPath,
            targetDbPath,
          });
        },
        (err: unknown) => {
          return (
            err instanceof RestoreError &&
            /cannot restore while target database has an active connection or lock/i.test(err.message)
          );
        }
      );

      // 4. Invariant: Target database active connection remains healthy and can complete its transaction
      targetDb.exec('ROLLBACK;');
      targetManager.close();

      // 5. After closing active connection, restoreDatabase now succeeds cleanly
      const successRestore = restoreDatabase({
        snapshotPath: backupResult.backupPath,
        targetDbPath,
      });
      assert.strictEqual(successRestore.targetDbPath, path.resolve(targetDbPath));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('STAGE 3 - SCENARIO 7: Repeated backup, corruption, and restore cycles (5 full consecutive recovery cycles)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-stage3-cycles-'));
    const liveDbPath = path.join(tmpDir, 'live-gateway.db');
    const backupDir = path.join(tmpDir, 'backups');
    assertSandboxPath(liveDbPath);

    try {
      let dbManager = new DatabaseManager({ dbPath: liveDbPath, autoMigrate: true });
      dbManager.initialize();
      let db = dbManager.getDb();

      const passwordService = new ScryptPasswordService();

      for (let cycle = 1; cycle <= 5; cycle++) {
        // A. Mutate data in current cycle
        const userRepo = new UserRepository(db);
        const cycleUser = userRepo.insertUser({
          id: `usr-cycle-${cycle}`,
          username: `user_cycle_${cycle}`,
          role: cycle === 1 ? 'admin' : 'member',
          is_active: 1,
        });

        const pwHash = await passwordService.hashPassword(`PasswordCycle${cycle}!`);
        userRepo.setUserCredentials(cycleUser.id, pwHash);

        const auditRepo = new AuditRepository(db);
        const auditService = new AuditService(auditRepo);
        const audId = auditService.startAudit({
          userId: cycleUser.id,
          upstreamSlug: 'crm',
          toolName: `crm_tool_cycle_${cycle}`,
          arguments: { cycle },
        });
        auditService.finalizeAudit(audId, { status: 'success', startTimeMs: Date.now() - 20 });

        // B. Online WAL backup
        const backupResult = backupDatabase(db, backupDir, 5);
        assert.ok(fs.existsSync(backupResult.backupPath));
        assert.ok(fs.existsSync(backupResult.manifestPath));

        const expectedRows = backupResult.manifest.rowCounts;
        assert.strictEqual(expectedRows.users, cycle);
        assert.strictEqual(expectedRows.user_credentials, cycle);
        assert.strictEqual(expectedRows.audit_logs, cycle);

        // C. Close active connection before simulating disaster
        dbManager.close();

        // D. Simulate disaster corruption on primary
        fs.writeFileSync(liveDbPath, Buffer.from(`CORRUPTED_PRIMARY_BYTES_CYCLE_${cycle}`));
        fs.writeFileSync(`${liveDbPath}-wal`, Buffer.from(`STALE_WAL_CYCLE_${cycle}`));
        fs.writeFileSync(`${liveDbPath}-shm`, Buffer.from(`STALE_SHM_CYCLE_${cycle}`));

        // E. Restore from verified snapshot
        const restoreRes = restoreDatabase({
          snapshotPath: backupResult.backupPath,
          targetDbPath: liveDbPath,
        });

        assert.deepStrictEqual(restoreRes.restoredRowCounts, expectedRows);

        // F. Reopen restored database and execute post-restore functional checks
        dbManager = new DatabaseManager({ dbPath: liveDbPath, autoMigrate: false });
        dbManager.initialize();
        db = dbManager.getDb();

        // Check 1: SQLite integrity check
        const integrity = db.prepare('PRAGMA integrity_check;').get() as any;
        assert.strictEqual(integrity?.integrity_check, 'ok', `Integrity check failed on cycle ${cycle}`);

        // Check 2: Foreign key check
        const fks = db.prepare('PRAGMA foreign_key_check;').all();
        assert.deepStrictEqual(fks, [], `Foreign key violations on cycle ${cycle}`);

        // Check 3: Functional password verification for cycle user
        const rUserRepo = new UserRepository(db);
        const rCreds = rUserRepo.getUserCredentials(cycleUser.id);
        assert.ok(rCreds);
        const valid = await passwordService.verifyPassword(`PasswordCycle${cycle}!`, rCreds.password_hash);
        assert.strictEqual(valid, true, `Password check failed on cycle ${cycle}`);

        // Check 4: Audit count check
        const rAuditRepo = new AuditRepository(db);
        const list = rAuditRepo.listAudits({ limit: 50 });
        assert.strictEqual(list.length, cycle, `Audit count mismatch on cycle ${cycle}`);
      }

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('STAGE 3 - SCENARIO 8: Upstream configuration reads under concurrent status updates', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-stage3-upstream-stress-'));
    const dbPath = path.join(tmpDir, 'gateway.db');
    assertSandboxPath(dbPath);

    try {
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager.initialize();
      const db = dbManager.getDb();
      const upstreamRepo = new UpstreamRepository(db);

      // Seed 3 default upstreams
      upstreamRepo.seedDefaults();

      const NUM_OPERATIONS = 30;

      // Concurrently read all upstreams and toggle status
      const operations = Array.from({ length: NUM_OPERATIONS }, async (_, i) => {
        if (i % 3 === 0) {
          // Writer: toggle enabled state
          const targetSlug = i % 2 === 0 ? 'crm' : 'tasks';
          const isEnabled = i % 4 === 0 ? 0 : 1;
          upstreamRepo.updateUpstream(targetSlug, { isEnabled });
          return { type: 'write', success: true };
        } else {
          // Reader: fetch enabled upstreams
          const enabled = upstreamRepo.getEnabledUpstreams();
          assert.ok(Array.isArray(enabled));
          // Always between 1 and 3 upstreams enabled (woocommerce is never toggled off)
          assert.ok(enabled.length >= 1 && enabled.length <= 3);
          return { type: 'read', count: enabled.length };
        }
      });

      const results = await Promise.all(operations);
      assert.strictEqual(results.length, NUM_OPERATIONS);

      // Invariant: Database integrity preserved
      const integrity = db.prepare('PRAGMA integrity_check;').get() as any;
      assert.strictEqual(integrity?.integrity_check, 'ok');

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
