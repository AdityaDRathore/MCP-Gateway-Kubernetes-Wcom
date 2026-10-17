import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { logger } from '../logging/logger.js';

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface BackupResult {
  backupPath: string;
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
 * Creates an online, non-locking backup of the SQLite database using VACUUM INTO.
 * 
 * Invariants:
 * 1. Safe online copy that accounts for WAL companion files without locking readers.
 * 2. SQL path literal is safely escaped against injection/apostrophes.
 * 3. Immediately executes PRAGMA integrity_check on the generated snapshot.
 * 4. Enforces strict POSIX permissions: 0700 on backupDir, 0600 on snapshot files.
 * 5. Automatically prunes older backups according to retention limit.
 */
export function backupDatabase(
  db: DatabaseSync,
  backupDir: string,
  retainCount = 7
): BackupResult {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }
  // Enforce 0700 on existing or newly created backup directory
  try {
    fs.chmodSync(backupDir, 0o700);
  } catch (err: unknown) {
    logger.warn('Could not tighten permissions on backup directory', {
      backupDir,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `gateway-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFileName);

  try {
    // 1. Snapshot database using SQLite VACUUM INTO with safely escaped path
    const escapedPath = escapeSqlStringLiteral(backupPath);
    db.exec(`VACUUM INTO '${escapedPath}';`);

    // Enforce 0600 permissions immediately on the created snapshot
    fs.chmodSync(backupPath, 0o600);

    // 2. Immediate Integrity Verification of Snapshot
    const verifyDb = new DatabaseSync(backupPath);
    let integrityCheck = 'unknown';
    try {
      const integrityRow = verifyDb.prepare('PRAGMA integrity_check;').get() as { integrity_check?: string } | undefined;
      integrityCheck = integrityRow?.integrity_check ?? 'failed';
    } finally {
      verifyDb.close();
    }

    if (integrityCheck !== 'ok') {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        // Ignore unlink failure
      }
      throw new BackupError(`Backup integrity check failed: ${integrityCheck}`);
    }

    const stats = fs.statSync(backupPath);

    // 3. Prune Old Backups
    pruneBackups(backupDir, retainCount);

    logger.info('Database backup completed successfully', {
      backupPath,
      sizeBytes: stats.size,
      integrityCheck,
    });

    return {
      backupPath,
      timestamp,
      sizeBytes: stats.size,
    };
  } catch (err: unknown) {
    // If backup file exists on failure, attempt cleanup
    if (fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
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
 * Prunes older database backups, retaining the most recent `retainCount` snapshots.
 */
export function pruneBackups(backupDir: string, retainCount = 7): string[] {
  if (!fs.existsSync(backupDir)) {
    return [];
  }

  const files = fs.readdirSync(backupDir)
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
