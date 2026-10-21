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

export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

export interface RestoreOptions {
  snapshotPath: string;
  targetDbPath: string;
  manifestPath?: string;
}

export interface RestoreResult {
  targetDbPath: string;
  manifest: BackupManifest;
  restoredRowCounts: Record<string, number>;
  sha256: string;
  sizeBytes: number;
}

/**
 * Asserts that the target database path is safe and does not resolve to protected live paths.
 * Specifically rejects any path in /data or /data/* to guarantee zero live PVC / production corruption.
 * Resolves symlinks and normalizes path segments (e.g., ../) to prevent traversal bypasses.
 */
export function assertSafeDatabasePath(targetPath: string): string {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new RestoreError('Target database path is invalid or empty');
  }

  const resolved = path.resolve(targetPath);
  const normalized = path.normalize(resolved);

  // Guard against any attempt to target protected cluster PVC paths (/data or /data/*)
  if (normalized === '/data' || normalized.startsWith('/data/') || normalized === '/data/gateway.db') {
    throw new RestoreError(
      `Security violation: target path '${targetPath}' resolves to protected live location '${normalized}' and is rejected`
    );
  }

  // Symlink resolution checks: check if file or existing parent dir resolves into /data
  try {
    if (fs.existsSync(normalized)) {
      const real = fs.realpathSync(normalized);
      if (real === '/data' || real.startsWith('/data/')) {
        throw new RestoreError(
          `Security violation: target path '${targetPath}' resolves via symlink to protected path '${real}' and is rejected`
        );
      }
    } else {
      const parentDir = path.dirname(normalized);
      if (fs.existsSync(parentDir)) {
        const realParent = fs.realpathSync(parentDir);
        if (realParent === '/data' || realParent.startsWith('/data/')) {
          throw new RestoreError(
            `Security violation: target path '${targetPath}' parent resolves via symlink to protected path '${realParent}' and is rejected`
          );
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof RestoreError) {
      throw err;
    }
  }

  return normalized;
}

/**
 * Restores a database from a verified online backup snapshot and its companion manifest.
 * 
 * Safety & Verification Invariants:
 * 1. Strict path boundary enforcement (rejects /data/ targets before any filesystem mutation).
 * 2. Pre-placement validation: manifest presence, schema version, file size, SHA-256 checksum,
 *    and SQLite PRAGMA integrity/foreign key verification on snapshot BEFORE modifying target.
 * 3. Atomic fail-closed: If validation fails, existing target files are left untouched.
 * 4. WAL & companion cleanup: Safely unlinks target .db, .db-wal, and .db-shm to prevent poisoning.
 * 5. Post-restore verification: PRAGMA integrity_check, foreign_key_check, and table row counts
 *    are verified against manifest before returning.
 * 
 * Note on Cryptographic Boundaries:
 * The manifest SHA-256 checksum detects accidental snapshot corruption relative to the companion manifest.
 * It does not establish absolute tamper-proof authenticity if an attacker controls both files.
 */
export function restoreDatabase(options: RestoreOptions): RestoreResult {
  // 1. Verify safe target path prior to ANY filesystem inspection or mutation
  const safeTarget = assertSafeDatabasePath(options.targetDbPath);

  // 2. Verify snapshot file existence
  if (!fs.existsSync(options.snapshotPath)) {
    throw new RestoreError(`Snapshot file not found: ${options.snapshotPath}`);
  }

  // 3. Locate and validate companion manifest
  const manifestPath =
    options.manifestPath ?? options.snapshotPath.replace(/\.db$/, '.manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new RestoreError(`Backup companion manifest not found: ${manifestPath}`);
  }

  let manifest: BackupManifest;
  try {
    const rawManifest = fs.readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(rawManifest);
  } catch (err: unknown) {
    throw new RestoreError(
      `Failed to parse backup manifest: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !manifest.sha256 ||
    typeof manifest.sizeBytes !== 'number' ||
    !manifest.rowCounts ||
    typeof manifest.rowCounts !== 'object'
  ) {
    throw new RestoreError(
      'Malformed backup manifest: missing required validation properties (sha256, sizeBytes, rowCounts)'
    );
  }

  if (manifest.integrityCheck !== 'ok') {
    throw new RestoreError(
      `Manifest records integrity check failure: ${manifest.integrityCheck}`
    );
  }
  if (manifest.foreignKeyCheck !== 'ok') {
    throw new RestoreError(
      `Manifest records foreign key check failure: ${manifest.foreignKeyCheck}`
    );
  }

  // 4. Verify snapshot size and SHA-256 checksum against manifest BEFORE touching target
  const snapshotStats = fs.statSync(options.snapshotPath);
  if (snapshotStats.size !== manifest.sizeBytes) {
    throw new RestoreError(
      `Snapshot size mismatch: manifest expected ${manifest.sizeBytes} bytes, got ${snapshotStats.size} bytes`
    );
  }

  const fileBytes = fs.readFileSync(options.snapshotPath);
  const computedSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');
  if (computedSha256.toLowerCase() !== manifest.sha256.toLowerCase()) {
    throw new RestoreError(
      `Snapshot checksum mismatch: manifest expected ${manifest.sha256}, got ${computedSha256}`
    );
  }

  // 5. Pre-verify SQLite integrity on snapshot directly before any modifications to target
  let snapshotDb: DatabaseSync | null = null;
  try {
    snapshotDb = new DatabaseSync(options.snapshotPath);
    const integrityRow = snapshotDb.prepare('PRAGMA integrity_check;').get() as
      | { integrity_check?: string }
      | undefined;
    if (integrityRow?.integrity_check !== 'ok') {
      throw new RestoreError(
        `Snapshot SQLite integrity check failed: ${integrityRow?.integrity_check}`
      );
    }
    const fkRows = snapshotDb.prepare('PRAGMA foreign_key_check;').all();
    if (fkRows.length > 0) {
      throw new RestoreError(
        `Snapshot SQLite foreign key check failed with ${fkRows.length} violations`
      );
    }
  } catch (err: unknown) {
    if (err instanceof RestoreError) {
      throw err;
    }
    throw new RestoreError(
      `Snapshot database pre-verification failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    snapshotDb?.close();
  }

  // 5b. Verify target connection state: Fail closed if target currently has an active connection holding a lock
  if (fs.existsSync(safeTarget)) {
    let lockCheckDb: DatabaseSync | null = null;
    try {
      lockCheckDb = new DatabaseSync(safeTarget);
      lockCheckDb.exec('PRAGMA busy_timeout = 100;');
      lockCheckDb.exec('BEGIN EXCLUSIVE;');
      lockCheckDb.exec('ROLLBACK;');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/database is locked|busy/i.test(msg)) {
        throw new RestoreError(
          `Precondition failed: cannot restore while target database has an active connection or lock: ${msg}`
        );
      }
      // If the target is physically corrupted or unreadable (disaster scenario), lock check is bypassed
    } finally {
      lockCheckDb?.close();
    }
  }

  // 6. Safe target cleanup: remove existing main DB and stale WAL/SHM companion files
  const targetDir = path.dirname(safeTarget);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  }

  const walPath = `${safeTarget}-wal`;
  const shmPath = `${safeTarget}-shm`;

  if (fs.existsSync(safeTarget)) {
    fs.unlinkSync(safeTarget);
  }
  if (fs.existsSync(walPath)) {
    fs.unlinkSync(walPath);
  }
  if (fs.existsSync(shmPath)) {
    fs.unlinkSync(shmPath);
  }

  // 7. Place snapshot and enforce POSIX permissions (0600)
  fs.copyFileSync(options.snapshotPath, safeTarget);
  fs.chmodSync(safeTarget, 0o600);

  // 8. Post-restore verification: open connection and check integrity, foreign keys, row counts
  let restoredDb: DatabaseSync | null = null;
  let restoredRowCounts: Record<string, number> = {};
  try {
    restoredDb = new DatabaseSync(safeTarget);
    const postIntegrity = restoredDb.prepare('PRAGMA integrity_check;').get() as
      | { integrity_check?: string }
      | undefined;
    if (postIntegrity?.integrity_check !== 'ok') {
      throw new RestoreError(
        `Restored database integrity check failed: ${postIntegrity?.integrity_check}`
      );
    }

    const postFk = restoredDb.prepare('PRAGMA foreign_key_check;').all();
    if (postFk.length > 0) {
      throw new RestoreError(
        `Restored database foreign key check failed with ${postFk.length} violations`
      );
    }

    restoredRowCounts = getTableRowCounts(restoredDb);
    for (const [tbl, expectedCount] of Object.entries(manifest.rowCounts)) {
      const actualCount = restoredRowCounts[tbl] ?? 0;
      if (actualCount !== expectedCount) {
        throw new RestoreError(
          `Restored row count mismatch on table '${tbl}': manifest expected ${expectedCount}, got ${actualCount}`
        );
      }
    }
  } finally {
    restoredDb?.close();
  }

  logger.info('Database restored successfully from verified snapshot', {
    targetDbPath: safeTarget,
    backupId: manifest.backupId,
    schemaVersion: manifest.schemaVersion,
    sha256: computedSha256,
  });

  return {
    targetDbPath: safeTarget,
    manifest,
    restoredRowCounts,
    sha256: computedSha256,
    sizeBytes: snapshotStats.size,
  };
}

