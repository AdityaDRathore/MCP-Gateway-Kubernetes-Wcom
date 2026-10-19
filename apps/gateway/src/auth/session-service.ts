import crypto from 'node:crypto';
import { SessionRepository, BrowserSessionRecord } from '../db/session-repo.js';
import { UserRepository, UserEntity } from '../db/user-repo.js';

export const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes sliding window
export const ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours absolute maximum
export const SESSION_COOKIE_NAME = 'urumi_session';

export interface CreateSessionResult {
  session: BrowserSessionRecord;
  rawToken: string;
  csrfToken: string;
}

export interface AuthenticatedSession {
  session: BrowserSessionRecord;
  user: UserEntity;
}

export interface SessionServiceOptions {
  idleTimeoutMs?: number;
  absoluteLifetimeMs?: number;
}

export class SessionService {
  private readonly idleTimeoutMs: number;
  private readonly absoluteLifetimeMs: number;

  constructor(
    private sessionRepo: SessionRepository,
    private userRepo: UserRepository,
    options: SessionServiceOptions = {}
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.absoluteLifetimeMs = options.absoluteLifetimeMs ?? ABSOLUTE_LIFETIME_MS;
  }

  /**
   * Hashes a raw session token using SHA-256 for persistent verifier storage.
   */
  public hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Creates a new authenticated browser session for an active user.
   */
  public async createSession(
    userId: string,
    meta: { userAgent?: string; ipAddress?: string } = {}
  ): Promise<CreateSessionResult> {
    const user = this.userRepo.findUserById(userId);
    if (!user) {
      throw new Error(`Cannot create session: User '${userId}' does not exist`);
    }
    if (user.is_active !== 1) {
      throw new Error(`Cannot create session: User '${userId}' is deactivated`);
    }

    const sessionId = crypto.randomUUID();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const csrfSecret = crypto.randomBytes(32).toString('hex');

    const now = Date.now();
    const expiresAt = now + this.absoluteLifetimeMs;

    const session: BrowserSessionRecord = {
      id: sessionId,
      user_id: userId,
      token_hash: tokenHash,
      csrf_secret: csrfSecret,
      ip_address: meta.ipAddress ?? null,
      user_agent: meta.userAgent ?? null,
      expires_at: expiresAt,
      created_at: now,
      last_activity_at: now,
    };

    this.sessionRepo.insertSession(session);

    return {
      session,
      rawToken,
      csrfToken: csrfSecret,
    };
  }

  /**
   * Validates a raw session token against the persistent verifier store.
   */
  public async validateSession(rawToken: string): Promise<AuthenticatedSession | null> {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      return null;
    }

    const tokenHash = this.hashToken(rawToken);
    const session = this.sessionRepo.findSessionByTokenHash(tokenHash);
    if (!session) {
      return null;
    }

    const now = Date.now();

    // Check absolute lifetime
    if (now >= session.expires_at) {
      this.sessionRepo.deleteSession(session.id);
      return null;
    }

    // Check sliding idle timeout
    if (now - session.last_activity_at > this.idleTimeoutMs) {
      this.sessionRepo.deleteSession(session.id);
      return null;
    }

    // Check user existence and active status
    const user = this.userRepo.findUserById(session.user_id);
    if (!user || user.is_active !== 1) {
      this.sessionRepo.deleteSession(session.id);
      return null;
    }

    // Throttled activity update (only update last_activity_at if > 60,000ms has passed to avoid WAL thrashing)
    if (now - session.last_activity_at > 60000) {
      this.sessionRepo.updateLastActivityAt(session.id, now);
      session.last_activity_at = now;
    }

    return { session, user };
  }

  /**
   * Invalidates a session by raw token.
   */
  public async invalidateSession(rawToken: string): Promise<void> {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      return;
    }
    const tokenHash = this.hashToken(rawToken);
    this.sessionRepo.deleteSessionByTokenHash(tokenHash);
  }

  /**
   * Invalidates all sessions belonging to a specific user.
   */
  public async invalidateUserSessions(userId: string): Promise<number> {
    return this.sessionRepo.deleteUserSessions(userId);
  }

  /**
   * Formats a Set-Cookie header string for session establishment.
   */
  public static buildCookieHeader(rawToken: string, options: { secure: boolean; maxAgeMs?: number }): string {
    const maxAgeSec = Math.floor((options.maxAgeMs ?? ABSOLUTE_LIFETIME_MS) / 1000);
    const parts = [
      `${SESSION_COOKIE_NAME}=${rawToken}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSec}`,
    ];
    if (options.secure) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  /**
   * Formats a Set-Cookie header string for session destruction (logout).
   */
  public static buildClearCookieHeader(options: { secure: boolean }): string {
    const parts = [
      `${SESSION_COOKIE_NAME}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ];
    if (options.secure) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }
}
