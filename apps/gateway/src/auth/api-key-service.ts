import crypto from 'node:crypto';
import { ApiKeyRepository, ApiKeyRecord, UserRecord } from '../db/api-key-repo.js';
import { AuthenticatedUser } from './authenticator.js';

export interface GenerateKeyParams {
  userId: string;
  name: string;
  expiresInSeconds?: number;
}

export interface GeneratedKeyResult {
  rawKey: string;
  apiKey: ApiKeyRecord;
}

export const API_KEY_PREFIX = 'urumi_live_';

/**
 * Service managing API-key generation, hashing, constant-time verification, and revocation.
 * 
 * Non-Negotiable Invariants:
 * 1. Generates 32 bytes of cryptographically secure random entropy (64 hex characters).
 * 2. Prefix 'urumi_live_' for automated secret scanning detection.
 * 3. Raw key is returned EXACTLY ONCE upon creation.
 * 4. Only SHA-256 verifier hash is persisted in SQLite.
 * 5. Inbound verification uses crypto.timingSafeEqual to prevent side-channel timing attacks.
 * 6. Revocation is immediately effective on the very next request.
 * 7. Zero credentials or hashes logged.
 */
export class ApiKeyService {
  constructor(private repo: ApiKeyRepository) {}

  /**
   * Generates a new API key for a user.
   * Returns the raw key exactly once.
   */
  generateApiKey(params: GenerateKeyParams): GeneratedKeyResult {
    const entropy = crypto.randomBytes(32).toString('hex');
    const rawKey = `${API_KEY_PREFIX}${entropy}`;
    const keyPrefix = rawKey.substring(0, 16);
    const keyHash = this.hashKey(rawKey);

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = params.expiresInSeconds
      ? now + params.expiresInSeconds
      : null;

    const apiKey: ApiKeyRecord = {
      id: crypto.randomUUID(),
      user_id: params.userId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name: params.name,
      expires_at: expiresAt,
      revoked_at: null,
      created_at: now,
      last_used_at: null,
    };

    this.repo.insertApiKey(apiKey);

    return {
      rawKey,
      apiKey,
    };
  }

  /**
   * Verifies an inbound raw API key using constant-time comparison.
   * Enforces revocation and expiry checks.
   */
  async verifyKey(rawKey: string): Promise<AuthenticatedUser | null> {
    if (!rawKey || typeof rawKey !== 'string') {
      return null;
    }

    const trimmedKey = rawKey.trim();
    if (!trimmedKey.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const computedHashHex = this.hashKey(trimmedKey);
    const record = this.repo.findApiKeyByHash(computedHashHex);
    if (!record) {
      return null;
    }

    // Constant-time digest comparison to prevent timing attacks
    const computedBuf = Buffer.from(computedHashHex, 'hex');
    const storedBuf = Buffer.from(record.key_hash, 'hex');
    if (computedBuf.length !== storedBuf.length || !crypto.timingSafeEqual(computedBuf, storedBuf)) {
      return null;
    }

    // Revocation check: fail immediately if revoked
    if (record.revoked_at !== null) {
      return null;
    }

    // Active user check: fail closed immediately if user is deactivated or missing active status
    if (typeof record.is_active !== 'number' || record.is_active !== 1) {
      return null;
    }

    // Expiry check: fail if expired
    const now = Math.floor(Date.now() / 1000);
    if (record.expires_at !== null && record.expires_at <= now) {
      return null;
    }

    // Update last used timestamp
    try {
      this.repo.updateApiKeyLastUsed(record.key_id, now);
    } catch {
      // Non-fatal if last_used_at update fails during high contention
    }

    return {
      id: record.user_id,
      username: record.username,
      role: record.role,
    };
  }

  /**
   * Revokes an API key by its stable identifier.
   */
  revokeKey(keyId: string): boolean {
    return this.repo.revokeApiKey(keyId);
  }

  /**
   * Computes SHA-256 digest of the raw key.
   */
  hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  /**
   * Helper to create a user account.
   */
  createUser(username: string, role: 'admin' | 'member'): UserRecord {
    const user: UserRecord = {
      id: crypto.randomUUID(),
      username,
      role,
      created_at: Math.floor(Date.now() / 1000),
    };
    this.repo.insertUser(user);
    return user;
  }
}
