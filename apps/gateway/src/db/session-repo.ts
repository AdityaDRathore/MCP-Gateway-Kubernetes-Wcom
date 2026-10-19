import { DatabaseSync } from 'node:sqlite';

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token: string;
  created_at: number;
  expires_at: number;
  last_active_at: number;
  user_agent: string | null;
  ip_address: string | null;
}

export class SessionRepository {
  constructor(private db: DatabaseSync) {}

  insertSession(session: SessionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, last_active_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      session.id,
      session.user_id,
      session.token_hash,
      session.csrf_token,
      session.created_at,
      session.expires_at,
      session.last_active_at,
      session.user_agent,
      session.ip_address
    );
  }

  findSessionByTokenHash(tokenHash: string): SessionRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, user_id, token_hash, csrf_token, created_at, expires_at, last_active_at, user_agent, ip_address
      FROM sessions
      WHERE token_hash = ?;
    `);
    const row = stmt.get(tokenHash) as SessionRecord | undefined;
    return row ?? null;
  }

  updateLastActiveAt(id: string, lastActiveAt: number): void {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET last_active_at = ?
      WHERE id = ?;
    `);
    stmt.run(lastActiveAt, id);
  }

  deleteSession(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM sessions WHERE id = ?;`);
    stmt.run(id);
  }

  deleteSessionByTokenHash(tokenHash: string): void {
    const stmt = this.db.prepare(`DELETE FROM sessions WHERE token_hash = ?;`);
    stmt.run(tokenHash);
  }

  deleteUserSessions(userId: string): number {
    const stmt = this.db.prepare(`DELETE FROM sessions WHERE user_id = ?;`);
    const result = stmt.run(userId);
    return typeof (result as any)?.changes === 'number' ? (result as any).changes : 0;
  }

  pruneExpiredSessions(now: number): number {
    const stmt = this.db.prepare(`DELETE FROM sessions WHERE expires_at <= ?;`);
    const result = stmt.run(now);
    return typeof (result as any)?.changes === 'number' ? (result as any).changes : 0;
  }
}
