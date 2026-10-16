import { Router, Response } from 'express';
import { AuthenticatedRequest, createAuthMiddleware } from '../auth/middleware.js';
import { Authenticator } from '../auth/authenticator.js';

/**
 * Creates the reserved administrative router mounted at `/admin/v1`.
 * 
 * Invariants:
 * 1. All routes under /admin/v1 require authentication.
 * 2. Unauthenticated requests receive HTTP 401.
 * 3. Non-admin roles (e.g. 'member') receive HTTP 403 Forbidden.
 * 4. Authenticated admin requests receive HTTP 501 Not Implemented for all methods and paths (reserved for Gate G7).
 * 5. Admin handlers are standard REST routes and must NEVER be mounted into the downstream MCP tool catalog.
 */
export function createAdminRouter(authenticator: Authenticator): Router {
  const router = Router();

  // Enforce authentication across all admin endpoints
  router.use(createAuthMiddleware(authenticator));

  // Role-based authorization & 501 reservation handler for all methods and subpaths
  router.all('*', (req: AuthenticatedRequest, res: Response): void => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        error: 'Forbidden: Administrative privileges required',
      });
      return;
    }

    res.status(501).json({
      error: 'Not Implemented',
      message: 'Admin API reserved for Gate G7',
      path: req.originalUrl,
      method: req.method,
    });
  });

  return router;
}
