import { DatabaseSync } from 'node:sqlite';

export interface BrowserSessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_secret: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: number;
  created_at: number;
  last_activity_at: number;
}

export class SessionRepository {
  constructor(private db: DatabaseSync) {}

  insertSession(session: BrowserSessionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO browser_sessions (id, user_id, token_hash, csrf_secret, ip_address, user_agent, expires_at, created_at, last_activity_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      session.id,
      session.user_id,
      session.token_hash,
      session.csrf_secret,
      session.ip_address,
      session.user_agent,
      session.expires_at,
      session.created_at,
      session.last_activity_at
    );
  }

  findSessionByTokenHash(tokenHash: string): BrowserSessionRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, user_id, token_hash, csrf_secret, ip_address, user_agent, expires_at, created_at, last_activity_at
      FROM browser_sessions
      WHERE token_hash = ?;
    `);
    const row = stmt.get(tokenHash) as BrowserSessionRecord | undefined;
    return row ?? null;
  }

  updateLastActivityAt(id: string, lastActivityAt: number): void {
    const stmt = this.db.prepare(`
      UPDATE browser_sessions
      SET last_activity_at = ?
      WHERE id = ?;
    `);
    stmt.run(lastActivityAt, id);
  }

  deleteSession(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM browser_sessions WHERE id = ?;`);
    stmt.run(id);
  }

  deleteSessionByTokenHash(tokenHash: string): void {
    const stmt = this.db.prepare(`DELETE FROM browser_sessions WHERE token_hash = ?;`);
    stmt.run(tokenHash);
  }

  deleteUserSessions(userId: string): number {
    const stmt = this.db.prepare(`DELETE FROM browser_sessions WHERE user_id = ?;`);
    const result = stmt.run(userId);
    return typeof (result as any)?.changes === 'number' ? (result as any).changes : 0;
  }

  pruneExpiredSessions(now: number): number {
    const stmt = this.db.prepare(`DELETE FROM browser_sessions WHERE expires_at <= ?;`);
    const result = stmt.run(now);
    return typeof (result as any)?.changes === 'number' ? (result as any).changes : 0;
  }
}
