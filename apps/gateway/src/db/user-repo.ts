import { DatabaseSync } from 'node:sqlite';

export interface UserEntity {
  id: string;
  username: string;
  role: 'admin' | 'member';
  is_active: number; // 1 = active, 0 = deactivated
  created_at: number;
}

export interface UserCredentialsEntity {
  user_id: string;
  password_hash: string;
  algorithm: string;
  created_at: number;
  updated_at: number;
}

export interface CreateUserInput {
  id: string;
  username: string;
  role: 'admin' | 'member';
  is_active?: number;
  created_at?: number;
}

export class UserRepository {
  constructor(private db: DatabaseSync) {}

  insertUser(user: CreateUserInput): UserEntity {
    const isActive = user.is_active ?? 1;
    const createdAt = user.created_at ?? Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, role, is_active, created_at)
      VALUES (?, ?, ?, ?, ?);
    `);
    stmt.run(user.id, user.username, user.role, isActive, createdAt);

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      is_active: isActive,
      created_at: createdAt,
    };
  }

  findUserById(id: string): UserEntity | null {
    const stmt = this.db.prepare(`
      SELECT id, username, role, is_active, created_at
      FROM users
      WHERE id = ?;
    `);
    const row = stmt.get(id) as UserEntity | undefined;
    return row ?? null;
  }

  findUserByUsername(username: string): UserEntity | null {
    const stmt = this.db.prepare(`
      SELECT id, username, role, is_active, created_at
      FROM users
      WHERE username = ?;
    `);
    const row = stmt.get(username) as UserEntity | undefined;
    return row ?? null;
  }

  getUserCredentials(userId: string): UserCredentialsEntity | null {
    const stmt = this.db.prepare(`
      SELECT user_id, password_hash, algorithm, created_at, updated_at
      FROM user_credentials
      WHERE user_id = ?;
    `);
    const row = stmt.get(userId) as UserCredentialsEntity | undefined;
    return row ?? null;
  }

  setUserCredentials(userId: string, passwordHash: string, algorithm = 'scrypt_v1'): void {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      INSERT INTO user_credentials (user_id, password_hash, algorithm, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        password_hash = excluded.password_hash,
        algorithm = excluded.algorithm,
        updated_at = excluded.updated_at;
    `);
    stmt.run(userId, passwordHash, algorithm, now, now);
  }

  updateActiveStatus(userId: string, isActive: number): void {
    const stmt = this.db.prepare(`
      UPDATE users
      SET is_active = ?
      WHERE id = ?;
    `);
    stmt.run(isActive, userId);
  }

  updateUserRole(userId: string, role: 'admin' | 'member'): void {
    const stmt = this.db.prepare(`
      UPDATE users
      SET role = ?
      WHERE id = ?;
    `);
    stmt.run(role, userId);
  }

  countActiveAdmins(): number {
    const stmt = this.db.prepare(`
      SELECT count(*) as count
      FROM users
      WHERE role = 'admin' AND is_active = 1;
    `);
    const row = stmt.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  listUsers(): UserEntity[] {
    const stmt = this.db.prepare(`
      SELECT id, username, role, is_active, created_at
      FROM users
      ORDER BY created_at ASC;
    `);
    return stmt.all() as unknown as UserEntity[];
  }

  listUsersWithKeyCounts(now: number = Math.floor(Date.now() / 1000)): MemberWithKeyCount[] {
    const stmt = this.db.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.role, 
        u.is_active, 
        u.created_at,
        COUNT(k.id) as active_key_count
      FROM users u
      LEFT JOIN api_keys k ON u.id = k.user_id AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > ?)
      GROUP BY u.id, u.username, u.role, u.is_active, u.created_at
      ORDER BY u.created_at ASC;
    `);
    const rows = stmt.all(now) as unknown as MemberWithKeyCount[];
    return rows;
  }
}

export interface MemberWithKeyCount {
  id: string;
  username: string;
  role: 'admin' | 'member';
  is_active: number;
  created_at: number;
  active_key_count: number;
}
