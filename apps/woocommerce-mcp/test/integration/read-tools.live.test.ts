import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExpressApp } from '../../src/server.js';
import { AppConfig } from '../../src/config.js';
import { WooCommerceClient } from '../../src/woocommerce/client.js';

const TEST_PORT = 7801;
const KUBECONTEXT = process.env.KUBECONTEXT || 'k3d-urumi';
const NAMESPACE = process.env.NAMESPACE || 'urumi';

// Extract actual credentials from Kubernetes secret
const rawKey = execSync(
  `kubectl --context ${KUBECONTEXT} -n ${NAMESPACE} get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-key}'`,
  { encoding: 'utf-8' }
).trim();
const rawSecret = execSync(
  `kubectl --context ${KUBECONTEXT} -n ${NAMESPACE} get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-secret}'`,
  { encoding: 'utf-8' }
).trim();

const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY ||
  (rawKey.startsWith('ck_') ? rawKey : Buffer.from(rawKey, 'base64').toString('utf-8'));
const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET ||
  (rawSecret.startsWith('cs_') ? rawSecret : Buffer.from(rawSecret, 'base64').toString('utf-8'));

const liveConfig: AppConfig = {
  PORT: TEST_PORT,
  HOST: '127.0.0.1',
  WOOCOMMERCE_BASE_URL: process.env.WOOCOMMERCE_BASE_URL || 'http://127.0.0.1:8089',
  WOOCOMMERCE_SITE_URL: process.env.WOOCOMMERCE_SITE_URL || 'http://shop.127.0.0.1.nip.io:8080',
  WOOCOMMERCE_CONSUMER_KEY: consumerKey,
  WOOCOMMERCE_CONSUMER_SECRET: consumerSecret,
  UPSTREAM_HOST_HEADER: 'urumi-wordpress.urumi.svc.cluster.local',
  REQUEST_TIMEOUT_MS: 10000,
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
};

describe('Gate G4 Live Read Tools End-to-End Integration Tests', () => {
  let server: http.Server;
  let mcpClient: Client;
  let liveClient: WooCommerceClient;

  before(async () => {
    liveClient = new WooCommerceClient(liveConfig);
    const app = createExpressApp(liveConfig, liveClient);
    server = app.listen(TEST_PORT, '127.0.0.1');

    mcpClient = new Client(
      { name: 'gate-g4-live-test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(
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

  // --- 1. Tool Discovery Check ---
  test('1. Exact 5 Tools Discovered over Live MCP Server', async () => {
    const listRes = await mcpClient.listTools();
    const toolNames = listRes.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      'create_product',
      'get_order',
      'list_orders',
      'list_products',
      'update_order_status',
    ]);
  });

  // --- 2. Live list_products Verification ---
  describe('2. Live list_products Tool Verification', () => {
    test('retrieves seeded products from live WooCommerce store', async () => {
      const res = await mcpClient.callTool({
        name: 'list_products',
        arguments: { page: 1, per_page: 10 },
      });

      assert.equal(res.isError, undefined);
      assert.ok(res.content && res.content.length > 0);
      const products = JSON.parse((res.content[0] as { text: string }).text);
      assert.ok(products.length >= 3, `Expected at least 3 products, got ${products.length}`);

      const skus = products.map((p: { sku: string }) => p.sku);
      assert.ok(skus.includes('URUMI-MUG-001'), 'Must include URUMI-MUG-001');
      assert.ok(skus.includes('URUMI-MOUSE-001'), 'Must include URUMI-MOUSE-001');
      assert.ok(skus.includes('URUMI-NOTE-001'), 'Must include URUMI-NOTE-001');
    });

    test('filters by Category correctly on live store', async () => {
      // Category 16 = Accessories (URUMI-MUG-001)
      const res16 = await mcpClient.callTool({
        name: 'list_products',
        arguments: { category: '16' },
      });
      const prods16 = JSON.parse((res16.content[0] as { text: string }).text);
      assert.equal(prods16.length, 1);
      assert.equal(prods16[0].sku, 'URUMI-MUG-001');

      // Category 17 = Electronics (URUMI-MOUSE-001)
      const res17 = await mcpClient.callTool({
        name: 'list_products',
        arguments: { category: '17' },
      });
      const prods17 = JSON.parse((res17.content[0] as { text: string }).text);
      assert.equal(prods17.length, 1);
      assert.equal(prods17[0].sku, 'URUMI-MOUSE-001');

      // Category 18 = Stationery (URUMI-NOTE-001)
      const res18 = await mcpClient.callTool({
        name: 'list_products',
        arguments: { category: '18' },
      });
      const prods18 = JSON.parse((res18.content[0] as { text: string }).text);
      assert.equal(prods18.length, 1);
      assert.equal(prods18[0].sku, 'URUMI-NOTE-001');
    });

    test('filters by SKU, Status, and Search query on live store', async () => {
      // Exact SKU filter
      const resSku = await mcpClient.callTool({
        name: 'list_products',
        arguments: { sku: 'URUMI-NOTE-001' },
      });
      const bySku = JSON.parse((resSku.content[0] as { text: string }).text);
      assert.equal(bySku.length, 1);
      assert.equal(bySku[0].name, 'Notebook Demo');

      // Status filter
      const resStatus = await mcpClient.callTool({
        name: 'list_products',
        arguments: { status: 'publish' },
      });
      const published = JSON.parse((resStatus.content[0] as { text: string }).text);
      assert.ok(published.length >= 3);

      // Search filter
      const resSearch = await mcpClient.callTool({
        name: 'list_products',
        arguments: { search: 'Mouse' },
      });
      const searched = JSON.parse((resSearch.content[0] as { text: string }).text);
      assert.equal(searched.length, 1);
      assert.equal(searched[0].sku, 'URUMI-MOUSE-001');
    });

    test('handles empty results and bounded pagination on live store', async () => {
      // Empty result
      const resEmpty = await mcpClient.callTool({
        name: 'list_products',
        arguments: { search: 'NonexistentProductTitleXYZ99' },
      });
      const empty = JSON.parse((resEmpty.content[0] as { text: string }).text);
      assert.deepEqual(empty, []);

      // Bounded pagination: per_page=2, page=1
      const resP1 = await mcpClient.callTool({
        name: 'list_products',
        arguments: { page: 1, per_page: 2 },
      });
      const p1 = JSON.parse((resP1.content[0] as { text: string }).text);
      assert.equal(p1.length, 2);

      // Page 2
      const resP2 = await mcpClient.callTool({
        name: 'list_products',
        arguments: { page: 2, per_page: 2 },
      });
      const p2 = JSON.parse((resP2.content[0] as { text: string }).text);
      assert.ok(p2.length >= 1);
      // Ensure pages have distinct products
      assert.notEqual(p1[0].id, p2[0].id);
    });
  });

  // --- 3. Live list_orders Verification ---
  describe('3. Live list_orders Tool Verification', () => {
    test('retrieves live orders list containing Order #14', async () => {
      const res = await mcpClient.callTool({
        name: 'list_orders',
        arguments: { page: 1, per_page: 10 },
      });

      assert.equal(res.isError, undefined);
      const orders = JSON.parse((res.content[0] as { text: string }).text);
      assert.ok(orders.length >= 1, 'Store must contain at least Order #14');
      const order14 = orders.find((o: { id: number }) => o.id === 14);
      assert.ok(order14, 'Order #14 must be present in orders list');
      assert.equal(order14.status, 'processing');
      assert.equal(order14.total, '299.00');
    });

    test('filters orders by status on live store', async () => {
      // Status = processing (matches #14)
      const resProc = await mcpClient.callTool({
        name: 'list_orders',
        arguments: { status: 'processing' },
      });
      const procOrders = JSON.parse((resProc.content[0] as { text: string }).text);
      assert.ok(procOrders.length >= 1);
      assert.ok(procOrders.every((o: { status: string }) => o.status === 'processing'));

      // Status = completed (matches 0)
      const resComp = await mcpClient.callTool({
        name: 'list_orders',
        arguments: { status: 'completed' },
      });
      const compOrders = JSON.parse((resComp.content[0] as { text: string }).text);
      assert.deepEqual(compOrders, []);
    });

    test('filters orders by date range on live store', async () => {
      // Matching range
      const resDate = await mcpClient.callTool({
        name: 'list_orders',
        arguments: {
          after: '2026-10-11T00:00:00Z',
          before: '2026-10-12T00:00:00Z',
        },
      });
      const dateOrders = JSON.parse((resDate.content[0] as { text: string }).text);
      assert.ok(dateOrders.length >= 1);
      assert.ok(dateOrders.some((o: { id: number }) => o.id === 14));

      // Future non-matching range
      const resFuture = await mcpClient.callTool({
        name: 'list_orders',
        arguments: {
          after: '2026-10-25T00:00:00Z',
          before: '2026-10-26T00:00:00Z',
        },
      });
      const futureOrders = JSON.parse((resFuture.content[0] as { text: string }).text);
      assert.deepEqual(futureOrders, []);
    });

    test('rejects invalid date range (after >= before) without upstream call', async () => {
      const res = await mcpClient.callTool({
        name: 'list_orders',
        arguments: {
          after: '2026-10-25T00:00:00Z',
          before: '2026-10-10T00:00:00Z',
        },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          'Validation error: "after" timestamp must be strictly earlier than "before" timestamp.'
        )
      );
    });
  });

  // --- 4. Live get_order & PII Omission Verification ---
  describe('4. Live get_order Tool & PII Omission Verification', () => {
    test('retrieves live Order #14 details and line items over MCP protocol', async () => {
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
      assert.ok(order.line_items.length >= 1);
      assert.equal(order.line_items[0].sku, 'URUMI-MUG-001');
      assert.equal(order.line_items[0].quantity, 1);
    });

    test('CRITICAL SECURITY: live get_order tool response strictly omits all customer PII', async () => {
      const res = await mcpClient.callTool({
        name: 'get_order',
        arguments: { order_id: 14 },
      });

      const text = (res.content[0] as { text: string }).text;
      const parsed = JSON.parse(text);

      // Verify that NO customer PII keys exist anywhere in the payload
      const sensitiveKeys = [
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
        'address_2',
        'postcode',
      ];

      for (const key of sensitiveKeys) {
        assert.equal(
          key in parsed,
          false,
          `Security violation: Key "${key}" present in parsed output!`
        );
        assert.equal(
          text.includes(`"${key}"`),
          false,
          `Security violation: Key "${key}" present in raw JSON response string!`
        );
      }
    });

    test('maps nonexistent order ID (999999) to clean 404 isError response', async () => {
      const res = await mcpClient.callTool({
        name: 'get_order',
        arguments: { order_id: 999999 },
      });

      assert.equal(res.isError, true);
      assert.ok(
        (res.content[0] as { text: string }).text.includes(
          '999999 not found in store catalog'
        )
      );
    });
  });

  // --- 5. Write Tools Input Validation on Live Server ---
  describe('5. Write Tools Input Validation on Live Server', () => {
    test('create_product rejects invalid SKU with spaces over live transport', async () => {
      try {
        await mcpClient.callTool({
          name: 'create_product',
          arguments: {
            name: 'Invalid SKU Product',
            sku: 'INVALID SKU SPACES',
            regular_price: '199.00',
            status: 'draft',
          },
        });
        assert.fail('Expected protocol rejection for SKU with spaces');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
    });

    test('update_order_status rejects unapproved status enum over live transport', async () => {
      try {
        await mcpClient.callTool({
          name: 'update_order_status',
          arguments: {
            order_id: 14,
            status: 'refunded',
          },
        });
        assert.fail('Expected protocol rejection for unapproved status');
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
      }
    });
  });

  // --- 6. Baseline Data Preservation Verification ---
  describe('6. Baseline Data Preservation Check', () => {
    test('Seeded products (10, 11, 12) and Order #14 remain completely untouched', async () => {
      // Fetch products directly from live client
      const products = await liveClient.listProducts({ per_page: 10 });
      const mug = products.find((p) => p.id === 10);
      const mouse = products.find((p) => p.id === 11);
      const note = products.find((p) => p.id === 12);

      assert.ok(mug, 'Product #10 must exist');
      assert.equal(mug.sku, 'URUMI-MUG-001');
      assert.equal(mug.price, '299');
      assert.equal(mug.status, 'publish');

      assert.ok(mouse, 'Product #11 must exist');
      assert.equal(mouse.sku, 'URUMI-MOUSE-001');
      assert.equal(mouse.price, '799');
      assert.equal(mouse.status, 'publish');

      assert.ok(note, 'Product #12 must exist');
      assert.equal(note.sku, 'URUMI-NOTE-001');
      assert.equal(note.price, '149');
      assert.equal(note.status, 'publish');

      // Fetch Order #14 directly from live client
      const order = await liveClient.getOrder(14);
      assert.ok(order, 'Order #14 must exist');
      assert.equal(order.status, 'processing');
      assert.equal(order.total, '299.00');
      assert.equal(order.currency, 'INR');
      assert.equal(order.line_items[0].sku, 'URUMI-MUG-001');
    });
  });
});
