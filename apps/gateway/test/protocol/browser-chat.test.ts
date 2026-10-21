import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { parseConfig } from '../../src/config.js';
import { createBrowserApp } from '../../src/server.js';
import { UserRepository } from '../../src/db/user-repo.js';
import { SessionRepository } from '../../src/db/session-repo.js';
import { ScryptPasswordService } from '../../src/auth/scrypt-password-service.js';
import { SessionService, SESSION_COOKIE_NAME } from '../../src/auth/session-service.js';
import { parseCookies } from '../../src/http/browser-middleware.js';
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

describe('Browser Chat & Confirmation HTTP Protocol Tests (Gate P6-G3)', () => {
  let db: DatabaseSync;
  let userRepo: UserRepository;
  let sessionRepo: SessionRepository;
  let passwordService: ScryptPasswordService;
  let sessionService: SessionService;
  let catalogService: CatalogService;
  let router: ToolRouter;
  let confirmationManager: ConfirmationManager;

  let browserServer: http.Server;
  let browserPort: number;

  const allowedOrigin = 'http://dashboard.127.0.0.1.nip.io:8080';

  let currentMockProviderResponse: ModelResponse = {
    content: 'Hello! I am your AI assistant.',
    finishReason: 'stop',
  };
  let providerShouldThrow: Error | null = null;

  const mockProvider: ModelProvider = {
    name: 'protocol-mock-provider',
    isConfigured: () => !providerShouldThrow || !(providerShouldThrow instanceof ProviderUnconfiguredError),
    generateChatTurn: async (_options: ModelRequestOptions): Promise<ModelResponse> => {
      if (providerShouldThrow) {
        throw providerShouldThrow;
      }
      return currentMockProviderResponse;
    },
  };

  before(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    userRepo = new UserRepository(db);
    sessionRepo = new SessionRepository(db);
    passwordService = new ScryptPasswordService();
    sessionService = new SessionService(sessionRepo, userRepo);

    // Seed test users: alice (active member), bob (active member), deact (deactivated)
    const passwordHash = await passwordService.hashPassword('SecretPassword123!');
    userRepo.insertUser({
      id: 'usr-alice-1',
      username: 'alice',
      role: 'member',
      is_active: 1,
    });
    userRepo.setUserCredentials('usr-alice-1', passwordHash);

    userRepo.insertUser({
      id: 'usr-bob-1',
      username: 'bob',
      role: 'member',
      is_active: 1,
    });
    userRepo.setUserCredentials('usr-bob-1', passwordHash);

    userRepo.insertUser({
      id: 'usr-deact-1',
      username: 'deact',
      role: 'member',
      is_active: 0,
    });
    userRepo.setUserCredentials('usr-deact-1', passwordHash);

    const auditRepo = new AuditRepository(db);
    const auditService = new AuditService(auditRepo);

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
          slug: 'tasks',
          tools: [
            {
              name: 'tasks__create_task',
              originalName: 'create_task',
              upstreamSlug: 'tasks',
              description: 'Create a task',
              inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
            },
          ],
        },
      ],
      [{ slug: 'tasks', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1 }]
    );

    const config = parseConfig({
      MAX_RESULT_SIZE_BYTES: '1048576',
      CHAT_TURN_TIMEOUT_MS: '30000',
      PROVIDER_TIMEOUT_MS: '15000',
    });

    router = new ToolRouter(catalogService, upstreamManager, auditService, config);
    // Mock router dispatch
    router.dispatch = async (opts) => ({
      content: [{ type: 'text', text: `{"executed":true,"tool":"${opts.publicToolName}"}` }],
      isError: false,
    });

    confirmationManager = new ConfirmationManager('protocol-test-hmac-signing-salt');
    const agentLoop = new AgentLoopOrchestrator(
      catalogService,
      router,
      mockProvider,
      confirmationManager,
      config
    );

    const browserApp = createBrowserApp({
      config,
      sessionService,
      userRepo,
      passwordService,
      catalogService,
      toolRouter: router,
      confirmationManager,
      agentLoop,
    });

    browserServer = http.createServer(browserApp);
    await new Promise<void>((resolve) => browserServer.listen(0, '127.0.0.1', () => resolve()));
    browserPort = (browserServer.address() as any).port;
  });

  after(async () => {
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

  describe('Authentication & Security Invariants', () => {
    it('rejects POST /api/v1/browser/chat when unauthenticated (401)', async () => {
      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          'x-urumi-csrf': 'some-csrf-token',
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.code, 'SESSION_MISSING');
    });

    it('rejects POST /api/v1/browser/chat when CSRF token is missing (403)', async () => {
      const { cookie } = await loginUser('alice');

      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, 'CSRF_TOKEN_INVALID');
    });

    it('rejects POST /api/v1/browser/chat when Origin is unauthorized (403)', async () => {
      const { cookie, csrfToken } = await loginUser('alice');

      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://malicious.evil.com',
          cookie,
          'x-urumi-csrf': csrfToken,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, 'CSRF_ORIGIN_FORBIDDEN');
    });

    it('rejects empty or missing message body with 400 Validation Error', async () => {
      const { cookie, csrfToken } = await loginUser('alice');

      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie,
          'x-urumi-csrf': csrfToken,
        },
        body: JSON.stringify({ message: '' }),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.error, 'Validation Error');
    });
  });

  describe('Active Chat Turn Protocol Round-Trip', () => {
    it('successfully processes conversational message and returns 200 ChatTurnResponse', async () => {
      const { cookie, csrfToken } = await loginUser('alice');

      currentMockProviderResponse = {
        content: 'I am ready to assist with WooCommerce, CRM, and Tasks.',
        finishReason: 'stop',
      };
      providerShouldThrow = null;

      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie,
          'x-urumi-csrf': csrfToken,
        },
        body: JSON.stringify({ message: 'Hello assistant' }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.message, 'I am ready to assist with WooCommerce, CRM, and Tasks.');
      assert.deepStrictEqual(data.toolCalls, []);
      assert.ok(data.turnId);
    });
  });

  describe('Mutation Confirmation Protocol Flow', () => {
    it('returns confirmationToken when model proposes mutating action, and allows execution upon valid confirm', async () => {
      const alice = await loginUser('alice');
      const bob = await loginUser('bob');

      // 1. Model proposes tasks__create_task (mutating)
      currentMockProviderResponse = {
        content: 'I will create a task for you.',
        toolCalls: [
          {
            id: 'call-1',
            name: 'tasks__create_task',
            args: { title: 'Complete G3 implementation' },
          },
        ],
        finishReason: 'tool_calls',
      };
      providerShouldThrow = null;

      const chatRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie: alice.cookie,
          'x-urumi-csrf': alice.csrfToken,
        },
        body: JSON.stringify({ message: 'Create task Complete G3 implementation' }),
      });

      assert.strictEqual(chatRes.status, 200);
      const chatData = await chatRes.json();
      assert.ok(chatData.confirmationToken);
      assert.strictEqual(chatData.toolCalls?.[0].status, 'confirmation_required');

      const token = chatData.confirmationToken;

      // 2. Reject confirm request with missing token (400)
      const missingTokenRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat/confirm`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie: alice.cookie,
          'x-urumi-csrf': alice.csrfToken,
        },
        body: JSON.stringify({ confirmationToken: '' }),
      });
      assert.strictEqual(missingTokenRes.status, 400);

      // 3. User Bob attempts to confirm Alice's token -> 403 Forbidden (CONFIRMATION_USER_MISMATCH)
      const bobConfirmRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat/confirm`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie: bob.cookie,
          'x-urumi-csrf': bob.csrfToken,
        },
        body: JSON.stringify({ confirmationToken: token }),
      });
      assert.strictEqual(bobConfirmRes.status, 403);
      const bobData = await bobConfirmRes.json();
      assert.strictEqual(bobData.code, 'CONFIRMATION_USER_MISMATCH');

      // 4. Alice confirms her own token -> 200 OK
      currentMockProviderResponse = {
        content: 'Task created successfully.',
        finishReason: 'stop',
      };

      const aliceConfirmRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat/confirm`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie: alice.cookie,
          'x-urumi-csrf': alice.csrfToken,
        },
        body: JSON.stringify({ confirmationToken: token }),
      });

      assert.strictEqual(aliceConfirmRes.status, 200);
      const confirmData = await aliceConfirmRes.json();
      assert.strictEqual(confirmData.message, 'Task created successfully.');
      assert.strictEqual(confirmData.toolCalls?.[0].status, 'success');

      // 5. Replay of same token fails (400 CONFIRMATION_ALREADY_USED)
      const replayRes = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat/confirm`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie: alice.cookie,
          'x-urumi-csrf': alice.csrfToken,
        },
        body: JSON.stringify({ confirmationToken: token }),
      });
      assert.strictEqual(replayRes.status, 400);
      const replayData = await replayRes.json();
      assert.strictEqual(replayData.code, 'CONFIRMATION_ALREADY_USED');
    });
  });

  describe('Provider Failure Protocol Mappings', () => {
    it('returns HTTP 503 with PROVIDER_UNCONFIGURED when provider lacks credentials', async () => {
      const { cookie, csrfToken } = await loginUser('alice');

      providerShouldThrow = new ProviderUnconfiguredError('Provider API key not configured');

      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie,
          'x-urumi-csrf': csrfToken,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.strictEqual(data.code, 'PROVIDER_UNCONFIGURED');
    });

    it('returns HTTP 429 with PROVIDER_RATE_LIMITED when provider is rate limited', async () => {
      const { cookie, csrfToken } = await loginUser('alice');

      providerShouldThrow = new ProviderRateLimitError('Upstream Gemini quota exceeded');

      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie,
          'x-urumi-csrf': csrfToken,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 429);
      const data = await res.json();
      assert.strictEqual(data.code, 'PROVIDER_RATE_LIMITED');
    });

    it('returns HTTP 504 with PROVIDER_TIMEOUT when provider times out', async () => {
      const { cookie, csrfToken } = await loginUser('alice');

      providerShouldThrow = new ProviderTimeoutError('Chat request timed out');

      const res = await fetch(`http://127.0.0.1:${browserPort}/api/v1/browser/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: allowedOrigin,
          cookie,
          'x-urumi-csrf': csrfToken,
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      assert.strictEqual(res.status, 504);
      const data = await res.json();
      assert.strictEqual(data.code, 'PROVIDER_TIMEOUT');
    });
  });
});
