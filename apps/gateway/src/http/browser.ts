import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SessionService, SESSION_COOKIE_NAME } from '../auth/session-service.js';
import { UserRepository } from '../db/user-repo.js';
import { ScryptPasswordService } from '../auth/scrypt-password-service.js';
import { LoginRateLimiter } from '../auth/login-rate-limiter.js';
import { getClientIp } from './client-ip.js';
import {
  createSessionAuthMiddleware,
  createCsrfMiddleware,
  requireRole,
  parseCookies,
  BrowserRequest,
} from './browser-middleware.js';
import { AdminService, AdminError } from '../admin/admin-service.js';
import {
  CreateUpstreamSchema,
  UpdateUpstreamSchema,
  UpstreamResponseDTO,
} from '../admin/admin-types.js';
import { CatalogService } from '../upstream/catalog-service.js';
import { logger } from '../logging/logger.js';

const LoginRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const DUMMY_SCRYPT_HASH =
  'scrypt$v1$N=16384,r=8,p=1$0000000000000000000000000000000000000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

export interface BrowserUpstreamHealthDTO {
  state: string;
  toolCount: number;
  lastCheck: number | null;
  lastError: string | null;
}

export interface BrowserUpstreamDTO {
  id: string;
  slug: string;
  displayName: string;
  endpointUrl: string;
  timeoutMs: number;
  isEnabled: boolean;
  status: string;
  health: BrowserUpstreamHealthDTO;
  createdAt: number;
  updatedAt: number;
}

/**
 * Projects an internal UpstreamResponseDTO into a strict, safe BrowserUpstreamDTO.
 * SECURITY INVARIANT: Secret reference names (secretRefName), internal cleanup errors,
 * and raw credential data are NEVER present in browser responses.
 */
export function toBrowserUpstreamDTO(upstream: UpstreamResponseDTO): BrowserUpstreamDTO {
  return {
    id: upstream.id,
    slug: upstream.slug,
    displayName: upstream.displayName,
    endpointUrl: upstream.endpointUrl,
    timeoutMs: upstream.timeoutMs,
    isEnabled: upstream.isEnabled,
    status: upstream.status,
    health: {
      state: upstream.health?.healthState ?? 'connecting',
      toolCount: typeof upstream.health?.toolCount === 'number' ? upstream.health.toolCount : 0,
      lastCheck: upstream.health?.lastCheckedAt ? upstream.health.lastCheckedAt : null,
      lastError: upstream.health?.lastError ?? null,
    },
    createdAt: upstream.createdAt,
    updatedAt: upstream.updatedAt,
  };
}

export interface BrowserRouterOptions {
  sessionService: SessionService;
  userRepo: UserRepository;
  passwordService: ScryptPasswordService;
  cookieSecure: boolean;
  trustedProxies?: string[];
  rateLimiter?: LoginRateLimiter;
  adminService?: AdminService;
  catalogService?: CatalogService;
}

export function createBrowserRouter(options: BrowserRouterOptions): Router {
  const router = Router();
  const sessionAuth = createSessionAuthMiddleware(options.sessionService);
  const csrfAuth = createCsrfMiddleware();
  const rateLimiter = options.rateLimiter ?? new LoginRateLimiter();
  const trustedProxies = options.trustedProxies ?? ['127.0.0.1', '::1', '10.42.0.0/16', '10.43.0.0/16'];

  const handleAdminError = (err: unknown, res: Response, defaultMessage = 'Internal Server Error'): void => {
    if (err instanceof AdminError) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
      return;
    }
    logger.error('Unhandled browser upstreams error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({
      error: defaultMessage,
      code: 'INTERNAL_ERROR',
    });
  };

  /**
   * POST /api/v1/browser/session
   * Establishes a new authenticated browser session with rate limiting,
   * constant-time dummy verification, and generic error responses.
   */
  router.post('/session', async (req: Request, res: Response): Promise<void> => {
    const parseResult = LoginRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parseResult.error.format(),
      });
      return;
    }

    const { username, password } = parseResult.data;
    const clientIp = getClientIp(req, trustedProxies);

    // 1. Sliding window rate limit check
    const rateLimitStatus = rateLimiter.checkLimit(clientIp, username);
    if (rateLimitStatus.limited) {
      res.set('Retry-After', String(rateLimitStatus.retryAfterSeconds));
      res.status(429).json({
        error: 'Too many failed login attempts. Please try again later.',
        code: 'LOGIN_RATE_LIMITED',
      });
      return;
    }

    const user = options.userRepo.findUserByUsername(username);
    const credentials = user ? options.userRepo.getUserCredentials(user.id) : null;

    // 2. Generic failure path for nonexistent user, missing credentials, or inactive user
    if (!user || !credentials || user.is_active !== 1) {
      // Execute constant-time dummy Scrypt verification to prevent user enumeration via timing
      try {
        await options.passwordService.verifyPassword(password, DUMMY_SCRYPT_HASH);
      } catch {
        // Ignore dummy verify error
      }

      rateLimiter.recordFailure(clientIp, username);
      res.status(401).json({
        error: 'Invalid username or password',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    // 3. User is active and credentials exist — verify password
    let isValidPassword = false;
    try {
      isValidPassword = await options.passwordService.verifyPassword(password, credentials.password_hash);
    } catch (err: unknown) {
      logger.error('Error during password verification', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      isValidPassword = false;
    }

    if (!isValidPassword) {
      rateLimiter.recordFailure(clientIp, username);
      res.status(401).json({
        error: 'Invalid username or password',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    // 4. Successful authentication: clear failure count, create session
    rateLimiter.recordSuccess(clientIp, username);
    const userAgent = req.headers['user-agent'];

    try {
      const { rawToken, csrfToken } = await options.sessionService.createSession(user.id, {
        userAgent,
        ipAddress: clientIp,
      });

      const cookieHeader = SessionService.buildCookieHeader(rawToken, {
        secure: options.cookieSecure,
      });
      res.setHeader('Set-Cookie', cookieHeader);

      res.status(200).json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
        csrfToken,
      });
    } catch (err: unknown) {
      logger.error('Failed to create browser session', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  /**
   * GET /api/v1/browser/session
   * Validates active session and returns user info + CSRF token.
   */
  router.get('/session', sessionAuth, (req: BrowserRequest, res: Response): void => {
    const { session, user } = req.sessionContext!;
    res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      csrfToken: session.csrf_secret,
    });
  });

  /**
   * DELETE /api/v1/browser/session
   * Invalidates active session and clears the session cookie.
   */
  router.delete('/session', sessionAuth, csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    const cookies = parseCookies(req.headers['cookie']);
    const rawToken = cookies[SESSION_COOKIE_NAME];

    if (rawToken) {
      await options.sessionService.invalidateSession(rawToken);
    }

    const clearCookieHeader = SessionService.buildClearCookieHeader({
      secure: options.cookieSecure,
    });
    res.setHeader('Set-Cookie', clearCookieHeader);

    res.status(200).json({ success: true });
  });

  // =========================================================================
  // Upstream & Tool Management (Gate P5-G3: 9 Endpoints)
  // =========================================================================

  /**
   * 1. GET /api/v1/browser/upstreams
   * List all registered upstreams with safe metadata and operational health.
   * Allowed: Admin, Member.
   */
  router.get('/upstreams', sessionAuth, requireRole('admin', 'member'), async (_req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.adminService) {
      res.status(501).json({ error: 'Admin service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
    try {
      const upstreams = await options.adminService.listUpstreams();
      res.status(200).json({ upstreams: upstreams.map(toBrowserUpstreamDTO) });
    } catch (err: unknown) {
      handleAdminError(err, res);
    }
  });

  /**
   * 2. GET /api/v1/browser/upstreams/:id
   * Get details of a single upstream by ID or slug with safe metadata.
   * Allowed: Admin, Member.
   */
  router.get('/upstreams/:id', sessionAuth, requireRole('admin', 'member'), async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.adminService) {
      res.status(501).json({ error: 'Admin service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
    try {
      const upstream = await options.adminService.getUpstream(req.params.id);
      res.status(200).json({ upstream: toBrowserUpstreamDTO(upstream) });
    } catch (err: unknown) {
      handleAdminError(err, res);
    }
  });

  /**
   * 3. GET /api/v1/browser/upstreams/:id/tools
   * Query live catalog snapshot for tools registered by this upstream.
   * Allowed: Admin, Member.
   */
  router.get('/upstreams/:id/tools', sessionAuth, requireRole('admin', 'member'), async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.adminService) {
      res.status(501).json({ error: 'Admin service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
    try {
      const upstream = await options.adminService.getUpstream(req.params.id);
      const snapshot = options.catalogService?.getSnapshot();
      const allTools = snapshot ? Array.from(snapshot.tools.values()) : [];
      const tools = allTools
        .filter((t) => t.upstreamSlug === upstream.slug)
        .map((t) => ({
          name: t.originalName,
          publicName: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema,
        }));
      res.status(200).json({
        upstreamSlug: upstream.slug,
        toolCount: tools.length,
        tools,
      });
    } catch (err: unknown) {
      handleAdminError(err, res);
    }
  });

  /**
   * 4. POST /api/v1/browser/upstreams
   * Create a new upstream with SSRF validation, saga, and Kubernetes Secret.
   * Allowed: Admin only. Requires CSRF.
   */
  router.post('/upstreams', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.adminService) {
      res.status(501).json({ error: 'Admin service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
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

    const user = req.sessionContext!.user;
    try {
      const upstream = await options.adminService.createUpstream(parseResult.data, {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      if (upstream.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(201).json({ upstream: toBrowserUpstreamDTO(upstream) });
    } catch (err: unknown) {
      handleAdminError(err, res);
    }
  });

  /**
   * 5. PATCH /api/v1/browser/upstreams/:id
   * Update configuration or rotate credentials for an existing upstream.
   * Allowed: Admin only. Requires CSRF.
   */
  router.patch('/upstreams/:id', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.adminService) {
      res.status(501).json({ error: 'Admin service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
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

    const user = req.sessionContext!.user;
    try {
      const upstream = await options.adminService.updateUpstream(
        req.params.id,
        parseResult.data,
        {
          id: user.id,
          username: user.username,
          role: user.role,
        }
      );
      if (upstream.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json({ upstream: toBrowserUpstreamDTO(upstream) });
    } catch (err: unknown) {
      handleAdminError(err, res);
    }
  });

  /**
   * 6. POST /api/v1/browser/upstreams/:id/enable
   * Enable an upstream.
   * Allowed: Admin only. Requires CSRF.
   */
  router.post('/upstreams/:id/enable', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.adminService) {
      res.status(501).json({ error: 'Admin service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
    const user = req.sessionContext!.user;
    try {
      const upstream = await options.adminService.enableUpstream(req.params.id, {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      if (upstream.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json({ upstream: toBrowserUpstreamDTO(upstream) });
    } catch (err: unknown) {
      handleAdminError(err, res);
    }
  });

  /**
   * 7. POST /api/v1/browser/upstreams/:id/disable
   * Disable an upstream.
   * Allowed: Admin only. Requires CSRF.
   */
  router.post('/upstreams/:id/disable', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.adminService) {
      res.status(501).json({ error: 'Admin service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
    const user = req.sessionContext!.user;
    try {
      const upstream = await options.adminService.disableUpstream(req.params.id, {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      if (upstream.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json({ upstream: toBrowserUpstreamDTO(upstream) });
    } catch (err: unknown) {
      handleAdminError(err, res);
    }
  });

  /**
   * 8. DELETE /api/v1/browser/upstreams/:id
   * Delete an upstream and its Kubernetes Secret.
   * Allowed: Admin only. Requires CSRF.
   */
  router.delete('/upstreams/:id', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.adminService) {
      res.status(501).json({ error: 'Admin service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
    const user = req.sessionContext!.user;
    try {
      const result = await options.adminService.deleteUpstream(req.params.id, {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      if (result.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json(result);
    } catch (err: unknown) {
      handleAdminError(err, res);
    }
  });

  /**
   * 9. POST /api/v1/browser/upstreams/:id/retry-cleanup
   * Retry cleanup for an upstream in cleanup_required status.
   * Allowed: Admin only. Requires CSRF.
   */
  router.post('/upstreams/:id/retry-cleanup', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.adminService) {
      res.status(501).json({ error: 'Admin service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
    const user = req.sessionContext!.user;
    try {
      const result = await options.adminService.retryCleanup(req.params.id, {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      if (result.auditDegraded) {
        res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
      }
      res.status(200).json(result);
    } catch (err: unknown) {
      handleAdminError(err, res);
    }
  });

  return router;
}
