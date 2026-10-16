import { Request, Response, NextFunction } from 'express';
import { Authenticator, AuthenticatedUser } from './authenticator.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Creates Express middleware enforcing Bearer token authentication.
 * Fails closed on missing, malformed, or unverified credentials.
 */
export function createAuthMiddleware(authenticator: Authenticator) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'Unauthorized: Missing Authorization header',
      });
      return;
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      res.status(401).json({
        error: 'Unauthorized: Authorization scheme must be Bearer',
      });
      return;
    }

    const token = parts[1];
    if (!token || token.trim().length === 0) {
      res.status(401).json({
        error: 'Unauthorized: Empty Bearer token',
      });
      return;
    }

    try {
      const user = await authenticator.authenticate(token);
      if (!user) {
        res.status(401).json({
          error: 'Unauthorized: Invalid or revoked API key',
        });
        return;
      }

      req.user = user;
      next();
    } catch (err: unknown) {
      res.status(401).json({
        error: 'Unauthorized: Authentication verification failed',
      });
    }
  };
}
