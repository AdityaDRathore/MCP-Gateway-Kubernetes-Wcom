import { AuthenticatedUser, Authenticator } from './authenticator.js';

/**
 * In-memory Fake Authenticator strictly used in test construction.
 * Not referenced or instantiated anywhere in production code.
 */
export class FakeAuthenticator implements Authenticator {
  private validKeys = new Map<string, AuthenticatedUser>();

  registerKey(token: string, user: AuthenticatedUser): void {
    this.validKeys.set(token, user);
  }

  revokeKey(token: string): void {
    this.validKeys.delete(token);
  }

  clear(): void {
    this.validKeys.clear();
  }

  async authenticate(bearerToken: string): Promise<AuthenticatedUser | null> {
    return this.validKeys.get(bearerToken) ?? null;
  }
}
