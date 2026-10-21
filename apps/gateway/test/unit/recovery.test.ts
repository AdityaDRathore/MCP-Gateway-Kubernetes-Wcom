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
  pruneBackups,
  restoreDatabase,
  assertSafeDatabasePath,
  RestoreError,
  BackupError,
} from '../../src/db/backup.js';

describe('Gateway Backup and Disaster Recovery Unit Tests', () => {
  it('creates an online backup via VACUUM INTO and verifies integrity', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-backup-test-'));
    const dbPath = path.join(tmpDir, 'gateway.db');
    const backupDir = path.join(tmpDir, 'backups');

    try {
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager.initialize();

      const repo = new ApiKeyRepository(dbManager.getDb());
      const keyService = new ApiKeyService(repo);
      const user = keyService.createUser('alice', 'admin');
      keyService.generateApiKey({ userId: user.id, name: 'Alice Key' });

      // Create backup
      const backupResult = backupDatabase(dbManager.getDb(), backupDir, 7);

      assert.equal(fs.existsSync(backupResult.backupPath), true);
      assert(backupResult.sizeBytes > 0);

      // Verify backup directory permissions 0700 (drwx------)
      const dirStat = fs.statSync(backupDir);
      const dirMode = (dirStat.mode & 0o777).toString(8);
      assert.equal(dirMode, '700');

      // Verify permissions 0600 (-rw-------)
      const stats = fs.statSync(backupResult.backupPath);
      const modeOctal = (stats.mode & 0o777).toString(8);
      assert.equal(modeOctal, '600');

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('safely handles backup paths containing apostrophes and special characters', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gtw-backup-o'reilly-"));
    const dbPath = path.join(tmpDir, 'gateway.db');
    const backupDir = path.join(tmpDir, "backups_o'reilly's_dir");

    try {
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager.initialize();

      const repo = new ApiKeyRepository(dbManager.getDb());
      const keyService = new ApiKeyService(repo);
      keyService.createUser('bob', 'admin');

      // Execute backup into directory with apostrophe
      const backupResult = backupDatabase(dbManager.getDb(), backupDir, 7);
      assert.equal(fs.existsSync(backupResult.backupPath), true);

      // Verify file permissions 0600 on snapshot
      const stats = fs.statSync(backupResult.backupPath);
      const modeOctal = (stats.mode & 0o777).toString(8);
      assert.equal(modeOctal, '600');

      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('prunes old backup files according to retention limit', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-prune-test-'));
    const backupDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    try {
      // Create 5 dummy backup files with different timestamps
      for (let i = 1; i <= 5; i++) {
        const filePath = path.join(backupDir, `gateway-2026-10-1${i}T10-00-00-000Z.db`);
        fs.writeFileSync(filePath, 'dummy backup data');
        // Offset mtime
        fs.utimesSync(filePath, 1000 + i * 100, 1000 + i * 100);
      }

      // Retain 3 backups
      const removed = pruneBackups(backupDir, 3);
      assert.equal(removed.length, 2);

      const remaining = fs.readdirSync(backupDir);
      assert.equal(remaining.length, 3);
      // Should retain newest ones (i = 5, 4, 3)
      assert.equal(remaining.includes('gateway-2026-10-15T10-00-00-000Z.db'), true);
      assert.equal(remaining.includes('gateway-2026-10-14T10-00-00-000Z.db'), true);
      assert.equal(remaining.includes('gateway-2026-10-13T10-00-00-000Z.db'), true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('recovers data from backup snapshot after primary database corruption and stale WAL cleanup', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-restore-test-'));
    const dbPath = path.join(tmpDir, 'gateway.db');
    const walPath = path.join(tmpDir, 'gateway.db-wal');
    const shmPath = path.join(tmpDir, 'gateway.db-shm');
    const backupDir = path.join(tmpDir, 'backups');

    try {
      // 1. Initial State: Create user, key, audit record
      const dbManager1 = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager1.initialize();

      const keyRepo1 = new ApiKeyRepository(dbManager1.getDb());
      const keyService1 = new ApiKeyService(keyRepo1);
      const user = keyService1.createUser('recovery_admin', 'admin');
      const { rawKey } = keyService1.generateApiKey({ userId: user.id, name: 'Recovery Key' });

      const auditRepo1 = new AuditRepository(dbManager1.getDb());
      const auditService1 = new AuditService(auditRepo1);
      const auditId = auditService1.startAudit({
        userId: user.id,
        upstreamSlug: 'crm',
        toolName: 'crm__get_contact',
        arguments: { id: 1 },
      });
      auditService1.finalizeAudit(auditId, {
        status: 'success',
        startTimeMs: Date.now() - 100,
      });

      // 2. Take Online Backup
      const backupResult = backupDatabase(dbManager1.getDb(), backupDir);
      dbManager1.close();

      // 3. Simulate Node Failure and Primary Database Corruption
      fs.writeFileSync(dbPath, Buffer.from('DISASTER_CORRUPT_DATABASE_BYTES'));
      // Leave stale WAL / SHM files if present
      fs.writeFileSync(walPath, Buffer.from('STALE_WAL_DATA'));
      fs.writeFileSync(shmPath, Buffer.from('STALE_SHM_DATA'));

      // 4. Execute Restore Procedure:
      // Remove corrupted main db and stale WAL/SHM companion files
      fs.unlinkSync(dbPath);
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

      // Copy verified backup snapshot into primary position
      fs.copyFileSync(backupResult.backupPath, dbPath);
      fs.chmodSync(dbPath, 0o600);

      // 5. Reopen with DatabaseManager and Verify All Records Intact
      const dbManager2 = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager2.initialize();

      const keyRepo2 = new ApiKeyRepository(dbManager2.getDb());
      const keyService2 = new ApiKeyService(keyRepo2);

      // User restored
      const restoredUser = keyRepo2.findUserByUsername('recovery_admin');
      assert.notEqual(restoredUser, null);
      assert.equal(restoredUser?.role, 'admin');

      // Key verification functional
      const authUser = await keyService2.verifyKey(rawKey);
      assert.notEqual(authUser, null);
      assert.equal(authUser?.username, 'recovery_admin');

      // Audit records restored
      const auditRepo2 = new AuditRepository(dbManager2.getDb());
      const auditService2 = new AuditService(auditRepo2);
      const restoredAudit = auditService2.getAuditById(auditId);
      assert.notEqual(restoredAudit, null);
      assert.equal(restoredAudit?.status, 'success');
      assert.equal(restoredAudit?.tool_name, 'crm__get_contact');

      dbManager2.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('STAGE 2 FULL-SCHEMA: restores all 7 Phase 5 tables, relationships, and authentication contracts (Condition 4)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-stage2-fullschema-'));
    const sourceDbPath = path.join(tmpDir, 'source-gateway.db');
    const restoredDbPath = path.join(tmpDir, 'restored-gateway.db');
    const backupDir = path.join(tmpDir, 'backups');

    try {
      // 1. Initialize source database with full migrations (all 7 tables)
      const dbManagerSource = new DatabaseManager({ dbPath: sourceDbPath, autoMigrate: true });
      dbManagerSource.initialize();
      const db = dbManagerSource.getDb();

      const userRepo = new UserRepository(db);
      const passwordService = new ScryptPasswordService();
      const sessionRepo = new SessionRepository(db);
      const sessionService = new SessionService(sessionRepo, userRepo);
      const invitationRepo = new InvitationRepository(db);
      const invitationService = new InvitationService(invitationRepo, userRepo, sessionService, passwordService, db);
      const apiKeyRepo = new ApiKeyRepository(db);
      const apiKeyService = new ApiKeyService(apiKeyRepo);
      const upstreamRepo = new UpstreamRepository(db);
      const auditRepo = new AuditRepository(db);
      const auditService = new AuditService(auditRepo);

      // Seed Table 1: users (admin + member)
      const adminUser = userRepo.insertUser({
        id: 'usr-stage2-admin-1',
        username: 'stage2_admin',
        role: 'admin',
        is_active: 1,
      });
      const memberUser = userRepo.insertUser({
        id: 'usr-stage2-member-1',
        username: 'stage2_member',
        role: 'member',
        is_active: 1,
      });

      // Seed Table 2: user_credentials (scrypt password hashes)
      const adminHash = await passwordService.hashPassword('AdminMaster123!');
      userRepo.setUserCredentials(adminUser.id, adminHash);
      const memberHash = await passwordService.hashPassword('MemberSecret456!');
      userRepo.setUserCredentials(memberUser.id, memberHash);

      // Seed Table 3: browser_sessions
      const sessionAdmin = await sessionService.createSession(adminUser.id, {
        ipAddress: '127.0.0.1',
        userAgent: 'Stage2-Test-Agent',
      });
      const sessionMember = await sessionService.createSession(memberUser.id, {
        ipAddress: '10.42.0.15',
        userAgent: 'Stage2-Member-Agent',
      });

      // Seed Table 4: user_invitations (1 unredeemed, 1 redeemed)
      const pendingInv = invitationService.createInvitation({
        role: 'member',
        invitedBy: adminUser.id,
      });
      const inviteToRedeem = invitationService.createInvitation({
        role: 'member',
        invitedBy: adminUser.id,
      });
      await invitationService.redeemInvitation({
        token: inviteToRedeem.rawToken,
        username: 'stage2_redeemed_user',
        password: 'RedeemedPass123!',
      });

      // Seed Table 5: api_keys (1 active, 1 revoked)
      const { rawKey: activeRawKey, apiKey: activeKeyRecord } = apiKeyService.generateApiKey({
        userId: adminUser.id,
        name: 'Stage2 Active Admin Key',
      });
      const { rawKey: revokedRawKey, apiKey: revokedKeyRecord } = apiKeyService.generateApiKey({
        userId: memberUser.id,
        name: 'Stage2 Revoked Member Key',
      });
      apiKeyRepo.revokeApiKey(revokedKeyRecord.id);

      // Seed Table 6: upstreams (seedDefaults seeds 3 upstreams)
      upstreamRepo.seedDefaults();

      // Seed Table 7: audit_logs (3 statuses: success, failed, pending/unconfirmed)
      const aud1 = auditService.startAudit({
        userId: adminUser.id,
        upstreamSlug: 'woocommerce',
        toolName: 'woocommerce_list_products',
        arguments: { per_page: 10 },
      });
      auditService.finalizeAudit(aud1, { status: 'success', startTimeMs: Date.now() - 50 });

      const aud2 = auditService.startAudit({
        userId: memberUser.id,
        upstreamSlug: 'crm',
        toolName: 'crm_get_contact',
        arguments: { id: 42 },
      });
      auditService.finalizeAudit(aud2, {
        status: 'failed',
        startTimeMs: Date.now() - 30,
        errorCode: 'UPSTREAM_NOT_FOUND',
        errorMessage: 'Contact 42 does not exist',
      });

      const aud3 = auditService.startAudit({
        userId: adminUser.id,
        upstreamSlug: 'tasks',
        toolName: 'tasks_list_tasks',
        arguments: {},
      });
      // aud3 intentionally left in pending state

      // 2. Perform online WAL backup
      const backupResult = backupDatabase(db, backupDir, 5);
      assert.ok(fs.existsSync(backupResult.backupPath));
      assert.ok(fs.existsSync(backupResult.manifestPath));

      // Verify manifest records all 7 tables
      const manifest = backupResult.manifest;
      assert.strictEqual(manifest.integrityCheck, 'ok');
      assert.strictEqual(manifest.foreignKeyCheck, 'ok');
      assert.strictEqual(manifest.rowCounts.users, 3); // admin, member, redeemed_user
      assert.strictEqual(manifest.rowCounts.user_credentials, 3);
      assert.strictEqual(manifest.rowCounts.browser_sessions, 3); // 2 manual + 1 from invitation redemption
      assert.strictEqual(manifest.rowCounts.user_invitations, 2);
      assert.strictEqual(manifest.rowCounts.api_keys, 2);
      assert.strictEqual(manifest.rowCounts.upstreams, 3);
      assert.strictEqual(manifest.rowCounts.audit_logs, 3);

      // Close source database connection
      dbManagerSource.close();

      // 3. Execute standardized restoreDatabase to a fresh target path
      const restoreResult = restoreDatabase({
        snapshotPath: backupResult.backupPath,
        targetDbPath: restoredDbPath,
      });

      assert.strictEqual(restoreResult.targetDbPath, path.resolve(restoredDbPath));
      assert.strictEqual(restoreResult.sha256, manifest.sha256);
      assert.deepStrictEqual(restoreResult.restoredRowCounts, manifest.rowCounts);

      // Verify POSIX permissions 0600 on restored database
      const restoredStat = fs.statSync(restoredDbPath);
      assert.strictEqual((restoredStat.mode & 0o777).toString(8), '600');

      // 4. Open restored database with DatabaseManager and execute functional verification
      const dbManagerRestored = new DatabaseManager({ dbPath: restoredDbPath, autoMigrate: false });
      dbManagerRestored.initialize();
      const rDb = dbManagerRestored.getDb();

      // A. PRAGMA integrity and foreign key assertions
      const integrityCheck = rDb.prepare('PRAGMA integrity_check;').get() as any;
      assert.strictEqual(integrityCheck?.integrity_check, 'ok');
      const fkViolations = rDb.prepare('PRAGMA foreign_key_check;').all();
      assert.deepStrictEqual(fkViolations, [], 'Zero foreign key violations in restored database');

      // B. User authentication & Scrypt password verification
      const rUserRepo = new UserRepository(rDb);
      const rPasswordService = new ScryptPasswordService();
      const restoredAdminCreds = rUserRepo.getUserCredentials(adminUser.id);
      assert.ok(restoredAdminCreds);
      const adminPassValid = await rPasswordService.verifyPassword('AdminMaster123!', restoredAdminCreds.password_hash);
      assert.strictEqual(adminPassValid, true, 'Admin password must verify correctly against restored hash');
      const adminPassInvalid = await rPasswordService.verifyPassword('WrongPassword!', restoredAdminCreds.password_hash);
      assert.strictEqual(adminPassInvalid, false);

      // C. Browser Session verification
      const rSessionRepo = new SessionRepository(rDb);
      const rSessionService = new SessionService(rSessionRepo, rUserRepo);
      const validatedSession = await rSessionService.validateSession(sessionAdmin.rawToken);
      assert.ok(validatedSession);
      assert.strictEqual(validatedSession.user.id, adminUser.id);
      assert.strictEqual(validatedSession.user.username, 'stage2_admin');

      // D. Invitation state and lifecycle verification
      const rInvRepo = new InvitationRepository(rDb);
      const rInvService = new InvitationService(rInvRepo, rUserRepo, rSessionService, rPasswordService, rDb);
      // Unredeemed invitation should still be valid and redeemable
      const redeemAfterRestore = await rInvService.redeemInvitation({
        token: pendingInv.rawToken,
        username: 'stage2_post_restore_user',
        password: 'PostRestorePass123!',
      });
      assert.ok(redeemAfterRestore.user);
      assert.strictEqual(redeemAfterRestore.user.username, 'stage2_post_restore_user');

      // E. API Key verification (Active vs Revoked contract)
      const rApiKeyRepo = new ApiKeyRepository(rDb);
      const rApiKeyService = new ApiKeyService(rApiKeyRepo);
      const activeAuth = await rApiKeyService.verifyKey(activeRawKey);
      assert.ok(activeAuth);
      assert.strictEqual(activeAuth.username, 'stage2_admin');
      const revokedAuth = await rApiKeyService.verifyKey(revokedRawKey);
      assert.strictEqual(revokedAuth, null, 'Revoked key must fail verification on restored DB');

      // F. Upstream dynamic catalog
      const rUpstreamRepo = new UpstreamRepository(rDb);
      const upstreams = rUpstreamRepo.getAllUpstreams();
      assert.strictEqual(upstreams.length, 3);
      assert.ok(upstreams.some((u) => u.slug === 'woocommerce'));
      assert.ok(upstreams.some((u) => u.slug === 'crm'));
      assert.ok(upstreams.some((u) => u.slug === 'tasks'));

      // G. Audit Log queries and pagination
      const rAuditRepo = new AuditRepository(rDb);
      const audits = rAuditRepo.listAudits({ limit: 10 });
      assert.strictEqual(audits.length, 3);
      const successAudit = audits.find((a) => a.id === aud1);
      assert.ok(successAudit);
      assert.strictEqual(successAudit.status, 'success');
      assert.strictEqual(successAudit.tool_name, 'woocommerce_list_products');

      dbManagerRestored.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('FAIL-01: detects snapshot byte corruption and aborts without damaging existing target (Condition 5)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-fail01-test-'));
    const targetDbPath = path.join(tmpDir, 'target.db');
    const backupDir = path.join(tmpDir, 'backups');

    try {
      // 1. Establish an existing, healthy target database
      const dbManager = new DatabaseManager({ dbPath: targetDbPath, autoMigrate: true });
      dbManager.initialize();
      const userRepo = new UserRepository(dbManager.getDb());
      userRepo.insertUser({ id: 'usr-orig', username: 'original_user', role: 'admin', is_active: 1 });
      dbManager.close();

      // Snapshot the pristine state of target.db
      const targetBytesBefore = fs.readFileSync(targetDbPath);

      // 2. Create a valid backup in backupDir from an auxiliary source
      const auxDbPath = path.join(tmpDir, 'aux.db');
      const auxManager = new DatabaseManager({ dbPath: auxDbPath, autoMigrate: true });
      auxManager.initialize();
      const backupResult = backupDatabase(auxManager.getDb(), backupDir);
      auxManager.close();

      // 3. Intentionally corrupt bytes in the snapshot .db file
      const snapshotBytes = fs.readFileSync(backupResult.backupPath);
      // Flip byte at offset 200
      snapshotBytes[200] = snapshotBytes[200] ^ 0xff;
      fs.writeFileSync(backupResult.backupPath, snapshotBytes);

      // 4. Attempt restoreDatabase — must fail closed on SHA-256 checksum mismatch
      assert.throws(
        () => {
          restoreDatabase({
            snapshotPath: backupResult.backupPath,
            targetDbPath,
          });
        },
        (err: unknown) => {
          return err instanceof RestoreError && /checksum mismatch/i.test(err.message);
        }
      );

      // 5. INVARIANT: Existing target database MUST NOT be corrupted or modified
      const targetBytesAfter = fs.readFileSync(targetDbPath);
      assert.deepStrictEqual(targetBytesAfter, targetBytesBefore, 'Target database must remain untouched after failed restore');

      // Re-verify that target database opens and original_user remains intact
      const verifyManager = new DatabaseManager({ dbPath: targetDbPath, autoMigrate: false });
      verifyManager.initialize();
      const verifyUserRepo = new UserRepository(verifyManager.getDb());
      const u = verifyUserRepo.findUserByUsername('original_user');
      assert.ok(u);
      assert.strictEqual(u.username, 'original_user');
      verifyManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('FAIL-02: rejects missing, malformed, or tampered backup manifests and leaves existing target undamaged (Condition 5)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-fail02-test-'));
    const targetDbPath = path.join(tmpDir, 'target.db');
    const backupDir = path.join(tmpDir, 'backups');

    try {
      // 1. Establish an existing target database
      const dbManager = new DatabaseManager({ dbPath: targetDbPath, autoMigrate: true });
      dbManager.initialize();
      const userRepo = new UserRepository(dbManager.getDb());
      userRepo.insertUser({ id: 'usr-preserve', username: 'preserved_user', role: 'admin', is_active: 1 });
      dbManager.close();

      const targetBytesBefore = fs.readFileSync(targetDbPath);

      // 2. Generate valid backup snapshot
      const auxDbPath = path.join(tmpDir, 'aux.db');
      const auxManager = new DatabaseManager({ dbPath: auxDbPath, autoMigrate: true });
      auxManager.initialize();
      const backupResult = backupDatabase(auxManager.getDb(), backupDir);
      auxManager.close();

      // Case A: Missing companion manifest
      const origManifest = fs.readFileSync(backupResult.manifestPath, 'utf-8');
      fs.unlinkSync(backupResult.manifestPath);

      assert.throws(
        () => {
          restoreDatabase({
            snapshotPath: backupResult.backupPath,
            targetDbPath,
          });
        },
        (err: unknown) => err instanceof RestoreError && /manifest not found/i.test(err.message)
      );
      assert.deepStrictEqual(fs.readFileSync(targetDbPath), targetBytesBefore);

      // Case B: Malformed JSON manifest
      fs.writeFileSync(backupResult.manifestPath, '{invalid_json_bytes');
      assert.throws(
        () => {
          restoreDatabase({
            snapshotPath: backupResult.backupPath,
            targetDbPath,
          });
        },
        (err: unknown) => err instanceof RestoreError && /Failed to parse backup manifest/i.test(err.message)
      );
      assert.deepStrictEqual(fs.readFileSync(targetDbPath), targetBytesBefore);

      // Case C: Tampered sizeBytes in manifest
      const parsedManifest = JSON.parse(origManifest);
      parsedManifest.sizeBytes = parsedManifest.sizeBytes + 1024;
      fs.writeFileSync(backupResult.manifestPath, JSON.stringify(parsedManifest));

      assert.throws(
        () => {
          restoreDatabase({
            snapshotPath: backupResult.backupPath,
            targetDbPath,
          });
        },
        (err: unknown) => err instanceof RestoreError && /size mismatch/i.test(err.message)
      );
      assert.deepStrictEqual(fs.readFileSync(targetDbPath), targetBytesBefore);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('FAIL-03: enforces autocommit mode and rejects backup when an active transaction is open (Condition 5)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-fail03-test-'));
    const dbPath = path.join(tmpDir, 'trans-gateway.db');
    const backupDir = path.join(tmpDir, 'backups');

    try {
      const dbManager = new DatabaseManager({ dbPath, autoMigrate: true });
      dbManager.initialize();
      const db = dbManager.getDb();

      // Start an explicit transaction on connection
      db.exec('BEGIN IMMEDIATE;');

      assert.throws(
        () => {
          backupDatabase(db, backupDir);
        },
        (err: unknown) => {
          return (
            err instanceof BackupError &&
            /connection has an active transaction\. VACUUM INTO requires autocommit mode/i.test(err.message)
          );
        }
      );

      // Verify no orphan files were published into backupDir
      if (fs.existsSync(backupDir)) {
        const files = fs.readdirSync(backupDir);
        assert.strictEqual(files.length, 0, 'No partial backup files may exist after aborted backup');
      }

      // Rollback transaction and close cleanly
      db.exec('ROLLBACK;');
      dbManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('FAIL-04: successfully eliminates poisoned stale -wal and -shm files during disaster recovery (Condition 3 & 5)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-fail04-test-'));
    const targetDbPath = path.join(tmpDir, 'crashed-gateway.db');
    const walPath = `${targetDbPath}-wal`;
    const shmPath = `${targetDbPath}-shm`;
    const backupDir = path.join(tmpDir, 'backups');

    try {
      // 1. Generate clean backup snapshot from auxiliary database
      const auxDbPath = path.join(tmpDir, 'aux.db');
      const auxManager = new DatabaseManager({ dbPath: auxDbPath, autoMigrate: true });
      auxManager.initialize();
      const keyRepo = new ApiKeyRepository(auxManager.getDb());
      const keyService = new ApiKeyService(keyRepo);
      const user = keyService.createUser('wal_resilient_user', 'admin');
      const backupResult = backupDatabase(auxManager.getDb(), backupDir);
      auxManager.close();

      // 2. Simulate crashed database with POISONED WAL and SHM files
      fs.writeFileSync(targetDbPath, Buffer.from('CRASHED_MAIN_DB_HEADER'));
      fs.writeFileSync(walPath, Buffer.from('POISONED_STALE_WAL_DATA_BYTES_SIMULATING_REPLAY_CORRUPTION'));
      fs.writeFileSync(shmPath, Buffer.from('POISONED_STALE_SHM_SHARED_MEMORY_CORRUPT_BYTES'));

      assert.ok(fs.existsSync(walPath));
      assert.ok(fs.existsSync(shmPath));

      // 3. Execute restoreDatabase: must delete companion files prior to snapshot copy
      const result = restoreDatabase({
        snapshotPath: backupResult.backupPath,
        targetDbPath,
      });

      assert.strictEqual(result.targetDbPath, path.resolve(targetDbPath));

      // 4. Invariant: Stale poisoned companion files MUST be unlinked
      // Note: sqlite creates a new -wal only on subsequent writes, so right after copy neither wal nor shm should exist
      assert.strictEqual(fs.existsSync(walPath), false, 'Stale -wal companion file must be deleted');
      assert.strictEqual(fs.existsSync(shmPath), false, 'Stale -shm companion file must be deleted');

      // 5. Open target database: must pass integrity check with zero corruption
      const restoredManager = new DatabaseManager({ dbPath: targetDbPath, autoMigrate: false });
      restoredManager.initialize();
      const rDb = restoredManager.getDb();

      const integrity = rDb.prepare('PRAGMA integrity_check;').get() as any;
      assert.strictEqual(integrity?.integrity_check, 'ok');

      const rKeyRepo = new ApiKeyRepository(rDb);
      const u = rKeyRepo.findUserByUsername('wal_resilient_user');
      assert.ok(u);
      assert.strictEqual(u.id, user.id);

      restoredManager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('FAIL-05: strictly rejects targets within /data/ or resolving to /data/ without touching filesystem (Condition 1 & 5)', () => {
    // 1. Direct /data/ targets
    assert.throws(
      () => assertSafeDatabasePath('/data/gateway.db'),
      (err: unknown) => err instanceof RestoreError && /protected live location/i.test(err.message)
    );
    assert.throws(
      () => assertSafeDatabasePath('/data'),
      (err: unknown) => err instanceof RestoreError && /protected live location/i.test(err.message)
    );
    assert.throws(
      () => assertSafeDatabasePath('/data/'),
      (err: unknown) => err instanceof RestoreError && /protected live location/i.test(err.message)
    );
    assert.throws(
      () => assertSafeDatabasePath('/data/some-other-file.db'),
      (err: unknown) => err instanceof RestoreError && /protected live location/i.test(err.message)
    );

    // 2. Path normalization & traversal attempts (e.g., /tmp/../data/gateway.db)
    assert.throws(
      () => assertSafeDatabasePath('/tmp/../data/gateway.db'),
      (err: unknown) => err instanceof RestoreError && /protected live location/i.test(err.message)
    );
    assert.throws(
      () => assertSafeDatabasePath('/data/./sub/../gateway.db'),
      (err: unknown) => err instanceof RestoreError && /protected live location/i.test(err.message)
    );

    // 3. Verify restoreDatabase fails immediately without touching filesystem
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-fail05-test-'));
    const dummySnapshot = path.join(tmpDir, 'dummy.db');
    fs.writeFileSync(dummySnapshot, 'dummy');

    try {
      assert.throws(
        () => {
          restoreDatabase({
            snapshotPath: dummySnapshot,
            targetDbPath: '/data/gateway.db',
          });
        },
        (err: unknown) => err instanceof RestoreError && /protected live location/i.test(err.message)
      );

      // Verify that /data/gateway.db does NOT exist on the filesystem
      assert.strictEqual(fs.existsSync('/data/gateway.db'), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
