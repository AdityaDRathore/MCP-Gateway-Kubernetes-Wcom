import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { assertAutocommitMode, backupDatabase, BackupError } from '../../src/db/backup.js';

describe('SQLite Backup Precondition Verification (DEC-05 / P5-G2 Condition)', () => {
  it('assertAutocommitMode succeeds when connection is in autocommit mode', () => {
    const db = new DatabaseSync(':memory:');
    assert.strictEqual(db.isTransaction, false);

    // Must not throw
    assert.doesNotThrow(() => {
      assertAutocommitMode(db);
    });
    db.close();
  });

  it('assertAutocommitMode fails closed when transaction is active (BEGIN)', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE test (id INT);');
    db.exec('BEGIN TRANSACTION;');

    assert.strictEqual(db.isTransaction, true);

    assert.throws(
      () => {
        assertAutocommitMode(db);
      },
      (err: unknown) => {
        assert(err instanceof BackupError);
        assert(err.message.includes('connection has an active transaction'));
        return true;
      }
    );

    db.exec('ROLLBACK;');
    assert.strictEqual(db.isTransaction, false);

    // After rollback, autocommit mode is restored
    assert.doesNotThrow(() => {
      assertAutocommitMode(db);
    });
    db.close();
  });

  it('assertAutocommitMode fails closed for deferred transactions', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE test (id INT);');
    db.exec('BEGIN DEFERRED;');

    assert.strictEqual(db.isTransaction, true);

    assert.throws(
      () => {
        assertAutocommitMode(db);
      },
      (err: unknown) => {
        assert(err instanceof BackupError);
        assert(err.message.includes('connection has an active transaction'));
        return true;
      }
    );

    db.exec('COMMIT;');
    assert.strictEqual(db.isTransaction, false);
    db.close();
  });

  it('assertAutocommitMode fails closed if db is null or isTransaction is indeterminate', () => {
    assert.throws(
      () => {
        assertAutocommitMode(null as any);
      },
      /database connection is null or undefined/
    );

    const mockDbWithoutProp = { exec: () => {} };
    assert.throws(
      () => {
        assertAutocommitMode(mockDbWithoutProp as any);
      },
      /unable to verify autocommit state/
    );
  });

  it('backupDatabase rejects execution if called while a transaction is open', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urumi-backup-precondition-'));
    const dbPath = path.join(tempDir, 'active.db');
    const backupDir = path.join(tempDir, 'backups');

    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE test_data (val TEXT);');
    db.exec('INSERT INTO test_data VALUES (\'persisted\');');

    db.exec('BEGIN EXCLUSIVE;');

    assert.throws(
      () => {
        backupDatabase(db, backupDir);
      },
      (err: unknown) => {
        assert(err instanceof BackupError);
        assert(err.message.includes('connection has an active transaction'));
        return true;
      }
    );

    // Ensure no backup file was created
    if (fs.existsSync(backupDir)) {
      const files = fs.readdirSync(backupDir);
      assert.strictEqual(files.length, 0);
    }

    db.exec('ROLLBACK;');

    // Now outside transaction, backup should succeed
    const result = backupDatabase(db, backupDir);
    assert(fs.existsSync(result.backupPath));
    assert(result.sizeBytes > 0);

    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
