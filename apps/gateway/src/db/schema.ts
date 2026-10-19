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

export const migration002: Migration = {
  version: 2,
  name: '002_upstreams_registry',
  sql: `
    CREATE TABLE IF NOT EXISTS upstreams (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL DEFAULT 10000 CHECK(timeout_ms BETWEEN 500 AND 30000),
      is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1)),
      status TEXT NOT NULL CHECK(status IN ('provisioning', 'active', 'disabled', 'deleting', 'cleanup_required', 'failed')),
      secret_ref_name TEXT,
      secret_ref_key TEXT,
      cleanup_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_upstreams_slug ON upstreams(slug);
  `,
};

export const migration003: Migration = {
  version: 3,
  name: '003_dashboard_auth_and_sessions',
  sql: `
    ALTER TABLE users ADD COLUMN password_hash TEXT;
    ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deactivated'));
    ALTER TABLE users ADD COLUMN updated_at INTEGER;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      user_agent TEXT,
      ip_address TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      created_by TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      redeemed_at INTEGER,
      redeemed_by TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON invitations(token_hash);
  `,
};

export const MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
];

