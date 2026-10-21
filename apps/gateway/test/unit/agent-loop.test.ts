import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/db/migrations.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService } from '../../src/audit/audit-service.js';
import { UpstreamRepository } from '../../src/db/upstream-repo.js';
import { CatalogService } from '../../src/upstream/catalog-service.js';
import { UpstreamManager } from '../../src/upstream/upstream-manager.js';
import { ToolRouter } from '../../src/upstream/tool-router.js';
import { parseConfig } from '../../src/config.js';
import {
  AgentLoopOrchestrator,
  MAX_TOOL_ITERATIONS,
  MAX_TOOL_RESULT_BYTES,
  truncateResult,
} from '../../src/chat/agent-loop.js';
import {
  ConfirmationManager,
  isProtectedTarget,
  isDisposableFixture,
} from '../../src/chat/confirmation.js';
import {
  ModelProvider,
  ModelRequestOptions,
  ModelResponse,
  ProviderTimeoutError,
} from '../../src/chat/types.js';
import { AuthenticatedUser } from '../../src/auth/authenticator.js';

describe('Gateway Bounded Agent Loop & Confirmation Unit Tests (Gate P6-G3)', () => {
  function setupHarness(mockResponses: ModelResponse[] = []) {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    // Seed test users
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, role, is_active, created_at) VALUES ('usr-alice', 'alice', 'member', 1, ?)").run(now);
    db.prepare("INSERT INTO users (id, username, role, is_active, created_at) VALUES ('usr-bob', 'bob', 'member', 1, ?)").run(now);

    const auditRepo = new AuditRepository(db);
    const auditService = new AuditService(auditRepo);

    const upstreamRepo = new UpstreamRepository(db);
    upstreamRepo.seedDefaults();

    const catalogService = new CatalogService();
    const upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
      allowLocalhostForTesting: true,
    });
    upstreamManager.syncClientsWithRepository();

    // Register representative tools into catalog using updateSnapshot
    catalogService.updateSnapshot(
      [
        {
          slug: 'woocommerce',
          tools: [
            {
              name: 'woocommerce__list_orders',
              originalName: 'list_orders',
              upstreamSlug: 'woocommerce',
              description: 'List store orders',
              inputSchema: {
                type: 'object',
                properties: {
                  per_page: { type: 'number' },
                },
              },
            },
            {
              name: 'woocommerce__create_product',
              originalName: 'create_product',
              upstreamSlug: 'woocommerce',
              description: 'Create a new product',
              inputSchema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  sku: { type: 'string' },
                  regular_price: { type: 'string' },
                },
                required: ['name', 'regular_price'],
              },
            },
            {
              name: 'woocommerce__update_order_status',
              originalName: 'update_order_status',
              upstreamSlug: 'woocommerce',
              description: 'Update order status',
              inputSchema: {
                type: 'object',
                properties: {
                  order_id: { type: 'number' },
                  status: { type: 'string' },
                },
                required: ['order_id', 'status'],
              },
            },
          ],
        },
        {
          slug: 'crm',
          tools: [
            {
              name: 'crm__search_contacts',
              originalName: 'search_contacts',
              upstreamSlug: 'crm',
              description: 'Search CRM contacts',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                },
              },
            },
          ],
        },
        {
          slug: 'tasks',
          tools: [
            {
              name: 'tasks__list_tasks',
              originalName: 'list_tasks',
              upstreamSlug: 'tasks',
              description: 'List assigned tasks',
              inputSchema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                },
              },
            },
            {
              name: 'tasks__create_task',
              originalName: 'create_task',
              upstreamSlug: 'tasks',
              description: 'Create a task',
              inputSchema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                },
                required: ['title'],
              },
            },
          ],
        },
      ],
      [
        { slug: 'woocommerce', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 3 },
        { slug: 'crm', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 1 },
        { slug: 'tasks', healthState: 'available', persistedStatus: 'active', isEnabled: true, toolCount: 2 },
      ]
    );

    const config = parseConfig({
      MAX_RESULT_SIZE_BYTES: '1048576',
      CHAT_TURN_TIMEOUT_MS: '30000',
      PROVIDER_TIMEOUT_MS: '15000',
    });

    const router = new ToolRouter(catalogService, upstreamManager, auditService, config);
    const confirmationManager = new ConfirmationManager('test-secret-salt-for-p6-g3-testing');

    let responseIndex = 0;
    const mockProvider: ModelProvider = {
      name: 'test-mock-provider',
      isConfigured: () => true,
      generateChatTurn: async (_options: ModelRequestOptions): Promise<ModelResponse> => {
        if (responseIndex < mockResponses.length) {
          return mockResponses[responseIndex++];
        }
        return {
          content: 'Default mock answer',
          finishReason: 'stop',
        };
      },
    };

    const orchestrator = new AgentLoopOrchestrator(
      catalogService,
      router,
      mockProvider,
      confirmationManager,
      config
    );

    const testUser: AuthenticatedUser = {
      id: 'usr-alice',
      username: 'alice',
      role: 'member',
    };

    return {
      db,
      router,
      catalogService,
      auditRepo,
      confirmationManager,
      orchestrator,
      testUser,
      mockProvider,
    };
  }

  it('handles normal assistant response with no tool calls', async () => {
    const { orchestrator, testUser } = setupHarness([
      {
        content: 'Hello! I am your Urumi Gateway assistant.',
        finishReason: 'stop',
      },
    ]);

    const result = await orchestrator.executeTurn({
      user: testUser,
      message: 'Hello there',
    });

    assert.equal(result.message, 'Hello! I am your Urumi Gateway assistant.');
    assert.deepEqual(result.toolCalls, []);
    assert.ok(result.turnId);
  });

  it('executes a single read-only tool and feeds result back to model for final answer', async () => {
    const { orchestrator, testUser, router, auditRepo } = setupHarness([
      {
        content: 'Checking orders...',
        toolCalls: [
          {
            id: 'call-1',
            name: 'woocommerce__list_orders',
            args: { per_page: 5 },
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: 'You have 3 orders today.',
        finishReason: 'stop',
      },
    ]);

    // Mock ToolRouter.dispatch so we do not need a live WooCommerce cluster
    router.dispatch = async (opts) => {
      assert.equal(opts.publicToolName, 'woocommerce__list_orders');
      assert.equal(opts.user?.id, 'usr-alice');
      return {
        content: [{ type: 'text', text: JSON.stringify([{ id: 101, status: 'processing' }]) }],
        isError: false,
      };
    };

    const result = await orchestrator.executeTurn({
      user: testUser,
      message: 'Show me recent orders',
    });

    assert.equal(result.message, 'You have 3 orders today.');
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls![0].name, 'woocommerce__list_orders');
    assert.equal(result.toolCalls![0].status, 'success');
    assert.ok(result.toolCalls![0].durationMs !== undefined);
  });

  it('executes a multi-turn composite workflow combining CRM and Tasks tools', async () => {
    const { orchestrator, testUser, router } = setupHarness([
      {
        content: 'First let me find the contact...',
        toolCalls: [
          {
            id: 'call-crm-1',
            name: 'crm__search_contacts',
            args: { query: 'Sarah' },
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: 'Now fetching assigned tasks...',
        toolCalls: [
          {
            id: 'call-tasks-1',
            name: 'tasks__list_tasks',
            args: { status: 'todo' },
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: 'Sarah has 2 pending todo tasks.',
        finishReason: 'stop',
      },
    ]);

    const dispatchedTools: string[] = [];
    router.dispatch = async (opts) => {
      dispatchedTools.push(opts.publicToolName);
      return {
        content: [{ type: 'text', text: `{"mock":"${opts.publicToolName}"}` }],
        isError: false,
      };
    };

    const result = await orchestrator.executeTurn({
      user: testUser,
      message: 'Find Sarah and check her tasks',
    });

    assert.equal(result.message, 'Sarah has 2 pending todo tasks.');
    assert.deepEqual(dispatchedTools, ['crm__search_contacts', 'tasks__list_tasks']);
    assert.equal(result.toolCalls?.length, 2);
    assert.equal(result.toolCalls![0].name, 'crm__search_contacts');
    assert.equal(result.toolCalls![1].name, 'tasks__list_tasks');
  });

  it('handles unknown tool names by feeding error back to model without crashing', async () => {
    const { orchestrator, testUser } = setupHarness([
      {
        content: 'Attempting unknown tool...',
        toolCalls: [
          {
            id: 'call-bad-1',
            name: 'unknown_service__phantom_tool',
            args: {},
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: 'I apologize, that tool is not available in the gateway catalog.',
        finishReason: 'stop',
      },
    ]);

    const result = await orchestrator.executeTurn({
      user: testUser,
      message: 'Run phantom tool',
    });

    assert.equal(result.message, 'I apologize, that tool is not available in the gateway catalog.');
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls![0].status, 'error');
    assert.match(JSON.stringify(result.toolCalls![0].result), /not recognized/);
  });

  it('strictly enforces the 5-iteration cap and terminates gracefully on iteration 6', async () => {
    // Generate an infinite stream of tool call requests
    const infiniteLoopResponses: ModelResponse[] = Array.from({ length: 8 }, (_, i) => ({
      content: `Iteration ${i + 1}`,
      toolCalls: [
        {
          id: `loop-call-${i}`,
          name: 'woocommerce__list_orders',
          args: { per_page: 1 },
        },
      ],
      finishReason: 'tool_calls',
    }));

    const { orchestrator, testUser, router } = setupHarness(infiniteLoopResponses);

    let dispatchCount = 0;
    router.dispatch = async () => {
      dispatchCount++;
      return {
        content: [{ type: 'text', text: '[]' }],
        isError: false,
      };
    };

    const result = await orchestrator.executeTurn({
      user: testUser,
      message: 'Run endless loop',
    });

    assert.match(result.message, /maximum allowable tool iterations \(5\)/);
    assert.equal(dispatchCount, MAX_TOOL_ITERATIONS);
    assert.equal(result.toolCalls?.length, MAX_TOOL_ITERATIONS);
  });

  it('enforces overall 30-second turn deadline across loop iterations', async () => {
    const { orchestrator, testUser, mockProvider } = setupHarness();

    // Mock provider to report timeout
    mockProvider.generateChatTurn = async () => {
      throw new ProviderTimeoutError('Chat request exceeded the 30-second turn deadline');
    };

    await assert.rejects(
      () => orchestrator.executeTurn({ user: testUser, message: 'Take too long' }),
      (err: unknown) => {
        assert(err instanceof ProviderTimeoutError);
        assert.equal((err as ProviderTimeoutError).statusCode, 504);
        assert.match((err as Error).message, /30-second turn deadline/);
        return true;
      }
    );
  });

  it('truncates tool result exceeding 64 KiB with policy notice', () => {
    const hugePayload = 'A'.repeat(70000); // 70 KB
    const truncated = truncateResult(hugePayload, MAX_TOOL_RESULT_BYTES);

    assert(Buffer.byteLength(truncated, 'utf-8') < 70000);
    assert(truncated.includes('[Output truncated to 64 KiB by Gateway security policy]'));

    const smallPayload = 'Small result';
    const smallTruncated = truncateResult(smallPayload, MAX_TOOL_RESULT_BYTES);
    assert.equal(smallTruncated, smallPayload);
  });

  describe('Protected WooCommerce Baseline Safeguard', () => {
    it('blocks mutating Order #14', () => {
      const check1 = isProtectedTarget('woocommerce__update_order_status', { order_id: 14, status: 'completed' });
      assert.equal(check1.protected, true);
      assert.match(check1.reason!, /Order #14 is an immutable baseline record/);

      const check2 = isProtectedTarget('woocommerce__update_order_status', { order_id: '14', status: 'completed' });
      assert.equal(check2.protected, true);

      const checkSafe = isProtectedTarget('woocommerce__update_order_status', { order_id: 999, status: 'completed' });
      assert.equal(checkSafe.protected, false);
    });

    it('blocks mutating Product IDs 10, 11, 12', () => {
      for (const id of [10, 11, 12, '10', '11', '12']) {
        const check = isProtectedTarget('any_tool', { product_id: id });
        assert.equal(check.protected, true);
        assert.match(check.reason!, /immutable baseline record/);
      }

      const safeCheck = isProtectedTarget('any_tool', { product_id: 55 });
      assert.equal(safeCheck.protected, false);
    });

    it('blocks creating product colliding with baseline SKUs', () => {
      const collisionCheck = isProtectedTarget('woocommerce__create_product', {
        name: 'T-Shirt',
        sku: 'woo-vneck-tee',
        regular_price: '15.00',
      });
      assert.equal(collisionCheck.protected, true);
      assert.match(collisionCheck.reason!, /collides with an immutable baseline product/);
    });

    it('agent loop rejects protected target calls before dispatching', async () => {
      const { orchestrator, testUser, router } = setupHarness([
        {
          content: 'Updating order 14...',
          toolCalls: [
            {
              id: 'call-prot-1',
              name: 'woocommerce__update_order_status',
              args: { order_id: 14, status: 'cancelled' },
            },
          ],
          finishReason: 'tool_calls',
        },
        {
          content: 'I cannot modify Order #14 because it is protected.',
          finishReason: 'stop',
        },
      ]);

      let dispatched = false;
      router.dispatch = async () => {
        dispatched = true;
        return { content: [], isError: false };
      };

      const result = await orchestrator.executeTurn({
        user: testUser,
        message: 'Cancel order 14',
      });

      assert.equal(dispatched, false, 'Protected order 14 dispatch was blocked');
      assert.equal(result.toolCalls?.[0].status, 'error');
      assert.equal((result.toolCalls?.[0].result as any).code, 'MUTATION_TARGET_PROTECTED');
    });
  });

  describe('Mutation Confirmation Lifecycle & Token Cryptography', () => {
    it('suspends turn and mints confirmation token for non-demo mutating action', async () => {
      const { orchestrator, testUser } = setupHarness([
        {
          content: 'I will create a task for you.',
          toolCalls: [
            {
              id: 'call-task-1',
              name: 'tasks__create_task',
              args: { title: 'Review audit logs' },
            },
          ],
          finishReason: 'tool_calls',
        },
      ]);

      const result = await orchestrator.executeTurn({
        user: testUser,
        message: 'Create a task to review audit logs',
      });

      assert.ok(result.confirmationToken, 'Confirmation token must be present');
      assert.match(result.message, /modifies system state/);
      assert.equal(result.toolCalls?.[0].status, 'confirmation_required');
      assert.ok(result.confirmationPrompt);
    });

    it('verifies and consumes token with exact user binding and single-use protection', () => {
      const cm = new ConfirmationManager('unit-test-secret-salt-32bytes-len');
      const { token } = cm.mintToken({
        userId: 'usr-alice',
        toolName: 'tasks__create_task',
        args: { title: 'Important task' },
      });

      // 1. Verify with matching user succeeds
      const verify1 = cm.verifyAndConsumeToken(token, 'usr-alice');
      assert.equal(verify1.valid, true);
      assert.equal(verify1.payload?.toolName, 'tasks__create_task');
      assert.equal(verify1.parsedArgs?.title, 'Important task');

      // 2. Replay of consumed token fails
      const replay = cm.verifyAndConsumeToken(token, 'usr-alice');
      assert.equal(replay.valid, false);
      assert.equal(replay.code, 'CONFIRMATION_ALREADY_USED');
    });

    it('rejects confirmation token when user mismatches', () => {
      const cm = new ConfirmationManager('unit-test-secret-salt-32bytes-len');
      const { token } = cm.mintToken({
        userId: 'usr-alice',
        toolName: 'tasks__create_task',
        args: { title: 'Alice task' },
      });

      // User Bob attempts to confirm Alice's token
      const result = cm.verifyAndConsumeToken(token, 'usr-bob');
      assert.equal(result.valid, false);
      assert.equal(result.code, 'CONFIRMATION_USER_MISMATCH');
    });

    it('rejects expired confirmation token', () => {
      const cm = new ConfirmationManager('unit-test-secret-salt-32bytes-len');
      const { token } = cm.mintToken({
        userId: 'usr-alice',
        toolName: 'tasks__create_task',
        args: { title: 'Expired task' },
        ttlMs: -1000, // expired 1s ago
      });

      const result = cm.verifyAndConsumeToken(token, 'usr-alice');
      assert.equal(result.valid, false);
      assert.equal(result.code, 'CONFIRMATION_EXPIRED');
    });

    it('rejects confirmation token when arguments are tampered', () => {
      const cm = new ConfirmationManager('unit-test-secret-salt-32bytes-len');
      const { token } = cm.mintToken({
        userId: 'usr-alice',
        toolName: 'tasks__create_task',
        args: { title: 'Original task' },
      });

      const tamperedCheck = cm.verifyAndConsumeToken(token, 'usr-alice', { title: 'Tampered task' });
      assert.equal(tamperedCheck.valid, false);
      assert.equal(tamperedCheck.code, 'ARGUMENT_MISMATCH');
    });

    it('resumes turn and executes tool upon successful confirmation', async () => {
      const { orchestrator, testUser, router } = setupHarness([
        {
          content: 'Task "Review audit logs" has been successfully created.',
          finishReason: 'stop',
        },
      ]);

      let dispatchedUser: string | undefined;
      router.dispatch = async (opts) => {
        dispatchedUser = opts.user?.id;
        return {
          content: [{ type: 'text', text: '{"id":"TASK-901","title":"Review audit logs"}' }],
          isError: false,
        };
      };

      const result = await orchestrator.resumeTurnWithConfirmedAction({
        user: testUser,
        toolName: 'tasks__create_task',
        args: { title: 'Review audit logs' },
      });

      assert.equal(dispatchedUser, 'usr-alice', 'User attribution preserved on confirmed execution');
      assert.equal(result.message, 'Task "Review audit logs" has been successfully created.');
      assert.equal(result.toolCalls?.length, 1);
      assert.equal(result.toolCalls![0].status, 'success');
    });
  });

  describe('Disposable Demo Fixture Policy', () => {
    it('recognizes valid chat-demo-... product creation as disposable fixture', () => {
      const validFixture = isDisposableFixture('woocommerce__create_product', {
        name: 'Chat Demo Shirt',
        regular_price: '24.99',
        sku: 'chat-demo-shirt-001',
      });
      assert.equal(validFixture, true);

      // Non-demo SKU does not qualify
      const nonDemo = isDisposableFixture('woocommerce__create_product', {
        name: 'Regular Shirt',
        regular_price: '24.99',
        sku: 'regular-shirt-001',
      });
      assert.equal(nonDemo, false);

      // Other tool does not qualify even with demo prefix
      const taskCheck = isDisposableFixture('tasks__create_task', {
        title: 'chat-demo-task',
        sku: 'chat-demo-task',
      });
      assert.equal(taskCheck, false);
    });

    it('auto-permits disposable demo fixture product creation without interactive confirmation', async () => {
      const { orchestrator, testUser, router } = setupHarness([
        {
          content: 'Creating demo product...',
          toolCalls: [
            {
              id: 'call-demo-1',
              name: 'woocommerce__create_product',
              args: {
                name: 'Demo Beanie',
                sku: 'chat-demo-beanie-test',
                regular_price: '19.99',
              },
            },
          ],
          finishReason: 'tool_calls',
        },
        {
          content: 'Product "Demo Beanie" created successfully on storefront.',
          finishReason: 'stop',
        },
      ]);

      let dispatched = false;
      router.dispatch = async (opts) => {
        dispatched = true;
        assert.equal(opts.publicToolName, 'woocommerce__create_product');
        assert.equal(opts.user?.id, 'usr-alice');
        return {
          content: [{ type: 'text', text: '{"id":999,"name":"Demo Beanie"}' }],
          isError: false,
        };
      };

      const result = await orchestrator.executeTurn({
        user: testUser,
        message: 'Create demo product Demo Beanie for 19.99',
      });

      assert.equal(dispatched, true, 'Disposable fixture was executed directly');
      assert.equal(result.confirmationToken, undefined, 'No confirmation required for demo fixture');
      assert.equal(result.message, 'Product "Demo Beanie" created successfully on storefront.');
      assert.equal(result.toolCalls?.[0].status, 'success');
    });
  });
});
