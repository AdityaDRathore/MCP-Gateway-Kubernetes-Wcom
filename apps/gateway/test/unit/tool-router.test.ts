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
import { ToolRouter, KNOWN_TOOL_MUTABILITY } from '../../src/upstream/tool-router.js';
import { parseConfig } from '../../src/config.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { UpstreamTimeoutError, UpstreamConnectionError } from '../../src/upstream/types.js';

describe('Gateway Dynamic Tool Router Unit Tests', () => {
  function setupTestHarness(): {
    db: DatabaseSync;
    auditService: AuditService;
    upstreamRepo: UpstreamRepository;
    catalogService: CatalogService;
    upstreamManager: UpstreamManager;
    router: ToolRouter;
  } {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS);

    // Seed test user to satisfy foreign key constraint on audit_logs(user_id)
    db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('usr-1', 'alice', 'member', ?)").run(Date.now());

    const auditRepo = new AuditRepository(db);
    const auditService = new AuditService(auditRepo);

    const upstreamRepo = new UpstreamRepository(db);
    upstreamRepo.seedDefaults();

    const catalogService = new CatalogService();
    const upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
      allowLocalhostForTesting: true,
    });
    upstreamManager.syncClientsWithRepository();

    const config = parseConfig({
      MAX_RESULT_SIZE_BYTES: '1000', // 1000 bytes for size limit testing
    });

    const router = new ToolRouter(catalogService, upstreamManager, auditService, config);

    return { db, auditService, upstreamRepo, catalogService, upstreamManager, router };
  }

  it('rejects unknown public tool names with standard MCP InvalidParams protocol error', async () => {
    const { router, db } = setupTestHarness();

    await assert.rejects(
      () => router.dispatch({ publicToolName: 'nonexistent__unknown_tool' }),
      (err: unknown) => {
        assert(err instanceof McpError);
        assert.equal((err as McpError).code, ErrorCode.InvalidParams);
        assert.match((err as Error).message, /Tool "nonexistent__unknown_tool" not found/);
        return true;
      }
    );

    db.close();
  });

  it('rejects unreachable tools marked in catalog with truthful tool error', async () => {
    const { router, catalogService, db } = setupTestHarness();

    // Populate catalog with an unreachable tool
    catalogService.updateSnapshot(
      [],
      [
        {
          slug: 'crm',
          healthState: 'unavailable',
          persistedStatus: 'active',
          isEnabled: true,
          toolCount: 0,
          lastCheckedAt: Date.now(),
          lastError: 'fetch failed',
        },
      ]
    );

    // Seed catalog with tool having reachable: false
    const snapshotWithUnreachable = {
      ...catalogService.getSnapshot(),
      toolsByPublicName: new Map([
        [
          'crm__get_contact',
          {
            name: 'crm__get_contact',
            originalName: 'get_contact',
            upstreamSlug: 'crm',
            inputSchema: { type: 'object' },
            _meta: { reachable: false },
          },
        ],
      ]),
    };
    (catalogService as any).currentSnapshot = snapshotWithUnreachable;

    const result = await router.dispatch({
      publicToolName: 'crm__get_contact',
      arguments: {},
    });

    assert.equal(result.isError, true);
    assert.match((result.content[0] as any).text, /Upstream service 'crm' is currently unreachable/);

    db.close();
  });

  it('rejects invalid arguments before dispatch and does not invoke upstream', async () => {
    const { router, catalogService, upstreamManager, db } = setupTestHarness();

    // Register active tool with schema requiring 'id'
    const tool = {
      name: 'crm__get_contact',
      originalName: 'get_contact',
      upstreamSlug: 'crm',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', pattern: '^CRM-CONT-[0-9]{3}$' } },
        additionalProperties: false,
      },
      _meta: { reachable: true },
    };

    (catalogService as any).currentSnapshot = {
      ...catalogService.getSnapshot(),
      toolsByPublicName: new Map([['crm__get_contact', tool]]),
    };

    let upstreamCalled = false;
    const client = upstreamManager.getClient('crm')!;
    client.callTool = async () => {
      upstreamCalled = true;
      return { content: [{ type: 'text', text: 'ok' }] };
    };

    // Call with missing 'id'
    const result1 = await router.dispatch({
      publicToolName: 'crm__get_contact',
      arguments: {},
    });
    assert.equal(result1.isError, true);
    assert.match((result1.content[0] as any).text, /Required property 'id' is missing/);
    assert.equal(upstreamCalled, false);

    // Call with invalid 'id' pattern
    const result2 = await router.dispatch({
      publicToolName: 'crm__get_contact',
      arguments: { id: 'invalid-id-format' },
    });
    assert.equal(result2.isError, true);
    assert.match((result2.content[0] as any).text, /does not match required pattern/);
    assert.equal(upstreamCalled, false);

    db.close();
  });

  it('correctly classifies mutating vs read-only tools according to explicit registry and prefixes', () => {
    const { router, db } = setupTestHarness();

    // Explicit entries
    assert.equal(router.isMutatingTool({ name: 'woocommerce__create_product', originalName: 'create_product', upstreamSlug: 'woocommerce', inputSchema: { type: 'object' } }), true);
    assert.equal(router.isMutatingTool({ name: 'woocommerce__list_products', originalName: 'list_products', upstreamSlug: 'woocommerce', inputSchema: { type: 'object' } }), false);
    assert.equal(router.isMutatingTool({ name: 'tasks__create_task', originalName: 'create_task', upstreamSlug: 'tasks', inputSchema: { type: 'object' } }), true);
    assert.equal(router.isMutatingTool({ name: 'crm__search_contacts', originalName: 'search_contacts', upstreamSlug: 'crm', inputSchema: { type: 'object' } }), false);

    // Annotation override
    assert.equal(router.isMutatingTool({ name: 'custom__read', originalName: 'custom_op', upstreamSlug: 'custom', inputSchema: { type: 'object' }, annotations: { readOnly: true } }), false);
    assert.equal(router.isMutatingTool({ name: 'custom__write', originalName: 'custom_op', upstreamSlug: 'custom', inputSchema: { type: 'object' }, annotations: { readOnly: false } }), true);

    // Prefix rules
    assert.equal(router.isMutatingTool({ name: 'custom__delete_item', originalName: 'delete_item', upstreamSlug: 'custom', inputSchema: { type: 'object' } }), true);
    assert.equal(router.isMutatingTool({ name: 'custom__fetch_details', originalName: 'fetch_details', upstreamSlug: 'custom', inputSchema: { type: 'object' } }), false);

    // Conservative default for unknown operation
    assert.equal(router.isMutatingTool({ name: 'custom__unknown_op', originalName: 'unknown_op', upstreamSlug: 'custom', inputSchema: { type: 'object' } }), true);

    db.close();
  });

  it('fails closed and halts dispatch if Phase 1 audit start write fails', async () => {
    const { router, catalogService, upstreamManager, auditService, db } = setupTestHarness();

    const tool = {
      name: 'crm__search_contacts',
      originalName: 'search_contacts',
      upstreamSlug: 'crm',
      inputSchema: { type: 'object' },
      _meta: { reachable: true },
    };
    (catalogService as any).currentSnapshot = {
      ...catalogService.getSnapshot(),
      toolsByPublicName: new Map([['crm__search_contacts', tool]]),
    };

    let upstreamCalled = false;
    const client = upstreamManager.getClient('crm')!;
    client.callTool = async () => {
      upstreamCalled = true;
      return { content: [{ type: 'text', text: 'ok' }] };
    };

    // Simulate Phase 1 failure (e.g. database locked or corrupted)
    auditService.startAudit = () => {
      throw new Error('Simulated SQLite disk write failure on Phase 1 start');
    };

    const result = await router.dispatch({
      publicToolName: 'crm__search_contacts',
      arguments: {},
    });

    assert.equal(result.isError, true);
    assert.match((result.content[0] as any).text, /Audit logging unavailable/);
    assert.equal(upstreamCalled, false, 'Upstream MUST NOT be called when Phase 1 audit write fails');

    db.close();
  });

  it('executes upstream successfully and finalizes audit as success', async () => {
    const { router, catalogService, upstreamManager, auditService, db } = setupTestHarness();

    const tool = {
      name: 'crm__search_contacts',
      originalName: 'search_contacts',
      upstreamSlug: 'crm',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      _meta: { reachable: true },
    };
    (catalogService as any).currentSnapshot = {
      ...catalogService.getSnapshot(),
      toolsByPublicName: new Map([['crm__search_contacts', tool]]),
    };

    let capturedArgs: any = null;
    const client = upstreamManager.getClient('crm')!;
    client.callTool = async (name, args) => {
      capturedArgs = args;
      return {
        content: [{ type: 'text', text: JSON.stringify([{ id: 'CRM-CONT-001', name: 'Alice' }]) }],
      };
    };

    const result = await router.dispatch({
      publicToolName: 'crm__search_contacts',
      arguments: { query: 'Alice' },
      user: { id: 'usr-1', username: 'alice', role: 'member' },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(capturedArgs, { query: 'Alice' });

    // Verify audit record was finalized as 'success'
    const audits = (auditService as any).repo.listAudits();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].status, 'success');
    assert.equal(audits[0].tool_name, 'crm__search_contacts');
    assert.equal(audits[0].user_id, 'usr-1');

    db.close();
  });

  it('preserves upstream tool-level domain errors (isError: true) without tripping circuit breaker', async () => {
    const { router, catalogService, upstreamManager, auditService, db } = setupTestHarness();

    const tool = {
      name: 'crm__get_contact',
      originalName: 'get_contact',
      upstreamSlug: 'crm',
      inputSchema: { type: 'object' },
      _meta: { reachable: true },
    };
    (catalogService as any).currentSnapshot = {
      ...catalogService.getSnapshot(),
      toolsByPublicName: new Map([['crm__get_contact', tool]]),
    };

    const client = upstreamManager.getClient('crm')!;
    client.callTool = async () => {
      return {
        content: [{ type: 'text', text: 'Contact CRM-CONT-999 not found' }],
        isError: true,
      };
    };

    const result = await router.dispatch({
      publicToolName: 'crm__get_contact',
      arguments: {},
    });

    assert.equal(result.isError, true);
    assert.match((result.content[0] as any).text, /not found/);

    // Audit status must be 'failed' with TOOL_ERROR
    const audits = (auditService as any).repo.listAudits();
    assert.equal(audits[0].status, 'failed');
    assert.equal(audits[0].error_code, 'TOOL_ERROR');

    // Circuit breaker MUST remain closed (business tool error does not count as transport failure)
    const breaker = router.getCircuitBreaker('crm');
    assert.equal(breaker.getState(), 'closed');

    db.close();
  });

  it('classifies timeout on mutating tool as unconfirmed_outcome without retry', async () => {
    const { router, catalogService, upstreamManager, auditService, db } = setupTestHarness();

    const tool = {
      name: 'woocommerce__create_product',
      originalName: 'create_product',
      upstreamSlug: 'woocommerce',
      inputSchema: { type: 'object' },
      _meta: { reachable: true },
    };
    (catalogService as any).currentSnapshot = {
      ...catalogService.getSnapshot(),
      toolsByPublicName: new Map([['woocommerce__create_product', tool]]),
    };

    const client = upstreamManager.getClient('woocommerce')!;
    client.callTool = async () => {
      throw new UpstreamTimeoutError('The operation timed out after 50ms');
    };

    const result = await router.dispatch({
      publicToolName: 'woocommerce__create_product',
      arguments: {},
      requestDeadlineMs: 50,
    });

    assert.equal(result.isError, true);
    assert.match((result.content[0] as any).text, /timed out/);

    // Audit status for mutating operation must be 'unconfirmed_outcome'
    const audits = (auditService as any).repo.listAudits();
    assert.equal(audits[0].status, 'unconfirmed_outcome');
    assert.equal(audits[0].error_code, 'UPSTREAM_TIMEOUT');

    db.close();
  });

  it('classifies timeout on read-only tool as timeout', async () => {
    const { router, catalogService, upstreamManager, auditService, db } = setupTestHarness();

    const tool = {
      name: 'woocommerce__list_products',
      originalName: 'list_products',
      upstreamSlug: 'woocommerce',
      inputSchema: { type: 'object' },
      _meta: { reachable: true },
    };
    (catalogService as any).currentSnapshot = {
      ...catalogService.getSnapshot(),
      toolsByPublicName: new Map([['woocommerce__list_products', tool]]),
    };

    const client = upstreamManager.getClient('woocommerce')!;
    client.callTool = async () => {
      throw new UpstreamTimeoutError('The operation timed out after 50ms');
    };

    const result = await router.dispatch({
      publicToolName: 'woocommerce__list_products',
      arguments: {},
      requestDeadlineMs: 50,
    });

    assert.equal(result.isError, true);

    // Audit status for read-only operation must be 'timeout'
    const audits = (auditService as any).repo.listAudits();
    assert.equal(audits[0].status, 'timeout');
    assert.equal(audits[0].error_code, 'UPSTREAM_TIMEOUT');

    db.close();
  });

  it('enforces Phase 2 audit degradation dual signaling contract', async () => {
    const { router, catalogService, upstreamManager, auditService, db } = setupTestHarness();

    const tool = {
      name: 'tasks__create_task',
      originalName: 'create_task',
      upstreamSlug: 'tasks',
      inputSchema: { type: 'object' },
      _meta: { reachable: true },
    };
    (catalogService as any).currentSnapshot = {
      ...catalogService.getSnapshot(),
      toolsByPublicName: new Map([['tasks__create_task', tool]]),
    };

    const client = upstreamManager.getClient('tasks')!;
    client.callTool = async () => {
      return { content: [{ type: 'text', text: '{"id":"TASK-101"}' }] };
    };

    // Simulate Phase 2 finalization failure (e.g. disk full)
    auditService.finalizeAudit = (id, opts) => {
      return {
        auditId: id,
        status: opts.status,
        degraded: true,
      };
    };

    let onDegradedCalled = false;
    const result = await router.dispatch({
      publicToolName: 'tasks__create_task',
      arguments: {},
      onDegradedAudit: () => {
        onDegradedCalled = true;
      },
    });

    // Pristine content and isError: false are preserved
    assert.equal(result.isError, undefined);
    assert.equal((result.content[0] as any).text, '{"id":"TASK-101"}');

    // Dual signaling: _meta is attached and onDegradedAudit hook was triggered
    assert.equal(onDegradedCalled, true);
    assert.equal((result._meta as any).urumi_audit_status, 'finalization-degraded');
    assert.match((result._meta as any).urumi_audit_warning, /Do not retry/);

    db.close();
  });

  it('rejects responses exceeding MAX_RESULT_SIZE_BYTES with safe tool error', async () => {
    const { router, catalogService, upstreamManager, db } = setupTestHarness();

    const tool = {
      name: 'crm__search_contacts',
      originalName: 'search_contacts',
      upstreamSlug: 'crm',
      inputSchema: { type: 'object' },
      _meta: { reachable: true },
    };
    (catalogService as any).currentSnapshot = {
      ...catalogService.getSnapshot(),
      toolsByPublicName: new Map([['crm__search_contacts', tool]]),
    };

    const client = upstreamManager.getClient('crm')!;
    // Generate 2000-character payload (configured MAX_RESULT_SIZE_BYTES is 1000)
    client.callTool = async () => {
      return { content: [{ type: 'text', text: 'X'.repeat(2000) }] };
    };

    const result = await router.dispatch({
      publicToolName: 'crm__search_contacts',
      arguments: {},
    });

    assert.equal(result.isError, true);
    assert.match((result.content[0] as any).text, /response size .* exceeded maximum permissible limit/);

    db.close();
  });
});
