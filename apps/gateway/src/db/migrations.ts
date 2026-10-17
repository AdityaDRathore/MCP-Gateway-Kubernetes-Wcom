import { DatabaseSync } from 'node:sqlite';
import { Migration } from './schema.js';

export class IncompatibleSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleSchemaError';
  }
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Runs versioned, transactional migrations against the SQLite database.
 * 
 * Invariants:
 * 1. Checks current schema version.
 * 2. Halts startup if database schema version is newer than application code version (Fail-Closed).
 * 3. Applies each pending migration inside a dedicated IMMEDIATE transaction.
 * 4. Rolls back transaction on failure, leaving no partial schema changes.
 */
export function runMigrations(db: DatabaseSync, migrations: Migration[]): void {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const currentVersionRow = db.prepare('SELECT MAX(version) as ver FROM schema_migrations').get() as { ver: number | null } | undefined;
  const currentVersion = currentVersionRow?.ver ?? 0;

  const maxCodeVersion = migrations.length > 0
    ? Math.max(...migrations.map((m) => m.version))
    : 0;

  // Fail-closed check: Newer schema version in DB than in code
  if (currentVersion > maxCodeVersion) {
    throw new IncompatibleSchemaError(
      `Database schema version (${currentVersion}) is newer than application supported version (${maxCodeVersion}). Startup aborted to prevent corruption.`
    );
  }

  // Filter and sort pending migrations
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);')
        .run(migration.version, migration.name, Math.floor(Date.now() / 1000));
      db.exec('COMMIT;');
    } catch (err: unknown) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Rollback may fail if transaction was already aborted
      }
      throw new MigrationError(
        `Migration ${migration.version} (${migration.name}) failed. Transaction rolled back. Startup halted. Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
