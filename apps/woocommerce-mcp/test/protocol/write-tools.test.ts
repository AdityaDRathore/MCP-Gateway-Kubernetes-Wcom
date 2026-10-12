import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExpressApp } from '../../src/server.js';
import { AppConfig } from '../../src/config.js';
import { WooCommerceClient } from '../../src/woocommerce/client.js';
import { NotFoundError, ConflictError, UpstreamProtocolError } from '../../src/woocommerce/errors.js';
import { ProjectedProduct } from '../../src/woocommerce/mappers.js';

const TEST_PORT = 7802;

describe('Gate G5 Write Tools MCP Protocol Test Suite', () => {
  let server: http.Server;
  let mcpClient: Client;
  let transport: StreamableHTTPClientTransport;

  let lastCreatePayload: unknown = null;
  let lastUpdateArgs: unknown = null;
  let clientMethodCallCount = 0;

  const mockProduct: ProjectedProduct = {
    id: 101,
    name: 'G5 Wire Product',
    sku: 'G5-WIRE-001',
    type: 'simple',
    status: 'draft',
    price: '349.00',
    regular_price: '349.00',
    stock_status: 'instock',
    categories: [],
  };

  const mockWcClient = {
    createProduct: async (payload: unknown) => {
      clientMethodCallCount++;
      lastCreatePayload = payload;
      const p = payload as { sku: string; name: string };
      if (p.sku === 'DUPLICATE-SKU') {
        throw new ConflictError('Product with SKU "DUPLICATE-SKU" already exists.');
      }
      if (p.name === 'FAIL_UPSTREAM') {
        throw new UpstreamProtocolError('Upstream store returned invalid response payload');
      }
      return {
        ...mockProduct,
        name: p.name,
        sku: p.sku,
      };
    },
    updateOrderStatus: async (orderId: number, status: string) => {
      clientMethodCallCount++;
      lastUpdateArgs = { orderId, status };
      if (orderId === 999999) {
        throw new NotFoundError('order', 999999);
      }
      if (status === 'failed') {
        throw new Error('Database transaction lock timeout');
      }
      if (status === 'processing') {
        // Simulate no-op if currently already in processing
        return {
          id: orderId,
          previous_status: 'processing',
          status: 'processing',
          updated: false,
        };
      }
      return {
        id: orderId,
        previous_status: 'pending',
        status,
        updated: true,
      };
    },
  } as unknown as WooCommerceClient;

  const testConfig: AppConfig = {
    PORT: TEST_PORT,
    HOST: '127.0.0.1',
    WOOCOMMERCE_BASE_URL: 'http://127.0.0.1:8089',
    WOOCOMMERCE_SITE_URL: 'http://shop.127.0.0.1.nip.io:8080',
    WOOCOMMERCE_CONSUMER_KEY: 'ck_mock_test_key',
    WOOCOMMERCE_CONSUMER_SECRET: 'cs_mock_test_secret',
    REQUEST_TIMEOUT_MS: 5000,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
  };

  before(async () => {
    const app = createExpressApp(testConfig, mockWcClient);
    server = app.listen(TEST_PORT, '127.0.0.1');

    mcpClient = new Client(
      { name: 'gate-g5-protocol-test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`)
    );

    await mcpClient.connect(transport);
  });

  after(async () => {
    try {
      await mcpClient.close();
    } catch {}
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // --- 1. create_product Protocol Suite ---
  describe('create_product via MCP Protocol Transport', () => {
    test('successfully creates product over MCP protocol with valid fields', async () => {
      const res = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Protocol Test Widget',
          sku: 'PROTO-WIDGET-01',
          regular_price: '199.50',
          status: 'draft',
          description: 'A test widget created over Streamable HTTP.',
          manage_stock: true,
          stock_quantity: 25,
        },
      });

      assert.equal(res.isError, undefined);
      assert.ok(res.content && res.content.length > 0);
      const product = JSON.parse((res.content[0] as { text: string }).text);
      assert.equal(product.sku, 'PROTO-WIDGET-01');
      assert.deepEqual(lastCreatePayload, {
        name: 'Protocol Test Widget',
        sku: 'PROTO-WIDGET-01',
        regular_price: '199.50',
        status: 'draft',
        description: 'A test widget created over Streamable HTTP.',
        manage_stock: true,
        stock_quantity: 25,
      });
    });

    test('rejects SKU with invalid characters (spaces) before calling client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'create_product',
          arguments: {
            name: 'Invalid SKU Product',
            sku: 'INVALID SKU WITH SPACES',
            regular_price: '99.00',
          },
        });
        assert.fail('Expected rejection for SKU with spaces');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount, 'Upstream client must not be called on invalid SKU regex');
    });

    test('rejects invalid decimal price before calling client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'create_product',
          arguments: {
            name: 'Bad Price Product',
            sku: 'BAD-PRICE-01',
            regular_price: 'not-a-price',
          },
        });
        assert.fail('Expected rejection for non-decimal regular_price');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('rejects zero regular_price ("0.00") before calling client', async () => {
      const beforeCount = clientMethodCallCount;
      const res = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Free Item',
          sku: 'FREE-ITEM-01',
          regular_price: '0.00',
        },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Validation error: "regular_price" must be a positive decimal greater than zero'
        )
      );
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('rejects stock_quantity without manage_stock before calling client', async () => {
      const beforeCount = clientMethodCallCount;
      const res = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Unmanaged Stock Item',
          sku: 'UNMANAGED-01',
          regular_price: '49.00',
          manage_stock: false,
          stock_quantity: 15,
        },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Validation error: "stock_quantity" requires "manage_stock" to be true'
        )
      );
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('maps duplicate SKU ConflictError to isError response', async () => {
      const res = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Duplicate Product',
          sku: 'DUPLICATE-SKU',
          regular_price: '149.00',
        },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Error creating product "DUPLICATE-SKU": Product with SKU "DUPLICATE-SKU" already exists.'
        )
      );
    });

    test('handles upstream protocol error cleanly returning isError response', async () => {
      const res = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'FAIL_UPSTREAM',
          sku: 'FAIL-UPSTREAM-SKU',
          regular_price: '19.99',
        },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Invalid or unexpected response structure received from WooCommerce'
        )
      );
    });
  });

  // --- 2. update_order_status Protocol Suite ---
  describe('update_order_status via MCP Protocol Transport', () => {
    test('successfully updates order status over MCP protocol', async () => {
      const res = await mcpClient.callTool({
        name: 'update_order_status',
        arguments: {
          order_id: 105,
          status: 'completed',
        },
      });

      assert.equal(res.isError, undefined);
      const result = JSON.parse((res.content[0] as { text: string }).text);
      assert.equal(result.id, 105);
      assert.equal(result.previous_status, 'pending');
      assert.equal(result.status, 'completed');
      assert.equal(result.updated, true);
      assert.deepEqual(lastUpdateArgs, { orderId: 105, status: 'completed' });
    });

    test('detects already-matching status as no-op (updated: false)', async () => {
      const res = await mcpClient.callTool({
        name: 'update_order_status',
        arguments: {
          order_id: 105,
          status: 'processing',
        },
      });

      assert.equal(res.isError, undefined);
      const result = JSON.parse((res.content[0] as { text: string }).text);
      assert.equal(result.id, 105);
      assert.equal(result.previous_status, 'processing');
      assert.equal(result.status, 'processing');
      assert.equal(result.updated, false);
    });

    test('rejects unapproved status enum before calling client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'update_order_status',
          arguments: {
            order_id: 105,
            status: 'shipped_unapproved',
          },
        });
        assert.fail('Expected rejection for unapproved status');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('rejects negative order_id before calling client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'update_order_status',
          arguments: {
            order_id: -99,
            status: 'completed',
          },
        });
        assert.fail('Expected rejection for negative order_id');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('rejects non-integer float order_id before calling client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'update_order_status',
          arguments: {
            order_id: 105.7,
            status: 'completed',
          },
        });
        assert.fail('Expected rejection for float order_id');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('maps NotFoundError for nonexistent order to descriptive error message', async () => {
      const res = await mcpClient.callTool({
        name: 'update_order_status',
        arguments: {
          order_id: 999999,
          status: 'completed',
        },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Error updating order 999999 status to "completed": order with ID 999999 not found in store catalog.'
        )
      );
    });

    test('handles upstream database or system error cleanly returning isError response', async () => {
      const res = await mcpClient.callTool({
        name: 'update_order_status',
        arguments: {
          order_id: 105,
          status: 'failed',
        },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Database transaction lock timeout'
        )
      );
    });
  });
});
