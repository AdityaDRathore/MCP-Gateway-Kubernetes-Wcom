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
  parseCookies,
  BrowserRequest,
} from './browser-middleware.js';
import { logger } from '../logging/logger.js';

const LoginRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const DUMMY_SCRYPT_HASH =
  'scrypt$v1$N=16384,r=8,p=1$0000000000000000000000000000000000000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

export interface BrowserRouterOptions {
  sessionService: SessionService;
  userRepo: UserRepository;
  passwordService: ScryptPasswordService;
  cookieSecure: boolean;
  trustedProxies?: string[];
  rateLimiter?: LoginRateLimiter;
}

export function createBrowserRouter(options: BrowserRouterOptions): Router {
  const router = Router();
  const sessionAuth = createSessionAuthMiddleware(options.sessionService);
  const csrfAuth = createCsrfMiddleware();
  const rateLimiter = options.rateLimiter ?? new LoginRateLimiter();
  const trustedProxies = options.trustedProxies ?? ['127.0.0.1', '::1', '10.42.0.0/16', '10.43.0.0/16'];

  /**
   * POST /api/v1/browser/session
   * Establishes a new authenticated browser session with rate limiting,
   * constant-time dummy verification, and generic error responses.
   */
  router.post('/session', async (req: Request, res: Response): Promise<void> => {
    const parseResult = LoginRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Bad Request: Invalid credentials format',
        details: parseResult.error.errors.map((e) => e.message),
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

  return router;
}
