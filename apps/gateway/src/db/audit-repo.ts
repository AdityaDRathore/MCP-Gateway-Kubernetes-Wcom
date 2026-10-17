import { DatabaseSync } from 'node:sqlite';

export type AuditStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'client_disconnected'
  | 'unconfirmed_outcome';

export interface AuditRecord {
  id: string;
  user_id: string | null;
  upstream_slug: string | null;
  tool_name: string;
  arguments_hash: string;
  status: AuditStatus;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
}

export interface CreateAuditStartParams {
  id: string;
  user_id?: string | null;
  upstream_slug?: string | null;
  tool_name: string;
  arguments_hash: string;
  created_at?: number;
}

export interface FinalizeAuditParams {
  status: AuditStatus;
  duration_ms?: number | null;
  error_code?: string | null;
  error_message?: string | null;
}

/**
 * Data access repository for Audit Logs in SQLite.
 */
export class AuditRepository {
  constructor(private db: DatabaseSync) {}

  insertAuditStart(params: CreateAuditStartParams): void {
    const createdAt = params.created_at ?? Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (id, user_id, upstream_slug, tool_name, arguments_hash, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?);
    `);
    stmt.run(
      params.id,
      params.user_id ?? null,
      params.upstream_slug ?? null,
      params.tool_name,
      params.arguments_hash,
      createdAt
    );
  }

  updateAuditFinalize(id: string, params: FinalizeAuditParams): boolean {
    const stmt = this.db.prepare(`
      UPDATE audit_logs
      SET status = ?, duration_ms = ?, error_code = ?, error_message = ?
      WHERE id = ?;
    `);
    const result = stmt.run(
      params.status,
      params.duration_ms ?? null,
      params.error_code ?? null,
      params.error_message ?? null,
      id
    );
    return Number(result.changes) > 0;
  }

  findAuditById(id: string): AuditRecord | null {
    const stmt = this.db.prepare('SELECT * FROM audit_logs WHERE id = ?;');
    const row = stmt.get(id) as AuditRecord | undefined;
    return row ?? null;
  }

  reconcileDanglingRecords(cutoffTimestamp: number): number {
    const stmt = this.db.prepare(`
      UPDATE audit_logs
      SET status = 'unconfirmed_outcome', error_code = 'FINALIZATION_TIMEOUT'
      WHERE status = 'pending' AND created_at < ?;
    `);
    const result = stmt.run(cutoffTimestamp);
    return Number(result.changes);
  }

  pruneOldRecords(cutoffTimestamp: number, batchLimit = 500): number {
    const stmt = this.db.prepare(`
      DELETE FROM audit_logs
      WHERE id IN (
        SELECT id FROM audit_logs
        WHERE created_at < ?
        LIMIT ?
      );
    `);
    const result = stmt.run(cutoffTimestamp, batchLimit);
    return Number(result.changes);
  }

  listAudits(options: {
    limit?: number;
    offset?: number;
    status?: AuditStatus;
    userId?: string;
  } = {}): AuditRecord[] {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    let query = 'SELECT * FROM audit_logs';
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options.userId) {
      conditions.push('user_id = ?');
      params.push(options.userId);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?;';
    params.push(limit, offset);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as unknown as AuditRecord[];
  }
}
