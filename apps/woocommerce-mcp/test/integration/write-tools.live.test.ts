import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExpressApp } from '../../src/server.js';
import { AppConfig } from '../../src/config.js';
import { WooCommerceClient } from '../../src/woocommerce/client.js';

const TEST_PORT = 7802;
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

describe('Gate G5 Live Write Tools End-to-End Integration Tests', () => {
  let server: http.Server;
  let mcpClient: Client;
  let liveClient: WooCommerceClient;

  before(async () => {
    liveClient = new WooCommerceClient(liveConfig);
    const app = createExpressApp(liveConfig, liveClient);
    server = app.listen(TEST_PORT, '127.0.0.1');

    mcpClient = new Client(
      { name: 'gate-g5-live-test-client', version: '1.0.0' },
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

  // --- 1. Live create_product Verification ---
  describe('1. Live create_product Mutation, Persistence, Duplicate SKU & Cleanup', () => {
    const disposableSku = `URUMI-TEST-G5-${Date.now()}`;
    let createdProductId: number | null = null;

    test('creates product over live MCP transport and verifies response projection', async () => {
      const res = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Live G5 Disposable Widget',
          sku: disposableSku,
          regular_price: '249.99',
          status: 'publish',
          description: 'A temporary product created to verify Gate G5 write capabilities.',
          manage_stock: true,
          stock_quantity: 12,
        },
      });

      assert.equal(res.isError, undefined);
      assert.ok(res.content && res.content.length > 0);
      const text = (res.content[0] as { text: string }).text;
      const product = JSON.parse(text);

      assert.ok(typeof product.id === 'number');
      createdProductId = product.id;

      assert.equal(product.name, 'Live G5 Disposable Widget');
      assert.equal(product.sku, disposableSku);
      assert.equal(product.price, '249.99');
      assert.equal(product.regular_price, '249.99');
      assert.equal(product.status, 'publish');
      assert.equal(product.stock_status, 'instock');

      // Verify that raw upstream payload fields are NOT returned
      assert.equal('_links' in product, false);
      assert.equal('yoast_head' in product, false);
      assert.equal('tax_class' in product, false);
    });

    test('verifies live persisted database state by reading back created product', async () => {
      assert.ok(createdProductId, 'Product must have been created');

      const persisted = await liveClient.getProductBySku(disposableSku);
      assert.ok(persisted, 'Created product must be readable from WooCommerce store');
      assert.equal(persisted.id, createdProductId);
      assert.equal(persisted.sku, disposableSku);
      assert.equal(persisted.price, '249.99');
      assert.equal(persisted.status, 'publish');
    });

    test('duplicate SKU creation returns conflict error without creating second product', async () => {
      const res = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Duplicate SKU Attempt',
          sku: disposableSku,
          regular_price: '300.00',
        },
      });

      assert.equal(res.isError, true);
      const text = (res.content[0] as { text: string }).text;
      assert.ok(
        text.includes(`Product with SKU "${disposableSku}" already exists`),
        `Expected conflict error for duplicate SKU, got: ${text}`
      );
    });

    test('cleans up disposable product and verifies permanent removal', async () => {
      assert.ok(createdProductId, 'Product ID must be known for cleanup');

      // Delete the product permanently
      await liveClient.deleteProduct(createdProductId);

      // Verify deletion from live store
      const afterDelete = await liveClient.getProductBySku(disposableSku);
      assert.equal(afterDelete, null, 'Deleted product must not be found in store');
    });
  });

  // --- 2. Live update_order_status Verification ---
  describe('2. Live update_order_status Mutation, No-Op, and Cleanup (Isolated Fixture)', () => {
    let testOrderId: number | null = null;

    before(async () => {
      // Create dedicated disposable test order for G5 mutation test
      testOrderId = await liveClient.createTestOrder('pending');
      assert.ok(testOrderId, 'Disposable test order must be created successfully');
      assert.notEqual(testOrderId, 14, 'Test fixture order must never be protected Order #14');
    });

    after(async () => {
      if (testOrderId) {
        try {
          await liveClient.deleteOrder(testOrderId);
        } catch {}
      }
    });

    test('mutates disposable order status from pending to on-hold over MCP transport', async () => {
      assert.ok(testOrderId);

      const res = await mcpClient.callTool({
        name: 'update_order_status',
        arguments: {
          order_id: testOrderId,
          status: 'on-hold',
        },
      });

      assert.equal(res.isError, undefined);
      const text = (res.content[0] as { text: string }).text;
      const result = JSON.parse(text);

      assert.equal(result.id, testOrderId);
      assert.equal(result.previous_status, 'pending');
      assert.equal(result.status, 'on-hold');
      assert.equal(result.updated, true);
    });

    test('verifies live persisted database state by reading back updated order', async () => {
      assert.ok(testOrderId);

      const persisted = await liveClient.getOrder(testOrderId);
      assert.equal(persisted.id, testOrderId);
      assert.equal(persisted.status, 'on-hold', 'Order status must be persisted as on-hold');
    });

    test('detects already-matching status as no-op without issuing upstream PUT', async () => {
      assert.ok(testOrderId);

      const res = await mcpClient.callTool({
        name: 'update_order_status',
        arguments: {
          order_id: testOrderId,
          status: 'on-hold',
        },
      });

      assert.equal(res.isError, undefined);
      const text = (res.content[0] as { text: string }).text;
      const result = JSON.parse(text);

      assert.equal(result.id, testOrderId);
      assert.equal(result.previous_status, 'on-hold');
      assert.equal(result.status, 'on-hold');
      assert.equal(result.updated, false, 'Should be marked as updated: false (no-op)');
    });

    test('maps nonexistent order ID (999999) to clean 404 isError response', async () => {
      const res = await mcpClient.callTool({
        name: 'update_order_status',
        arguments: {
          order_id: 999999,
          status: 'completed',
        },
      });

      assert.equal(res.isError, true);
      const text = (res.content[0] as { text: string }).text;
      assert.ok(
        text.includes('999999 not found in store catalog'),
        `Expected 404 error message, got: ${text}`
      );
    });

    test('cleans up disposable test order and verifies removal', async () => {
      assert.ok(testOrderId);

      await liveClient.deleteOrder(testOrderId);

      let orderFound = true;
      try {
        await liveClient.getOrder(testOrderId);
      } catch (err: unknown) {
        orderFound = false;
      }
      assert.equal(orderFound, false, 'Deleted order must no longer exist in store');
      testOrderId = null; // Mark cleaned up
    });
  });

  // --- 3. Baseline Data Preservation Verification ---
  describe('3. Baseline Data Preservation Check', () => {
    test('CRITICAL INTEGRITY: Protected Order #14 was NEVER modified and remains intact', async () => {
      const order14 = await liveClient.getOrder(14);
      assert.ok(order14, 'Order #14 must exist');
      assert.equal(order14.status, 'processing', 'Order #14 status must still be processing');
      assert.equal(order14.total, '299.00', 'Order #14 total must still be 299.00');
      assert.equal(order14.currency, 'INR', 'Order #14 currency must still be INR');
      assert.equal(order14.line_items[0].sku, 'URUMI-MUG-001');
    });

    test('CRITICAL INTEGRITY: Seeded products (10, 11, 12) remain completely untouched', async () => {
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
    });
  });

  // --- 4. Security & Sensitive Field Omission Verification ---
  describe('4. Security & Sensitive Field Omission Verification', () => {
    test('tool outputs contain zero API keys, consumer secrets, or OAuth signatures', async () => {
      const res = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Security Test Item',
          sku: 'SEC-TEST-ITEM-001',
          regular_price: '99.00',
        },
      });

      const text = (res.content[0] as { text: string }).text;

      // Clean up right away if created
      try {
        const parsed = JSON.parse(text);
        if (parsed.id) {
          await liveClient.deleteProduct(parsed.id);
        }
      } catch {}

      assert.equal(text.includes(consumerKey), false, 'Consumer key must not be in tool output');
      assert.equal(text.includes(consumerSecret), false, 'Consumer secret must not be in tool output');
      assert.equal(text.includes('oauth_signature'), false, 'OAuth signature must not be in tool output');
    });
  });
});
