import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExpressApp } from '../../src/server.js';
import { parseConfig } from '../../src/config.js';
import { FakeAuthenticator } from '../../src/auth/fake-authenticator.js';

describe('Gateway MCP Protocol and Handshake Protocol Tests', () => {
  const TEST_PORT = 7890;
  const config = parseConfig({
    PORT: String(TEST_PORT),
    HOST: '127.0.0.1',
    MAX_PAYLOAD_SIZE_BYTES: '65536',
  });

  const fakeAuth = new FakeAuthenticator();
  const testMember = { id: 'usr-1', username: 'alice', role: 'member' as const };
  const testAdmin = { id: 'usr-admin', username: 'admin', role: 'admin' as const };
  const validMemberToken = 'urumi_live_test_member_token_1234567890abcdef';
  const validAdminToken = 'urumi_live_test_admin_token_abcdef1234567890';

  fakeAuth.registerKey(validMemberToken, testMember);
  fakeAuth.registerKey(validAdminToken, testAdmin);

  const app = createExpressApp({
    config,
    authenticator: fakeAuth,
    readinessCheck: () => true,
  });

  test('Protocol Handshake, Auth Rejections, Body Boundaries, and Idempotent Cleanup', async () => {
    const server = app.listen(TEST_PORT, '127.0.0.1');

    try {
      // 1. Unauthenticated request to POST /mcp must fail with HTTP 401
      const unauthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      assert.equal(unauthRes.status, 401, 'Unauthenticated POST /mcp must return 401');
      const unauthBody = await unauthRes.json();
      assert.equal(unauthBody.error, 'Unauthorized: Missing Authorization header');

      // 2. Invalid API key to POST /mcp must fail with HTTP 401
      const invalidKeyRes = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid_or_revoked_key',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 2 }),
      });
      assert.equal(invalidKeyRes.status, 401);
      const invalidKeyBody = await invalidKeyRes.json();
      assert.equal(invalidKeyBody.error, 'Unauthorized: Invalid or revoked API key');

      // 3. Method validation: Non-POST method (GET /mcp) must return HTTP 405 Method Not Allowed
      const getRes = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validMemberToken}`,
        },
      });
      assert.equal(getRes.status, 405, 'GET /mcp must return 405');
      assert.equal(getRes.headers.get('allow'), 'POST');

      // 4. Content-Type validation: Non-JSON body must return HTTP 415 Unsupported Media Type
      const textRes = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Authorization: `Bearer ${validMemberToken}`,
        },
        body: 'plain text body',
      });
      assert.equal(textRes.status, 415, 'Non-JSON Content-Type must return 415');

      // 5. Malformed JSON syntax must return HTTP 400 Bad Request
      const malformedRes = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validMemberToken}`,
        },
        body: '{"invalid": json syntax',
      });
      assert.equal(malformedRes.status, 400, 'Malformed JSON syntax must return 400');
      const malformedBody = await malformedRes.json();
      assert.equal(malformedBody.error, 'Bad Request: Malformed JSON payload');

      // 6. Oversized request body (>64 KiB) must return HTTP 413 Payload Too Large
      const oversizedPayload = JSON.stringify({
        jsonrpc: '2.0',
        method: 'test',
        id: 3,
        padding: 'A'.repeat(70000), // > 65536 bytes
      });
      const oversizedRes = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validMemberToken}`,
        },
        body: oversizedPayload,
      });
      assert.equal(oversizedRes.status, 413, 'Payload > 64 KiB must return 413');

      // 7. Authenticated MCP client handshake via official SDK Client
      const client = new Client(
        {
          name: 'urumi-test-agent',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${TEST_PORT}/mcp`),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${validMemberToken}`,
            },
          },
        }
      );

      await client.connect(transport);

      // 8. Tool listing & verifying admin routes are omitted from tool catalog
      const toolsResult = await client.listTools();
      assert.ok(Array.isArray(toolsResult.tools), 'Tools result must contain tools array');
      // In Gate G3 skeleton, no admin handlers are mounted as tools
      const toolNames = toolsResult.tools.map((t) => t.name);
      assert.equal(toolNames.some((n) => n.includes('admin')), false, 'Admin endpoints must not be exposed as tools');

      // 9. Repeated request cleanup: successive listTools call executes without hanging
      const toolsResult2 = await client.listTools();
      assert.ok(Array.isArray(toolsResult2.tools));

      // Clean client teardown
      await client.close();

      // 10. Verify /admin/v1 routes remain private and unexposed
      const adminRes = await fetch(`http://127.0.0.1:${TEST_PORT}/admin/v1/upstreams`, {
        headers: { Authorization: `Bearer ${validAdminToken}` },
      });
      assert.equal(adminRes.status, 501, 'Admin routes return 501 Not Implemented');
    } finally {
      server.close();
    }
  });
});
