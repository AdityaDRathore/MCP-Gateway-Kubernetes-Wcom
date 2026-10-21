import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { backupDatabase } from '../../src/db/backup.js';

describe('Disposable Database Migration 003 Verification (Condition 5)', () => {
  let tmpDir: string;
  let disposableDbPath: string;
  let backupDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urumi-disposable-migration-'));
    disposableDbPath = path.join(tmpDir, 'disposable-gateway.db');
    backupDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('verifies pending migration 003 on pre-migration disposable database copy', () => {
    // 1. Pre-flight check: Invariant that live PVC path /data/gateway.db is NOT touched
    assert.notStrictEqual(disposableDbPath, '/data/gateway.db');

    // 2. Initialize disposable database at PRE-MIGRATION state (Migrations version 1 and 2 only)
    const preMigrations = MIGRATIONS.filter((m) => m.version <= 2);
    assert.strictEqual(preMigrations.length, 2);

    const db = new DatabaseSync(disposableDbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA journal_mode = WAL;');
    runMigrations(db, preMigrations);

    // Verify pre-migration version in schema_migrations
    const preVersions = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC;').all() as any[];
    assert.deepStrictEqual(
      preVersions.map((r) => r.version),
      [1, 2]
    );

    // Post-migration 003 tables MUST NOT exist at this stage
    const tableCheckBefore = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user_invitations', 'user_credentials', 'browser_sessions');")
      .all();
    assert.strictEqual(tableCheckBefore.length, 0);

    // 3. Seed realistic pre-existing data across pre-migration tables
    const now = Math.floor(Date.now() / 1000);

    // Seed users (note: pre-migration users table has id, username, role, created_at)
    db.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?);').run(
      'usr-mig-admin',
      'mig_admin',
      'admin',
      now - 1000
    );
    db.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?);').run(
      'usr-mig-member',
      'mig_member',
      'member',
      now - 500
    );

    // Seed API key
    db.prepare(
      'INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, expires_at, revoked_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);'
    ).run('key-mig-1', 'usr-mig-admin', 'hash123', 'urumi_live_test', 'Mig Admin Key', null, null, now - 1000, null);

    // Seed upstreams
    db.prepare(
      'INSERT INTO upstreams (id, slug, display_name, endpoint_url, timeout_ms, is_enabled, status, secret_ref_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);'
    ).run(
      'ups-mig-crm',
      'crm',
      'CRM System',
      'http://crm-service.internal:3000/mcp',
      5000,
      1,
      'active',
      'urumi-secret-crm',
      now - 2000,
      now - 2000
    );

    // Seed audit log
    db.prepare(
      'INSERT INTO audit_logs (id, user_id, upstream_slug, tool_name, arguments_hash, status, duration_ms, error_code, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);'
    ).run(
      'aud-mig-1',
      'usr-mig-admin',
      'crm',
      'search_contacts',
      'sha256-input',
      'success',
      50,
      null,
      null,
      now - 100
    );

    // Snapshot pre-migration rows for validation
    const usersBefore = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id;').all();
    const keysBefore = db.prepare('SELECT * FROM api_keys ORDER BY id;').all();
    const upstreamsBefore = db.prepare('SELECT * FROM upstreams ORDER BY id;').all();
    const auditsBefore = db.prepare('SELECT * FROM audit_logs ORDER BY id;').all();

    // 4. APPLY PENDING MIGRATION (Migration 3: 003_browser_identity_and_sessions)
    runMigrations(db, MIGRATIONS);

    // 5. POST-MIGRATION VERIFICATION
    // A. Verify schema_migrations recorded version 3
    const postVersions = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC;').all() as any[];
    assert.deepStrictEqual(
      postVersions.map((r) => r.version),
      [1, 2, 3]
    );
    assert.strictEqual(postVersions[2].name, '003_browser_identity_and_sessions');

    // B. Verify user_invitations, user_credentials, and browser_sessions tables now exist
    const postTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user_invitations', 'user_credentials', 'browser_sessions');")
      .all() as any[];
    assert.strictEqual(postTables.length, 3);

    // C. Verify ROW PRESERVATION and default is_active = 1 migration on users table
    const usersAfter = db.prepare('SELECT id, username, role, is_active, created_at FROM users ORDER BY id;').all() as any[];
    assert.strictEqual(usersAfter.length, usersBefore.length);
    for (let i = 0; i < usersAfter.length; i++) {
      const b = usersBefore[i] as any;
      const a = usersAfter[i];
      assert.strictEqual(a.id, b.id);
      assert.strictEqual(a.username, b.username);
      assert.strictEqual(a.role, b.role);
      assert.strictEqual(a.created_at, b.created_at);
      assert.strictEqual(a.is_active, 1, 'Default is_active=1 must be assigned to existing users');
    }

    const keysAfter = db.prepare('SELECT * FROM api_keys ORDER BY id;').all();
    assert.deepStrictEqual(keysAfter, keysBefore, 'API keys rows must be strictly preserved');

    const upstreamsAfter = db.prepare('SELECT * FROM upstreams ORDER BY id;').all();
    assert.deepStrictEqual(upstreamsAfter, upstreamsBefore, 'Upstreams rows must be strictly preserved');

    const auditsAfter = db.prepare('SELECT * FROM audit_logs ORDER BY id;').all();
    assert.deepStrictEqual(auditsAfter, auditsBefore, 'Audit logs rows must be strictly preserved');

    // D. Test writing into new user_invitations table
    db.prepare(`
      INSERT INTO user_invitations (id, token_hash, role, invited_by, expires_at, redeemed_at, redeemed_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?);
    `).run('inv-mig-test', 'sha256hash...', 'member', 'usr-mig-admin', now + 259200, now);

    const invRow = db.prepare('SELECT * FROM user_invitations WHERE id = ?;').get('inv-mig-test') as any;
    assert.ok(invRow);
    assert.strictEqual(invRow.role, 'member');
    assert.strictEqual(invRow.invited_by, 'usr-mig-admin');

    // E. Verify Foreign Key constraints (zero violations)
    const fkViolations = db.prepare('PRAGMA foreign_key_check;').all();
    assert.deepStrictEqual(fkViolations, [], 'Zero foreign key violations permitted');

    // F. Verify SQLite database integrity check
    const integrityCheck = db.prepare('PRAGMA integrity_check;').get() as any;
    assert.strictEqual(integrityCheck?.integrity_check, 'ok');

    db.close();

    // 6. BACKUP MANIFEST AND CHECKSUM VERIFICATION (Condition 5)
    const dbForBackup = new DatabaseSync(disposableDbPath);
    const backupResult = backupDatabase(dbForBackup, backupDir);

    assert.strictEqual(backupResult.manifest.integrityCheck, 'ok');
    assert.strictEqual(backupResult.manifest.foreignKeyCheck, 'ok');
    assert.strictEqual(backupResult.manifest.rowCounts.users, 2);
    assert.strictEqual(backupResult.manifest.rowCounts.api_keys, 1);
    assert.strictEqual(backupResult.manifest.rowCounts.upstreams, 1);
    assert.strictEqual(backupResult.manifest.rowCounts.audit_logs, 1);
    assert.strictEqual(backupResult.manifest.rowCounts.user_invitations, 1);

    // Verify SHA-256 checksum on backup file matches manifest
    const backupBytes = fs.readFileSync(backupResult.backupPath);
    const computedChecksum = crypto.createHash('sha256').update(backupBytes).digest('hex');
    assert.strictEqual(computedChecksum, backupResult.manifest.sha256);

    dbForBackup.close();
  });
});
