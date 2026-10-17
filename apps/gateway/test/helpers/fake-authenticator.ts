import { AuthenticatedUser, Authenticator } from '../../src/auth/authenticator.js';

/**
 * In-memory Fake Authenticator strictly confined to the test tree (test/helpers/).
 * Completely removed from the application source tree (src/) so production builds
 * cannot import or reference it.
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
