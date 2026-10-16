import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express, { Request, Response } from 'express';
import { createAdminRouter } from '../../src/http/admin.js';
import { FakeAuthenticator } from '../../src/auth/fake-authenticator.js';

describe('Gateway Admin Prefix Reservation Unit Tests', () => {
  const fakeAuth = new FakeAuthenticator();
  const adminUser = { id: 'usr-admin', username: 'admin', role: 'admin' as const };
  const memberUser = { id: 'usr-member', username: 'member', role: 'member' as const };

  fakeAuth.registerKey('admin_token', adminUser);
  fakeAuth.registerKey('member_token', memberUser);

  const app = express();
  app.use('/admin/v1', createAdminRouter(fakeAuth));

  // Helper function to simulate HTTP requests against express app via fetch
  async function testRoute(method: string, path: string, token?: string) {
    const server = app.listen(0);
    const port = (server.address() as any).port;
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers,
      });
      const data = await res.json();
      return { status: res.status, data };
    } finally {
      server.close();
    }
  }

  test('rejects unauthenticated request to /admin/v1 with 401', async () => {
    const { status, data } = await testRoute('GET', '/admin/v1/upstreams');
    assert.equal(status, 401);
    assert.equal(data.error, 'Unauthorized: Missing Authorization header');
  });

  test('rejects member role with 403 Forbidden across admin subpaths', async () => {
    const { status, data } = await testRoute('GET', '/admin/v1/upstreams', 'member_token');
    assert.equal(status, 403);
    assert.equal(data.error, 'Forbidden: Administrative privileges required');

    const res2 = await testRoute('POST', '/admin/v1/api-keys', 'member_token');
    assert.equal(res2.status, 403);
  });

  test('admin role receives HTTP 501 Not Implemented across all subpaths', async () => {
    const subpaths = [
      '/admin/v1',
      '/admin/v1/upstreams',
      '/admin/v1/api-keys',
      '/admin/v1/audit',
      '/admin/v1/arbitrary/sub/path',
    ];

    for (const path of subpaths) {
      const { status, data } = await testRoute('GET', path, 'admin_token');
      assert.equal(status, 501, `Expected 501 for path ${path}`);
      assert.equal(data.error, 'Not Implemented');
      assert.equal(data.message, 'Admin API reserved for Gate G7');
      assert.equal(data.path, path);
    }
  });

  test('admin role receives HTTP 501 across all HTTP methods', async () => {
    const methods = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'];

    for (const method of methods) {
      const { status, data } = await testRoute(method, '/admin/v1/upstreams/1', 'admin_token');
      assert.equal(status, 501, `Expected 501 for method ${method}`);
      assert.equal(data.error, 'Not Implemented');
      assert.equal(data.method, method);
    }
  });
});
