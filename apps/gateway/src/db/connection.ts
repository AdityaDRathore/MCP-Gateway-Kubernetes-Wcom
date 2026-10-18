import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.js';
import { MIGRATIONS } from './schema.js';
import { logger } from '../logging/logger.js';

export class DatabaseInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseInitializationError';
  }
}

export class DatabaseCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseCorruptionError';
  }
}

export interface DatabaseManagerOptions {
  dbPath: string;
  autoMigrate?: boolean;
}

/**
 * Enforces strict POSIX file permissions:
 * - Parent directory: 0700 (drwx------)
 * - Database file: 0600 (-rw-------)
 * - Companion WAL/SHM files: 0600 (-rw-------)
 */
export function enforceDatabasePermissions(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }

  // Enforce directory 0700
  const dir = path.dirname(dbPath);
  if (fs.existsSync(dir)) {
    try {
      fs.chmodSync(dir, 0o700);
      const stat = fs.statSync(dir);
      const modeOctal = (stat.mode & 0o777).toString(8);
      logger.info('Database directory POSIX permissions verified', { dir, mode: modeOctal, uid: stat.uid, gid: stat.gid });
    } catch (err: unknown) {
      logger.warn('Could not tighten permissions on database directory', {
        dir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Enforce primary db file 0600
  if (fs.existsSync(dbPath)) {
    try {
      fs.chmodSync(dbPath, 0o600);
      const stat = fs.statSync(dbPath);
      const modeOctal = (stat.mode & 0o777).toString(8);
      logger.info('Database file POSIX permissions verified', { dbPath, mode: modeOctal, uid: stat.uid, gid: stat.gid });
    } catch (err: unknown) {
      logger.warn('Could not tighten permissions on database file', {
        dbPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Enforce companion WAL and SHM files 0600 if present
  for (const companion of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(companion)) {
      try {
        fs.chmodSync(companion, 0o600);
        const stat = fs.statSync(companion);
        const modeOctal = (stat.mode & 0o777).toString(8);
        logger.info('Companion file POSIX permissions verified', { file: companion, mode: modeOctal, uid: stat.uid, gid: stat.gid });
      } catch {
        // Ignore if temporary locked
      }
    }
  }
}

/**
 * Manages SQLite database connection lifecycle using Node.js core node:sqlite.
 * 
 * Invariants:
 * 1. Enforces WAL mode, foreign keys, synchronous normal, and 5000ms busy timeout.
 * 2. Verifies effective journal mode returned by SQLite.
 * 3. Enforces strict POSIX permissions (0700 dir, 0600 db files).
 * 4. Checks database integrity at startup; fails closed if corrupt (does not delete/reset existing database).
 * 5. Checkpoints WAL on close and propagates errors to lifecycle management.
 * 6. Decoupled health/readiness check.
 */
export class DatabaseManager {
  private db: DatabaseSync | null = null;
  private dbPath: string;
  private autoMigrate: boolean;

  constructor(options: DatabaseManagerOptions) {
    this.dbPath = options.dbPath;
    this.autoMigrate = options.autoMigrate ?? true;
  }

  /**
   * Initializes the database connection and runs pending migrations.
   */
  initialize(): void {
    if (this.db) {
      return;
    }

    try {
      if (this.dbPath !== ':memory:') {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        // Tighten existing directory permissions to 0700 if permitted (e.g. non-mountpoint)
        try {
          fs.chmodSync(dir, 0o700);
        } catch (err: unknown) {
          logger.warn('Could not tighten permissions on database directory', {
            dir,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.db = new DatabaseSync(this.dbPath);

      // Enforce 0600 file permissions on database file if permitted
      if (this.dbPath !== ':memory:' && fs.existsSync(this.dbPath)) {
        try {
          fs.chmodSync(this.dbPath, 0o600);
        } catch (err: unknown) {
          logger.warn('Could not tighten permissions on database file', {
            dbPath: this.dbPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err: unknown) {
      throw new DatabaseInitializationError(
        `Failed to open SQLite database at '${this.dbPath}': ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Configure and verify required PRAGMAs
    try {
      // 1. Verify and enforce WAL mode
      const journalRow = this.db.prepare('PRAGMA journal_mode = WAL;').get() as { journal_mode?: string } | undefined;
      const effectiveMode = journalRow?.journal_mode?.toLowerCase();
      if (this.dbPath !== ':memory:' && effectiveMode !== 'wal') {
        throw new DatabaseInitializationError(
          `Failed to enable SQLite WAL mode on '${this.dbPath}': effective journal_mode is '${effectiveMode}' instead of 'wal'.`
        );
      }

      // 2. Foreign Keys
      this.db.exec('PRAGMA foreign_keys = ON;');
      const fkRow = this.db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys?: number } | undefined;
      if (fkRow?.foreign_keys !== 1) {
        throw new DatabaseInitializationError('Failed to enable SQLite foreign_keys constraint.');
      }

      // 3. Busy timeout
      this.db.exec('PRAGMA busy_timeout = 5000;');

      // 4. Synchronous NORMAL
      this.db.exec('PRAGMA synchronous = NORMAL;');

      // Re-enforce permissions on companion files generated by WAL initialization
      enforceDatabasePermissions(this.dbPath);
    } catch (err: unknown) {
      try {
        this.close();
      } catch {
        // Suppress secondary close error on init failure
      }
      if (err instanceof DatabaseInitializationError) {
        throw err;
      }
      throw new DatabaseInitializationError(
        `Failed to configure SQLite PRAGMAs: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Integrity check on startup
    const integrityRow = this.db.prepare('PRAGMA integrity_check;').get() as { integrity_check?: string } | undefined;
    if (integrityRow?.integrity_check !== 'ok') {
      const checkResult = integrityRow?.integrity_check ?? 'unknown error';
      try {
        this.close();
      } catch {
        // Suppress secondary close error
      }
      throw new DatabaseCorruptionError(
        `Database integrity check failed for '${this.dbPath}': ${checkResult}. Startup aborted without modifying database file.`
      );
    }

    // Run migrations if enabled
    if (this.autoMigrate) {
      try {
        runMigrations(this.db, MIGRATIONS);
      } catch (err) {
        try {
          this.close();
        } catch {
          // Suppress secondary close error
        }
        throw err;
      }
    }

    // Verify and enforce strict POSIX permissions on database and directory
    enforceDatabasePermissions(this.dbPath);

    logger.info('SQLite database initialized successfully', {
      dbPath: this.dbPath,
      isMemory: this.dbPath === ':memory:',
    });
  }

  /**
   * Returns the underlying DatabaseSync instance.
   */
  getDb(): DatabaseSync {
    if (!this.db) {
      throw new Error('Database is not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Evaluates local database health for readiness probes.
   */
  isHealthy(): boolean {
    if (!this.db) {
      return false;
    }
    try {
      const result = this.db.prepare('SELECT 1 as healthy;').get() as { healthy?: number } | undefined;
      return result?.healthy === 1;
    } catch {
      return false;
    }
  }

  /**
   * Executes a function inside an immediate transaction.
   */
  transaction<T>(fn: () => T): T {
    const db = this.getDb();
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const result = fn();
      db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Ignore rollback failure if already aborted
      }
      throw err;
    }
  }

  /**
   * Checkpoints WAL frames and closes the database connection cleanly.
   * Propagates errors to caller so failed checkpoints/closes are observable to shutdown handling.
   */
  close(): void {
    if (this.db) {
      const dbToClose = this.db;
      this.db = null;
      try {
        // Checkpoint pending WAL frames before closing
        dbToClose.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        dbToClose.close();
      } catch (err: unknown) {
        logger.error('Error during SQLite database close/checkpoint', {
          dbPath: this.dbPath,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  getDbPath(): string {
    return this.dbPath;
  }
}
