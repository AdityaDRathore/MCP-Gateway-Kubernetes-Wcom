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
 * Creates an online, non-locking backup of the SQLite database using VACUUM INTO.
 * 
 * Invariants:
 * 1. Safe online copy that accounts for WAL companion files without locking readers.
 * 2. Immediately executes PRAGMA integrity_check on the generated snapshot.
 * 3. Sets strict POSIX permissions 0600 on the snapshot file.
 * 4. Automatically prunes older backups according to retention limit.
 */
export function backupDatabase(
  db: DatabaseSync,
  backupDir: string,
  retainCount = 7
): BackupResult {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `gateway-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFileName);

  try {
    // 1. Snapshot database using SQLite VACUUM INTO
    db.exec(`VACUUM INTO '${backupPath}';`);
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
