import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseManager } from '../../src/db/connection.js';
import { ApiKeyRepository } from '../../src/db/api-key-repo.js';
import { ApiKeyService } from '../../src/auth/api-key-service.js';
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService } from '../../src/audit/audit-service.js';
import { backupDatabase, pruneBackups } from '../../src/db/backup.js';

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
      const { rawKey } = keyService.generateApiKey({ userId: user.id, name: 'Alice Key' });

      // Create backup
      const backupResult = backupDatabase(dbManager.getDb(), backupDir, 7);

      assert.equal(fs.existsSync(backupResult.backupPath), true);
      assert(backupResult.sizeBytes > 0);

      // Verify permissions 0600 (-rw-------)
      const stats = fs.statSync(backupResult.backupPath);
      // In octal mode: check owner read and write
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
});
