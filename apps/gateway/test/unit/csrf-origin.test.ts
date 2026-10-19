import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOriginMiddleware,
  createCsrfMiddleware,
  normalizeOrigin,
  parseCookies,
  BrowserRequest,
} from '../../src/http/browser-middleware.js';
import { Response } from 'express';

function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  sessionContext?: any;
}) {
  const req = {
    method: options.method ?? 'POST',
    headers: options.headers ?? {},
    sessionContext: options.sessionContext,
  } as unknown as BrowserRequest;

  let statusCode = 200;
  let responseData: any = null;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      responseData = data;
      return this;
    },
  } as unknown as Response;

  return {
    req,
    res,
    getStatus: () => statusCode,
    getBody: () => responseData,
  };
}

describe('CSRF and Canonical Origin Middleware Unit Tests (DEC-04 / Threat Model)', () => {
  const allowedOrigins = [
    'http://dashboard.127.0.0.1.nip.io:8080',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ];
  const originMiddleware = createOriginMiddleware(allowedOrigins);

  it('normalizes origins correctly stripping paths and trailing slashes', () => {
    assert.strictEqual(
      normalizeOrigin('http://dashboard.127.0.0.1.nip.io:8080/'),
      'http://dashboard.127.0.0.1.nip.io:8080'
    );
    assert.strictEqual(
      normalizeOrigin('http://localhost:3001/some/path'),
      'http://localhost:3001'
    );
    assert.strictEqual(
      normalizeOrigin('HTTP://127.0.0.1:3001'),
      'http://127.0.0.1:3001'
    );
  });

  it('parses cookies safely from raw header', () => {
    const raw = 'urumi_session=abcdef1234; other_cookie=val%201; blank=';
    const parsed = parseCookies(raw);
    assert.strictEqual(parsed['urumi_session'], 'abcdef1234');
    assert.strictEqual(parsed['other_cookie'], 'val 1');
    assert.strictEqual(parsed['blank'], '');
  });

  it('allows state-changing requests when Origin header matches allowlist', () => {
    const { req, res, getStatus } = createMockReqRes({
      method: 'POST',
      headers: {
        origin: 'http://dashboard.127.0.0.1.nip.io:8080',
      },
    });

    let nextCalled = false;
    originMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(getStatus(), 200);
  });

  it('rejects state-changing requests when Origin header is forbidden', () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: 'POST',
      headers: {
        origin: 'http://malicious-attacker.com',
      },
    });

    let nextCalled = false;
    originMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getBody().code, 'CSRF_ORIGIN_FORBIDDEN');
  });

  it('allows request when Origin is absent but Referer matches allowlist', () => {
    const { req, res, getStatus } = createMockReqRes({
      method: 'POST',
      headers: {
        referer: 'http://dashboard.127.0.0.1.nip.io:8080/dashboard/upstreams',
      },
    });

    let nextCalled = false;
    originMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(getStatus(), 200);
  });

  it('rejects request when Origin is absent and Referer is forbidden or malformed', () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: 'POST',
      headers: {
        referer: 'http://evil.com/phishing',
      },
    });

    let nextCalled = false;
    originMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getBody().code, 'CSRF_ORIGIN_FORBIDDEN');
  });

  it('fails closed when both Origin and Referer are missing on state-changing request', () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: 'POST',
      headers: {},
    });

    let nextCalled = false;
    originMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getBody().code, 'CSRF_ORIGIN_MISSING');
  });

  it('prohibits host spoofing: client Host and X-Forwarded-Host are ignored for origin validation', () => {
    const { req, res, getStatus, getBody } = createMockReqRes({
      method: 'POST',
      headers: {
        host: 'dashboard.127.0.0.1.nip.io:8080',
        'x-forwarded-host': 'dashboard.127.0.0.1.nip.io:8080',
        origin: 'http://attacker-controlled.site',
      },
    });

    let nextCalled = false;
    originMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getBody().code, 'CSRF_ORIGIN_FORBIDDEN');
  });

  it('bypasses origin check for safe read-only methods (GET, HEAD)', () => {
    const { req, res, getStatus } = createMockReqRes({
      method: 'GET',
      headers: {},
    });

    let nextCalled = false;
    originMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(getStatus(), 200);
  });

  describe('CSRF Token Middleware', () => {
    const csrfMiddleware = createCsrfMiddleware();
    const validCsrf = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

    it('passes when valid CSRF token header matches active session in constant time', () => {
      const { req, res, getStatus } = createMockReqRes({
        method: 'POST',
        headers: {
          'x-urumi-csrf': validCsrf,
        },
        sessionContext: {
          session: { csrf_token: validCsrf },
          user: { id: 'u1' },
        },
      });

      let nextCalled = false;
      csrfMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(getStatus(), 200);
    });

    it('rejects when X-Urumi-CSRF token is mismatched', () => {
      const { req, res, getStatus, getBody } = createMockReqRes({
        method: 'POST',
        headers: {
          'x-urumi-csrf': '9999999999999999999999999999999999999999999999999999999999999999',
        },
        sessionContext: {
          session: { csrf_token: validCsrf },
          user: { id: 'u1' },
        },
      });

      let nextCalled = false;
      csrfMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(getStatus(), 403);
      assert.strictEqual(getBody().code, 'CSRF_TOKEN_INVALID');
    });

    it('rejects when X-Urumi-CSRF header is completely missing', () => {
      const { req, res, getStatus, getBody } = createMockReqRes({
        method: 'POST',
        headers: {},
        sessionContext: {
          session: { csrf_token: validCsrf },
          user: { id: 'u1' },
        },
      });

      let nextCalled = false;
      csrfMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(getStatus(), 403);
      assert.strictEqual(getBody().code, 'CSRF_TOKEN_INVALID');
    });
  });
});
