import { DatabaseSync } from 'node:sqlite';

export interface UserEntity {
  id: string;
  username: string;
  role: 'admin' | 'member';
  status: 'active' | 'deactivated';
  password_hash: string | null;
  created_at: number;
  updated_at: number | null;
}

export interface CreateUserInput {
  id: string;
  username: string;
  role: 'admin' | 'member';
  status?: 'active' | 'deactivated';
  password_hash?: string | null;
  created_at?: number;
  updated_at?: number | null;
}

export class UserRepository {
  constructor(private db: DatabaseSync) {}

  insertUser(user: CreateUserInput): UserEntity {
    const status = user.status ?? 'active';
    const createdAt = user.created_at ?? Math.floor(Date.now() / 1000);
    const updatedAt = user.updated_at ?? createdAt;
    const passwordHash = user.password_hash ?? null;

    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, role, status, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(user.id, user.username, user.role, status, passwordHash, createdAt, updatedAt);

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      status,
      password_hash: passwordHash,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  findUserById(id: string): UserEntity | null {
    const stmt = this.db.prepare(`
      SELECT id, username, role, status, password_hash, created_at, updated_at
      FROM users
      WHERE id = ?;
    `);
    const row = stmt.get(id) as UserEntity | undefined;
    return row ?? null;
  }

  findUserByUsername(username: string): UserEntity | null {
    const stmt = this.db.prepare(`
      SELECT id, username, role, status, password_hash, created_at, updated_at
      FROM users
      WHERE username = ?;
    `);
    const row = stmt.get(username) as UserEntity | undefined;
    return row ?? null;
  }

  updatePassword(userId: string, passwordHash: string): void {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      UPDATE users
      SET password_hash = ?, updated_at = ?
      WHERE id = ?;
    `);
    stmt.run(passwordHash, now, userId);
  }

  updateStatus(userId: string, status: 'active' | 'deactivated'): void {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      UPDATE users
      SET status = ?, updated_at = ?
      WHERE id = ?;
    `);
    stmt.run(status, now, userId);
  }

  listUsers(): UserEntity[] {
    const stmt = this.db.prepare(`
      SELECT id, username, role, status, password_hash, created_at, updated_at
      FROM users
      ORDER BY created_at ASC;
    `);
    return stmt.all() as unknown as UserEntity[];
  }
}
