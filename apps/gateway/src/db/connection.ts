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
 * Manages SQLite database connection lifecycle using Node.js core node:sqlite.
 * 
 * Invariants:
 * 1. Enforces WAL mode, foreign keys, synchronous normal, and 5000ms busy timeout.
 * 2. Checks database integrity at startup; fails closed if corrupt (does not delete/reset existing database).
 * 3. Graceful connection close.
 * 4. Decoupled health/readiness check.
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
      }

      this.db = new DatabaseSync(this.dbPath);
    } catch (err: unknown) {
      throw new DatabaseInitializationError(
        `Failed to open SQLite database at '${this.dbPath}': ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Configure required PRAGMAs
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
      this.db.exec('PRAGMA busy_timeout = 5000;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    } catch (err: unknown) {
      this.close();
      throw new DatabaseInitializationError(
        `Failed to configure SQLite PRAGMAs: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Integrity check on startup
    const integrityRow = this.db.prepare('PRAGMA integrity_check;').get() as { integrity_check?: string } | undefined;
    if (integrityRow?.integrity_check !== 'ok') {
      const checkResult = integrityRow?.integrity_check ?? 'unknown error';
      this.close();
      throw new DatabaseCorruptionError(
        `Database integrity check failed for '${this.dbPath}': ${checkResult}. Startup aborted without modifying database file.`
      );
    }

    // Run migrations if enabled
    if (this.autoMigrate) {
      try {
        runMigrations(this.db, MIGRATIONS);
      } catch (err) {
        this.close();
        throw err;
      }
    }

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
   * Closes the database connection cleanly.
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch (err: unknown) {
        logger.warn('Error closing SQLite database connection', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.db = null;
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
