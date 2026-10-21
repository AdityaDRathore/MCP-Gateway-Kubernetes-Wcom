import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { InvitationRepository, UserInvitationRecord } from '../db/invitation-repo.js';
import { UserRepository, UserEntity } from '../db/user-repo.js';
import { SessionService, CreateSessionResult } from './session-service.js';
import { ScryptPasswordService } from './scrypt-password-service.js';
import { DatabaseManager } from '../db/connection.js';
import { logger } from '../logging/logger.js';

export class InvitationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'InvitationError';
  }
}

export interface CreateInvitationOptions {
  role?: 'admin' | 'member';
  invitedBy?: string | null;
}

export interface CreateInvitationResult {
  id: string;
  rawToken: string;
  role: 'admin' | 'member';
  expiresAt: number;
  inviteUrl: string;
}

export interface ValidateInvitationResult {
  valid: boolean;
  role?: 'admin' | 'member';
  expiresAt?: number;
  code?: string;
  message?: string;
}

export interface RedeemInvitationInput {
  token: string;
  username: string;
  password: string;
  meta?: {
    ipAddress?: string;
    userAgent?: string;
  };
}

export interface RedeemInvitationResult {
  user: UserEntity;
  session: CreateSessionResult;
}

export class InvitationService {
  constructor(
    private invitationRepo: InvitationRepository,
    private userRepo: UserRepository,
    private sessionService: SessionService,
    private passwordService: ScryptPasswordService,
    private dbOrManager: DatabaseSync | DatabaseManager
  ) {}

  private getDb(): DatabaseSync {
    if ('getDb' in this.dbOrManager && typeof (this.dbOrManager as any).getDb === 'function') {
      return (this.dbOrManager as DatabaseManager).getDb();
    }
    return this.dbOrManager as DatabaseSync;
  }

  private runTransaction<T>(fn: () => T): T {
    if ('transaction' in this.dbOrManager && typeof (this.dbOrManager as any).transaction === 'function') {
      return (this.dbOrManager as DatabaseManager).transaction(fn);
    }
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
        // Suppress rollback error if already aborted
      }
      throw err;
    }
  }

  /**
   * Hashes a raw invitation token with SHA-256 for verifier storage.
   */
  public hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Generates a single-use invitation token with a 72-hour expiration window.
   * Only stores the SHA-256 verifier in SQLite.
   */
  public createInvitation(options: CreateInvitationOptions = {}): CreateInvitationResult {
    const role = options.role ?? 'member';
    if (role !== 'admin' && role !== 'member') {
      throw new InvitationError('INVALID_ROLE', "Role must be 'admin' or 'member'", 400);
    }

    const entropy = crypto.randomBytes(32).toString('hex');
    const rawToken = `urumi_inv_${entropy}`;
    const tokenHash = this.hashToken(rawToken);
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 72 * 3600; // 72 hours lifetime

    this.invitationRepo.insertInvitation({
      id,
      token_hash: tokenHash,
      role,
      invited_by: options.invitedBy ?? null,
      expires_at: expiresAt,
      created_at: now,
    });

    logger.info('Created user invitation', {
      invitationId: id,
      role,
      invitedBy: options.invitedBy ?? null,
      expiresAt,
    });

    return {
      id,
      rawToken,
      role,
      expiresAt,
      inviteUrl: `/invite/${rawToken}`,
    };
  }

  /**
   * Validates an invitation token without consuming it.
   */
  public validateInvitation(rawToken: string): ValidateInvitationResult {
    if (typeof rawToken !== 'string' || !/^urumi_inv_[a-f0-9]{64}$/.test(rawToken)) {
      return {
        valid: false,
        code: 'INVITATION_INVALID',
        message: 'Invalid invitation token format',
      };
    }

    const tokenHash = this.hashToken(rawToken);
    const inv = this.invitationRepo.findInvitationByTokenHash(tokenHash);
    if (!inv) {
      return {
        valid: false,
        code: 'INVITATION_INVALID',
        message: 'Invitation token not found',
      };
    }

    if (inv.redeemed_at !== null) {
      return {
        valid: false,
        code: 'INVITATION_INVALID',
        message: 'Invitation token has already been redeemed',
      };
    }

    const now = Math.floor(Date.now() / 1000);
    if (inv.expires_at <= now) {
      return {
        valid: false,
        code: 'INVITATION_EXPIRED',
        message: 'Invitation token has expired',
      };
    }

    return {
      valid: true,
      role: inv.role,
      expiresAt: inv.expires_at,
    };
  }

  /**
   * Atomically redeems an invitation token, creating the user and credentials.
   * Invariant: Password hashing (Scrypt) is executed BEFORE entering the SQLite write transaction
   * to prevent lock contention and avoid holding write locks during expensive CPU work.
   */
  public async redeemInvitation(input: RedeemInvitationInput): Promise<RedeemInvitationResult> {
    const { token, username, password, meta } = input;

    // 1. Format validation
    if (typeof token !== 'string' || !/^urumi_inv_[a-f0-9]{64}$/.test(token)) {
      throw new InvitationError('INVITATION_INVALID', 'Invalid invitation token format', 400);
    }

    if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      throw new InvitationError(
        'USERNAME_INVALID',
        'Username must be 3-32 characters (alphanumeric, underscore, dash)',
        400
      );
    }

    if (typeof password !== 'string' || password.length < 10) {
      throw new InvitationError('PASSWORD_TOO_SHORT', 'Password must be at least 10 characters long', 400);
    }

    const tokenHash = this.hashToken(token);

    // 2. Pre-transaction checks (fail fast before Scrypt hashing)
    const inv = this.invitationRepo.findInvitationByTokenHash(tokenHash);
    if (!inv) {
      throw new InvitationError('INVITATION_INVALID', 'Invitation token not found', 400);
    }

    if (inv.redeemed_at !== null) {
      throw new InvitationError('INVITATION_INVALID', 'Invitation token has already been redeemed', 400);
    }

    const now = Math.floor(Date.now() / 1000);
    if (inv.expires_at <= now) {
      throw new InvitationError('INVITATION_EXPIRED', 'Invitation token has expired', 400);
    }

    if (this.userRepo.findUserByUsername(username)) {
      throw new InvitationError('USERNAME_EXISTS', 'Username is already taken', 409);
    }

    // 3. Password Hashing (Outside transaction to preserve condition 2)
    const passwordHash = await this.passwordService.hashPassword(password);

    // 4. Atomic Transaction execution (User + Credentials + Invitation Redemption + Session Creation)
    const userId = crypto.randomUUID();
    let createdUser: UserEntity | null = null;
    let sessionResult: CreateSessionResult | null = null;

    this.runTransaction(() => {
      // Check username uniqueness inside transaction
      if (this.userRepo.findUserByUsername(username)) {
        throw new InvitationError('USERNAME_EXISTS', 'Username is already taken', 409);
      }

      // Check invitation single-use inside transaction
      const currentInv = this.invitationRepo.findInvitationByTokenHash(tokenHash);
      if (
        !currentInv ||
        currentInv.redeemed_at !== null ||
        currentInv.expires_at <= Math.floor(Date.now() / 1000)
      ) {
        throw new InvitationError(
          'INVITATION_INVALID',
          'Invitation token is invalid, expired, or already redeemed',
          400
        );
      }

      // Insert user
      createdUser = this.userRepo.insertUser({
        id: userId,
        username,
        role: currentInv.role,
        is_active: 1,
        created_at: now,
      });

      // Insert credentials
      this.userRepo.setUserCredentials(userId, passwordHash, 'scrypt_v1');

      // Mark redeemed
      const marked = this.invitationRepo.markRedeemed(currentInv.id, userId, now);
      if (!marked) {
        throw new InvitationError('INVITATION_INVALID', 'Invitation was concurrently redeemed', 400);
      }

      // 5. Atomically create active session for the newly registered user inside the transaction
      sessionResult = this.sessionService.createSessionSync(userId, meta);
    });

    if (!createdUser || !sessionResult) {
      throw new InvitationError('INTERNAL_ERROR', 'Failed to complete user registration', 500);
    }

    logger.info('Invitation redeemed successfully', {
      userId,
      username,
      role: (createdUser as UserEntity).role,
    });

    return {
      user: createdUser,
      session: sessionResult,
    };
  }
}
