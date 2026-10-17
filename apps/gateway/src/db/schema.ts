export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Migration 001: Initial Core Schema for Urumi Team MCP Gateway.
 * 
 * Enforces:
 * - Strict single-writer SQLite schema
 * - Verifier-only API key persistence (no plaintext tokens)
 * - 6-state audit logging lifecycle
 * - Referential integrity with foreign keys enabled
 */
export const migration001: Migration = {
  version: 1,
  name: '001_initial_core_schema',
  sql: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);


    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      upstream_slug TEXT,
      tool_name TEXT NOT NULL,
      arguments_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed', 'timeout', 'client_disconnected', 'unconfirmed_outcome')),
      duration_ms INTEGER,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_status_created ON audit_logs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `,
};

export const MIGRATIONS: Migration[] = [
  migration001,
];
