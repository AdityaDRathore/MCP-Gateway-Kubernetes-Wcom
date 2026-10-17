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
import { createExpressApp } from '../../src/server.js';
import { parseConfig } from '../../src/config.js';
import { FakeAuthenticator } from '../helpers/fake-authenticator.js';

describe('Gateway Downstream MCP Catalog Protocol Tests', () => {
  function createMockUpstream(
    name: string,
    tools: Array<{ name: string; description: string; schema?: z.ZodRawShape }>
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
            inputSchema: t.schema ?? { query: z.string().optional() },
          },
          async () => ({ content: [{ type: 'text', text: 'ok' }] })
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

  it('serves aggregated 10-tool catalog downstream and enforces truthful G5 call boundaries', async () => {
    // 1. Spin up 3 mock upstream services
    const woo = createMockUpstream('mock-woocommerce', [
      { name: 'list_products', description: 'List products' },
      { name: 'create_product', description: 'Create product' },
      { name: 'list_orders', description: 'List orders' },
      { name: 'get_order', description: 'Get order' },
      { name: 'update_order_status', description: 'Update order status' },
    ]);
    const crm = createMockUpstream('mock-crm', [
      { name: 'search_contacts', description: 'Search contacts' },
      { name: 'get_contact', description: 'Get contact' },
    ]);
    const tasks = createMockUpstream('mock-tasks', [
      { name: 'create_task', description: 'Create task' },
      { name: 'list_tasks', description: 'List tasks' },
      { name: 'update_task_status', description: 'Update task status' },
    ]);

    await Promise.all([
      new Promise<void>((res) => woo.server.listen(0, '127.0.0.1', () => { woo.port = (woo.server.address() as any).port; res(); })),
      new Promise<void>((res) => crm.server.listen(0, '127.0.0.1', () => { crm.port = (crm.server.address() as any).port; res(); })),
      new Promise<void>((res) => tasks.server.listen(0, '127.0.0.1', () => { tasks.port = (tasks.server.address() as any).port; res(); })),
    ]);

    // 2. Initialize Gateway DB, repos, catalog, and manager
    const dbManager = new DatabaseManager({ dbPath: ':memory:', autoMigrate: true });
    dbManager.initialize();
    const upstreamRepo = new UpstreamRepository(dbManager.getDb());

    upstreamRepo.seedDefaults();
    upstreamRepo.updateUpstream('woocommerce', { endpointUrl: `http://127.0.0.1:${woo.port}/mcp` });
    upstreamRepo.updateUpstream('crm', { endpointUrl: `http://127.0.0.1:${crm.port}/mcp` });
    upstreamRepo.updateUpstream('tasks', { endpointUrl: `http://127.0.0.1:${tasks.port}/mcp` });

    const catalogService = new CatalogService();
    const upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
      allowLocalhostForTesting: true,
    });

    await upstreamManager.initialize();

    // 3. Set up Gateway Express app with authentication
    const fakeAuth = new FakeAuthenticator();
    const validToken = 'urumi_live_test_member_token_1234567890abcdef';
    fakeAuth.registerKey(validToken, { id: 'usr-1', username: 'alice', role: 'member' });

    const gatewayConfig = parseConfig({
      HOST: '127.0.0.1',
    });

    const gatewayApp = createExpressApp({
      config: gatewayConfig,
      authenticator: fakeAuth,
      catalogService,
      readinessCheck: () => true,
    });

    const gatewayHttpServer = await new Promise<http.Server>((res) => {
      const s = gatewayApp.listen(0, '127.0.0.1', () => res(s));
    });
    const gatewayPort = (gatewayHttpServer.address() as any).port;

    let client: Client | null = null;
    let transport: StreamableHTTPClientTransport | null = null;

    try {
      // 4. Connect MCP Client over Streamable HTTP Transport
      transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${gatewayPort}/mcp`),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${validToken}`,
            },
          },
        }
      );

      client = new Client(
        { name: 'test-gateway-mcp-client', version: '1.0.0' },
        { capabilities: {} }
      );

      await client.connect(transport);

      // 5. Test tools/list
      const listResult = await client.listTools();
      assert.equal(listResult.tools.length, 10, 'Downstream client must receive all 10 tools');

      const expectedNames = [
        'crm__get_contact',
        'crm__search_contacts',
        'tasks__create_task',
        'tasks__list_tasks',
        'tasks__update_task_status',
        'woocommerce__create_product',
        'woocommerce__get_order',
        'woocommerce__list_orders',
        'woocommerce__list_products',
        'woocommerce__update_order_status',
      ];

      const actualNames = listResult.tools.map((t) => t.name);
      assert.deepEqual(actualNames, expectedNames, 'Tools must be strictly sorted alphabetically');

      // Verify tool schema structure
      for (const tool of listResult.tools) {
        assert(tool.name.includes('__'));
        assert(tool.inputSchema);
        assert.equal(tool.inputSchema.type, 'object');
      }

      // 6. Test truthful G5 tools/call boundary on available tool
      const callResult = await client.callTool({
        name: 'crm__search_contacts',
        arguments: { query: 'test' },
      });

      // Must return isError: true and truthful Gate G5 deferred message
      assert.equal(callResult.isError, true, 'G5 must return isError: true for deferred execution');
      assert.equal(Array.isArray(callResult.content), true);
      const textContent = (callResult.content as any)[0]?.text;
      assert.match(textContent, /Tool execution is not implemented in Gate G5/);
      assert.match(textContent, /activated in Gate G6/);

      // 7. Test calling an unreachable tool after upstream failure
      await crm.close();
      await upstreamManager.refreshUpstream('crm');

      const unreachableCall = await client.callTool({
        name: 'crm__search_contacts',
        arguments: { query: 'test' },
      });

      assert.equal(unreachableCall.isError, true);
      const unreachableText = (unreachableCall.content as any)[0]?.text;
      assert.match(unreachableText, /Upstream service 'crm' is currently unreachable/);
      assert.match(unreachableText, /The tool could not be executed/);

      // 8. Test calling an unknown tool (throws InvalidParams McpError)
      await assert.rejects(
        () => client.callTool({
          name: 'nonexistent__tool',
          arguments: {},
        }),
        (err: unknown) => {
          assert.match((err as Error).message, /Tool "nonexistent__tool" not found/);
          return true;
        }
      );
    } finally {
      if (client) {
        await client.close();
      }
      if (transport) {
        await transport.close();
      }
      gatewayHttpServer.closeAllConnections?.();
      await new Promise<void>((res) => gatewayHttpServer.close(() => res()));
      await upstreamManager.close();
      dbManager.close();
      await Promise.all([woo.close(), tasks.close()]);
    }
  });
});
