import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { DatabaseManager } from '../../src/db/connection.js';
import { UpstreamRepository } from '../../src/db/upstream-repo.js';
import { CatalogService } from '../../src/upstream/catalog-service.js';
import { UpstreamManager } from '../../src/upstream/upstream-manager.js';
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService } from '../../src/audit/audit-service.js';
import { SecretManager } from '../../src/k8s/secret-manager.js';
import { MockKubernetesSecretClient } from '../helpers/mock-secret-client.js';
import { AdminService } from '../../src/admin/admin-service.js';
import { createExpressApp } from '../../src/server.js';
import { parseConfig } from '../../src/config.js';
import { FakeAuthenticator } from '../helpers/fake-authenticator.js';

describe('Gate G7: Administrative API & Dynamic Catalog Synchronization Protocol Tests', () => {
  function createMockUpstream(
    name: string,
    tools: Array<{ name: string; description: string }>
  ): {
    server: http.Server;
    port: number;
    close: () => Promise<void>;
  } {
    const app = express();
    app.use(express.json());

    app.post('/mcp', async (req, res) => {
      const mcpServer = new McpServer({ name, version: '1.0.0' });
      for (const t of tools) {
        mcpServer.registerTool(
          t.name,
          {
            description: t.description,
            inputSchema: { query: z.string().optional() },
          },
          async () => ({ content: [{ type: 'text', text: `result from ${t.name}` }] })
        );
      }

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const server = http.createServer(app);
    return {
      server,
      port: 0,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    };
  }

  it('enforces RBAC, validates requests, and dynamically synchronizes downstream catalog on CRUD', async () => {
    // 1. Spin up mock upstream server on ephemeral port
    const mockUpstream = createMockUpstream('analytics-service', [
      { name: 'generate_report', description: 'Generates analytics report' },
      { name: 'get_metrics', description: 'Retrieves performance metrics' },
    ]);

    await new Promise<void>((res) => {
      mockUpstream.server.listen(0, '127.0.0.1', () => {
        mockUpstream.port = (mockUpstream.server.address() as any).port;
        res();
      });
    });

    // 2. Initialize Gateway DB, repos, SecretManager, UpstreamManager, AdminService
    const dbManager = new DatabaseManager({ dbPath: ':memory:', autoMigrate: true });
    dbManager.initialize();
    const db = dbManager.getDb();

    // Insert authenticated users into SQLite users table to satisfy foreign keys on audit_events
    db.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?);').run(
      'usr-admin-1',
      'admin',
      'admin',
      Math.floor(Date.now() / 1000)
    );
    db.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?);').run(
      'usr-member-1',
      'member',
      'member',
      Math.floor(Date.now() / 1000)
    );

    const upstreamRepo = new UpstreamRepository(db);
    const catalogService = new CatalogService();
    const mockK8sClient = new MockKubernetesSecretClient();
    const secretManager = new SecretManager(mockK8sClient, {
      namespace: 'urumi-gateway-secrets',
    });
    const auditRepo = new AuditRepository(db);
    const auditService = new AuditService(auditRepo);

    const upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
      allowLocalhostForTesting: true,
      credentialsResolver: async (secretName) => {
        return mockK8sClient.getSecretData('urumi-gateway-secrets', secretName);
      },
    });
    await upstreamManager.initialize();

    const adminService = new AdminService(
      upstreamRepo,
      secretManager,
      upstreamManager,
      auditService,
      {
        allowLocalhostForTesting: true,
      }
    );

    // 3. Set up Auth and Gateway Express server
    const fakeAuth = new FakeAuthenticator();
    const adminToken = 'urumi_live_admin_token_0987654321fedcba';
    const memberToken = 'urumi_live_member_token_1234567890abcdef';
    fakeAuth.registerKey(adminToken, { id: 'usr-admin-1', username: 'admin', role: 'admin' });
    fakeAuth.registerKey(memberToken, { id: 'usr-member-1', username: 'member', role: 'member' });

    const gatewayConfig = parseConfig({
      HOST: '127.0.0.1',
      KUBERNETES_SECRETS_NAMESPACE: 'urumi-gateway-secrets',
    });

    const gatewayApp = createExpressApp({
      config: gatewayConfig,
      authenticator: fakeAuth,
      catalogService,
      adminService,
      readinessCheck: () => true,
    });

    const gatewayHttpServer = await new Promise<http.Server>((res) => {
      const s = gatewayApp.listen(0, '127.0.0.1', () => res(s));
    });
    const gatewayPort = (gatewayHttpServer.address() as any).port;
    const adminBaseUrl = `http://127.0.0.1:${gatewayPort}/admin/v1/upstreams`;

    let downstreamClient: Client | null = null;
    let downstreamTransport: StreamableHTTPClientTransport | null = null;

    try {
      // 4. Test RBAC: Unauthenticated -> 401
      const unauthRes = await fetch(adminBaseUrl);
      assert.equal(unauthRes.status, 401, 'Unauthenticated request must be rejected with 401');

      // 5. Test RBAC: Member role -> 403 Forbidden
      const memberRes = await fetch(adminBaseUrl, {
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      assert.equal(memberRes.status, 403, 'Member key must be denied administrative access (403)');
      const memberBody = await memberRes.json();
      assert.ok(memberBody.error?.includes('Administrative privileges required'));

      // 6. Test Admin access: GET /admin/v1/upstreams -> 200 OK (initially empty)
      const listInitRes = await fetch(adminBaseUrl, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(listInitRes.status, 200);
      const listInitBody = await listInitRes.json();
      assert.equal(Array.isArray(listInitBody.upstreams), true);
      assert.equal(listInitBody.upstreams.length, 3, 'Initial upstreams contain the 3 default seeded upstreams');

      // 7. Test Body Validation: Invalid slug or SSRF URL -> 400 Bad Request
      const badSlugRes = await fetch(adminBaseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug: 'INVALID_SLUG_UPPERCASE!',
          displayName: 'Bad',
          endpointUrl: `http://127.0.0.1:${mockUpstream.port}/mcp`,
        }),
      });
      assert.equal(badSlugRes.status, 400);

      const ssrfRes = await fetch(adminBaseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug: 'ssrf-target',
          displayName: 'SSRF Attack',
          endpointUrl: 'http://169.254.169.254/latest/meta-data',
        }),
      });
      assert.equal(ssrfRes.status, 400);

      // 8. Connect Downstream MCP Client to verify live catalog synchronization
      downstreamTransport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${gatewayPort}/mcp`),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${memberToken}`,
            },
          },
        }
      );
      downstreamClient = new Client(
        { name: 'test-downstream-client', version: '1.0.0' },
        { capabilities: {} }
      );
      await downstreamClient.connect(downstreamTransport);

      const toolsBefore = await downstreamClient.listTools();
      assert.equal(toolsBefore.tools.length, 0, 'Initially downstream catalog has 0 tools');

      // 9. Admin creates upstream: POST /admin/v1/upstreams
      const createRes = await fetch(adminBaseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug: 'analytics',
          displayName: 'Analytics & Reporting Service',
          endpointUrl: `http://127.0.0.1:${mockUpstream.port}/mcp`,
          timeoutMs: 8000,
          credential: 'super-secret-k8s-token',
        }),
      });
      assert.equal(createRes.status, 201, 'Upstream creation should return 201 Created');
      const createBody = await createRes.json();
      const createdDto = createBody.upstream;

      // Zero credential exposure assertion!
      assert.equal(createdDto.slug, 'analytics');
      assert.equal(createdDto.status, 'active');
      assert.equal(createdDto.isEnabled, true);
      assert.ok(createdDto.secretRefName);
      assert.equal(createdDto.credential, undefined);
      assert.equal(createdDto.token, undefined);

      // Verify Secret in mock K8s client
      const storedSecret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', createdDto.secretRefName);
      assert.ok(storedSecret);
      assert.equal(storedSecret.data['token'], 'super-secret-k8s-token');
      assert.equal(storedSecret.labels['app.kubernetes.io/managed-by'], 'urumi-gateway');
      assert.equal(storedSecret.labels['urumi.io/upstream-slug'], 'analytics');

      // 10. CRITICAL PROTOCOL INVARIANT: Downstream MCP client immediately reflects new tools without process restart!
      const toolsAfterCreate = await downstreamClient.listTools();
      assert.equal(toolsAfterCreate.tools.length, 2, 'Downstream catalog must reflect 2 new tools');
      const toolNames = toolsAfterCreate.tools.map((t) => t.name).sort();
      assert.deepEqual(toolNames, ['analytics__generate_report', 'analytics__get_metrics']);

      // 11. Admin disables upstream: POST /admin/v1/upstreams/:id/disable
      const disableRes = await fetch(`${adminBaseUrl}/analytics/disable`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(disableRes.status, 200);
      const disableBody = await disableRes.json();
      const disabledDto = disableBody.upstream;
      assert.equal(disabledDto.isEnabled, false);
      assert.equal(disabledDto.status, 'disabled');

      // Downstream MCP client immediately sees tools removed!
      const toolsAfterDisable = await downstreamClient.listTools();
      assert.equal(toolsAfterDisable.tools.length, 0, 'Disabled upstream tools must be removed from downstream catalog');

      // 12. Admin re-enables upstream: POST /admin/v1/upstreams/:id/enable
      const enableRes = await fetch(`${adminBaseUrl}/analytics/enable`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(enableRes.status, 200);
      const enableBody = await enableRes.json();
      const enabledDto = enableBody.upstream;
      assert.equal(enabledDto.isEnabled, true);
      assert.equal(enabledDto.status, 'active');

      // Downstream MCP client immediately sees tools restored!
      const toolsAfterEnable = await downstreamClient.listTools();
      assert.equal(toolsAfterEnable.tools.length, 2, 'Re-enabled upstream tools must be republished');

      // 13. Admin updates upstream / rotates credential: PATCH /admin/v1/upstreams/:id
      const patchRes = await fetch(`${adminBaseUrl}/analytics`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Updated Analytics Service',
          credential: 'rotated-new-token-12345',
        }),
      });
      assert.equal(patchRes.status, 200);
      const patchBody = await patchRes.json();
      const patchedDto = patchBody.upstream;
      assert.equal(patchedDto.displayName, 'Updated Analytics Service');

      // Verify rotated Secret in K8s
      const rotatedSecret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', createdDto.secretRefName);
      assert.equal(rotatedSecret?.data['token'], 'rotated-new-token-12345');

      // 14. Admin deletes upstream: DELETE /admin/v1/upstreams/:id
      const deleteRes = await fetch(`${adminBaseUrl}/analytics`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(deleteRes.status, 200);
      const deleteBody = await deleteRes.json();
      assert.ok(deleteBody.message?.includes('successfully deleted'));

      // Downstream tools removed
      const toolsAfterDelete = await downstreamClient.listTools();
      assert.equal(toolsAfterDelete.tools.length, 0, 'Deleted upstream tools must be removed from downstream catalog');

      // Secret deleted from K8s
      const deletedSecret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', createdDto.secretRefName);
      assert.equal(deletedSecret, undefined, 'Secret must be deleted from Kubernetes');

      // SQLite row deleted
      const deletedRow = upstreamRepo.getUpstreamBySlug('analytics');
      assert.equal(deletedRow, null, 'Upstream row must be deleted from SQLite');
    } finally {
      if (downstreamTransport) {
        await downstreamTransport.close().catch(() => {});
      }
      if (downstreamClient) {
        await downstreamClient.close().catch(() => {});
      }
      await new Promise<void>((resolve) => {
        gatewayHttpServer.closeAllConnections?.();
        gatewayHttpServer.close(() => resolve());
      });
      await mockUpstream.close();
      dbManager.close();
    }
  });

  it('preserves cleanup_required state and allows retryCleanup when Secret deletion fails over HTTP', async () => {
    // 1. Initialize Gateway
    const dbManager = new DatabaseManager({ dbPath: ':memory:', autoMigrate: true });
    dbManager.initialize();
    const db = dbManager.getDb();

    // Insert user for audit_events foreign key
    db.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?);').run(
      'usr-admin-1',
      'admin',
      'admin',
      Math.floor(Date.now() / 1000)
    );

    const upstreamRepo = new UpstreamRepository(db);
    const catalogService = new CatalogService();
    const mockK8sClient = new MockKubernetesSecretClient();
    const secretManager = new SecretManager(mockK8sClient, {
      namespace: 'urumi-gateway-secrets',
    });
    const auditRepo = new AuditRepository(db);
    const auditService = new AuditService(auditRepo);

    const upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
      allowLocalhostForTesting: true,
    });
    await upstreamManager.initialize();

    const adminService = new AdminService(
      upstreamRepo,
      secretManager,
      upstreamManager,
      auditService,
      {
        allowLocalhostForTesting: true,
      }
    );

    const fakeAuth = new FakeAuthenticator();
    const adminToken = 'urumi_admin_key_stuck_secret_test';
    fakeAuth.registerKey(adminToken, { id: 'usr-admin-1', username: 'admin', role: 'admin' });

    const gatewayConfig = parseConfig({
      HOST: '127.0.0.1',
    });

    const gatewayApp = createExpressApp({
      config: gatewayConfig,
      authenticator: fakeAuth,
      catalogService,
      adminService,
      readinessCheck: () => true,
    });

    const gatewayHttpServer = await new Promise<http.Server>((res) => {
      const s = gatewayApp.listen(0, '127.0.0.1', () => res(s));
    });
    const gatewayPort = (gatewayHttpServer.address() as any).port;
    const adminBaseUrl = `http://127.0.0.1:${gatewayPort}/admin/v1/upstreams`;

    try {
      // Seed an active upstream with a Secret in SQLite and K8s
      const row = upstreamRepo.insertUpstream({
        slug: 'failing-delete-upstream',
        displayName: 'Failing Delete Upstream',
        endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
        status: 'active',
        isEnabled: 1,
        secretRefName: 'upstream-sec-failing-delete-upstream-99999999',
      });

      await mockK8sClient.createSecret('urumi-gateway-secrets', {
        name: row.secret_ref_name!,
        namespace: 'urumi-gateway-secrets',
        labels: {
          'app.kubernetes.io/managed-by': 'urumi-gateway',
          'urumi.io/upstream-slug': 'failing-delete-upstream',
        },
        stringData: { token: 'tok' },
      });

      // Inject K8s delete error
      mockK8sClient.failNext('deleteSecret', new Error('Simulated ETCD quorum loss during DELETE'));

      // DELETE /admin/v1/upstreams/failing-delete-upstream
      const delRes = await fetch(`${adminBaseUrl}/failing-delete-upstream`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      // Expect 502 Bad Gateway / CLEANUP_REQUIRED
      assert.equal(delRes.status, 502);
      const delErr = await delRes.json();
      assert.equal(delErr.code, 'CLEANUP_REQUIRED');
      assert.ok(delErr.error?.includes('Preserved in cleanup_required for retry'));

      // Verify row was NOT deleted from SQLite, but transitioned to 'cleanup_required'
      const stuckRow = upstreamRepo.getUpstreamBySlug('failing-delete-upstream');
      assert.ok(stuckRow, 'SQLite row must NOT be deleted');
      assert.equal(stuckRow.status, 'cleanup_required');
      assert.ok(stuckRow.cleanup_error?.includes('Simulated ETCD quorum loss'));

      // Now retry cleanup: POST /admin/v1/upstreams/:id/retry-cleanup
      const retryRes = await fetch(`${adminBaseUrl}/failing-delete-upstream/retry-cleanup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      assert.equal(retryRes.status, 200);
      const retryBody = await retryRes.json();
      assert.ok(retryBody.message?.includes('Cleanup retry succeeded'));

      // Now row and Secret are deleted
      assert.equal(upstreamRepo.getUpstreamBySlug('failing-delete-upstream'), null);
      assert.equal(mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', row.secret_ref_name!), undefined);
    } finally {
      await new Promise<void>((resolve) => {
        gatewayHttpServer.closeAllConnections?.();
        gatewayHttpServer.close(() => resolve());
      });
      dbManager.close();
    }
  });
});
