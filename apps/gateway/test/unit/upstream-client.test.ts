import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ManagedUpstreamClient } from '../../src/upstream/upstream-client.js';
import { UpstreamConnectionError, UpstreamTimeoutError } from '../../src/upstream/types.js';

describe('Gateway Managed Upstream Client Unit Tests', () => {
  function createMockUpstreamServer(tools: Array<{ name: string; description: string; schema?: z.ZodRawShape }>): {
    server: http.Server;
    port: number;
    close: () => Promise<void>;
  } {
    const app = express();
    app.use(express.json());

    app.post('/mcp', async (req, res) => {
      const mcpServer = new McpServer({ name: 'mock-server', version: '1.0.0' });
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
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('transitions state from connecting to available only after tools/list succeeds', async () => {
    const mock = createMockUpstreamServer([
      { name: 'search_items', description: 'Search items in mock' },
    ]);

    await new Promise<void>((resolve) => {
      mock.server.listen(0, '127.0.0.1', () => {
        mock.port = (mock.server.address() as any).port;
        resolve();
      });
    });

    const client = new ManagedUpstreamClient({
      slug: 'test-mcp',
      endpointUrl: `http://127.0.0.1:${mock.port}/mcp`,
      timeoutMs: 5000,
      isEnabled: true,
      allowLocalhostForTesting: true,
    });

    assert.equal(client.getHealthState(), 'connecting');

    const result = await client.discoverTools();
    assert.equal(client.getHealthState(), 'available');
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'test-mcp__search_items');
    assert.equal(client.getLastError(), null);

    await client.close();
    await mock.close();
  });

  it('deduplicates concurrent discoverTools() calls with single-flight promise sharing', async () => {
    const mock = createMockUpstreamServer([
      { name: 'item_one', description: 'Item one' },
      { name: 'item_two', description: 'Item two' },
    ]);

    await new Promise<void>((resolve) => {
      mock.server.listen(0, '127.0.0.1', () => {
        mock.port = (mock.server.address() as any).port;
        resolve();
      });
    });

    const client = new ManagedUpstreamClient({
      slug: 'singleflight-mcp',
      endpointUrl: `http://127.0.0.1:${mock.port}/mcp`,
      timeoutMs: 5000,
      isEnabled: true,
      allowLocalhostForTesting: true,
    });

    // Launch 3 concurrent calls
    const promise1 = client.discoverTools();
    const promise2 = client.discoverTools();
    const promise3 = client.discoverTools();

    // Verify they are the exact same promise instance
    assert.equal(promise1, promise2);
    assert.equal(promise2, promise3);

    const [res1, res2, res3] = await Promise.all([promise1, promise2, promise3]);
    assert.equal(res1.tools.length, 2);
    assert.equal(res2.tools.length, 2);
    assert.equal(res3.tools.length, 2);

    await client.close();
    await mock.close();
  });

  it('transitions to unavailable and tears down resources when connection fails', async () => {
    // Port 59999 has no listener
    const deadPort = 59999;
    const client = new ManagedUpstreamClient({
      slug: 'dead-mcp',
      endpointUrl: `http://127.0.0.1:${deadPort}/mcp`,
      timeoutMs: 2000,
      isEnabled: true,
      allowLocalhostForTesting: true,
    });

    await assert.rejects(
      async () => client.discoverTools(),
      (err: unknown) => {
        assert(err instanceof UpstreamConnectionError || err instanceof UpstreamTimeoutError);
        assert((err as Error).message.includes('dead-mcp'));
        return true;
      }
    );

    assert.equal(client.getHealthState(), 'unavailable');
    assert.notEqual(client.getLastError(), null);
    assert.equal(client.getClient(), null); // Cleanly torn down

    await client.close();
  });

  it('immediately returns empty tools and state disabled when isEnabled is false', async () => {
    const client = new ManagedUpstreamClient({
      slug: 'disabled-mcp',
      endpointUrl: 'http://127.0.0.1:3000/mcp',
      timeoutMs: 5000,
      isEnabled: false,
      allowLocalhostForTesting: true,
    });

    assert.equal(client.getHealthState(), 'disabled');
    const result = await client.discoverTools();
    assert.equal(result.tools.length, 0);
    assert.equal(client.getHealthState(), 'disabled');

    await client.close();
  });
});
