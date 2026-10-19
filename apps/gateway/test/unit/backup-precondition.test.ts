import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assertAutocommitMode, backupDatabase, BackupError, getTableRowCounts } from '../../src/db/backup.js';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';

describe('SQLite Backup Precondition & Manifest Verification (P5-G2 Condition 1 & 4)', () => {
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
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urumi-backup-tx-'));
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
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('backupDatabase creates snapshot with verified manifest, sha256 checksum, and row counts', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urumi-backup-manifest-'));
    const dbPath = path.join(tempDir, 'source.db');
    const backupDir = path.join(tempDir, 'backups');

    const db = new DatabaseSync(dbPath);
    runMigrations(db, MIGRATIONS);

    // Seed rows into primary tables
    db.exec(`
      INSERT INTO users (id, username, role, is_active, created_at)
      VALUES ('u1', 'admin', 'admin', 1, 1000), ('u2', 'alice', 'member', 1, 1001);

      INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, created_at)
      VALUES ('k1', 'u1', 'admin-key', 'urumi_live_adm', 'hash1', 1000);

      INSERT INTO upstreams (id, slug, display_name, endpoint_url, timeout_ms, is_enabled, status, created_at, updated_at)
      VALUES ('ups1', 'woocommerce', 'WooCommerce MCP', 'http://wc:3000/mcp', 10000, 1, 'active', 1000, 1000);

      INSERT INTO audit_logs (id, user_id, upstream_slug, tool_name, status, created_at, arguments_hash)
      VALUES ('aud1', 'u1', 'woocommerce', 'list_products', 'success', 1000, 'arg_hash_canary');
    `);

    const result = backupDatabase(db, backupDir);

    // 1. Files exist with 0600 permissions
    assert(fs.existsSync(result.backupPath));
    assert(fs.existsSync(result.manifestPath));
    const dbStat = fs.statSync(result.backupPath);
    const manifestStat = fs.statSync(result.manifestPath);
    assert.strictEqual((dbStat.mode & 0o777), 0o600);
    assert.strictEqual((manifestStat.mode & 0o777), 0o600);

    // 2. Checksum verification
    const expectedSha256 = crypto.createHash('sha256').update(fs.readFileSync(result.backupPath)).digest('hex');
    assert.strictEqual(result.manifest.sha256, expectedSha256);

    // 3. Manifest content verification
    const fileManifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    assert.strictEqual(fileManifest.backupId, result.manifest.backupId);
    assert.strictEqual(fileManifest.integrityCheck, 'ok');
    assert.strictEqual(fileManifest.foreignKeyCheck, 'ok');
    assert.strictEqual(fileManifest.rowCounts.users, 2);
    assert.strictEqual(fileManifest.rowCounts.api_keys, 1);
    assert.strictEqual(fileManifest.rowCounts.upstreams, 1);
    assert.strictEqual(fileManifest.rowCounts.audit_logs, 1);

    // 4. Standalone snapshot database test
    const snapshotDb = new DatabaseSync(result.backupPath);
    const snapshotCounts = getTableRowCounts(snapshotDb);
    assert.strictEqual(snapshotCounts.users, 2);
    assert.strictEqual(snapshotCounts.api_keys, 1);
    assert.strictEqual(snapshotCounts.upstreams, 1);
    assert.strictEqual(snapshotCounts.audit_logs, 1);
    snapshotDb.close();

    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('pruneBackups prunes both .db snapshots and their companion .manifest.json files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urumi-backup-prune-'));
    const backupDir = path.join(tempDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    // Create 4 dummy backup pairs with differing modification times
    for (let i = 1; i <= 4; i++) {
      const dbFile = path.join(backupDir, `gateway-2026-01-0${i}-000000.db`);
      const manifestFile = path.join(backupDir, `gateway-2026-01-0${i}-000000.manifest.json`);
      fs.writeFileSync(dbFile, 'db-content');
      fs.writeFileSync(manifestFile, '{}');
      const time = 1700000000 + i * 1000;
      fs.utimesSync(dbFile, time, time);
      fs.utimesSync(manifestFile, time, time);
    }

    // Retain only 2 newest backups
    const db = new DatabaseSync(':memory:');
    const result = backupDatabase(db, backupDir, 2);

    const remainingFiles = fs.readdirSync(backupDir);
    const remainingDbs = remainingFiles.filter((f) => f.endsWith('.db'));
    const remainingManifests = remainingFiles.filter((f) => f.endsWith('.manifest.json'));

    assert.strictEqual(remainingDbs.length, 2);
    assert.strictEqual(remainingManifests.length, 2);

    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
