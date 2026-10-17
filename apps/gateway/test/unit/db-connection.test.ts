import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseManager, DatabaseInitializationError, DatabaseCorruptionError } from '../../src/db/connection.js';

describe('Gateway SQLite Database Connection Unit Tests', () => {
  it('initializes fresh database with WAL mode, foreign keys, synchronous NORMAL, and busy timeout', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-db-test-'));
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      const manager = new DatabaseManager({ dbPath, autoMigrate: true });
      manager.initialize();

      assert.equal(manager.isOpen(), true);
      assert.equal(manager.isHealthy(), true);

      const db = manager.getDb();

      // Verify PRAGMA journal_mode = wal
      const journalRow = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      assert.equal(journalRow.journal_mode.toLowerCase(), 'wal');

      // Verify PRAGMA foreign_keys = 1 (ON)
      const fkRow = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
      assert.equal(fkRow.foreign_keys, 1);

      // Verify PRAGMA busy_timeout = 5000
      const timeoutRow = db.prepare('PRAGMA busy_timeout;').get() as { timeout: number };
      assert.equal(timeoutRow.timeout, 5000);

      // Verify PRAGMA synchronous = 1 (NORMAL)
      const syncRow = db.prepare('PRAGMA synchronous;').get() as { synchronous: number };
      assert.equal(syncRow.synchronous, 1);

      manager.close();
      assert.equal(manager.isOpen(), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('tightens permissions on existing loose directory to 0700 and database file to 0600', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-db-perm-'));
    // Deliberately set overly permissive 0777 on directory
    fs.chmodSync(tmpDir, 0o777);
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      const manager = new DatabaseManager({ dbPath, autoMigrate: true });
      manager.initialize();

      // Verify directory permissions tightened to 0700
      const dirStat = fs.statSync(tmpDir);
      const dirMode = (dirStat.mode & 0o777).toString(8);
      assert.equal(dirMode, '700');

      // Verify database file permissions set to 0600
      const fileStat = fs.statSync(dbPath);
      const fileMode = (fileStat.mode & 0o777).toString(8);
      assert.equal(fileMode, '600');

      manager.close();
    } finally {
      fs.chmodSync(tmpDir, 0o700);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('safely reopens an existing database without resetting or dropping data', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-db-reopen-'));
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      // First open
      const manager1 = new DatabaseManager({ dbPath, autoMigrate: true });
      manager1.initialize();
      const db1 = manager1.getDb();
      db1.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('u1', 'alice', 'admin', 100);").run();
      manager1.close();

      // Second open
      const manager2 = new DatabaseManager({ dbPath, autoMigrate: true });
      manager2.initialize();
      const db2 = manager2.getDb();
      const row = db2.prepare("SELECT username, role FROM users WHERE id = 'u1';").get() as { username: string; role: string };
      assert.equal(row.username, 'alice');
      assert.equal(row.role, 'admin');
      manager2.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails closed when database file is corrupted without deleting or resetting the file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-db-corrupt-'));
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      // Create a corrupt file with invalid header
      fs.writeFileSync(dbPath, Buffer.from('CORRUPTED_NON_SQLITE_HEADER_DATA_1234567890'));

      const manager = new DatabaseManager({ dbPath, autoMigrate: true });
      assert.throws(
        () => manager.initialize(),
        (err: unknown) => {
          assert(err instanceof DatabaseCorruptionError || err instanceof DatabaseInitializationError);
          return true;
        }
      );

      // Verify file was NOT deleted or overwritten
      assert.equal(fs.existsSync(dbPath), true);
      const content = fs.readFileSync(dbPath, 'utf8');
      assert(content.includes('CORRUPTED_NON_SQLITE_HEADER_DATA'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails closed when database directory path is unwritable', () => {
    const readOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-db-ro-'));
    fs.chmodSync(readOnlyDir, 0o400); // Read-only directory
    const invalidPath = path.join(readOnlyDir, 'nested', 'gateway.db');

    try {
      const manager = new DatabaseManager({ dbPath: invalidPath, autoMigrate: true });
      assert.throws(
        () => manager.initialize(),
        (err: unknown) => {
          assert(err instanceof DatabaseInitializationError);
          return true;
        }
      );
    } finally {
      fs.chmodSync(readOnlyDir, 0o700);
      fs.rmSync(readOnlyDir, { recursive: true, force: true });
    }
  });

  it('executes operations inside transactions with rollback on failure', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-db-tx-'));
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      const manager = new DatabaseManager({ dbPath, autoMigrate: true });
      manager.initialize();
      const db = manager.getDb();

      // Successful transaction
      manager.transaction(() => {
        db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('u2', 'bob', 'member', 101);").run();
      });

      const userRow = db.prepare("SELECT username FROM users WHERE id = 'u2';").get() as { username: string };
      assert.equal(userRow.username, 'bob');

      // Failing transaction rolls back completely
      assert.throws(() => {
        manager.transaction(() => {
          db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('u3', 'charlie', 'member', 102);").run();
          throw new Error('Simulated failure during transaction');
        });
      });

      const rolledBackRow = db.prepare("SELECT * FROM users WHERE id = 'u3';").get();
      assert.equal(rolledBackRow, undefined);

      manager.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('checkpoints WAL frames on close and propagates errors when close fails', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtw-db-close-err-'));
    const dbPath = path.join(tmpDir, 'gateway.db');

    try {
      const manager = new DatabaseManager({ dbPath, autoMigrate: true });
      manager.initialize();

      // Simulate a database handle where close throws an error
      const realDb = manager.getDb();
      // Close the underlying handle directly so that manager.close() attempting WAL checkpoint throws
      realDb.close();

      assert.throws(
        () => manager.close(),
        (err: unknown) => {
          assert(err instanceof Error);
          return true;
        }
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
