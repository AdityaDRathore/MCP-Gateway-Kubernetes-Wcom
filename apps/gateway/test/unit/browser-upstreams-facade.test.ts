import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../../src/db/schema.js';
import { parseConfig } from '../../src/config.js';
import { createBrowserApp } from '../../src/server.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { UpstreamRepository } from '../../src/db/upstream-repo.js';
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService } from '../../src/audit/audit-service.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { SessionService, SESSION_COOKIE_NAME } from '../../src/auth/session-service.js';
import { CatalogService } from '../../src/upstream/catalog-service.js';
import { UpstreamManager } from '../../src/upstream/upstream-manager.js';
import { SecretManager } from '../../src/k8s/secret-manager.js';
import { MockKubernetesSecretClient } from '../helpers/mock-secret-client.js';
import { AdminService } from '../../src/admin/admin-service.js';
import { CatalogTool, UpstreamStatusSummary } from '../../src/upstream/types.js';

describe('Gate P5-G3: Upstream & Tool Management Browser Façade Unit Tests', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let upstreamRepo: UpstreamRepository;
  let auditRepo: AuditRepository;
  let auditService: AuditService;
  let mockK8sClient: MockKubernetesSecretClient;
  let secretManager: SecretManager;
  let catalogService: CatalogService;
  let upstreamManager: UpstreamManager;
  let adminService: AdminService;
  let passwordService: ScryptPasswordService;
  let sessionService: SessionService;

  let browserServer: http.Server;
  let browserPort: number;

  const allowedOrigin = 'http://dashboard.127.0.0.1.nip.io:8080';
  let adminCookie: string;
  let adminCsrfToken: string;
  let memberCookie: string;
  let memberCsrfToken: string;

  before(async () => {
    db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS) {
      db.exec(m.sql);
    }

    userRepo = new UserRepository(db);
    sessionRepo = new SessionRepository(db);
    upstreamRepo = new UpstreamRepository(db);
    auditRepo = new AuditRepository(db);
    auditService = new AuditService(auditRepo);
    passwordService = new ScryptPasswordService();
    sessionService = new SessionService(sessionRepo, userRepo);

    mockK8sClient = new MockKubernetesSecretClient();
    secretManager = new SecretManager(mockK8sClient, {
      namespace: 'urumi-gateway-secrets',
    });
    catalogService = new CatalogService();

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

    // Create users: admin and member
    const adminHash = await passwordService.hashPassword('AdminPass123!');
    userRepo.insertUser({
      id: 'usr-admin-1',
      username: 'admin',
      role: 'admin',
      is_active: 1,
    });
    userRepo.setUserCredentials('usr-admin-1', adminHash);

    const memberHash = await passwordService.hashPassword('MemberPass123!');
    userRepo.insertUser({
      id: 'usr-member-1',
      username: 'member',
      role: 'member',
      is_active: 1,
    });
    userRepo.setUserCredentials('usr-member-1', memberHash);

    // Seed baseline upstreams into SQLite
    upstreamRepo.insertUpstream({
      id: 'ups-wc-1',
      slug: 'woocommerce',
      displayName: 'WooCommerce MCP',
      endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
      timeoutMs: 10000,
      isEnabled: 1,
      status: 'active',
      secretRefName: 'urumi-wc-secret-ref',
    });

    upstreamRepo.insertUpstream({
      id: 'ups-crm-1',
      slug: 'crm',
      displayName: 'CRM MCP',
      endpointUrl: 'http://urumi-mcp-crm.urumi.svc.cluster.local:3000/mcp',
      timeoutMs: 5000,
      isEnabled: 1,
      status: 'active',
      secretRefName: null,
    });

    // Populate catalog snapshot with tools
    const mockTools: CatalogTool[] = [
      {
        name: 'woocommerce__list_products',
        originalName: 'list_products',
        upstreamSlug: 'woocommerce',
        description: 'List products in catalog',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'woocommerce__get_order',
        originalName: 'get_order',
        upstreamSlug: 'woocommerce',
        description: 'Get single order',
        inputSchema: { type: 'object', properties: { order_id: { type: 'number' } } },
      },
      {
        name: 'crm__search_contacts',
        originalName: 'search_contacts',
        upstreamSlug: 'crm',
        description: 'Search CRM contacts',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ];

    const mockStatuses: UpstreamStatusSummary[] = [
      {
        slug: 'woocommerce',
        healthState: 'available',
        persistedStatus: 'active',
        isEnabled: true,
        toolCount: 2,
        lastCheckedAt: 1792400000,
      },
      {
        slug: 'crm',
        healthState: 'available',
        persistedStatus: 'active',
        isEnabled: true,
        toolCount: 1,
        lastCheckedAt: 1792400100,
      },
    ];

    catalogService.updateSnapshot(
      [
        { slug: 'woocommerce', tools: [mockTools[0], mockTools[1]] },
        { slug: 'crm', tools: [mockTools[2]] },
      ],
      mockStatuses
    );

    // Create browser server
    const config = parseConfig({
      PORT: '3000',
      BROWSER_PORT: '3001',
      ALLOWED_ORIGINS: allowedOrigin,
      COOKIE_SECURE: 'false',
      TRUSTED_PROXIES: '127.0.0.1,::1',
    });

    const browserApp = createBrowserApp({
      config,
      sessionService,
      userRepo,
      passwordService,
      adminService,
      catalogService,
    });

    browserServer = http.createServer(browserApp);
    await new Promise<void>((resolve) => browserServer.listen(0, '127.0.0.1', () => resolve()));
    browserPort = (browserServer.address() as any).port;

    // Create session for admin
    const adminSession = await sessionService.createSession('usr-admin-1', {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
    adminCookie = `${SESSION_COOKIE_NAME}=${adminSession.rawToken}`;
    adminCsrfToken = adminSession.csrfToken;

    // Create session for member
    const memberSession = await sessionService.createSession('usr-member-1', {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
    memberCookie = `${SESSION_COOKIE_NAME}=${memberSession.rawToken}`;
    memberCsrfToken = memberSession.csrfToken;
  });

  after(async () => {
    await new Promise<void>((resolve) => browserServer.close(() => resolve()));
    db.close();
  });

  // Helper for issuing browser requests
  async function makeRequest(
    method: string,
    pathname: string,
    options: {
      cookie?: string;
      csrfToken?: string;
      origin?: string;
      body?: unknown;
    } = {}
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; rawBody: string }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Host: `127.0.0.1:${browserPort}`,
      };

      if (options.cookie) {
        headers['Cookie'] = options.cookie;
      }
      if (options.csrfToken) {
        headers['X-Urumi-CSRF'] = options.csrfToken;
      }
      if (options.origin !== undefined) {
        if (options.origin) {
          headers['Origin'] = options.origin;
        }
      } else {
        headers['Origin'] = allowedOrigin;
      }

      let payload: string | undefined;
      if (options.body !== undefined) {
        payload = JSON.stringify(options.body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload).toString();
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: browserPort,
          path: pathname,
          method,
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            let parsed: any;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: parsed,
              rawBody: data,
            });
          });
        }
      );

      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  // =========================================================================
  // 1. Read Endpoints & Safe DTO Projection (Admin & Member)
  // =========================================================================

  it('1. GET /api/v1/browser/upstreams: Admin lists all upstreams with safe DTO projection', async () => {
    const res = await makeRequest('GET', '/api/v1/browser/upstreams', {
      cookie: adminCookie,
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.upstreams));
    assert.equal(res.body.upstreams.length, 2);

    const wc = res.body.upstreams.find((u: any) => u.slug === 'woocommerce');
    assert.ok(wc);
    assert.equal(wc.id, 'ups-wc-1');
    assert.equal(wc.slug, 'woocommerce');
    assert.equal(wc.displayName, 'WooCommerce MCP');
    assert.equal(wc.endpointUrl, 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp');
    assert.equal(wc.timeoutMs, 10000);
    assert.equal(wc.isEnabled, true);
    assert.equal(wc.status, 'active');
    assert.equal(wc.health.state, 'disabled');
    assert.equal(wc.health.toolCount, 0);
    assert.equal(wc.health.lastCheck, null);
    assert.equal(wc.health.lastError, null);

    // CRITICAL SECURITY INVARIANT: internal secretRefName must be completely omitted
    assert.equal(wc.secretRefName, undefined, 'secretRefName must NOT be exposed in browser DTO');
    assert.equal(wc.cleanupError, undefined, 'cleanupError must NOT be exposed in browser DTO');
  });

  it('2. GET /api/v1/browser/upstreams: Member can list upstreams with identical safe projection', async () => {
    const res = await makeRequest('GET', '/api/v1/browser/upstreams', {
      cookie: memberCookie,
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.upstreams));
    assert.equal(res.body.upstreams.length, 2);

    for (const u of res.body.upstreams) {
      assert.equal(u.secretRefName, undefined, 'secretRefName must NOT be present for member');
    }
  });

  it('3. GET /api/v1/browser/upstreams/:id: returns upstream detail by ID or slug', async () => {
    // Lookup by slug
    const resSlug = await makeRequest('GET', '/api/v1/browser/upstreams/woocommerce', {
      cookie: adminCookie,
    });
    assert.equal(resSlug.status, 200);
    assert.equal(resSlug.body.upstream.slug, 'woocommerce');
    assert.equal(resSlug.body.upstream.secretRefName, undefined);

    // Lookup by UUID
    const resId = await makeRequest('GET', '/api/v1/browser/upstreams/ups-wc-1', {
      cookie: memberCookie,
    });
    assert.equal(resId.status, 200);
    assert.equal(resId.body.upstream.slug, 'woocommerce');

    // Nonexistent upstream returns 404
    const res404 = await makeRequest('GET', '/api/v1/browser/upstreams/nonexistent-upstream', {
      cookie: adminCookie,
    });
    assert.equal(res404.status, 404);
    assert.equal(res404.body.code, 'NOT_FOUND');
  });

  it('4. GET /api/v1/browser/upstreams/:id/tools: returns tools for the upstream from live catalog snapshot', async () => {
    const res = await makeRequest('GET', '/api/v1/browser/upstreams/woocommerce/tools', {
      cookie: memberCookie,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.upstreamSlug, 'woocommerce');
    assert.equal(res.body.toolCount, 2);
    assert.ok(Array.isArray(res.body.tools));
    assert.equal(res.body.tools.length, 2);

    const listProd = res.body.tools.find((t: any) => t.name === 'list_products');
    assert.ok(listProd);
    assert.equal(listProd.publicName, 'woocommerce__list_products');
    assert.equal(listProd.description, 'List products in catalog');
    assert.deepEqual(listProd.inputSchema, { type: 'object', properties: {} });

    // Unknown upstream tools returns 404
    const resUnknown = await makeRequest('GET', '/api/v1/browser/upstreams/unknown-slug/tools', {
      cookie: adminCookie,
    });
    assert.equal(resUnknown.status, 404);
  });

  it('5. Unauthenticated read requests are rejected with 401 SESSION_MISSING', async () => {
    const res1 = await makeRequest('GET', '/api/v1/browser/upstreams');
    assert.equal(res1.status, 401);
    assert.equal(res1.body.code, 'SESSION_MISSING');

    const res2 = await makeRequest('GET', '/api/v1/browser/upstreams/woocommerce');
    assert.equal(res2.status, 401);
    assert.equal(res2.body.code, 'SESSION_MISSING');

    const res3 = await makeRequest('GET', '/api/v1/browser/upstreams/woocommerce/tools');
    assert.equal(res3.status, 401);
    assert.equal(res3.body.code, 'SESSION_MISSING');
  });

  // =========================================================================
  // 2. Role Authorization (ROLE-NEG-01): Member Mutations Forbidden
  // =========================================================================

  it('6. ROLE-NEG-01: Member calling any mutating endpoint receives HTTP 403 Forbidden', async () => {
    // POST /upstreams
    const postRes = await makeRequest('POST', '/api/v1/browser/upstreams', {
      cookie: memberCookie,
      csrfToken: memberCsrfToken,
      body: {
        slug: 'member-attempt',
        displayName: 'Member Attempt',
        endpointUrl: 'http://urumi-test.urumi.svc.cluster.local:3000/mcp',
      },
    });
    assert.equal(postRes.status, 403);
    assert.equal(postRes.body.code, 'FORBIDDEN');

    // PATCH /upstreams/:id
    const patchRes = await makeRequest('PATCH', '/api/v1/browser/upstreams/woocommerce', {
      cookie: memberCookie,
      csrfToken: memberCsrfToken,
      body: { displayName: 'Hacked WC' },
    });
    assert.equal(patchRes.status, 403);
    assert.equal(patchRes.body.code, 'FORBIDDEN');

    // POST /upstreams/:id/enable
    const enableRes = await makeRequest('POST', '/api/v1/browser/upstreams/woocommerce/enable', {
      cookie: memberCookie,
      csrfToken: memberCsrfToken,
    });
    assert.equal(enableRes.status, 403);
    assert.equal(enableRes.body.code, 'FORBIDDEN');

    // POST /upstreams/:id/disable
    const disableRes = await makeRequest('POST', '/api/v1/browser/upstreams/woocommerce/disable', {
      cookie: memberCookie,
      csrfToken: memberCsrfToken,
    });
    assert.equal(disableRes.status, 403);
    assert.equal(disableRes.body.code, 'FORBIDDEN');

    // DELETE /upstreams/:id
    const deleteRes = await makeRequest('DELETE', '/api/v1/browser/upstreams/woocommerce', {
      cookie: memberCookie,
      csrfToken: memberCsrfToken,
    });
    assert.equal(deleteRes.status, 403);
    assert.equal(deleteRes.body.code, 'FORBIDDEN');

    // POST /upstreams/:id/retry-cleanup
    const retryRes = await makeRequest('POST', '/api/v1/browser/upstreams/woocommerce/retry-cleanup', {
      cookie: memberCookie,
      csrfToken: memberCsrfToken,
    });
    assert.equal(retryRes.status, 403);
    assert.equal(retryRes.body.code, 'FORBIDDEN');
  });

  // =========================================================================
  // 3. CSRF & Origin Security Controls on Mutating Endpoints
  // =========================================================================

  it('7. CSRF-NEG-01: Admin mutation rejected when X-Urumi-CSRF header is missing or invalid', async () => {
    // Missing CSRF
    const resMissing = await makeRequest('POST', '/api/v1/browser/upstreams', {
      cookie: adminCookie,
      body: {
        slug: 'csrf-test-1',
        displayName: 'CSRF Test 1',
        endpointUrl: 'http://urumi-test.urumi.svc.cluster.local:3000/mcp',
      },
    });
    assert.equal(resMissing.status, 403);
    assert.equal(resMissing.body.code, 'CSRF_TOKEN_INVALID');

    // Invalid CSRF
    const resInvalid = await makeRequest('POST', '/api/v1/browser/upstreams', {
      cookie: adminCookie,
      csrfToken: '00'.repeat(32), // wrong token
      body: {
        slug: 'csrf-test-2',
        displayName: 'CSRF Test 2',
        endpointUrl: 'http://urumi-test.urumi.svc.cluster.local:3000/mcp',
      },
    });
    assert.equal(resInvalid.status, 403);
    assert.equal(resInvalid.body.code, 'CSRF_TOKEN_INVALID');
  });

  it('8. CSRF-NEG-02: Admin mutation rejected when Origin is not in canonical allowlist', async () => {
    const res = await makeRequest('POST', '/api/v1/browser/upstreams', {
      cookie: adminCookie,
      csrfToken: adminCsrfToken,
      origin: 'http://malicious-attacker.com',
      body: {
        slug: 'origin-test',
        displayName: 'Origin Test',
        endpointUrl: 'http://urumi-test.urumi.svc.cluster.local:3000/mcp',
      },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'CSRF_ORIGIN_FORBIDDEN');
  });

  // =========================================================================
  // 4. SSRF Prevention & Endpoint Validation (THREAT-10)
  // =========================================================================

  it('9. THREAT-10: Upstream creation rejects loopback, AWS metadata, and invalid internal endpoints', async () => {
    const prohibitedUrls = [
      'http://169.254.169.254/latest/meta-data/', // AWS metadata
      'http://10.0.0.1:3000/mcp',                 // Private IP literal
      'http://192.168.1.1:3000/mcp',              // Private IP literal
      'http://[fd00::1]:3000/mcp',                // IPv6 private address
      'http://database.internal:3000/mcp',        // Non-approved domain
      'ftp://urumi-mcp-tasks.urumi.svc.cluster.local:3000/mcp', // Bad protocol
      'http://urumi-mariadb.urumi.svc.cluster.local:3000/mcp', // Blacklisted internal host
      'http://urumi-wordpress.urumi.svc.cluster.local:3000/mcp', // Blacklisted internal host
      'http://urumi-gateway.urumi.svc.cluster.local:3000/mcp', // Blacklisted internal host
      'http://kubernetes.default.svc.cluster.local:3000/mcp', // Blacklisted k8s API
      'http://urumi-mcp-tasks.urumi.svc.cluster.local:80/mcp', // Unapproved port 80
      'http://urumi-unknown.urumi.svc.cluster.local:3000/mcp', // Unapproved service
    ];

    let i = 0;
    for (const endpointUrl of prohibitedUrls) {
      i++;
      const res = await makeRequest('POST', '/api/v1/browser/upstreams', {
        cookie: adminCookie,
        csrfToken: adminCsrfToken,
        body: {
          slug: `ssrf-test-${i}`,
          displayName: `SSRF Test ${i}`,
          endpointUrl,
        },
      });

      assert.equal(res.status, 400, `Expected 400 Bad Request for prohibited URL: ${endpointUrl}`);
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    }
  });

  // =========================================================================
  // 5. Zero Canary Secret Leakage (THREAT-09, SECR-SCAN-01)
  // =========================================================================

  it('10. THREAT-09 & SECR-SCAN-01: Raw canary credentials never appear in API responses, headers, or DTOs', async () => {
    const canarySecret = 'CANARY_SEC_XYZ123_SUPER_SECRET';

    // Create upstream with canary secret
    const createRes = await makeRequest('POST', '/api/v1/browser/upstreams', {
      cookie: adminCookie,
      csrfToken: adminCsrfToken,
      body: {
        slug: 'canary-service',
        displayName: 'Canary Service',
        endpointUrl: 'http://urumi-mcp-tasks.urumi.svc.cluster.local:3000/mcp',
        timeoutMs: 8000,
        credential: canarySecret,
      },
    });

    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.upstream.slug, 'canary-service');
    assert.equal(createRes.body.upstream.secretRefName, undefined);

    // Verify raw secret does NOT appear anywhere in the response text
    assert.doesNotMatch(
      createRes.rawBody,
      new RegExp(canarySecret),
      'Canary secret must not appear in create response body'
    );
    assert.doesNotMatch(
      JSON.stringify(createRes.headers),
      new RegExp(canarySecret),
      'Canary secret must not appear in create response headers'
    );

    // Fetch upstream detail
    const getRes = await makeRequest('GET', '/api/v1/browser/upstreams/canary-service', {
      cookie: adminCookie,
    });
    assert.equal(getRes.status, 200);
    assert.doesNotMatch(
      getRes.rawBody,
      new RegExp(canarySecret),
      'Canary secret must not appear in get response body'
    );

    // List upstreams
    const listRes = await makeRequest('GET', '/api/v1/browser/upstreams', {
      cookie: adminCookie,
    });
    assert.equal(listRes.status, 200);
    assert.doesNotMatch(
      listRes.rawBody,
      new RegExp(canarySecret),
      'Canary secret must not appear in list response body'
    );

    // Rotate credential via PATCH
    const newCanarySecret = 'CANARY_ROTATED_789_NEW_SECRET';
    const patchRes = await makeRequest('PATCH', '/api/v1/browser/upstreams/canary-service', {
      cookie: adminCookie,
      csrfToken: adminCsrfToken,
      body: {
        displayName: 'Canary Rotated',
        credential: newCanarySecret,
      },
    });

    assert.equal(patchRes.status, 200);
    assert.doesNotMatch(
      patchRes.rawBody,
      new RegExp(newCanarySecret),
      'Rotated canary secret must not appear in patch response body'
    );
  });

  // =========================================================================
  // 6. Upstream Administrative Lifecycle (Admin Operations)
  // =========================================================================

  it('11. Full Admin Upstream Lifecycle: PATCH, enable, disable, retry-cleanup, and DELETE', async () => {
    // 1. PATCH displayName & timeout
    const patchRes = await makeRequest('PATCH', '/api/v1/browser/upstreams/canary-service', {
      cookie: adminCookie,
      csrfToken: adminCsrfToken,
      body: {
        displayName: 'Canary Service Updated',
        timeoutMs: 12000,
      },
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.upstream.displayName, 'Canary Service Updated');
    assert.equal(patchRes.body.upstream.timeoutMs, 12000);
    assert.equal(patchRes.body.upstream.secretRefName, undefined);

    // 2. Disable upstream
    const disableRes = await makeRequest('POST', '/api/v1/browser/upstreams/canary-service/disable', {
      cookie: adminCookie,
      csrfToken: adminCsrfToken,
    });
    assert.equal(disableRes.status, 200);
    assert.equal(disableRes.body.upstream.status, 'disabled');
    assert.equal(disableRes.body.upstream.isEnabled, false);

    // 3. Enable upstream
    const enableRes = await makeRequest('POST', '/api/v1/browser/upstreams/canary-service/enable', {
      cookie: adminCookie,
      csrfToken: adminCsrfToken,
    });
    assert.equal(enableRes.status, 200);
    assert.equal(enableRes.body.upstream.status, 'active');
    assert.equal(enableRes.body.upstream.isEnabled, true);

    // 4. Retry cleanup on non-cleanup_required upstream returns message gracefully
    const retryRes = await makeRequest('POST', '/api/v1/browser/upstreams/canary-service/retry-cleanup', {
      cookie: adminCookie,
      csrfToken: adminCsrfToken,
    });
    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.body.slug, 'canary-service');

    // 5. Delete upstream
    const deleteRes = await makeRequest('DELETE', '/api/v1/browser/upstreams/canary-service', {
      cookie: adminCookie,
      csrfToken: adminCsrfToken,
    });
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.slug, 'canary-service');

    // Confirm upstream is gone
    const verify404 = await makeRequest('GET', '/api/v1/browser/upstreams/canary-service', {
      cookie: adminCookie,
    });
    assert.equal(verify404.status, 404);
  });
});
