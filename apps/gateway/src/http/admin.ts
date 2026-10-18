import express, { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest, createAuthMiddleware } from '../auth/middleware.js';
import { Authenticator } from '../auth/authenticator.js';
import { AdminService, AdminError } from '../admin/admin-service.js';
import { CreateUpstreamSchema, UpdateUpstreamSchema } from '../admin/admin-types.js';
import { logger } from '../logging/logger.js';

/**
 * Creates the administrative router mounted at `/admin/v1`.
 * 
 * Invariants:
 * 1. All routes under /admin/v1 require Bearer token authentication.
 * 2. Unauthenticated requests receive HTTP 401 Unauthorized.
 * 3. Non-admin roles (e.g. 'member') receive HTTP 403 Forbidden.
 * 4. Authenticated admin requests are dispatched to AdminService when provided, or HTTP 501 if unconfigured.
 * 5. Secret credentials are NEVER included in response bodies or errors.
 * 6. Admin handlers are standard REST routes and must NEVER be mounted into the downstream MCP tool catalog.
 */
export function createAdminRouter(
  authenticator: Authenticator,
  adminService?: AdminService
): Router {
  const router = Router();

  // Enforce authentication across all admin endpoints
  router.use(createAuthMiddleware(authenticator));

  // Role-based authorization: reject non-admin users with 403 Forbidden
  router.use((req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        error: 'Forbidden: Administrative privileges required',
      });
      return;
    }
    next();
  });

  // If no AdminService is provided, return 501 Not Implemented (backward-compatibility / stub mode)
  if (!adminService) {
    router.all('*', (req: AuthenticatedRequest, res: Response): void => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Admin API reserved for Gate G7',
        path: req.originalUrl,
        method: req.method,
      });
    });
    return router;
  }

  // Bounded JSON body parser for admin requests (64 KiB cap)
  const jsonParser = express.json({ limit: 65536 });
  router.use((req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
      jsonParser(req, res, (err: unknown) => {
        if (err) {
          const errorObj = err as { type?: string; status?: number };
          if (errorObj.type === 'entity.too.large' || errorObj.status === 413) {
            res.status(413).json({
              error: 'Payload Too Large: Request body exceeds 65536 bytes limit',
            });
            return;
          }

          if (err instanceof SyntaxError && 'body' in (err as unknown as Record<string, unknown>)) {
            res.status(400).json({
              error: 'Bad Request: Malformed JSON payload',
            });
            return;
          }

          next(err);
          return;
        }
        next();
      });
      return;
    }
    next();
  });

  // Helper for safe async handler wrapping and error mapping
  const asyncHandler = (
    fn: (req: AuthenticatedRequest, res: Response) => Promise<void>
  ) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        await fn(req, res);
      } catch (err: unknown) {
        if (err instanceof AdminError) {
          res.status(err.statusCode).json({
            error: err.message,
            code: err.code,
          });
          return;
        }

        const message = err instanceof Error ? err.message : String(err);
        logger.error('Unhandled admin API error', {
          path: req.originalUrl,
          method: req.method,
          error: message,
        });

        res.status(500).json({
          error: 'Internal Server Error',
        });
      }
    };
  };

  // 1. GET /upstreams — List all upstreams
  router.get(
    '/upstreams',
    asyncHandler(async (_req, res) => {
      const upstreams = await adminService.listUpstreams();
      res.status(200).json({ upstreams });
    })
  );

  // 2. POST /upstreams — Create a new upstream
  router.post(
    '/upstreams',
    asyncHandler(async (req, res) => {
      const parseResult = CreateUpstreamSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorDetails = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');
        res.status(400).json({
          error: `Validation Error: ${errorDetails}`,
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const upstream = await adminService.createUpstream(parseResult.data, req.user!);
      if (upstream.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(201).json({ upstream });
    })
  );

  // 3. GET /upstreams/:id — Get details of an upstream by ID or slug
  router.get(
    '/upstreams/:id',
    asyncHandler(async (req, res) => {
      const upstream = await adminService.getUpstream(req.params.id);
      res.status(200).json({ upstream });
    })
  );

  // 4. PATCH /upstreams/:id — Update configuration or rotate credentials
  router.patch(
    '/upstreams/:id',
    asyncHandler(async (req, res) => {
      const parseResult = UpdateUpstreamSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorDetails = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');
        res.status(400).json({
          error: `Validation Error: ${errorDetails}`,
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const upstream = await adminService.updateUpstream(
        req.params.id,
        parseResult.data,
        req.user!
      );
      if (upstream.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json({ upstream });
    })
  );

  // 5. POST /upstreams/:id/disable — Disable an upstream
  router.post(
    '/upstreams/:id/disable',
    asyncHandler(async (req, res) => {
      const upstream = await adminService.disableUpstream(req.params.id, req.user!);
      if (upstream.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json({ upstream });
    })
  );

  // 6. POST /upstreams/:id/enable — Enable an upstream
  router.post(
    '/upstreams/:id/enable',
    asyncHandler(async (req, res) => {
      const upstream = await adminService.enableUpstream(req.params.id, req.user!);
      if (upstream.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json({ upstream });
    })
  );

  // 7. DELETE /upstreams/:id — Delete an upstream and its Kubernetes Secret
  router.delete(
    '/upstreams/:id',
    asyncHandler(async (req, res) => {
      const result = await adminService.deleteUpstream(req.params.id, req.user!);
      if (result.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json(result);
    })
  );

  // 8. POST /upstreams/:id/retry-cleanup — Retry cleanup for an upstream in cleanup_required
  router.post(
    '/upstreams/:id/retry-cleanup',
    asyncHandler(async (req, res) => {
      const result = await adminService.retryCleanup(req.params.id, req.user!);
      if (result.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json(result);
    })
  );

  // Catch-all for undefined subpaths under /admin/v1
  router.all('*', (req: AuthenticatedRequest, res: Response): void => {
    res.status(404).json({
      error: 'Not Found',
      message: `Admin endpoint ${req.method} ${req.originalUrl} not found`,
    });
  });

  return router;
}
