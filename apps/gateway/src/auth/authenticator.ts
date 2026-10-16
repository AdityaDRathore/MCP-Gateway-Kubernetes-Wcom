/**
 * Authentication interfaces and production fail-closed authenticator.
 */

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: 'admin' | 'member';
}

export interface Authenticator {
  authenticate(bearerToken: string): Promise<AuthenticatedUser | null>;
}

/**
 * Production Fail-Closed Authenticator for Gate G3 Skeleton.
 * 
 * Non-Negotiable Invariants:
 * - Persistent SQLite verifiers and API keys are implemented in Gate G4.
 * - In Gate G3, this authenticator unconditionally rejects all tokens.
 * - Zero authentication bypass flags, mock headers, or backdoor environment switches exist.
 */
export class FailClosedAuthenticator implements Authenticator {
  async authenticate(_bearerToken: string): Promise<AuthenticatedUser | null> {
    return null;
  }
}
