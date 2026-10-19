import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, IncompatibleSchemaError, MigrationError } from '../../src/db/migrations.js';
import { Migration, MIGRATIONS, migration001 } from '../../src/db/schema.js';

describe('Gateway SQLite Schema Migrations Unit Tests', () => {
  it('applies migrations cleanly and records version in schema_migrations', () => {
    const db = new DatabaseSync(':memory:');

    const testMigrations: Migration[] = [
      {
        version: 1,
        name: '001_create_table_a',
        sql: 'CREATE TABLE table_a (id INTEGER PRIMARY KEY, value TEXT);',
      },
      {
        version: 2,
        name: '002_create_table_b',
        sql: 'CREATE TABLE table_b (id INTEGER PRIMARY KEY, ref_a INTEGER REFERENCES table_a(id));',
      },
    ];

    runMigrations(db, testMigrations);

    const versionRow = db.prepare('SELECT MAX(version) as ver FROM schema_migrations;').get() as { ver: number };
    assert.equal(versionRow.ver, 2);

    const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC;').all() as unknown as { version: number; name: string }[];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, '001_create_table_a');
    assert.equal(rows[1].name, '002_create_table_b');

    // Verify tables were created
    db.prepare("INSERT INTO table_a (id, value) VALUES (1, 'hello');").run();
    const aRow = db.prepare('SELECT value FROM table_a WHERE id = 1;').get() as { value: string };
    assert.equal(aRow.value, 'hello');

    db.close();
  });

  it('canonical Migration 001 creates users, api_keys, audit_logs and strictly excludes upstreams table', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, [migration001]);

    // Verify allowed tables exist
    assert.notEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users';").get(), undefined);
    assert.notEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys';").get(), undefined);
    assert.notEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs';").get(), undefined);

    // Verify upstreams table is strictly absent in Migration 001
    const upstreamsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='upstreams';").get();
    assert.equal(upstreamsTable, undefined);

    db.close();
  });

  it('additive Migration 002 introduces upstreams registry table with constraints and index', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    // Verify upstreams table exists
    const upstreamsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='upstreams';").get();
    assert.notEqual(upstreamsTable, undefined);

    // Verify index exists
    const upstreamsIndex = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_upstreams_slug';").get();
    assert.notEqual(upstreamsIndex, undefined);

    // Verify check constraints on timeout_ms and is_enabled
    assert.throws(() => {
      db.prepare(`
        INSERT INTO upstreams (id, slug, display_name, endpoint_url, timeout_ms, is_enabled, status, created_at, updated_at)
        VALUES ('1', 'test', 'Test', 'http://test/mcp', 100, 1, 'active', 1000, 1000);
      `).run();
    }, /CHECK constraint failed/);

    assert.throws(() => {
      db.prepare(`
        INSERT INTO upstreams (id, slug, display_name, endpoint_url, timeout_ms, is_enabled, status, created_at, updated_at)
        VALUES ('1', 'test', 'Test', 'http://test/mcp', 10000, 2, 'active', 1000, 1000);
      `).run();
    }, /CHECK constraint failed/);

    db.close();
  });

  it('additive Migration 003 introduces is_active, user_credentials, browser_sessions, and user_invitations tables', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    // Verify users columns: is_active added
    const userCols = db.prepare("PRAGMA table_info(users);").all() as { name: string }[];
    const colNames = userCols.map((c) => c.name);
    assert(colNames.includes('is_active'));

    // Verify user_credentials table exists and has foreign key to users
    assert.notEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_credentials';").get(), undefined);
    const credCols = db.prepare("PRAGMA table_info(user_credentials);").all() as { name: string }[];
    const credColNames = credCols.map((c) => c.name);
    assert(credColNames.includes('user_id'));
    assert(credColNames.includes('password_hash'));
    assert(credColNames.includes('algorithm'));

    // Verify browser_sessions and user_invitations tables exist
    assert.notEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='browser_sessions';").get(), undefined);
    assert.notEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_invitations';").get(), undefined);

    // Verify indexes exist
    assert.notEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sessions_token_hash';").get(), undefined);
    assert.notEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_invitations_token_hash';").get(), undefined);

    // Verify is_active CHECK constraint on users (must be 0 or 1)
    assert.throws(() => {
      db.prepare(`
        INSERT INTO users (id, username, role, created_at, is_active)
        VALUES ('u1', 'bad_user', 'member', 1000, 2);
      `).run();
    }, /CHECK constraint failed/);

    db.close();
  });

  it('is idempotent when run repeatedly against up-to-date schema', () => {
    const db = new DatabaseSync(':memory:');

    const testMigrations: Migration[] = [
      {
        version: 1,
        name: '001_test',
        sql: 'CREATE TABLE t (id INTEGER);',
      },
    ];

    runMigrations(db, testMigrations);
    // Repeat run
    runMigrations(db, testMigrations);

    const versionRow = db.prepare('SELECT COUNT(*) as count FROM schema_migrations;').get() as { count: number };
    assert.equal(versionRow.count, 1);

    db.close();
  });

  it('rolls back atomic transaction when a migration fails, leaving no partial schema changes', () => {
    const db = new DatabaseSync(':memory:');

    const testMigrations: Migration[] = [
      {
        version: 1,
        name: '001_valid',
        sql: 'CREATE TABLE table_one (id INTEGER);',
      },
      {
        version: 2,
        name: '002_failing',
        sql: `
          CREATE TABLE table_two (id INTEGER);
          INVALID SQL SYNTAX THAT CAUSES IMMEDIATE FAILURE;
        `,
      },
    ];

    assert.throws(
      () => runMigrations(db, testMigrations),
      (err: unknown) => {
        assert(err instanceof MigrationError);
        assert(err.message.includes('002_failing'));
        return true;
      }
    );

    // Migration 1 should be committed
    const rowOne = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='table_one';").get();
    assert.notEqual(rowOne, undefined);

    // Migration 2 should be rolled back completely (table_two does NOT exist)
    const rowTwo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='table_two';").get();
    assert.equal(rowTwo, undefined);

    // schema_migrations version should remain at 1
    const versionRow = db.prepare('SELECT MAX(version) as ver FROM schema_migrations;').get() as { ver: number };
    assert.equal(versionRow.ver, 1);

    db.close();
  });

  it('fails closed when database schema version is newer than application code version', () => {
    const db = new DatabaseSync(':memory:');

    // Simulate database that was migrated by a newer gateway release (version 10)
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at) VALUES (10, '010_future_schema', 123456789);
    `);

    // Application code only knows about migrations up to version 1
    const appMigrations: Migration[] = [
      {
        version: 1,
        name: '001_initial',
        sql: 'CREATE TABLE t (id INTEGER);',
      },
    ];

    assert.throws(
      () => runMigrations(db, appMigrations),
      (err: unknown) => {
        assert(err instanceof IncompatibleSchemaError);
        assert(err.message.includes('newer than application supported version'));
        return true;
      }
    );

    db.close();
  });
});
