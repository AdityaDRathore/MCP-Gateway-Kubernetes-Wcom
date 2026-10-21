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
import { InvitationService, InvitationError } from '../auth/invitation-service.js';
import { InvitationRepository } from '../db/invitation-repo.js';
import { ApiKeyService } from '../auth/api-key-service.js';
import { ApiKeyRepository, ApiKeyWithUserSummary } from '../db/api-key-repo.js';
import { AuditRepository, AuditStatus } from '../db/audit-repo.js';
import { DatabaseManager } from '../db/connection.js';
import { DatabaseSync } from 'node:sqlite';
import { ToolRouter } from '../upstream/tool-router.js';
import { ModelProvider, ProviderError } from '../chat/types.js';
import { ConfirmationManager } from '../chat/confirmation.js';
import { AgentLoopOrchestrator } from '../chat/agent-loop.js';

const LoginRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const CreateInvitationSchema = z.object({
  role: z.enum(['admin', 'member']).optional().default('member'),
});

const RedeemInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(32, 'Username must be at most 32 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username must be alphanumeric, hyphen, or underscore'),
  password: z.string().min(10, 'Password must be at least 10 characters long'),
});

const UpdateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

const CreateKeySchema = z.object({
  name: z.string().min(1, 'Key name is required').max(64, 'Key name must be at most 64 characters'),
  expiresInDays: z.number().int().positive().max(365).optional(),
  userId: z.string().optional(),
});

export const ChatTurnRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(4000, 'Message cannot exceed 4000 characters'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system', 'tool']),
        content: z.string().optional(),
        toolCalls: z.array(z.any()).optional(),
        toolCallId: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .optional(),
});

export const ChatConfirmRequestSchema = z.object({
  confirmationToken: z.string().min(1, 'Confirmation token is required'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system', 'tool']),
        content: z.string().optional(),
        toolCalls: z.array(z.any()).optional(),
        toolCallId: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .optional(),
});

export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1, 'Limit must be >= 1').max(100, 'Limit cannot exceed 100').default(25),
  offset: z.coerce.number().int().min(0, 'Offset must be >= 0').default(0),
  status: z.enum([
    'pending',
    'success',
    'failed',
    'timeout',
    'client_disconnected',
    'unconfirmed_outcome',
  ]).optional(),
  userId: z.string().uuid('Invalid userId format').optional(),
});

export interface BrowserAuditDTO {
  id: string;
  userId: string | null;
  username: string | null;
  upstreamSlug: string | null;
  toolName: string;
  status: AuditStatus;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
}

export function sanitizeErrorMessage(msg: string | null | undefined): string | null {
  if (!msg) return null;
  return msg
    .replace(/urumi_[a-zA-Z0-9_]{10,}/g, '[REDACTED_SECRET]')
    .replace(/bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(password|secret|key|token|credential)\s*[:=]\s*["']?[^"'\s]+["']?/gi, '$1=[REDACTED]')
    .replace(/https?:\/\/[^:@\s]+:[^@\s]+@/g, 'https://[REDACTED]@');
}

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
  invitationService?: InvitationService;
  invitationRepo?: InvitationRepository;
  apiKeyService?: ApiKeyService;
  apiKeyRepo?: ApiKeyRepository;
  dbManager?: DatabaseManager;
  auditRepo?: AuditRepository;
  toolRouter?: ToolRouter;
  modelProvider?: ModelProvider;
  confirmationManager?: ConfirmationManager;
  agentLoop?: AgentLoopOrchestrator;
  chatTurnTimeoutMs?: number;
}

export function createBrowserRouter(options: BrowserRouterOptions): Router {
  const router = Router();
  const sessionAuth = createSessionAuthMiddleware(options.sessionService);
  const csrfAuth = createCsrfMiddleware();
  const rateLimiter = options.rateLimiter ?? new LoginRateLimiter();
  const trustedProxies = options.trustedProxies ?? ['127.0.0.1', '::1', '10.42.0.0/16', '10.43.0.0/16'];

  const confirmationManager = options.confirmationManager ?? new ConfirmationManager();
  const agentLoop =
    options.agentLoop ??
    (options.toolRouter && options.catalogService && options.modelProvider
      ? new AgentLoopOrchestrator(
          options.catalogService,
          options.toolRouter,
          options.modelProvider,
          confirmationManager,
          {
            CHAT_TURN_TIMEOUT_MS: options.chatTurnTimeoutMs ?? 30000,
            PROVIDER_TIMEOUT_MS: 15000,
          } as any
        )
      : null);

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

  const runWriteTx = <T>(fn: () => T): T => {
    if (options.dbManager) {
      return options.dbManager.transaction(fn);
    }
    const db = (options.userRepo as any).db as DatabaseSync;
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const res = fn();
      db.exec('COMMIT;');
      return res;
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch {}
      throw err;
    }
  };

  /**
   * 10. POST /api/v1/browser/invitations
   * Creates a single-use invitation token for a new team member.
   * Allowed: Admin only. Requires CSRF.
   */
  router.post('/invitations', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.invitationService) {
      res.status(501).json({ error: 'Invitation service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
    const parseResult = CreateInvitationSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation Error', details: parseResult.error.format() });
      return;
    }
    const currentUser = req.sessionContext!.user;
    try {
      const result = options.invitationService.createInvitation({
        role: parseResult.data.role,
        invitedBy: currentUser.id,
      });
      res.status(201).json({
        invitation: {
          id: result.id,
          role: result.role,
          expiresAt: result.expiresAt,
          inviteUrl: result.inviteUrl,
          token: result.rawToken,
        },
      });
    } catch (err: unknown) {
      if (err instanceof InvitationError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      logger.error('Failed to create invitation', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 11. POST /api/v1/browser/invitations/redeem
   * Redeems an invitation token, creating user and credentials.
   * Allowed: Public (Anonymous).
   */
  router.post('/invitations/redeem', async (req: Request, res: Response): Promise<void> => {
    if (!options.invitationService) {
      res.status(501).json({ error: 'Invitation service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }
    const parseResult = RedeemInvitationSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation Error', details: parseResult.error.format() });
      return;
    }
    const { token, username, password } = parseResult.data;
    const clientIp = getClientIp(req, trustedProxies);
    const userAgent = req.headers['user-agent'] as string | undefined;

    try {
      const result = await options.invitationService.redeemInvitation({
        token,
        username,
        password,
        meta: { ipAddress: clientIp, userAgent },
      });

      const cookieHeader = SessionService.buildCookieHeader(result.session.rawToken, {
        secure: options.cookieSecure,
      });
      res.setHeader('Set-Cookie', cookieHeader);

      res.status(200).json({
        user: {
          id: result.user.id,
          username: result.user.username,
          role: result.user.role,
        },
        csrfToken: result.session.csrfToken,
      });
    } catch (err: unknown) {
      if (err instanceof InvitationError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      logger.error('Failed to redeem invitation', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 12. GET /api/v1/browser/members
   * Returns list of team members with their active key counts.
   * Allowed: Admin only.
   */
  router.get('/members', sessionAuth, requireRole('admin'), async (_req: BrowserRequest, res: Response): Promise<void> => {
    try {
      const users = options.userRepo.listUsersWithKeyCounts();
      res.status(200).json({
        members: users.map((u) => ({
          id: u.id,
          username: u.username,
          role: u.role,
          isActive: u.is_active === 1,
          createdAt: u.created_at,
          activeKeyCount: u.active_key_count,
        })),
      });
    } catch (err: unknown) {
      logger.error('Failed to list members', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 13. POST /api/v1/browser/members/:id/deactivate
   * Deactivates a team member, revoking all API keys and terminating sessions.
   * Allowed: Admin only. Requires CSRF.
   */
  router.post('/members/:id/deactivate', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    const targetId = req.params.id;
    const currentAdmin = req.sessionContext!.user;

    if (targetId === currentAdmin.id) {
      res.status(400).json({
        error: 'Cannot deactivate your own account',
        code: 'SELF_DEACTIVATION_PROHIBITED',
      });
      return;
    }

    const targetUser = options.userRepo.findUserById(targetId);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    if (targetUser.is_active === 0) {
      res.status(400).json({ error: 'User is already deactivated', code: 'USER_ALREADY_DEACTIVATED' });
      return;
    }

    try {
      runWriteTx(() => {
        if (targetUser.role === 'admin') {
          const activeAdmins = options.userRepo.countActiveAdmins();
          if (activeAdmins <= 1) {
            throw new Error('LAST_ACTIVE_ADMIN');
          }
        }
        options.userRepo.updateActiveStatus(targetId, 0);
        if (options.apiKeyRepo) {
          options.apiKeyRepo.revokeAllUserApiKeys(targetId);
        }
        options.sessionService.invalidateUserSessions(targetId);
      });

      logger.info('Member deactivated', {
        adminId: currentAdmin.id,
        targetUserId: targetId,
      });

      res.status(200).json({
        success: true,
        message: 'Member deactivated successfully',
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'LAST_ACTIVE_ADMIN') {
        res.status(400).json({
          error: 'Cannot deactivate the last active administrator',
          code: 'LAST_ADMIN_PROTECTED',
        });
        return;
      }
      logger.error('Failed to deactivate member', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 14. POST /api/v1/browser/members/:id/reactivate
   * Reactivates a deactivated team member.
   * Allowed: Admin only. Requires CSRF.
   */
  router.post('/members/:id/reactivate', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    const targetId = req.params.id;
    const targetUser = options.userRepo.findUserById(targetId);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    if (targetUser.is_active === 1) {
      res.status(400).json({ error: 'User is already active', code: 'USER_ALREADY_ACTIVE' });
      return;
    }

    try {
      options.userRepo.updateActiveStatus(targetId, 1);
      logger.info('Member reactivated', {
        adminId: req.sessionContext!.user.id,
        targetUserId: targetId,
      });
      res.status(200).json({
        success: true,
        message: 'Member reactivated successfully',
      });
    } catch (err: unknown) {
      logger.error('Failed to reactivate member', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 15. PATCH /api/v1/browser/members/:id/role
   * Updates a member's role (admin <-> member).
   * Allowed: Admin only. Requires CSRF.
   */
  router.patch('/members/:id/role', sessionAuth, requireRole('admin'), csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    const targetId = req.params.id;
    const parseResult = UpdateMemberRoleSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation Error', details: parseResult.error.format() });
      return;
    }

    const targetUser = options.userRepo.findUserById(targetId);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    const newRole = parseResult.data.role;
    if (targetUser.role === newRole) {
      res.status(200).json({
        success: true,
        user: { id: targetUser.id, username: targetUser.username, role: targetUser.role },
      });
      return;
    }

    try {
      runWriteTx(() => {
        if (targetUser.role === 'admin' && newRole === 'member' && targetUser.is_active === 1) {
          const activeAdmins = options.userRepo.countActiveAdmins();
          if (activeAdmins <= 1) {
            throw new Error('LAST_ACTIVE_ADMIN');
          }
        }
        options.userRepo.updateUserRole(targetId, newRole);
        // Invalidate active browser sessions to force re-authentication with new privileges
        options.sessionService.invalidateUserSessions(targetId);
      });

      logger.info('Member role updated', {
        adminId: req.sessionContext!.user.id,
        targetUserId: targetId,
        oldRole: targetUser.role,
        newRole,
      });

      res.status(200).json({
        success: true,
        user: { id: targetUser.id, username: targetUser.username, role: newRole },
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'LAST_ACTIVE_ADMIN') {
        res.status(400).json({
          error: 'Cannot demote the last active administrator',
          code: 'LAST_ADMIN_PROTECTED',
        });
        return;
      }
      logger.error('Failed to update member role', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 16. GET /api/v1/browser/keys
   * Lists API keys with strict IDOR protection.
   * Admins can list all keys or filter by userId.
   * Members can strictly ONLY list their own keys (any userId query param is ignored).
   */
  router.get('/keys', sessionAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.apiKeyRepo) {
      res.status(501).json({ error: 'API key repository not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }

    const currentUser = req.sessionContext!.user;
    try {
      let keys: ApiKeyWithUserSummary[];
      if (currentUser.role === 'admin') {
        const filterUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
        if (filterUserId) {
          keys = options.apiKeyRepo.listApiKeysByUserWithUser(filterUserId);
        } else {
          keys = options.apiKeyRepo.listAllApiKeysWithUser();
        }
      } else {
        // Enforce member IDOR boundary: query strictly by logged-in user id
        keys = options.apiKeyRepo.listApiKeysByUserWithUser(currentUser.id);
      }

      res.status(200).json({
        keys: keys.map((k) => ({
          id: k.id,
          userId: k.user_id,
          username: k.username,
          name: k.name,
          keyPrefix: k.key_prefix,
          expiresAt: k.expires_at,
          revokedAt: k.revoked_at,
          createdAt: k.created_at,
          lastUsedAt: k.last_used_at,
        })),
      });
    } catch (err: unknown) {
      logger.error('Failed to list API keys', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 17. POST /api/v1/browser/keys
   * Creates a new API key.
   * Admins can create keys for any active user.
   * Members can strictly only create keys for themselves.
   * Raw key is returned once in transient response.
   */
  router.post('/keys', sessionAuth, csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.apiKeyService || !options.apiKeyRepo) {
      res.status(501).json({ error: 'API key service not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }

    const parseResult = CreateKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation Error', details: parseResult.error.format() });
      return;
    }

    const currentUser = req.sessionContext!.user;
    let targetUserId = currentUser.id;

    if (currentUser.role === 'admin') {
      if (parseResult.data.userId) {
        targetUserId = parseResult.data.userId;
        const targetUser = options.userRepo.findUserById(targetUserId);
        if (!targetUser) {
          res.status(404).json({ error: 'Target user not found', code: 'USER_NOT_FOUND' });
          return;
        }
        if (targetUser.is_active !== 1) {
          res.status(400).json({ error: 'Cannot create API key for deactivated user', code: 'USER_DEACTIVATED' });
          return;
        }
      }
    } else {
      // Member is forced to self-provisioning; cannot set userId for another user
      targetUserId = currentUser.id;
    }

    const targetUser = options.userRepo.findUserById(targetUserId);
    if (!targetUser || targetUser.is_active !== 1) {
      res.status(400).json({ error: 'Cannot create API key for inactive user', code: 'USER_DEACTIVATED' });
      return;
    }

    const expiresInSeconds = parseResult.data.expiresInDays
      ? parseResult.data.expiresInDays * 86400
      : undefined;

    try {
      const { apiKey, rawKey } = options.apiKeyService.generateApiKey({
        userId: targetUserId,
        name: parseResult.data.name,
        expiresInSeconds,
      });

      logger.info('API key created via browser self-service', {
        creatorId: currentUser.id,
        targetUserId,
        keyId: apiKey.id,
        keyPrefix: apiKey.key_prefix,
      });

      res.status(201).json({
        apiKey: {
          id: apiKey.id,
          userId: apiKey.user_id,
          username: targetUser.username,
          name: apiKey.name,
          keyPrefix: apiKey.key_prefix,
          expiresAt: apiKey.expires_at,
          createdAt: apiKey.created_at,
        },
        rawKey,
      });
    } catch (err: unknown) {
      logger.error('Failed to create API key', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 18. POST /api/v1/browser/keys/:id/revoke
   * Revokes an API key.
   * Admins can revoke any key.
   * Members can ONLY revoke their own keys (IDOR protected).
   */
  router.post('/keys/:id/revoke', sessionAuth, csrfAuth, async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.apiKeyRepo) {
      res.status(501).json({ error: 'API key repository not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }

    const keyId = req.params.id;
    const currentUser = req.sessionContext!.user;

    const key = options.apiKeyRepo.findApiKeyById(keyId);
    if (!key) {
      res.status(404).json({ error: 'API key not found', code: 'KEY_NOT_FOUND' });
      return;
    }

    // Enforce ownership: members can only revoke their own keys
    if (currentUser.role !== 'admin' && key.user_id !== currentUser.id) {
      res.status(403).json({
        error: 'You do not have permission to revoke this API key',
        code: 'FORBIDDEN',
      });
      return;
    }

    try {
      options.apiKeyRepo.revokeApiKey(keyId);
      logger.info('API key revoked via browser self-service', {
        operatorId: currentUser.id,
        keyId,
        ownerId: key.user_id,
      });
      res.status(200).json({
        success: true,
        message: 'API key revoked successfully',
      });
    } catch (err: unknown) {
      logger.error('Failed to revoke API key', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 19. GET /api/v1/browser/audit
   * Retrieves paginated, filtered audit logs.
   * Access: Strictly Admin only. (Members receive 403 Forbidden).
   */
  router.get('/audit', sessionAuth, requireRole('admin'), async (req: BrowserRequest, res: Response): Promise<void> => {
    if (!options.auditRepo) {
      res.status(501).json({ error: 'Audit repository not configured', code: 'NOT_IMPLEMENTED' });
      return;
    }

    const parseResult = AuditQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({
        error: `Invalid query parameters: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        code: 'INVALID_QUERY_PARAMS',
      });
      return;
    }

    const { limit, offset, status, userId } = parseResult.data;

    try {
      const records = options.auditRepo.listAudits({ limit, offset, status, userId });

      // Resolve usernames in a single batch query (avoiding N+1 queries)
      const userIds = records
        .map((r) => r.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      const userMap = options.userRepo.findUsersByIds(userIds);

      const audits: BrowserAuditDTO[] = records.map((r) => ({
        id: r.id,
        userId: r.user_id,
        username: r.user_id ? userMap.get(r.user_id)?.username ?? null : null,
        upstreamSlug: r.upstream_slug,
        toolName: r.tool_name,
        status: r.status,
        durationMs: r.duration_ms,
        errorCode: r.error_code,
        errorMessage: sanitizeErrorMessage(r.error_message),
        createdAt: r.created_at,
      }));

      res.status(200).json({
        audits,
        limit,
        offset,
      });
    } catch (err: unknown) {
      logger.error('Failed to list audits', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  });

  /**
   * 20. POST /api/v1/browser/chat
   * Submits a conversational turn to the bounded agent loop.
   * Session authentication and CSRF protection required.
   */
  router.post('/chat', sessionAuth, csrfAuth, async (req: Request, res: Response): Promise<void> => {
    const browserReq = req as BrowserRequest;
    const user = browserReq.sessionContext?.user;
    if (!user || user.is_active !== 1) {
      res.status(401).json({ error: 'Unauthorized: active session required', code: 'UNAUTHORIZED' });
      return;
    }

    if (!agentLoop) {
      res.status(503).json({
        error: 'Chat service unconfigured: model provider or agent loop dependencies unavailable',
        code: 'PROVIDER_UNCONFIGURED',
      });
      return;
    }

    const parseResult = ChatTurnRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parseResult.error.format(),
      });
      return;
    }

    try {
      const response = await agentLoop.executeTurn({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
        message: parseResult.data.message,
        history: parseResult.data.history as any,
      });

      res.status(200).json(response);
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
        });
        return;
      }
      logger.error('Unhandled chat turn error', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      res.status(500).json({
        error: 'An internal error occurred while processing your chat request',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  /**
   * 21. POST /api/v1/browser/chat/confirm
   * Confirms and executes a previously suspended mutating tool call.
   * Session authentication and CSRF protection required.
   */
  router.post('/chat/confirm', sessionAuth, csrfAuth, async (req: Request, res: Response): Promise<void> => {
    const browserReq = req as BrowserRequest;
    const user = browserReq.sessionContext?.user;
    if (!user || user.is_active !== 1) {
      res.status(401).json({ error: 'Unauthorized: active session required', code: 'UNAUTHORIZED' });
      return;
    }

    if (!agentLoop) {
      res.status(503).json({
        error: 'Chat service unconfigured: model provider or agent loop dependencies unavailable',
        code: 'PROVIDER_UNCONFIGURED',
      });
      return;
    }

    const parseResult = ChatConfirmRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parseResult.error.format(),
      });
      return;
    }

    const verification = confirmationManager.verifyAndConsumeToken(
      parseResult.data.confirmationToken,
      user.id
    );

    if (!verification.valid || !verification.payload || !verification.parsedArgs) {
      const statusCode = verification.code === 'CONFIRMATION_USER_MISMATCH' ? 403 : 400;
      res.status(statusCode).json({
        error: verification.error ?? 'Invalid confirmation token',
        code: verification.code ?? 'INVALID_CONFIRMATION_TOKEN',
      });
      return;
    }

    try {
      const response = await agentLoop.resumeTurnWithConfirmedAction({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
        toolName: verification.payload.toolName,
        args: verification.parsedArgs,
        history: parseResult.data.history as any,
      });

      res.status(200).json(response);
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
        });
        return;
      }
      logger.error('Unhandled chat confirmation execution error', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      res.status(500).json({
        error: err instanceof Error ? err.message : 'An internal error occurred while executing the confirmed action',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  return router;
}
