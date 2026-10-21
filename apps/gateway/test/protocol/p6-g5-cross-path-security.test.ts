import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { parseConfig } from '../../src/config.js';
import { createExpressApp, createBrowserApp } from '../../src/server.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { SessionService, SESSION_COOKIE_NAME } from '../../src/auth/session-service.js';
import { ApiKeyRepository } from '../../src/db/api-key-repo.js';
import { ApiKeyService } from '../../src/auth/api-key-service.js';
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService } from '../../src/audit/audit-service.js';
import { UpstreamRepository } from '../../src/db/upstream-repo.js';
import { CatalogService } from '../../src/upstream/catalog-service.js';
import { UpstreamManager } from '../../src/upstream/upstream-manager.js';
import { ToolRouter } from '../../src/upstream/tool-router.js';
import { ConfirmationManager } from '../../src/chat/confirmation.js';
import { AgentLoopOrchestrator } from '../../src/chat/agent-loop.js';
import {
  ModelProvider,
  ModelRequestOptions,
  ModelResponse,
  ProviderUnconfiguredError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from '../../src/chat/types.js';
import { DatabaseAuthenticator } from '../../src/auth/database-authenticator.js';
import { parseCookies } from '../../src/http/browser-middleware.js';

describe('Phase 6 Gate P6-G5: Cross-Path Security and Regression Protocol Suite', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let passwordService: ScryptPasswordService;
  let sessionService: SessionService;
  let apiKeyRepo: ApiKeyRepository;
  let apiKeyService: ApiKeyService;
  let auditRepo: AuditRepository;
  let auditService: AuditService;
  let catalogService: CatalogService;
  let router: ToolRouter;
  let confirmationManager: ConfirmationManager;
  let agentLoop: AgentLoopOrchestrator;

  let mcpServer: http.Server;
  let browserServer: http.Server;
  let mcpPort: number;
  let browserPort: number;

  const allowedOrigin = 'http://dashboard.127.0.0.1.nip.io:8080';

  let aliceRawKey: string;
  let aliceKeyId: string;
  let bobRawKey: string;
  let bobKeyId: string;
  let charlieRawKey: string;
  let charlieKeyId: string;

  // Mock Provider state controls
  let mockProviderMode: 'normal' | 'timeout' | 'ratelimit' | 'unconfigured' | 'unknown_tool' | 'infinite_loop' | 'canary_leak' = 'normal';
  let loopCallCount = 0;

  const CANARY_SECRET = 'urumi_live_canary999999999999999999999999';
  const CANARY_GEMINI_KEY = 'AIzaSyCanarySecretKey999999999999999123';

  const mockProvider: ModelProvider = {
    name: 'p6-g5-mock-provider',
    isConfigured: () => mockProviderMode !== 'unconfigured',
    generateChatTurn: async (options: ModelRequestOptions): Promise<ModelResponse> => {
      if (mockProviderMode === 'unconfigured') {
        throw new ProviderUnconfiguredError('Gemini API key is unconfigured');
      }
      if (mockProviderMode === 'timeout') {
        throw new ProviderTimeoutError('Gemini model request timed out after deadline');
      }
      if (mockProviderMode === 'ratelimit') {
        throw new ProviderRateLimitError('Gemini model rate limit exceeded (HTTP 429)');
      }
      if (mockProviderMode === 'canary_leak') {
        return {
          content: `Leaked canary value is ${CANARY_SECRET} and provider value is ${CANARY_GEMINI_KEY}`,
          finishReason: 'stop',
        };
      }
      if (mockProviderMode === 'unknown_tool') {
        const lastMsg = options.messages[options.messages.length - 1];
        if (lastMsg.role === 'tool') {
          return {
            content: 'The requested tool was unknown. Handled safely.',
            finishReason: 'stop',
          };
        }
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_unknown_1',
              name: 'nonexistent__unknown_action',
              args: { query: 'test' },
            },
          ],
          finishReason: 'tool_calls',
        };
      }
      if (mockProviderMode === 'infinite_loop') {
        loopCallCount++;
        return {
          content: '',
          toolCalls: [
            {
              id: `call_loop_${loopCallCount}`,
              name: 'crm__search_contacts',
              args: { query: `loop-${loopCallCount}` },
            },
          ],
          finishReason: 'tool_calls',
        };
      }

      // Default normal behavior: if last message was tool result, finish with synthesized answer
      const lastMsg = options.messages[options.messages.length - 1];
      if (lastMsg && lastMsg.role === 'tool') {
        return {
          content: 'Here is the completed search result from CRM.',
          finishReason: 'stop',
        };
      }

      // Check user prompt to decide tool
      const userMsg = options.messages.find((m) => m.role === 'user');
      if (userMsg?.content?.includes('search contacts')) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_crm_1',
              name: 'crm__search_contacts',
              args: { query: 'Alice' },
            },
          ],
          finishReason: 'tool_calls',
        };
      }

      if (userMsg?.content?.includes('list orders')) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_woo_1',
              name: 'woocommerce__list_orders',
              args: {},
            },
          ],
          finishReason: 'tool_calls',
        };
      }

      return {
        content: 'Hello! I am your AI assistant.',
        finishReason: 'stop',
      };
    },
  };

  before(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    userRepo = new UserRepository(db);
    sessionRepo = new SessionRepository(db);
    passwordService = new ScryptPasswordService();
    sessionService = new SessionService(sessionRepo, userRepo);
    apiKeyRepo = new ApiKeyRepository(db);
    apiKeyService = new ApiKeyService(apiKeyRepo);
    auditRepo = new AuditRepository(db);
    auditService = new AuditService(auditRepo);

    // Seed test users
    const passwordHash = await passwordService.hashPassword('SecretPassword123!');

    // 1. Admin
    userRepo.insertUser({
      id: 'usr-admin-1',
      username: 'admin',
      role: 'admin',
      is_active: 1,
    });
    userRepo.setUserCredentials('usr-admin-1', passwordHash);

    // 2. Member Alice
    userRepo.insertUser({
      id: 'usr-alice-1',
      username: 'alice',
      role: 'member',
      is_active: 1,
    });
    userRepo.setUserCredentials('usr-alice-1', passwordHash);

    // 3. Member Bob
    userRepo.insertUser({
      id: 'usr-bob-1',
      username: 'bob',
      role: 'member',
      is_active: 1,
    });
    userRepo.setUserCredentials('usr-bob-1', passwordHash);

    // 4. Inactive Member Charlie
    userRepo.insertUser({
      id: 'usr-charlie-1',
      username: 'charlie',
      role: 'member',
      is_active: 0,
    });
    userRepo.setUserCredentials('usr-charlie-1', passwordHash);

    // Provision API keys
    const aliceKeyRes = apiKeyService.generateApiKey({
      userId: 'usr-alice-1',
      name: 'alice-test-key',
    });
    aliceRawKey = aliceKeyRes.rawKey;
    aliceKeyId = aliceKeyRes.apiKey.id;

    const bobKeyRes = apiKeyService.generateApiKey({
      userId: 'usr-bob-1',
      name: 'bob-test-key',
    });
    bobRawKey = bobKeyRes.rawKey;
    bobKeyId = bobKeyRes.apiKey.id;

    const charlieKeyRes = apiKeyService.generateApiKey({
      userId: 'usr-charlie-1',
      name: 'charlie-test-key',
    });
    charlieRawKey = charlieKeyRes.rawKey;
    charlieKeyId = charlieKeyRes.apiKey.id;

    // Upstream setup & Catalog
    const upstreamRepo = new UpstreamRepository(db);
    upstreamRepo.seedDefaults();

    catalogService = new CatalogService();
    const upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
      allowLocalhostForTesting: true,
    });
    upstreamManager.syncClientsWithRepository();

    catalogService.updateSnapshot(
      [
        {
          slug: 'crm',
          tools: [
            {
              name: 'crm__search_contacts',
              originalName: 'search_contacts',
              upstreamSlug: 'crm',
              description: 'Search contacts in CRM',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            },
          ],
        },
        {
          slug: 'woocommerce',
          tools: [
            {
              name: 'woocommerce__list_orders',
              originalName: 'list_orders',
              upstreamSlug: 'woocommerce',
              description: 'List orders from store',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ],
      [
        { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1 },
        { slug: 'woocommerce', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1 },
      ]
    );

    const config = parseConfig({
      PORT: '3000',
      BROWSER_PORT: '3001',
      ALLOWED_ORIGINS: allowedOrigin,
      COOKIE_SECURE: 'false',
      DASHBOARD_STATIC_PATH: path.resolve(process.cwd(), '../dashboard/dist'),
      TRUSTED_PROXIES: '127.0.0.1,::1',
      CHAT_TURN_TIMEOUT_MS: '30000',
      PROVIDER_TIMEOUT_MS: '15000',
    });

    router = new ToolRouter(catalogService, upstreamManager, auditService, config);
    // Controlled dispatch that executes audit lifecycle truthfully
    router.dispatch = async (opts) => {
      const startTime = Date.now();
      const auditId = auditService.startAudit({
        userId: opts.user?.id,
        upstreamSlug: opts.publicToolName.split('__')[0],
        toolName: opts.publicToolName,
        arguments: opts.arguments,
      });

      if (opts.publicToolName === 'woocommerce__list_orders') {
        auditService.finalizeAudit(auditId, {
          status: 'success',
          startTimeMs: startTime,
        });
        // Returns safe order with customer billing phone/email redacted/omitted
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify([
                {
                  id: 14,
                  status: 'processing',
                  total: '299.00',
                  currency: 'INR',
                  line_items: [{ id: 1, name: 'Urumi Test Mug', sku: 'URUMI-MUG-001', price: 299.0 }],
                  // Customer PII fields (billing phone, customer email) strictly omitted
                },
              ]),
            },
          ],
          isError: false,
        };
      }

      if (opts.publicToolName === 'crm__search_contacts') {
        auditService.finalizeAudit(auditId, {
          status: 'success',
          startTimeMs: startTime,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                contacts: [{ id: 'CRM-CONT-001', name: 'Alice Smith', email: 'alice@example.com' }],
              }),
            },
          ],
          isError: false,
        };
      }

      auditService.finalizeAudit(auditId, {
        status: 'error',
        startTimeMs: startTime,
        errorCode: 'UPSTREAM_ERROR',
        errorMessage: 'Simulated tool failure',
      });
      return {
        content: [{ type: 'text', text: 'Simulated tool failure' }],
        isError: true,
      };
    };

    confirmationManager = new ConfirmationManager('p6-g5-test-salt');
    agentLoop = new AgentLoopOrchestrator(
      catalogService,
      router,
      mockProvider,
      confirmationManager,
      config
    );

    const authenticator = new DatabaseAuthenticator(apiKeyService);

    const mcpApp = createExpressApp({
      config,
      authenticator,
      catalogService,
      toolRouter: router,
    });

    const browserApp = createBrowserApp({
      config,
      sessionService,
      userRepo,
      passwordService,
      catalogService,
      toolRouter: router,
      confirmationManager,
      agentLoop,
      apiKeyService,
      apiKeyRepo,
      auditRepo,
    });

    mcpServer = http.createServer(mcpApp);
    browserServer = http.createServer(browserApp);

    await new Promise<void>((resolve) => mcpServer.listen(0, '127.0.0.1', () => resolve()));
    await new Promise<void>((resolve) => browserServer.listen(0, '127.0.0.1', () => resolve()));

    mcpPort = (mcpServer.address() as any).port;
    browserPort = (browserServer.address() as any).port;
  });

  after(async () => {
    await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
    await new Promise<void>((resolve) => browserServer.close(() => resolve()));
    db.close();
  });

  async function loginUser(username: string): Promise<{ cookie: string; csrfToken: string }> {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: allowedOrigin,
      },
      body: JSON.stringify({ username, password: 'SecretPassword123!' }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const setCookie = res.headers.get('set-cookie');
    const cookies = parseCookies(setCookie!);
    const rawSession = cookies[SESSION_COOKIE_NAME];
    return {
      cookie: `${SESSION_COOKIE_NAME}=${rawSession}`,
      csrfToken: data.csrfToken,
    };
  }

  // =========================================================================
  // Section 1: Cross-Perimeter Boundary & Token Non-Substitutability
  // =========================================================================
  describe('1. Cross-Perimeter Boundary & Token Non-Substitutability', () => {
    it('1.1: browser session cookie presented to /mcp without Bearer token is rejected with 401', async () => {
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.ok(data.error.includes('Missing Authorization header'));
    });

    it('1.2: browser session cookie presented to /mcp with malformed Bearer token is rejected with 401', async () => {
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer bad_token_without_proper_prefix',
          cookie: aliceSession.cookie,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.ok(data.error.includes('Invalid or revoked API key') || data.error.includes('Unauthorized'));
    });

    it('1.3: downstream MCP Bearer key presented to POST /api/v1/browser/chat without session cookie is rejected with 401', async () => {
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${aliceRawKey}`,
          origin: allowedOrigin,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.code, 'SESSION_MISSING');
    });

    it('1.4: downstream MCP Bearer key presented to POST /api/v1/browser/chat/confirm without session cookie is rejected with 401', async () => {
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat/confirm`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${aliceRawKey}`,
          origin: allowedOrigin,
        },
        body: JSON.stringify({ confirmationToken: 'dummy-token' }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.code, 'SESSION_MISSING');
    });

    it('1.5: downstream MCP Bearer key presented to GET /api/v1/browser/keys without session cookie is rejected with 401', async () => {
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/keys`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${aliceRawKey}`,
        },
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.code, 'SESSION_MISSING');
    });

    it('1.6: downstream MCP Bearer key presented to GET /api/v1/browser/audit without session cookie is rejected with 401', async () => {
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/audit`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${aliceRawKey}`,
        },
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.code, 'SESSION_MISSING');
    });

    it('1.7: browser chat POST request enforces CSRF token presence (fails closed with 403 on missing CSRF header)', async () => {
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          // Omitting x-urumi-csrf
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, 'CSRF_TOKEN_INVALID');
    });

    it('1.8: browser chat POST request rejects invalid or forged CSRF tokens with 403', async () => {
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567',
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, 'CSRF_TOKEN_INVALID');
    });

    it('1.9: browser chat POST request rejects unauthorized Origin headers with 403', async () => {
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: 'http://malicious-attacker.evil.com',
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, 'CSRF_ORIGIN_FORBIDDEN');
    });
  });

  // =========================================================================
  // Section 2: Member vs Admin RBAC, Inactive Members & IDOR Key Boundaries
  // =========================================================================
  describe('2. Role-Based Access Control (RBAC), Inactive Members & IDOR Boundaries', () => {
    it('2.1: Member role session attempting admin-only endpoints GET /members and POST /members/:id/deactivate is rejected with 403', async () => {
      const aliceSession = await loginUser('alice');
      const resGet = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/members`, {
        method: 'GET',
        headers: {
          cookie: aliceSession.cookie,
        },
      });

      assert.strictEqual(resGet.status, 403);
      const dataGet = await resGet.json();
      assert.strictEqual(dataGet.code, 'FORBIDDEN');

      const resDeact = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/members/usr-bob-1/deactivate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
      });

      assert.strictEqual(resDeact.status, 403);
      const dataDeact = await resDeact.json();
      assert.strictEqual(dataDeact.code, 'FORBIDDEN');
    });

    it('2.2: Member role session attempting admin-only endpoint POST /invitations is rejected with 403', async () => {
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/invitations`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ email: 'newmember@example.com', role: 'member' }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, 'FORBIDDEN');
    });

    it('2.3: Member role session attempting admin-only endpoint POST /upstreams is rejected with 403', async () => {
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/upstreams`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ slug: 'new-service', url: 'http://localhost:3000/mcp' }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, 'FORBIDDEN');
    });

    it('2.4: Member role session attempting admin-only endpoint GET /audit is rejected with 403', async () => {
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/audit`, {
        method: 'GET',
        headers: {
          cookie: aliceSession.cookie,
        },
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, 'FORBIDDEN');
    });

    it('2.5: Member role session accessing member-permitted endpoint POST /chat succeeds with 200', async () => {
      mockProviderMode = 'normal';
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'Hello assistant' }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.message, 'Hello! I am your AI assistant.');
    });

    it('2.6: Member session listing keys strictly returns only their own keys (ignoring spoofed userId query param)', async () => {
      const aliceSession = await loginUser('alice');
      // Alice attempts to list Bob's keys by passing ?userId=usr-bob-1
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/keys?userId=usr-bob-1`, {
        method: 'GET',
        headers: {
          cookie: aliceSession.cookie,
        },
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.keys));
      // Alice must ONLY see her own keys
      for (const key of data.keys) {
        assert.strictEqual(key.userId, 'usr-alice-1');
        assert.notStrictEqual(key.userId, 'usr-bob-1');
      }
    });

    it('2.7: Member Alice attempting to revoke Member Bob key via POST /keys/:id/revoke is rejected with 403 (IDOR defense)', async () => {
      const aliceSession = await loginUser('alice');
      // Alice attempts to revoke Bob's key
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/keys/${bobKeyId}/revoke`, {
        method: 'POST',
        headers: {
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, 'FORBIDDEN');
    });

    it('2.8: Admin session attempting to revoke Member Bob key succeeds with 200', async () => {
      const adminSession = await loginUser('admin');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/keys/${bobKeyId}/revoke`, {
        method: 'POST',
        headers: {
          cookie: adminSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': adminSession.csrfToken,
        },
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
    });

    it('2.9: Inactive member Charlie cannot authenticate browser session (fails closed with 401)', async () => {
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/session`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
        },
        body: JSON.stringify({ username: 'charlie', password: 'SecretPassword123!' }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.code, 'INVALID_CREDENTIALS');
    });

    it('2.10: Inactive member Charlie Bearer API key presented to /mcp is rejected with 401', async () => {
      const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${charlieRawKey}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.ok(data.error.includes('Invalid or revoked API key') || data.error.includes('Unauthorized'));
    });
  });

  // =========================================================================
  // Section 3: Secret Isolation, PII Redaction, and Audit Attribution
  // =========================================================================
  describe('3. Secret Isolation, PII Redaction, and Audit Attribution', () => {
    it('3.1: chat responses redact internal canary secrets and provider keys before returning to client', async () => {
      mockProviderMode = 'canary_leak';
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'Reveal secrets please' }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      // Raw secrets MUST NOT be present anywhere in the response text
      assert.ok(!data.message.includes(CANARY_SECRET), 'Raw canary secret must not be exposed');
      assert.ok(!data.message.includes(CANARY_GEMINI_KEY), 'Raw Gemini key must not be exposed');
      assert.ok(data.message.includes('[REDACTED_SECRET]'), 'Must contain [REDACTED_SECRET]');
      assert.ok(data.message.includes('[REDACTED_KEY]'), 'Must contain [REDACTED_KEY]');
    });

    it('3.2: order query tool woocommerce__list_orders redacts customer billing phone, email, and PII', async () => {
      mockProviderMode = 'normal';
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'Please list orders' }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.toolCalls && data.toolCalls.length === 1);
      const toolCall = data.toolCalls[0];
      assert.strictEqual(toolCall.name, 'woocommerce__list_orders');
      assert.strictEqual(toolCall.status, 'success');

      const resultStr = JSON.stringify(toolCall.result);
      // Verify customer PII keys are NOT exposed
      assert.ok(!resultStr.includes('billing_phone'), 'Customer phone must not appear');
      assert.ok(!resultStr.includes('billing_email'), 'Customer email must not appear');
      assert.ok(!resultStr.includes('credit_card'), 'Credit card must not appear');
      assert.ok(resultStr.includes('URUMI-MUG-001'), 'Line item SKU is preserved');
    });

    it('3.3: controlled chat tool execution produces audit record attributed to exact logged-in user with duration and status', async () => {
      mockProviderMode = 'normal';
      const aliceSession = await loginUser('alice');

      const beforeAuditCount = auditRepo.listAudits().length;

      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'search contacts Alice' }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.toolCalls[0].name, 'crm__search_contacts');

      // Verify audit persistence
      const afterAuditCount = auditRepo.listAudits().length;
      assert.ok(afterAuditCount > beforeAuditCount, 'Audit record must be created');

      const recentAudits = auditRepo.listAudits({ limit: 5, offset: 0 });
      const matchingAudit = recentAudits.find(
        (a) => a.tool_name === 'crm__search_contacts' && a.user_id === 'usr-alice-1'
      );

      assert.ok(matchingAudit, 'Audit record for crm__search_contacts attributed to usr-alice-1 must exist');
      assert.strictEqual(matchingAudit.status, 'success');
      assert.strictEqual(matchingAudit.upstream_slug, 'crm');
      assert.ok(typeof matchingAudit.duration_ms === 'number' && matchingAudit.duration_ms >= 0);
      assert.strictEqual(matchingAudit.arguments_hash.length, 64, 'Arguments must be hashed with SHA-256');
    });

    it('3.4: audit error messages containing canary credentials mask sensitive substrings', async () => {
      const adminSession = await loginUser('admin');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/audit`, {
        method: 'GET',
        headers: {
          cookie: adminSession.cookie,
        },
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const rawText = JSON.stringify(data);
      assert.ok(!rawText.includes(CANARY_SECRET), 'Audit list must not expose raw canary secret');
      assert.ok(!rawText.includes(CANARY_GEMINI_KEY), 'Audit list must not expose raw Gemini key');
    });
  });

  // =========================================================================
  // Section 4: Provider & Upstream Error Mappings, Unknown Tools, and Bounded Loop Cap
  // =========================================================================
  describe('4. Provider Error Mappings, Circuit Breakers, Unknown Tools, and Loop Cap', () => {
    it('4.1: maps ProviderTimeoutError to HTTP 504 with code PROVIDER_TIMEOUT', async () => {
      mockProviderMode = 'timeout';
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 504);
      const data = await res.json();
      assert.strictEqual(data.code, 'PROVIDER_TIMEOUT');
    });

    it('4.2: maps ProviderRateLimitError to HTTP 429 with code PROVIDER_RATE_LIMITED', async () => {
      mockProviderMode = 'ratelimit';
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 429);
      const data = await res.json();
      assert.strictEqual(data.code, 'PROVIDER_RATE_LIMITED');
    });

    it('4.3: maps ProviderUnconfiguredError to HTTP 503 with code PROVIDER_UNCONFIGURED', async () => {
      mockProviderMode = 'unconfigured';
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.strictEqual(data.code, 'PROVIDER_UNCONFIGURED');
    });

    it('4.4: safely handles unknown model-requested tool without crashing gateway or agent loop', async () => {
      mockProviderMode = 'unknown_tool';
      const aliceSession = await loginUser('alice');
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'Trigger unknown tool' }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.toolCalls && data.toolCalls.length === 1);
      assert.strictEqual(data.toolCalls[0].name, 'nonexistent__unknown_action');
      assert.strictEqual(data.toolCalls[0].status, 'error');
      assert.ok(data.message.includes('Handled safely'));
    });

    it('4.5: agent loop strictly terminates at configured 5-iteration maximum on unbounded tool call sequences', async () => {
      mockProviderMode = 'infinite_loop';
      loopCallCount = 0;
      const aliceSession = await loginUser('alice');

      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: aliceSession.cookie,
          origin: allowedOrigin,
          'x-urumi-csrf': aliceSession.csrfToken,
        },
        body: JSON.stringify({ message: 'Run forever loop' }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      // Must terminate after exactly 5 tool iterations
      assert.strictEqual(data.toolCalls.length, 5, 'Must execute exactly 5 tool calls before loop cap halts');
      assert.ok(
        data.message.includes('maximum allowable tool iterations (5)'),
        'Must return message indicating iteration cap was reached'
      );
    });
  });
});
