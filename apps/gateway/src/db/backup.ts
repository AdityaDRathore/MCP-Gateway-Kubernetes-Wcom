import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { logger } from '../logging/logger.js';

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface BackupManifest {
  backupId: string;
  backupFileName: string;
  manifestFileName: string;
  timestamp: string;
  createdAtUnix: number;
  sha256: string;
  sizeBytes: number;
  schemaVersion: number;
  integrityCheck: string;
  foreignKeyCheck: string;
  rowCounts: Record<string, number>;
}

export interface BackupResult {
  backupPath: string;
  manifestPath: string;
  manifest: BackupManifest;
  timestamp: string;
  sizeBytes: number;
}

/**
 * Safely escapes string literals for SQLite statement execution.
 * In SQLite, single quotes within string literals are escaped by doubling them (' -> '').
 */
export function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Asserts that the SQLite database connection is currently in autocommit mode
 * (no active transaction), using the native connection transaction-state API.
 * 
 * In Node.js 24 LTS node:sqlite, DatabaseSync.prototype.isTransaction returns
 * true when a transaction (deferred, immediate, or exclusive) is active on the connection,
 * and false when in autocommit mode.
 * 
 * Fails closed if isTransaction is not explicitly false.
 */
export function assertAutocommitMode(db: DatabaseSync): void {
  if (!db) {
    throw new BackupError('SQLite backup precondition failed: database connection is null or undefined');
  }

  const isTx = (db as any).isTransaction;
  if (typeof isTx !== 'boolean') {
    throw new BackupError(
      `SQLite backup precondition failed: unable to verify autocommit state (isTransaction property type is ${typeof isTx})`
    );
  }

  if (isTx === true) {
    throw new BackupError(
      'SQLite backup precondition failed: connection has an active transaction. VACUUM INTO requires autocommit mode.'
    );
  }
}

/**
 * Collects row counts for all known application tables that exist in the database.
 */
export function getTableRowCounts(database: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  const tables = [
    'users',
    'api_keys',
    'upstreams',
    'audit_logs',
    'user_credentials',
    'browser_sessions',
    'user_invitations',
  ];

  for (const tbl of tables) {
    const tableExists = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;")
      .get(tbl);
    if (tableExists) {
      const countRow = database
        .prepare(`SELECT count(*) as count FROM ${tbl};`)
        .get() as { count: number } | undefined;
      counts[tbl] = countRow?.count ?? 0;
    }
  }
  return counts;
}

/**
 * Creates an atomic WAL-consistent backup of the SQLite database using VACUUM INTO,
 * generates a verified backup manifest (unique ID, SHA-256 checksum, row-count preservation,
 * PRAGMA integrity_check, PRAGMA foreign_key_check), enforces 0700/0600 POSIX permissions,
 * and prunes older backups.
 */
export function backupDatabase(
  db: DatabaseSync,
  backupDir: string,
  retainCount = 7
): BackupResult {
  // Precondition: Fail closed if transaction is active or indeterminate
  assertAutocommitMode(db);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(backupDir, 0o700);
  } catch (err: unknown) {
    logger.warn('Could not tighten permissions on backup directory', {
      backupDir,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Baseline row counts from source database prior to backup
  const sourceRowCounts = getTableRowCounts(db);

  const backupId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePrefix = `gateway-${timestamp}-${backupId.slice(0, 8)}`;
  const backupFileName = `${filePrefix}.db`;
  const manifestFileName = `${filePrefix}.manifest.json`;
  const backupPath = path.join(backupDir, backupFileName);
  const manifestPath = path.join(backupDir, manifestFileName);

  try {
    // 1. Snapshot database using SQLite VACUUM INTO
    const escapedPath = escapeSqlStringLiteral(backupPath);
    db.exec(`VACUUM INTO '${escapedPath}';`);
    fs.chmodSync(backupPath, 0o600);

    const stats = fs.statSync(backupPath);

    // 2. Compute SHA-256 Checksum of the snapshot file
    const fileBuffer = fs.readFileSync(backupPath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 3. Open snapshot connection for integrity & foreign-key verification
    const verifyDb = new DatabaseSync(backupPath);
    let integrityCheck = 'unknown';
    let fkViolationsCount = 0;
    let schemaVersion = 0;
    let backupRowCounts: Record<string, number> = {};

    try {
      // 3a. Integrity check
      const integrityRow = verifyDb.prepare('PRAGMA integrity_check;').get() as { integrity_check?: string } | undefined;
      integrityCheck = integrityRow?.integrity_check ?? 'failed';

      // 3b. Foreign key verification
      const fkRows = verifyDb.prepare('PRAGMA foreign_key_check;').all() as unknown[];
      fkViolationsCount = fkRows.length;

      // 3c. Schema user_version
      const versionRow = verifyDb.prepare('PRAGMA user_version;').get() as { user_version?: number } | undefined;
      schemaVersion = versionRow?.user_version ?? 0;

      // 3d. Verify row count preservation
      backupRowCounts = getTableRowCounts(verifyDb);
    } finally {
      verifyDb.close();
    }

    // Fail closed on integrity violation
    if (integrityCheck !== 'ok') {
      throw new BackupError(`Backup integrity check failed: ${integrityCheck}`);
    }

    // Fail closed on foreign key violation
    if (fkViolationsCount > 0) {
      throw new BackupError(`Backup foreign key check failed with ${fkViolationsCount} violations`);
    }

    // Fail closed on row count mismatch
    for (const [tbl, expectedCount] of Object.entries(sourceRowCounts)) {
      const actualCount = backupRowCounts[tbl];
      if (actualCount !== expectedCount) {
        throw new BackupError(
          `Backup row count mismatch for table '${tbl}': expected ${expectedCount}, got ${actualCount}`
        );
      }
    }

    // 4. Generate and write Backup Manifest
    const manifest: BackupManifest = {
      backupId,
      backupFileName,
      manifestFileName,
      timestamp,
      createdAtUnix: Math.floor(Date.now() / 1000),
      sha256,
      sizeBytes: stats.size,
      schemaVersion,
      integrityCheck,
      foreignKeyCheck: fkViolationsCount === 0 ? 'ok' : 'failed',
      rowCounts: backupRowCounts,
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.chmodSync(manifestPath, 0o600);

    // 5. Prune Old Backups and companion manifests
    pruneBackups(backupDir, retainCount);

    logger.info('Database backup and manifest generated successfully', {
      backupId,
      backupPath,
      manifestPath,
      sha256,
      sizeBytes: stats.size,
      integrityCheck,
    });

    return {
      backupPath,
      manifestPath,
      manifest,
      timestamp,
      sizeBytes: stats.size,
    };
  } catch (err: unknown) {
    // Clean up created files on failure
    if (fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        // Ignore
      }
    }
    if (fs.existsSync(manifestPath)) {
      try {
        fs.unlinkSync(manifestPath);
      } catch {
        // Ignore
      }
    }

    if (err instanceof BackupError) {
      throw err;
    }
    throw new BackupError(
      `Failed to create database backup: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Prunes older database backups and their companion manifest files,
 * retaining the most recent `retainCount` snapshots.
 */
export function pruneBackups(backupDir: string, retainCount = 7): string[] {
  if (!fs.existsSync(backupDir)) {
    return [];
  }

  const files = fs
    .readdirSync(backupDir)
    .filter((file) => file.startsWith('gateway-') && file.endsWith('.db'))
    .map((file) => ({
      name: file,
      fullPath: path.join(backupDir, file),
      mtime: fs.statSync(path.join(backupDir, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime); // Newest first

  const removed: string[] = [];
  if (files.length > retainCount) {
    const toRemove = files.slice(retainCount);
    for (const f of toRemove) {
      try {
        fs.unlinkSync(f.fullPath);
        removed.push(f.fullPath);

        // Also remove companion manifest file if present
        const manifestCandidate = f.fullPath.replace(/\.db$/, '.manifest.json');
        if (fs.existsSync(manifestCandidate)) {
          fs.unlinkSync(manifestCandidate);
          removed.push(manifestCandidate);
        }
      } catch (err: unknown) {
        logger.warn('Failed to prune old backup file', {
          file: f.fullPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return removed;
}
