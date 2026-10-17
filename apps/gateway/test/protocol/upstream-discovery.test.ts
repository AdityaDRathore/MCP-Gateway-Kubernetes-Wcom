import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { DatabaseManager } from '../../src/db/connection.js';
import { UpstreamRepository } from '../../src/db/upstream-repo.js';
import { CatalogService } from '../../src/upstream/catalog-service.js';
import { UpstreamManager } from '../../src/upstream/upstream-manager.js';

describe('Gateway Upstream Discovery Protocol Tests', () => {
  function createMockMcpService(
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
          async () => ({ content: [{ type: 'text', text: 'mock response' }] })
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

  it('discovers all 10 tools from WooCommerce, CRM, and Tasks services with deterministic namespacing', async () => {
    const wooServer = createMockMcpService('mock-woocommerce', [
      { name: 'list_products', description: 'List products' },
      { name: 'create_product', description: 'Create product' },
      { name: 'list_orders', description: 'List orders' },
      { name: 'get_order', description: 'Get order' },
      { name: 'update_order_status', description: 'Update order status' },
    ]);
    const crmServer = createMockMcpService('mock-crm', [
      { name: 'search_contacts', description: 'Search contacts' },
      { name: 'get_contact', description: 'Get contact' },
    ]);
    const tasksServer = createMockMcpService('mock-tasks', [
      { name: 'create_task', description: 'Create task' },
      { name: 'list_tasks', description: 'List tasks' },
      { name: 'update_task_status', description: 'Update task status' },
    ]);

    await Promise.all([
      new Promise<void>((res) => wooServer.server.listen(0, '127.0.0.1', () => { wooServer.port = (wooServer.server.address() as any).port; res(); })),
      new Promise<void>((res) => crmServer.server.listen(0, '127.0.0.1', () => { crmServer.port = (crmServer.server.address() as any).port; res(); })),
      new Promise<void>((res) => tasksServer.server.listen(0, '127.0.0.1', () => { tasksServer.port = (tasksServer.server.address() as any).port; res(); })),
    ]);

    const dbManager = new DatabaseManager({ dbPath: ':memory:', autoMigrate: true });
    dbManager.initialize();
    const repo = new UpstreamRepository(dbManager.getDb());

    // Seed defaults and update endpoints to ephemeral test ports
    repo.seedDefaults();
    repo.updateUpstream('woocommerce', { endpointUrl: `http://127.0.0.1:${wooServer.port}/mcp` });
    repo.updateUpstream('crm', { endpointUrl: `http://127.0.0.1:${crmServer.port}/mcp` });
    repo.updateUpstream('tasks', { endpointUrl: `http://127.0.0.1:${tasksServer.port}/mcp` });

    const catalogService = new CatalogService();
    const manager = new UpstreamManager(repo, catalogService, { allowLocalhostForTesting: true });

    try {
      await manager.initialize();

      const statuses = manager.getUpstreamStatuses();
      assert.equal(statuses.length, 3);
      for (const s of statuses) {
        assert.equal(s.healthState, 'available', `Expected ${s.slug} to be available`);
        assert.equal(s.lastError, undefined);
      }

      const snapshot = catalogService.getSnapshot();
      assert.equal(snapshot.tools.length, 10);

      const toolNames = snapshot.tools.map((t) => t.name);

      const expectedToolNames = [
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

      assert.deepEqual(toolNames, expectedToolNames, 'Tools must be strictly sorted alphabetically');

      for (const t of snapshot.tools) {
        assert.equal(t._meta?.reachable, true);
        assert.equal(t.upstreamSlug.length > 0, true);
      }
    } finally {
      await manager.close();
      dbManager.close();
      await Promise.all([wooServer.close(), crmServer.close(), tasksServer.close()]);
    }
  });

  it('isolates upstream failures: preserves cached tools with unreachable meta when an upstream fails', async () => {
    const wooServer = createMockMcpService('mock-woocommerce', [
      { name: 'list_products', description: 'List products' },
    ]);
    const crmServer = createMockMcpService('mock-crm', [
      { name: 'search_contacts', description: 'Search contacts' },
    ]);

    await Promise.all([
      new Promise<void>((res) => wooServer.server.listen(0, '127.0.0.1', () => { wooServer.port = (wooServer.server.address() as any).port; res(); })),
      new Promise<void>((res) => crmServer.server.listen(0, '127.0.0.1', () => { crmServer.port = (crmServer.server.address() as any).port; res(); })),
    ]);

    const dbManager = new DatabaseManager({ dbPath: ':memory:', autoMigrate: true });
    dbManager.initialize();
    const repo = new UpstreamRepository(dbManager.getDb());

    repo.seedDefaults();
    repo.updateUpstream('woocommerce', { endpointUrl: `http://127.0.0.1:${wooServer.port}/mcp` });
    repo.updateUpstream('crm', { endpointUrl: `http://127.0.0.1:${crmServer.port}/mcp` });
    repo.updateUpstream('tasks', { status: 'disabled' });

    const catalogService = new CatalogService();
    const manager = new UpstreamManager(repo, catalogService, { allowLocalhostForTesting: true });

    try {
      await manager.initialize();
      assert.equal(catalogService.getSnapshot().tools.length, 2);

      // Now close CRM upstream server
      await crmServer.close();

      // Refresh CRM upstream
      await manager.refreshUpstream('crm');

      const crmStatus = manager.getUpstreamStatus('crm');
      const wooStatus = manager.getUpstreamStatus('woocommerce');

      assert.equal(crmStatus?.healthState, 'unavailable');
      assert.equal(wooStatus?.healthState, 'available');
      assert.match(crmStatus?.lastError || '', /unreachable/i);

      // Snapshot still has 2 tools, but CRM tool is marked unreachable
      const snapshot = catalogService.getSnapshot();
      assert.equal(snapshot.tools.length, 2);

      const crmTool = snapshot.tools.find((t) => t.name === 'crm__search_contacts');
      const wooTool = snapshot.tools.find((t) => t.name === 'woocommerce__list_products');

      assert(crmTool);
      assert.equal(crmTool._meta?.reachable, false);
      assert.match(crmTool._meta?.error || '', /unreachable/i);

      assert(wooTool);
      assert.equal(wooTool._meta?.reachable, true);
    } finally {
      await manager.close();
      dbManager.close();
      await wooServer.close();
    }
  });

  it('deduplicates concurrent refreshAll calls across all upstreams', async () => {
    const wooServer = createMockMcpService('mock-woocommerce', [
      { name: 'list_products', description: 'List products' },
    ]);

    await new Promise<void>((res) => wooServer.server.listen(0, '127.0.0.1', () => { wooServer.port = (wooServer.server.address() as any).port; res(); }));

    const dbManager = new DatabaseManager({ dbPath: ':memory:', autoMigrate: true });
    dbManager.initialize();
    const repo = new UpstreamRepository(dbManager.getDb());

    repo.seedDefaults();
    repo.updateUpstream('woocommerce', { endpointUrl: `http://127.0.0.1:${wooServer.port}/mcp` });
    repo.updateUpstream('crm', { status: 'disabled' });
    repo.updateUpstream('tasks', { status: 'disabled' });

    const catalogService = new CatalogService();
    const manager = new UpstreamManager(repo, catalogService, { allowLocalhostForTesting: true });

    try {
      await manager.initialize();

      const p1 = manager.refreshAll();
      const p2 = manager.refreshAll();
      const p3 = manager.refreshAll();

      await Promise.all([p1, p2, p3]);

      assert.equal(catalogService.getSnapshot().tools.length, 1);
      assert.equal(manager.getUpstreamStatus('woocommerce')?.healthState, 'available');
    } finally {
      await manager.close();
      dbManager.close();
      await wooServer.close();
    }
  });
});
