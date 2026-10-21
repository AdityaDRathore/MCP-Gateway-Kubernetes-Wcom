import { DatabaseSync } from 'node:sqlite';

export interface UserInvitationRecord {
  id: string;
  token_hash: string;
  role: 'admin' | 'member';
  invited_by: string | null;
  expires_at: number;
  redeemed_at: number | null;
  redeemed_by_user_id: string | null;
  created_at: number;
}

export interface CreateInvitationInput {
  id: string;
  token_hash: string;
  role: 'admin' | 'member';
  invited_by?: string | null;
  expires_at: number;
  created_at?: number;
}

export class InvitationRepository {
  constructor(private db: DatabaseSync) {}

  insertInvitation(invitation: CreateInvitationInput): void {
    const createdAt = invitation.created_at ?? Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      INSERT INTO user_invitations (id, token_hash, role, invited_by, expires_at, redeemed_at, redeemed_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?);
    `);
    stmt.run(
      invitation.id,
      invitation.token_hash,
      invitation.role,
      invitation.invited_by ?? null,
      invitation.expires_at,
      createdAt
    );
  }

  findInvitationByTokenHash(tokenHash: string): UserInvitationRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, token_hash, role, invited_by, expires_at, redeemed_at, redeemed_by_user_id, created_at
      FROM user_invitations
      WHERE token_hash = ?;
    `);
    const row = stmt.get(tokenHash) as UserInvitationRecord | undefined;
    return row ?? null;
  }

  findInvitationById(id: string): UserInvitationRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, token_hash, role, invited_by, expires_at, redeemed_at, redeemed_by_user_id, created_at
      FROM user_invitations
      WHERE id = ?;
    `);
    const row = stmt.get(id) as UserInvitationRecord | undefined;
    return row ?? null;
  }

  markRedeemed(id: string, userId: string, redeemedAt: number = Math.floor(Date.now() / 1000)): boolean {
    const stmt = this.db.prepare(`
      UPDATE user_invitations
      SET redeemed_at = ?, redeemed_by_user_id = ?
      WHERE id = ? AND redeemed_at IS NULL;
    `);
    const result = stmt.run(redeemedAt, userId, id);
    return Number(result.changes) > 0;
  }

  countPendingInvitations(now: number = Math.floor(Date.now() / 1000)): number {
    const stmt = this.db.prepare(`
      SELECT count(*) as count
      FROM user_invitations
      WHERE redeemed_at IS NULL AND expires_at > ?;
    `);
    const row = stmt.get(now) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  deleteInvitation(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM user_invitations WHERE id = ?;`);
    stmt.run(id);
  }
}
