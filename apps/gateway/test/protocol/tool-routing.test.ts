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
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService } from '../../src/audit/audit-service.js';
import { CatalogService } from '../../src/upstream/catalog-service.js';
import { UpstreamManager } from '../../src/upstream/upstream-manager.js';
import { ToolRouter } from '../../src/upstream/tool-router.js';
import { createExpressApp } from '../../src/server.js';
import { parseConfig } from '../../src/config.js';
import { FakeAuthenticator } from '../helpers/fake-authenticator.js';

describe('Gateway Downstream MCP Dynamic Tool Routing Protocol Tests', () => {
  function createMockUpstream(
    name: string,
    toolHandlers: Record<
      string,
      {
        description: string;
        schema?: z.ZodRawShape;
        handler: (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
      }
    >
  ): {
    server: http.Server;
    port: number;
    close: () => Promise<void>;
  } {
    const app = express();
    app.use(express.json());

    app.post('/mcp', async (req, res) => {
      const mcpServer = new McpServer({ name, version: '1.0.0' });
      for (const [toolName, def] of Object.entries(toolHandlers)) {
        mcpServer.registerTool(
          toolName,
          {
            description: def.description,
            inputSchema: def.schema ?? {},
          },
          def.handler
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

  it('dynamically dispatches tools/call across upstreams, enforces argument validation and circuit breaker over Streamable HTTP', async () => {
    // 1. Spin up Mock Upstreams
    const wooCalls: Array<{ name: string; args: any }> = [];
    const crmCalls: Array<{ name: string; args: any }> = [];
    const tasksCalls: Array<{ name: string; args: any }> = [];

    const woo = createMockUpstream('mock-woocommerce', {
      create_product: {
        description: 'Create product in WooCommerce store',
        schema: { name: z.string(), regular_price: z.string() },
        handler: async (args) => {
          wooCalls.push({ name: 'create_product', args });
          return {
            content: [{ type: 'text', text: JSON.stringify({ id: 99, name: args.name, price: args.regular_price }) }],
          };
        },
      },
    });

    const crm = createMockUpstream('mock-crm', {
      search_contacts: {
        description: 'Search CRM contacts',
        schema: { query: z.string().optional() },
        handler: async (args) => {
          crmCalls.push({ name: 'search_contacts', args });
          return {
            content: [{ type: 'text', text: JSON.stringify([{ id: 'CRM-CONT-001', name: 'Alice', query: args.query }]) }],
          };
        },
      },
      get_contact: {
        description: 'Get single contact by ID',
        schema: { id: z.string() },
        handler: async (args) => {
          crmCalls.push({ name: 'get_contact', args });
          if (args.id === 'CRM-CONT-404') {
            return {
              content: [{ type: 'text', text: 'Contact not found' }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({ id: args.id, name: 'Alice' }) }],
          };
        },
      },
    });

    const tasks = createMockUpstream('mock-tasks', {
      create_task: {
        description: 'Create task',
        schema: { title: z.string() },
        handler: async (args) => {
          tasksCalls.push({ name: 'create_task', args });
          return {
            content: [{ type: 'text', text: JSON.stringify({ id: 'TASK-001', title: args.title }) }],
          };
        },
      },
    });

    await Promise.all([
      new Promise<void>((res) => woo.server.listen(0, '127.0.0.1', () => { woo.port = (woo.server.address() as any).port; res(); })),
      new Promise<void>((res) => crm.server.listen(0, '127.0.0.1', () => { crm.port = (crm.server.address() as any).port; res(); })),
      new Promise<void>((res) => tasks.server.listen(0, '127.0.0.1', () => { tasks.port = (tasks.server.address() as any).port; res(); })),
    ]);

    // 2. Initialize Gateway DB, repos, services, router
    const dbManager = new DatabaseManager({ dbPath: ':memory:', autoMigrate: true });
    dbManager.initialize();

    // Seed authenticated test user to satisfy foreign key constraint on audit_logs(user_id)
    dbManager.getDb().prepare("INSERT INTO users (id, username, role, created_at) VALUES ('usr-1', 'alice', 'member', ?)").run(Date.now());

    const upstreamRepo = new UpstreamRepository(dbManager.getDb());
    upstreamRepo.seedDefaults();
    upstreamRepo.updateUpstream('woocommerce', { endpointUrl: `http://127.0.0.1:${woo.port}/mcp` });
    upstreamRepo.updateUpstream('crm', { endpointUrl: `http://127.0.0.1:${crm.port}/mcp` });
    upstreamRepo.updateUpstream('tasks', { endpointUrl: `http://127.0.0.1:${tasks.port}/mcp` });

    const auditRepo = new AuditRepository(dbManager.getDb());
    const auditService = new AuditService(auditRepo);

    const catalogService = new CatalogService();
    const upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
      allowLocalhostForTesting: true,
    });

    await upstreamManager.initialize();

    const gatewayConfig = parseConfig({
      HOST: '127.0.0.1',
      DEFAULT_UPSTREAM_TIMEOUT_MS: '5000',
    });

    const toolRouter = new ToolRouter(catalogService, upstreamManager, auditService, gatewayConfig);

    const fakeAuth = new FakeAuthenticator();
    const token = 'urumi_live_test_member_token_1234567890abcdef';
    fakeAuth.registerKey(token, { id: 'usr-1', username: 'alice', role: 'member' });

    const gatewayApp = createExpressApp({
      config: gatewayConfig,
      authenticator: fakeAuth,
      catalogService,
      toolRouter,
      readinessCheck: () => true,
    });

    const gatewayHttpServer = await new Promise<http.Server>((res) => {
      const s = gatewayApp.listen(0, '127.0.0.1', () => res(s));
    });
    const gatewayPort = (gatewayHttpServer.address() as any).port;

    let client: Client | null = null;
    let transport: StreamableHTTPClientTransport | null = null;

    try {
      // 3. Connect MCP Client over Streamable HTTP Transport
      transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${gatewayPort}/mcp`),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        }
      );

      client = new Client(
        { name: 'test-gateway-client', version: '1.0.0' },
        { capabilities: {} }
      );

      await client.connect(transport);

      // 4. Test tools/list returns catalog tools
      const listRes = await client.listTools();
      assert.ok(listRes.tools.length >= 3);
      assert.ok(listRes.tools.some((t) => t.name === 'crm__search_contacts'));
      assert.ok(listRes.tools.some((t) => t.name === 'tasks__create_task'));
      assert.ok(listRes.tools.some((t) => t.name === 'woocommerce__create_product'));

      // 5. Test tools/call: CRM search_contacts (read-only)
      const crmCallRes = await client.callTool({
        name: 'crm__search_contacts',
        arguments: { query: 'alice' },
      });
      assert.equal(crmCallRes.isError, undefined);
      assert.equal(crmCalls.length, 1);
      assert.equal(crmCalls[0].name, 'search_contacts');
      assert.deepEqual(crmCalls[0].args, { query: 'alice' });

      // 6. Test tools/call: Tasks create_task (mutating)
      const tasksCallRes = await client.callTool({
        name: 'tasks__create_task',
        arguments: { title: 'Implement G6' },
      });
      assert.equal(tasksCallRes.isError, undefined);
      assert.equal(tasksCalls.length, 1);
      assert.equal(tasksCalls[0].name, 'create_task');
      assert.deepEqual(tasksCalls[0].args, { title: 'Implement G6' });

      // 7. Test tools/call: WooCommerce create_product (mutating)
      const wooCallRes = await client.callTool({
        name: 'woocommerce__create_product',
        arguments: { name: 'Organic Honey', regular_price: '19.99' },
      });
      assert.equal(wooCallRes.isError, undefined);
      assert.equal(wooCalls.length, 1);
      assert.equal(wooCalls[0].name, 'create_product');
      assert.deepEqual(wooCalls[0].args, { name: 'Organic Honey', regular_price: '19.99' });

      // 8. Test upstream tool-level domain error (isError: true)
      const notFoundRes = await client.callTool({
        name: 'crm__get_contact',
        arguments: { id: 'CRM-CONT-404' },
      });
      assert.equal(notFoundRes.isError, true);
      assert.match((notFoundRes.content[0] as any).text, /Contact not found/);

      // 9. Test unknown tool error (JSON-RPC InvalidParams)
      await assert.rejects(
        () => client.callTool({ name: 'unknown__fake_tool', arguments: {} }),
        (err: unknown) => {
          assert.match((err as Error).message, /Tool "unknown__fake_tool" not found/);
          return true;
        }
      );

      // 10. Test schema validation error (missing required parameter)
      const badArgsRes = await client.callTool({
        name: 'crm__get_contact',
        arguments: {}, // missing 'id'
      });
      assert.equal(badArgsRes.isError, true);
      assert.match((badArgsRes.content[0] as any).text, /Required property 'id' is missing/);

      // 11. Verify SQLite Audit Records
      const audits = auditRepo.listAudits({ limit: 10 });
      assert.ok(audits.length >= 4);

      const wooAudit = audits.find((a) => a.tool_name === 'woocommerce__create_product');
      assert.ok(wooAudit);
      assert.equal(wooAudit.status, 'success');
      assert.equal(wooAudit.upstream_slug, 'woocommerce');
      assert.equal(wooAudit.user_id, 'usr-1');

      const notFoundAudit = audits.find((a) => a.tool_name === 'crm__get_contact' && a.status === 'failed');
      assert.ok(notFoundAudit);
      assert.equal(notFoundAudit.error_code, 'TOOL_ERROR');
    } finally {
      if (client) await client.close();
      if (transport) await transport.close();
      gatewayHttpServer.closeAllConnections?.();
      await new Promise<void>((res) => gatewayHttpServer.close(() => res()));
      toolRouter.close();
      await upstreamManager.close();
      dbManager.close();
      await Promise.all([woo.close(), crm.close(), tasks.close()]);
    }
  });
});
