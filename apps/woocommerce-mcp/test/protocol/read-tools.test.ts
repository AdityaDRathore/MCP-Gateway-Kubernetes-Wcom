import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExpressApp } from '../../src/server.js';
import { AppConfig } from '../../src/config.js';
import { WooCommerceClient } from '../../src/woocommerce/client.js';
import { NotFoundError, UpstreamProtocolError } from '../../src/woocommerce/errors.js';
import { ProjectedProduct, ProjectedOrder } from '../../src/woocommerce/mappers.js';

const TEST_PORT = 7800;

describe('Gate G4 Read Tools MCP Protocol Test Suite', () => {
  let server: http.Server;
  let mcpClient: Client;
  let transport: StreamableHTTPClientTransport;

  let lastListProductsArgs: unknown = null;
  let lastListOrdersArgs: unknown = null;
  let lastGetOrderArgs: unknown = null;
  let clientMethodCallCount = 0;

  const mockProduct: ProjectedProduct = {
    id: 10,
    name: 'Urumi Test Mug',
    sku: 'URUMI-MUG-001',
    type: 'simple',
    status: 'publish',
    price: '299',
    regular_price: '299',
    stock_status: 'instock',
    categories: [{ id: 16, name: 'Accessories' }],
  };

  const mockOrder: ProjectedOrder = {
    id: 14,
    status: 'processing',
    currency: 'INR',
    total: '299.00',
    date_created: '2026-10-11T18:23:04',
    payment_method: 'Cash on delivery',
    line_items: [
      {
        id: 1,
        name: 'Urumi Test Mug',
        product_id: 10,
        quantity: 1,
        subtotal: '299.00',
        total: '299.00',
        sku: 'URUMI-MUG-001',
      },
    ],
  };

  const mockWcClient = {
    listProducts: async (params: unknown) => {
      clientMethodCallCount++;
      lastListProductsArgs = params;
      const p = params as { sku?: string; search?: string };
      if (p.sku === 'NONEXISTENT' || p.search === 'EMPTY') {
        return [];
      }
      if (p.search === 'FAIL_UPSTREAM') {
        throw new UpstreamProtocolError('Upstream store returned invalid response payload');
      }
      return [mockProduct];
    },
    listOrders: async (params: unknown) => {
      clientMethodCallCount++;
      lastListOrdersArgs = params;
      const o = params as { status?: string };
      if (o.status === 'completed') {
        return [];
      }
      if (o.status === 'failed') {
        throw new Error('Database connection failed upstream');
      }
      return [mockOrder];
    },
    getOrder: async (id: number) => {
      clientMethodCallCount++;
      lastGetOrderArgs = id;
      if (id === 999999) {
        throw new NotFoundError('order', 999999);
      }
      if (id === 500) {
        throw new UpstreamProtocolError('Malformed order object received');
      }
      return mockOrder;
    },
    createProduct: async (payload: unknown) => {
      clientMethodCallCount++;
      return mockProduct;
    },
    updateOrderStatus: async (id: number, status: string) => {
      clientMethodCallCount++;
      return { id, previous_status: 'pending', status, updated: true };
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
      { name: 'gate-g4-protocol-test-client', version: '1.0.0' },
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

  // --- 1. Five Tool Discovery Contract ---
  test('1. Tool Discovery over MCP transport returns exactly five tools', async () => {
    const result = await mcpClient.listTools();
    const discoveredNames = result.tools.map((t) => t.name).sort();

    const expectedTools = [
      'create_product',
      'get_order',
      'list_orders',
      'list_products',
      'update_order_status',
    ].sort();

    assert.deepEqual(
      discoveredNames,
      expectedTools,
      'MCP tool discovery must advertise exactly the five immutable tools'
    );
  });

  // --- 2. Protocol Invocations of Write Tools ---
  test('2. Protocol call to create_product succeeds and returns projected product', async () => {
    const res = await mcpClient.callTool({
      name: 'create_product',
      arguments: {
        name: 'G5 Test Product',
        sku: 'TEST-SKU-G5',
        regular_price: '499.00',
        status: 'draft',
      },
    });

    assert.equal(res.isError, undefined);
    const product = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(product.sku, 'URUMI-MUG-001');
  });

  test('3. Protocol call to update_order_status succeeds and returns mutation result', async () => {
    const res = await mcpClient.callTool({
      name: 'update_order_status',
      arguments: {
        order_id: 14,
        status: 'completed',
      },
    });

    assert.equal(res.isError, undefined);
    const result = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(result.id, 14);
    assert.equal(result.status, 'completed');
    assert.equal(result.updated, true);
  });

  // --- 3. list_products Protocol Invocations ---
  describe('list_products via MCP Protocol Transport', () => {
    test('executes successfully with approved filters (category, sku, status, search, pagination)', async () => {
      const res = await mcpClient.callTool({
        name: 'list_products',
        arguments: {
          page: 1,
          per_page: 5,
          category: '16',
          sku: 'URUMI-MUG-001',
          status: 'publish',
          search: 'Mug',
        },
      });

      assert.equal(res.isError, undefined);
      assert.ok(res.content && res.content.length > 0);
      const products = JSON.parse((res.content[0] as { text: string }).text);
      assert.equal(products.length, 1);
      assert.equal(products[0].sku, 'URUMI-MUG-001');
      assert.deepEqual(lastListProductsArgs, {
        page: 1,
        per_page: 5,
        category: '16',
        sku: 'URUMI-MUG-001',
        status: 'publish',
        search: 'Mug',
      });
    });

    test('returns empty array when no products match filter', async () => {
      const res = await mcpClient.callTool({
        name: 'list_products',
        arguments: { sku: 'NONEXISTENT' },
      });

      assert.equal(res.isError, undefined);
      const products = JSON.parse((res.content[0] as { text: string }).text);
      assert.deepEqual(products, []);
    });

    test('handles upstream failure cleanly returning isError tool response', async () => {
      const res = await mcpClient.callTool({
        name: 'list_products',
        arguments: { search: 'FAIL_UPSTREAM' },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Invalid or unexpected response structure received from WooCommerce'
        )
      );
    });

    test('rejects out-of-bounds pagination (page: 0) before invoking handler or upstream client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'list_products',
          arguments: { page: 0 },
        });
        assert.fail('Expected protocol rejection for page: 0');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount, 'Upstream client must NOT be called on invalid schema input');
    });

    test('rejects per_page > 50 before invoking handler or upstream client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'list_products',
          arguments: { per_page: 51 },
        });
        assert.fail('Expected protocol rejection for per_page: 51');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('rejects unapproved status filter before invoking handler or upstream client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'list_products',
          arguments: { status: 'deleted_unapproved' },
        });
        assert.fail('Expected protocol rejection for unapproved status');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount);
    });
  });

  // --- 4. list_orders Protocol Invocations ---
  describe('list_orders via MCP Protocol Transport', () => {
    test('executes successfully with status and date filters', async () => {
      const res = await mcpClient.callTool({
        name: 'list_orders',
        arguments: {
          page: 1,
          per_page: 10,
          status: 'processing',
          after: '2026-10-01T00:00:00Z',
          before: '2026-10-15T00:00:00Z',
        },
      });

      assert.equal(res.isError, undefined);
      const orders = JSON.parse((res.content[0] as { text: string }).text);
      assert.equal(orders.length, 1);
      assert.equal(orders[0].id, 14);
      assert.deepEqual(lastListOrdersArgs, {
        page: 1,
        per_page: 10,
        status: 'processing',
        after: '2026-10-01T00:00:00Z',
        before: '2026-10-15T00:00:00Z',
      });
    });

    test('returns empty array when filter matches no orders', async () => {
      const res = await mcpClient.callTool({
        name: 'list_orders',
        arguments: { status: 'completed' },
      });

      assert.equal(res.isError, undefined);
      assert.deepEqual(JSON.parse((res.content[0] as { text: string }).text), []);
    });

    test('rejects after >= before date range before making any upstream call', async () => {
      const beforeCount = clientMethodCallCount;
      const res = await mcpClient.callTool({
        name: 'list_orders',
        arguments: {
          after: '2026-10-20T00:00:00Z',
          before: '2026-10-10T00:00:00Z',
        },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Validation error: "after" timestamp must be strictly earlier than "before" timestamp.'
        )
      );
      assert.equal(clientMethodCallCount, beforeCount, 'Upstream client must not be called when after >= before');
    });

    test('rejects non-ISO date string before making any upstream call', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'list_orders',
          arguments: { after: 'not-an-iso-date' },
        });
        assert.fail('Expected protocol rejection for invalid date');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('handles upstream list_orders failure returning isError response', async () => {
      const res = await mcpClient.callTool({
        name: 'list_orders',
        arguments: { status: 'failed' },
      });

      assert.equal(res.isError, true);
      assert.ok((res.content[0] as { text: string }).text.includes('Database connection failed upstream'));
    });
  });

  // --- 5. get_order Protocol Invocations & PII Omission Verification ---
  describe('get_order via MCP Protocol Transport & PII Omission Contract', () => {
    test('retrieves order details and line items over MCP protocol', async () => {
      const res = await mcpClient.callTool({
        name: 'get_order',
        arguments: { order_id: 14 },
      });

      assert.equal(res.isError, undefined);
      const text = (res.content[0] as { text: string }).text;
      const order = JSON.parse(text);

      assert.equal(order.id, 14);
      assert.equal(order.status, 'processing');
      assert.equal(order.total, '299.00');
      assert.equal(order.currency, 'INR');
      assert.equal(order.line_items.length, 1);
      assert.equal(order.line_items[0].sku, 'URUMI-MUG-001');
      assert.equal(lastGetOrderArgs, 14);
    });

    test('CRITICAL SECURITY: returned tool output string contains zero customer PII', async () => {
      const res = await mcpClient.callTool({
        name: 'get_order',
        arguments: { order_id: 14 },
      });

      const text = (res.content[0] as { text: string }).text;
      const parsed = JSON.parse(text);

      // Verify that NO customer PII keys exist in the returned JSON object
      const prohibitedKeys = [
        'billing',
        'shipping',
        'email',
        'customer_email',
        'phone',
        'customer_phone',
        'customer_note',
        'customer_ip_address',
        'customer_user_agent',
        'customer_id',
        'first_name',
        'last_name',
        'address_1',
        'postcode',
      ];

      for (const key of prohibitedKeys) {
        assert.equal(
          key in parsed,
          false,
          `Security violation: Key "${key}" found in tool output payload!`
        );
        assert.equal(
          text.includes(`"${key}"`),
          false,
          `Security violation: Field "${key}" present in raw JSON output string!`
        );
      }
    });

    test('rejects negative order_id before calling upstream client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'get_order',
          arguments: { order_id: -14 },
        });
        assert.fail('Expected protocol rejection for negative order_id');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('rejects non-integer order_id before calling upstream client', async () => {
      const beforeCount = clientMethodCallCount;
      try {
        await mcpClient.callTool({
          name: 'get_order',
          arguments: { order_id: 14.5 },
        });
        assert.fail('Expected protocol rejection for float order_id');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
      assert.equal(clientMethodCallCount, beforeCount);
    });

    test('maps nonexistent order (404) to isError tool response with clear message', async () => {
      const res = await mcpClient.callTool({
        name: 'get_order',
        arguments: { order_id: 999999 },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Error retrieving order 999999: order with ID 999999 not found in store catalog.'
        )
      );
    });

    test('maps malformed upstream response to isError response', async () => {
      const res = await mcpClient.callTool({
        name: 'get_order',
        arguments: { order_id: 500 },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Invalid or unexpected response structure received from WooCommerce'
        )
      );
    });
  });
});
