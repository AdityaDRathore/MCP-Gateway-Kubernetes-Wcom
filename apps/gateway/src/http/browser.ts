import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SessionService, SESSION_COOKIE_NAME } from '../auth/session-service.js';
import { UserRepository } from '../db/user-repo.js';
import { ScryptPasswordService } from '../auth/scrypt-password-service.js';
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

export interface BrowserRouterOptions {
  sessionService: SessionService;
  userRepo: UserRepository;
  passwordService: ScryptPasswordService;
  cookieSecure: boolean;
}

export function createBrowserRouter(options: BrowserRouterOptions): Router {
  const router = Router();
  const sessionAuth = createSessionAuthMiddleware(options.sessionService);
  const csrfAuth = createCsrfMiddleware();

  /**
   * POST /api/v1/browser/session
   * Establishes a new authenticated browser session.
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
    const user = options.userRepo.findUserByUsername(username);

    if (!user || !user.password_hash) {
      // Constant-time dummy verify to mitigate username enumeration timing
      await options.passwordService.verifyPassword(
        password,
        '$scrypt$N=16384,r=8,p=1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000'
      );
      res.status(401).json({
        error: 'Unauthorized: Invalid username or password',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    if (user.status !== 'active') {
      res.status(401).json({
        error: 'Unauthorized: Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED',
      });
      return;
    }

    const isValidPassword = await options.passwordService.verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      res.status(401).json({
        error: 'Unauthorized: Invalid username or password',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress;
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
      csrfToken: session.csrf_token,
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
