import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../../src/db/schema.js';
import { UpstreamRepository } from '../../src/db/upstream-repo.js';
import { CatalogService } from '../../src/upstream/catalog-service.js';
import { UpstreamManager } from '../../src/upstream/upstream-manager.js';
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService } from '../../src/audit/audit-service.js';
import { SecretManager } from '../../src/k8s/secret-manager.js';
import { MockKubernetesSecretClient } from '../helpers/mock-secret-client.js';
import { AdminService } from '../../src/admin/admin-service.js';
import { createAdminRouter } from '../../src/http/admin.js';
import { FakeAuthenticator } from '../helpers/fake-authenticator.js';

describe('Gate G7: Administrative REST API (/admin/v1) Unit Tests', () => {
  let db: DatabaseSync;
  let upstreamRepo: UpstreamRepository;
  let catalogService: CatalogService;
  let upstreamManager: UpstreamManager;
  let auditRepo: AuditRepository;
  let auditService: AuditService;
  let mockK8sClient: MockKubernetesSecretClient;
  let secretManager: SecretManager;
  let adminService: AdminService;
  let fakeAuth: FakeAuthenticator;
  let app: express.Application;

  const adminUser = { id: 'usr-admin', username: 'admin', role: 'admin' as const };
  const memberUser = { id: 'usr-member', username: 'member', role: 'member' as const };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS) {
      db.exec(m.sql);
    }

    db.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?);').run(
      adminUser.id,
      adminUser.username,
      adminUser.role,
      Math.floor(Date.now() / 1000)
    );
    db.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?);').run(
      memberUser.id,
      memberUser.username,
      memberUser.role,
      Math.floor(Date.now() / 1000)
    );

    upstreamRepo = new UpstreamRepository(db);
    catalogService = new CatalogService();
    mockK8sClient = new MockKubernetesSecretClient();
    secretManager = new SecretManager(mockK8sClient, {
      namespace: 'urumi-gateway-secrets',
    });
    auditRepo = new AuditRepository(db);
    auditService = new AuditService(auditRepo);

    upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
      allowLocalhostForTesting: true,
      credentialsResolver: (name) => secretManager.getSecretData(name),
    });

    adminService = new AdminService(
      upstreamRepo,
      secretManager,
      upstreamManager,
      auditService,
      {
        allowLocalhostForTesting: true,
      }
    );

    fakeAuth = new FakeAuthenticator();
    fakeAuth.registerKey('admin_token', adminUser);
    fakeAuth.registerKey('member_token', memberUser);

    app = express();
    app.use('/admin/v1', createAdminRouter(fakeAuth, adminService));
  });

  async function requestApi(
    method: string,
    path: string,
    body?: unknown,
    token?: string
  ): Promise<{ status: number; data: any; headers: Headers }> {
    const server = await new Promise<import('node:net').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as any).port;

    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      let payload: string | undefined;
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers,
        body: payload,
      });

      let data: any = null;
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      return { status: res.status, data, headers: res.headers };
    } finally {
      server.close();
    }
  }

  test('rejects unauthenticated requests with HTTP 401 Unauthorized', async () => {
    const res = await requestApi('GET', '/admin/v1/upstreams');
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'Unauthorized: Missing Authorization header');
  });

  test('rejects member key with HTTP 403 Forbidden across admin routes', async () => {
    const resGet = await requestApi('GET', '/admin/v1/upstreams', undefined, 'member_token');
    assert.equal(resGet.status, 403);
    assert.equal(resGet.data.error, 'Forbidden: Administrative privileges required');

    const resPost = await requestApi('POST', '/admin/v1/upstreams', {}, 'member_token');
    assert.equal(resPost.status, 403);
    assert.equal(resPost.data.error, 'Forbidden: Administrative privileges required');
  });

  test('admin key lists existing upstreams with 200 OK', async () => {
    upstreamRepo.insertUpstream({
      slug: 'crm',
      displayName: 'CRM Service',
      endpointUrl: 'http://urumi-mcp-crm.urumi.svc.cluster.local:3000/mcp',
      status: 'active',
    });

    const res = await requestApi('GET', '/admin/v1/upstreams', undefined, 'admin_token');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.upstreams));
    assert.equal(res.data.upstreams.length, 1);
    assert.equal(res.data.upstreams[0].slug, 'crm');
    assert.equal(res.data.upstreams[0].displayName, 'CRM Service');
    assert.equal(res.data.upstreams[0].credential, undefined);
  });

  test('admin key creates an upstream with 201 Created and zero credential leak', async () => {
    upstreamManager.registerAndDiscover = async (row) => ({
      slug: row.slug,
      tools: [],
      discoveredAt: Date.now(),
    });

    const body = {
      slug: 'tasks',
      displayName: 'Tasks MCP Service',
      endpointUrl: 'http://urumi-mcp-tasks.urumi.svc.cluster.local:3000/mcp',
      timeoutMs: 12000,
      credential: 'my-sensitive-token-12345',
    };

    const res = await requestApi('POST', '/admin/v1/upstreams', body, 'admin_token');
    assert.equal(res.status, 201);
    assert.ok(res.data.upstream);
    assert.equal(res.data.upstream.slug, 'tasks');
    assert.equal(res.data.upstream.displayName, 'Tasks MCP Service');
    assert.equal(res.data.upstream.timeoutMs, 12000);
    assert.equal(res.data.upstream.status, 'active');
    assert.ok(res.data.upstream.secretRefName);

    // CRITICAL: Ensure raw credential does NOT leak in response
    assert.equal(res.data.upstream.credential, undefined);
    assert.equal(res.data.upstream.token, undefined);
    assert.ok(!JSON.stringify(res.data).includes('my-sensitive-token-12345'));
  });

  test('admin creates upstream without secrets (unauthenticated service)', async () => {
    upstreamManager.registerAndDiscover = async (row) => ({
      slug: row.slug,
      tools: [],
      discoveredAt: Date.now(),
    });

    const body = {
      slug: 'crm-no-secret',
      displayName: 'CRM Internal Mock',
      endpointUrl: 'http://urumi-mcp-crm.urumi.svc.cluster.local:3000/mcp',
      timeoutMs: 8000,
    };

    const res = await requestApi('POST', '/admin/v1/upstreams', body, 'admin_token');
    assert.equal(res.status, 201);
    assert.equal(res.data.upstream.secretRefName, null);
    assert.equal(res.data.upstream.status, 'active');

    // Confirm no Secret was created in K8s
    const secrets = mockK8sClient.getAllSecrets();
    const found = secrets.find((s) => s.labels['urumi.io/upstream-slug'] === 'crm-no-secret');
    assert.equal(found, undefined);
  });

  test('admin creates upstream with multi-key credentials map', async () => {
    upstreamManager.registerAndDiscover = async (row) => ({
      slug: row.slug,
      tools: [],
      discoveredAt: Date.now(),
    });

    const body = {
      slug: 'custom-auth-svc',
      displayName: 'Custom Auth Service',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      credentials: {
        consumerKey: 'ck_abc123',
        consumerSecret: 'cs_xyz789',
      },
    };

    const res = await requestApi('POST', '/admin/v1/upstreams', body, 'admin_token');
    assert.equal(res.status, 201);
    assert.ok(res.data.upstream.secretRefName);

    // Assert Secret in K8s has both keys
    const stored = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', res.data.upstream.secretRefName);
    assert.ok(stored);
    assert.equal(stored.data['consumerKey'], 'ck_abc123');
    assert.equal(stored.data['consumerSecret'], 'cs_xyz789');
  });

  test('rejects invalid request body with 400 Bad Request', async () => {
    const invalidBody = {
      slug: 'INVALID_SLUG',
      displayName: 'Invalid',
    };

    const res = await requestApi('POST', '/admin/v1/upstreams', invalidBody, 'admin_token');
    assert.equal(res.status, 400);
    assert.ok(res.data.error.includes('Validation Error'));
  });

  test('rejects SSRF endpointUrl violations with 400 Bad Request via canonical allowlist', async () => {
    const ssrfBody = {
      slug: 'ssrf-target',
      displayName: 'SSRF Attack',
      endpointUrl: 'http://169.254.169.254/latest/meta-data',
    };

    const res = await requestApi('POST', '/admin/v1/upstreams', ssrfBody, 'admin_token');
    assert.equal(res.status, 400);
    assert.ok(res.data.error.includes('Validation Error') || res.data.error.includes('endpointUrl'));
  });

  test('rejects payload exceeding 64 KiB with 413 Payload Too Large', async () => {
    const oversizedBody = {
      slug: 'huge-payload',
      displayName: 'Huge',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      credential: 'x'.repeat(70000), // > 64 KiB
    };

    const res = await requestApi('POST', '/admin/v1/upstreams', oversizedBody, 'admin_token');
    assert.equal(res.status, 413);
    assert.ok(res.data.error.includes('Payload Too Large'));
  });

  test('rejects malformed JSON syntax with 400 Bad Request', async () => {
    const res = await requestApi('POST', '/admin/v1/upstreams', '{ malformed json: ', 'admin_token');
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'Bad Request: Malformed JSON payload');
  });

  test('GET /upstreams/:id returns 200 for existing and 404 for non-existent', async () => {
    upstreamRepo.insertUpstream({
      slug: 'demo-get',
      displayName: 'Demo Get',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'active',
    });

    const resFound = await requestApi('GET', '/admin/v1/upstreams/demo-get', undefined, 'admin_token');
    assert.equal(resFound.status, 200);
    assert.equal(resFound.data.upstream.slug, 'demo-get');

    const resNotFound = await requestApi('GET', '/admin/v1/upstreams/non-existent', undefined, 'admin_token');
    assert.equal(resNotFound.status, 404);
    assert.equal(resNotFound.data.error, 'Upstream "non-existent" not found');
  });

  test('PATCH /upstreams/:id updates configuration with 200 OK', async () => {
    upstreamRepo.insertUpstream({
      slug: 'demo-patch',
      displayName: 'Old Name',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      timeoutMs: 5000,
      status: 'active',
    });

    const patchBody = {
      displayName: 'New Name',
      timeoutMs: 25000,
    };

    const res = await requestApi('PATCH', '/admin/v1/upstreams/demo-patch', patchBody, 'admin_token');
    assert.equal(res.status, 200);
    assert.equal(res.data.upstream.displayName, 'New Name');
    assert.equal(res.data.upstream.timeoutMs, 25000);
  });

  test('POST /upstreams/:id/disable and /enable toggle operational state', async () => {
    upstreamRepo.insertUpstream({
      slug: 'demo-toggle',
      displayName: 'Toggle Upstream',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'active',
      isEnabled: 1,
    });

    // Disable
    const resDisable = await requestApi('POST', '/admin/v1/upstreams/demo-toggle/disable', {}, 'admin_token');
    assert.equal(resDisable.status, 200);
    assert.equal(resDisable.data.upstream.status, 'disabled');
    assert.equal(resDisable.data.upstream.isEnabled, false);

    // Enable
    const resEnable = await requestApi('POST', '/admin/v1/upstreams/demo-toggle/enable', {}, 'admin_token');
    assert.equal(resEnable.status, 200);
    assert.equal(resEnable.data.upstream.status, 'active');
    assert.equal(resEnable.data.upstream.isEnabled, true);
  });

  test('DELETE /upstreams/:id deletes upstream and Secret with 200 OK', async () => {
    const row = upstreamRepo.insertUpstream({
      slug: 'demo-delete',
      displayName: 'Delete Target',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'active',
      secretRefName: 'upstream-sec-demo-delete-77777777',
    });

    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: row.secret_ref_name!,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'demo-delete',
      },
      stringData: { token: 'tok' },
    });

    const res = await requestApi('DELETE', '/admin/v1/upstreams/demo-delete', undefined, 'admin_token');
    assert.equal(res.status, 200);
    assert.equal(res.data.slug, 'demo-delete');

    // Verify absent
    const resCheck = await requestApi('GET', '/admin/v1/upstreams/demo-delete', undefined, 'admin_token');
    assert.equal(resCheck.status, 404);
  });

  test('DELETE /upstreams/:id fails safely to 502 and preserves row in cleanup_required if Secret deletion fails', async () => {
    const row = upstreamRepo.insertUpstream({
      slug: 'fail-delete-svc',
      displayName: 'Fail Delete Target',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'active',
      secretRefName: 'upstream-sec-fail-delete-88888888',
    });

    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: row.secret_ref_name!,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'fail-delete-svc',
      },
      stringData: { token: 'tok' },
    });

    mockK8sClient.failNext('deleteSecret', new Error('K8s API Timeout during delete'));

    const res = await requestApi('DELETE', '/admin/v1/upstreams/fail-delete-svc', undefined, 'admin_token');
    assert.equal(res.status, 502);
    assert.ok(res.data.error.includes('cleanup_required'));

    // Check that row was preserved in cleanup_required (Point 3)
    const preserved = upstreamRepo.getUpstreamBySlug('fail-delete-svc');
    assert.ok(preserved);
    assert.equal(preserved.status, 'cleanup_required');
    assert.ok(preserved.cleanup_error?.includes('K8s API Timeout'));
  });

  test('unmatched route under /admin/v1 returns 404 Not Found', async () => {
    const res = await requestApi('GET', '/admin/v1/unsupported-endpoint', undefined, 'admin_token');
    assert.equal(res.status, 404);
    assert.equal(res.data.error, 'Not Found');
  });
});
