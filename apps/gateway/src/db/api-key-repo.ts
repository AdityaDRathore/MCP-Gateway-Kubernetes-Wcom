import { DatabaseSync } from 'node:sqlite';

export interface UserRecord {
  id: string;
  username: string;
  role: 'admin' | 'member';
  created_at: number;
}

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
  last_used_at: number | null;
}

export interface ApiKeyWithUser {
  key_id: string;
  user_id: string;
  username: string;
  role: 'admin' | 'member';
  key_hash: string;
  key_prefix: string;
  name: string;
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
}

/**
 * Data access repository for Users and API Keys in SQLite.
 */
export class ApiKeyRepository {
  constructor(private db: DatabaseSync) {}

  insertUser(user: UserRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, role, created_at)
      VALUES (?, ?, ?, ?);
    `);
    stmt.run(user.id, user.username, user.role, user.created_at);
  }

  findUserById(id: string): UserRecord | null {
    const stmt = this.db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?;');
    const row = stmt.get(id) as UserRecord | undefined;
    return row ?? null;
  }

  findUserByUsername(username: string): UserRecord | null {
    const stmt = this.db.prepare('SELECT id, username, role, created_at FROM users WHERE username = ?;');
    const row = stmt.get(username) as UserRecord | undefined;
    return row ?? null;
  }

  hasAdminUser(): boolean {
    const stmt = this.db.prepare("SELECT 1 as has_admin FROM users WHERE role = 'admin' LIMIT 1;");
    const row = stmt.get() as { has_admin?: number } | undefined;
    return row?.has_admin === 1;
  }

  insertApiKey(apiKey: ApiKeyRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, expires_at, revoked_at, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      apiKey.id,
      apiKey.user_id,
      apiKey.key_hash,
      apiKey.key_prefix,
      apiKey.name,
      apiKey.expires_at,
      apiKey.revoked_at,
      apiKey.created_at,
      apiKey.last_used_at
    );
  }

  findApiKeyByHash(keyHash: string): ApiKeyWithUser | null {
    const stmt = this.db.prepare(`
      SELECT 
        k.id as key_id,
        k.user_id,
        u.username,
        u.role,
        k.key_hash,
        k.key_prefix,
        k.name,
        k.expires_at,
        k.revoked_at,
        k.last_used_at
      FROM api_keys k
      JOIN users u ON k.user_id = u.id
      WHERE k.key_hash = ?;
    `);
    const row = stmt.get(keyHash) as ApiKeyWithUser | undefined;
    return row ?? null;
  }

  findApiKeyById(id: string): ApiKeyRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, user_id, key_hash, key_prefix, name, expires_at, revoked_at, created_at, last_used_at
      FROM api_keys
      WHERE id = ?;
    `);
    const row = stmt.get(id) as ApiKeyRecord | undefined;
    return row ?? null;
  }

  revokeApiKey(id: string, revokedAt: number = Math.floor(Date.now() / 1000)): boolean {
    const stmt = this.db.prepare(`
      UPDATE api_keys 
      SET revoked_at = ? 
      WHERE id = ? AND revoked_at IS NULL;
    `);
    const result = stmt.run(revokedAt, id);
    return Number(result.changes) > 0;
  }

  updateApiKeyLastUsed(id: string, lastUsedAt: number = Math.floor(Date.now() / 1000)): void {
    const stmt = this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?;');
    stmt.run(lastUsedAt, id);
  }

  listApiKeysByUser(userId: string): ApiKeyRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, key_hash, key_prefix, name, expires_at, revoked_at, created_at, last_used_at
      FROM api_keys
      WHERE user_id = ?
      ORDER BY created_at DESC;
    `);
    return stmt.all(userId) as unknown as ApiKeyRecord[];
  }
}
