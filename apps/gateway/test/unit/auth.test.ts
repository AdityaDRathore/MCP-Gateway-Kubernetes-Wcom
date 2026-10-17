import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Request, Response, NextFunction } from 'express';
import { FailClosedAuthenticator } from '../../src/auth/authenticator.js';
import { FakeAuthenticator } from '../helpers/fake-authenticator.js';
import { createAuthMiddleware, AuthenticatedRequest } from '../../src/auth/middleware.js';

describe('Gateway Authentication Unit Tests', () => {
  test('FailClosedAuthenticator unconditionally returns null', async () => {
    const auth = new FailClosedAuthenticator();
    const result1 = await auth.authenticate('urumi_live_test_any_key');
    assert.equal(result1, null);

    const result2 = await auth.authenticate('Bearer dummy_token');
    assert.equal(result2, null);

    const result3 = await auth.authenticate('');
    assert.equal(result3, null);
  });

  test('FakeAuthenticator stores, resolves, and revokes test keys in isolation', async () => {
    const fakeAuth = new FakeAuthenticator();
    const testUser = { id: 'usr-1', username: 'alice', role: 'admin' as const };

    fakeAuth.registerKey('test_admin_token', testUser);
    const resolved = await fakeAuth.authenticate('test_admin_token');
    assert.deepEqual(resolved, testUser);

    fakeAuth.revokeKey('test_admin_token');
    const revoked = await fakeAuth.authenticate('test_admin_token');
    assert.equal(revoked, null);
  });

  test('Auth middleware rejects request missing Authorization header with 401', async () => {
    const fakeAuth = new FakeAuthenticator();
    const middleware = createAuthMiddleware(fakeAuth);

    const req = { headers: {} } as AuthenticatedRequest;
    let statusCode = 0;
    let jsonBody: any = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: any) {
        jsonBody = body;
        return this;
      },
    } as unknown as Response;

    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await middleware(req, res, next);
    assert.equal(statusCode, 401);
    assert.equal(jsonBody?.error, 'Unauthorized: Missing Authorization header');
    assert.equal(nextCalled, false);
  });

  test('Auth middleware rejects non-Bearer scheme with 401', async () => {
    const fakeAuth = new FakeAuthenticator();
    const middleware = createAuthMiddleware(fakeAuth);

    const req = {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    } as AuthenticatedRequest;

    let statusCode = 0;
    let jsonBody: any = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: any) {
        jsonBody = body;
        return this;
      },
    } as unknown as Response;

    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await middleware(req, res, next);
    assert.equal(statusCode, 401);
    assert.equal(jsonBody?.error, 'Unauthorized: Authorization scheme must be Bearer');
    assert.equal(nextCalled, false);
  });

  test('Auth middleware rejects empty or whitespace-only Bearer token with 401', async () => {
    const fakeAuth = new FakeAuthenticator();
    const middleware = createAuthMiddleware(fakeAuth);

    const req = {
      headers: { authorization: 'Bearer ' },
    } as AuthenticatedRequest;

    let statusCode = 0;
    let jsonBody: any = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: any) {
        jsonBody = body;
        return this;
      },
    } as unknown as Response;

    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await middleware(req, res, next);
    assert.equal(statusCode, 401);
    assert.equal(nextCalled, false);
  });

  test('Auth middleware attaches user to request on valid token', async () => {
    const fakeAuth = new FakeAuthenticator();
    const user = { id: 'usr-99', username: 'bob', role: 'member' as const };
    fakeAuth.registerKey('valid_member_key', user);

    const middleware = createAuthMiddleware(fakeAuth);
    const req = {
      headers: { authorization: 'Bearer valid_member_key' },
    } as AuthenticatedRequest;

    let nextCalled = false;
    const next = () => { nextCalled = true; };
    const res = {} as Response;

    await middleware(req, res, next);
    assert.equal(nextCalled, true);
    assert.deepEqual(req.user, user);
  });
});
