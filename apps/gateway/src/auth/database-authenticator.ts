import { Authenticator, AuthenticatedUser } from './authenticator.js';
import { ApiKeyService } from './api-key-service.js';

/**
 * Production Authenticator that verifies presented tokens against SQLite persistence.
 * 
 * Non-Negotiable Invariants:
 * 1. Delegates to ApiKeyService with constant-time verification.
 * 2. Zero authentication bypasses or mock headers.
 * 3. Returns null on invalid, expired, or revoked tokens (Fail Closed).
 */
export class DatabaseAuthenticator implements Authenticator {
  constructor(private apiKeyService: ApiKeyService) {}

  async authenticate(bearerToken: string): Promise<AuthenticatedUser | null> {
    return this.apiKeyService.verifyKey(bearerToken);
  }
}
