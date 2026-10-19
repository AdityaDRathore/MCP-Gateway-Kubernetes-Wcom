import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { SessionService, AuthenticatedSession, SESSION_COOKIE_NAME } from '../auth/session-service.js';

export interface BrowserRequest extends Request {
  sessionContext?: AuthenticatedSession;
}

export interface OriginValidatorOptions {
  allowedOrigins: string[];
}

/**
 * Normalizes an origin string (lowercased, trailing slash stripped).
 */
export function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    return url.origin.toLowerCase();
  } catch {
    return origin.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Parses cookies safely from a raw Cookie header string.
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }

  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');

  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    if (key && !cookies[key]) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }

  return cookies;
}

/**
 * Creates middleware enforcing the canonical origin allowlist and safe Referer fallback.
 * Strictly ignores untrusted Host/X-Forwarded-* headers for origin determination.
 */
export function createOriginMiddleware(allowedOriginsList: string[]) {
  const allowedSet = new Set(allowedOriginsList.map(normalizeOrigin));

  return (req: Request, res: Response, next: NextFunction): void => {
    // Safe read-only methods do not require origin checks
    const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
    if (safeMethods.has(req.method.toUpperCase())) {
      return next();
    }

    const originHeader = req.headers['origin'];
    const refererHeader = req.headers['referer'];

    // 1. Check Origin header if present
    if (originHeader) {
      const originStr = Array.isArray(originHeader) ? originHeader[0] : originHeader;
      const normalized = normalizeOrigin(originStr);
      if (allowedSet.has(normalized)) {
        return next();
      }
      res.status(403).json({
        error: 'Forbidden: Request origin is not allowed',
        code: 'CSRF_ORIGIN_FORBIDDEN',
      });
      return;
    }

    // 2. Fall back to Referer header if Origin is absent
    if (refererHeader) {
      const refererStr = Array.isArray(refererHeader) ? refererHeader[0] : refererHeader;
      try {
        const refUrl = new URL(refererStr);
        const refOrigin = normalizeOrigin(refUrl.origin);
        if (allowedSet.has(refOrigin)) {
          return next();
        }
      } catch {
        // Unparseable referer fails closed
      }
      res.status(403).json({
        error: 'Forbidden: Referer origin is not allowed',
        code: 'CSRF_ORIGIN_FORBIDDEN',
      });
      return;
    }

    // 3. Fail closed if both Origin and Referer are absent on state-changing requests
    res.status(403).json({
      error: 'Forbidden: Missing Origin and Referer headers on state-changing request',
      code: 'CSRF_ORIGIN_MISSING',
    });
  };
}

/**
 * Creates session authentication middleware for browser API routes.
 * Validates session cookie against SessionService.
 */
export function createSessionAuthMiddleware(sessionService: SessionService) {
  return async (req: BrowserRequest, res: Response, next: NextFunction): Promise<void> => {
    const cookies = parseCookies(req.headers['cookie']);
    const rawToken = cookies[SESSION_COOKIE_NAME];

    if (!rawToken) {
      res.status(401).json({
        error: 'Unauthorized: Missing or invalid session cookie',
        code: 'SESSION_MISSING',
      });
      return;
    }

    const auth = await sessionService.validateSession(rawToken);
    if (!auth) {
      res.status(401).json({
        error: 'Unauthorized: Session expired or invalid',
        code: 'SESSION_INVALID',
      });
      return;
    }

    req.sessionContext = auth;
    next();
  };
}

/**
 * Creates CSRF token validation middleware for authenticated browser endpoints.
 * Compares X-Urumi-CSRF header against the active session's csrf_token in constant time.
 */
export function createCsrfMiddleware() {
  return (req: BrowserRequest, res: Response, next: NextFunction): void => {
    // Safe read-only methods do not require CSRF token
    const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
    if (safeMethods.has(req.method.toUpperCase())) {
      return next();
    }

    const session = req.sessionContext?.session;
    if (!session) {
      res.status(401).json({
        error: 'Unauthorized: Session required for CSRF validation',
        code: 'SESSION_REQUIRED',
      });
      return;
    }

    const rawHeader = req.headers['x-urumi-csrf'];
    const csrfHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!csrfHeader || typeof csrfHeader !== 'string') {
      res.status(403).json({
        error: 'Forbidden: Missing X-Urumi-CSRF header',
        code: 'CSRF_TOKEN_INVALID',
      });
      return;
    }

    const secret = session.csrf_secret || (session as any).csrf_token;
    if (!secret || typeof secret !== 'string') {
      res.status(403).json({
        error: 'Forbidden: Session CSRF secret not found',
        code: 'CSRF_TOKEN_INVALID',
      });
      return;
    }
    const expectedBuf = Buffer.from(secret, 'hex');
    let providedBuf: Buffer;
    try {
      providedBuf = Buffer.from(csrfHeader, 'hex');
    } catch {
      res.status(403).json({
        error: 'Forbidden: Malformed X-Urumi-CSRF header',
        code: 'CSRF_TOKEN_INVALID',
      });
      return;
    }

    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      res.status(403).json({
        error: 'Forbidden: Invalid CSRF token',
        code: 'CSRF_TOKEN_INVALID',
      });
      return;
    }

    next();
  };
}
