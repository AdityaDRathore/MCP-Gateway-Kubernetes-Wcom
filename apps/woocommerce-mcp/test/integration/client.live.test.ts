import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { WooCommerceClient } from '../../src/woocommerce/client.js';
import { AppConfig } from '../../src/config.js';
import { signOAuth1Request } from '../../src/woocommerce/oauth.js';
import {
  AuthenticationError,
  NotFoundError,
  ConflictError,
  UpstreamTimeoutError,
} from '../../src/woocommerce/errors.js';

const KUBECONTEXT = process.env.KUBECONTEXT || 'k3d-urumi';
const NAMESPACE = process.env.NAMESPACE || 'urumi';

const rawKey = execSync(`kubectl --context ${KUBECONTEXT} -n ${NAMESPACE} get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-key}'`, { encoding: 'utf-8' }).trim();
const rawSecret = execSync(`kubectl --context ${KUBECONTEXT} -n ${NAMESPACE} get secret urumi-woocommerce-api -o jsonpath='{.data.consumer-secret}'`, { encoding: 'utf-8' }).trim();

const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY ||
  (rawKey.startsWith('ck_') ? rawKey : Buffer.from(rawKey, 'base64').toString('utf-8'));
const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET ||
  (rawSecret.startsWith('cs_') ? rawSecret : Buffer.from(rawSecret, 'base64').toString('utf-8'));

const baseConfig: AppConfig = {
  PORT: 7777,
  HOST: '0.0.0.0',
  WOOCOMMERCE_BASE_URL: process.env.WOOCOMMERCE_BASE_URL || 'http://127.0.0.1:8089',
  WOOCOMMERCE_SITE_URL: process.env.WOOCOMMERCE_SITE_URL || 'http://shop.127.0.0.1.nip.io:8080',
  WOOCOMMERCE_CONSUMER_KEY: consumerKey,
  WOOCOMMERCE_CONSUMER_SECRET: consumerSecret,
  UPSTREAM_HOST_HEADER: 'urumi-wordpress.urumi.svc.cluster.local',
  REQUEST_TIMEOUT_MS: 10000,
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
};

function rawGet(url: string, hostHeader = 'urumi-wordpress.urumi.svc.cluster.local'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          Host: hostHeader,
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString('utf-8')));
        res.on('end', () => resolve({ status: res.statusCode || 500, body: data }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('WooCommerce API Client Live Integration Tests (Gate G3)', () => {
  const client = new WooCommerceClient(baseConfig);

  test('1. Live Catalog Read: retrieves seeded products', async () => {
    const products = await client.listProducts({ per_page: 10 });
    assert.ok(products.length >= 3, `Expected at least 3 products, got ${products.length}`);

    const skus = products.map((p) => p.sku);
    assert.ok(skus.includes('URUMI-MUG-001'), 'URUMI-MUG-001 must be in catalog');
    assert.ok(skus.includes('URUMI-MOUSE-001'), 'URUMI-MOUSE-001 must be in catalog');
    assert.ok(skus.includes('URUMI-NOTE-001'), 'URUMI-NOTE-001 must be in catalog');

    const mug = products.find((p) => p.sku === 'URUMI-MUG-001');
    assert.equal(mug?.name, 'Urumi Test Mug');
    assert.equal(mug?.price, '299');
    assert.equal(mug?.status, 'publish');
  });

  test('2. Live Query-Filtered Read: pagination and SKU filter', async () => {
    // Exact SKU filter
    const mugList = await client.listProducts({ sku: 'URUMI-MUG-001' });
    assert.equal(mugList.length, 1);
    assert.equal(mugList[0].sku, 'URUMI-MUG-001');

    // Bounded page size filter (per_page = 2)
    const paged = await client.listProducts({ page: 1, per_page: 2, status: 'publish' });
    assert.equal(paged.length, 2, 'Must respect per_page=2 limit');
  });

  test('3. Live Order Read: retrieves Order #14 and enforces zero customer PII', async () => {
    const order = await client.getOrder(14);
    assert.equal(order.id, 14);
    assert.equal(order.status, 'processing');
    assert.equal(order.total, '299.00');
    assert.equal(order.currency, 'INR');
    assert.ok(order.line_items.some((i) => i.sku === 'URUMI-MUG-001'));

    // PII check: assert forbidden fields do not exist on projected order
    const keys = Object.keys(order);
    assert.ok(!keys.includes('billing'));
    assert.ok(!keys.includes('shipping'));
    assert.ok(!keys.includes('customer_id'));
    assert.ok(!keys.includes('customer_ip_address'));
    assert.ok(!keys.includes('email'));
    assert.ok(!keys.includes('phone'));
  });

  test('4. Live Orders List: bounded list without customer PII', async () => {
    const orders = await client.listOrders({ per_page: 5 });
    assert.ok(orders.length >= 1);
    const order14 = orders.find((o) => o.id === 14);
    assert.ok(order14, 'Order #14 must be listed in orders');

    // PII check across list
    for (const ord of orders) {
      const keys = Object.keys(ord);
      assert.ok(!keys.includes('billing'));
      assert.ok(!keys.includes('shipping'));
      assert.ok(!keys.includes('customer_ip_address'));
    }
  });


  test('5. Negative Authentication: rejects invalid consumer key and secret', async () => {
    // Bad secret
    const badSecretClient = new WooCommerceClient({
      ...baseConfig,
      WOOCOMMERCE_CONSUMER_SECRET: 'cs_invalid_secret_abcdef1234567890',
    });
    await assert.rejects(
      async () => await badSecretClient.listProducts({ per_page: 1 }),
      (err: unknown) => err instanceof AuthenticationError && err.statusCode === 401
    );

    // Bad key
    const badKeyClient = new WooCommerceClient({
      ...baseConfig,
      WOOCOMMERCE_CONSUMER_KEY: 'ck_invalid_key_abcdef1234567890',
    });
    await assert.rejects(
      async () => await badKeyClient.listProducts({ per_page: 1 }),
      (err: unknown) => err instanceof AuthenticationError && err.statusCode === 401
    );
  });

  test('5b. Negative Authentication: rejects missing credentials', async () => {
    const missingCredsClient = new WooCommerceClient({
      ...baseConfig,
      WOOCOMMERCE_CONSUMER_KEY: '',
      WOOCOMMERCE_CONSUMER_SECRET: '',
    });
    await assert.rejects(
      async () => await missingCredsClient.listProducts({ per_page: 1 }),
      (err: unknown) => err instanceof AuthenticationError && err.statusCode === 401
    );
  });

  test('5c. Live Nonce Replay Enforcement: rejects replayed nonce from live WooCommerce', async () => {
    const signResult = signOAuth1Request({
      method: 'GET',
      transportBaseUrl: `${baseConfig.WOOCOMMERCE_BASE_URL}/wp-json/wc/v3/products`,
      signatureBaseUrl: `${baseConfig.WOOCOMMERCE_SITE_URL}/wp-json/wc/v3/products`,
      queryParams: { per_page: 1 },
      consumerKey: baseConfig.WOOCOMMERCE_CONSUMER_KEY,
      consumerSecret: baseConfig.WOOCOMMERCE_CONSUMER_SECRET,
    });

    // 1st request with fresh nonce: must succeed HTTP 200
    const res1 = await rawGet(signResult.requestUrl);
    assert.equal(res1.status, 200, `First request should succeed with 200, got ${res1.status}`);

    // 2nd request with identical nonce: WooCommerce MUST reject with HTTP 401
    const res2 = await rawGet(signResult.requestUrl);
    assert.equal(res2.status, 401, `Replayed request should be rejected with 401, got ${res2.status}`);
    assert.ok(
      res2.body.includes('Invalid nonce') || res2.body.includes('nonce has already been used'),
      `Expected nonce rejection message, got: ${res2.body}`
    );
  });

  test('5d. Live Timestamp Freshness Enforcement: rejects stale timestamp (> 15 minutes old)', async () => {
    const staleTimestamp = (Math.floor(Date.now() / 1000) - 1000).toString(); // ~16.6 minutes ago
    const signResult = signOAuth1Request({
      method: 'GET',
      transportBaseUrl: `${baseConfig.WOOCOMMERCE_BASE_URL}/wp-json/wc/v3/products`,
      signatureBaseUrl: `${baseConfig.WOOCOMMERCE_SITE_URL}/wp-json/wc/v3/products`,
      queryParams: { per_page: 1 },
      consumerKey: baseConfig.WOOCOMMERCE_CONSUMER_KEY,
      consumerSecret: baseConfig.WOOCOMMERCE_CONSUMER_SECRET,
      timestamp: staleTimestamp,
    });

    const res = await rawGet(signResult.requestUrl);
    assert.equal(res.status, 401, `Stale timestamp should be rejected with 401, got ${res.status}`);
    assert.ok(
      res.body.includes('Invalid timestamp'),
      `Expected invalid timestamp message, got: ${res.body}`
    );
  });

  test('6. Non-Existent Resource: safely maps 404', async () => {
    await assert.rejects(
      async () => await client.getOrder(999999),
      (err: unknown) => err instanceof NotFoundError && err.statusCode === 404
    );
  });

  test('7. Duplicate SKU Prevention: blocks duplicate SKU before write', async () => {
    await assert.rejects(
      async () =>
        await client.createProduct({
          name: 'Duplicate Mug',
          sku: 'URUMI-MUG-001',
          regular_price: '500.00',
        }),
      (err: unknown) => err instanceof ConflictError && err.statusCode === 409
    );
  });

  test('8. Live Product Create & Cleanup: disposable test lifecycle', async () => {
    const testSku = `URUMI-TEST-G3-${Date.now().toString().slice(-6)}`;
    const created = await client.createProduct({
      name: 'G3 Integration Test Widget',
      sku: testSku,
      regular_price: '49.99',
      status: 'draft',
      description: 'Temporary disposable widget for Gate G3 verification',
    });

    assert.ok(created.id > 0, 'Created product must have valid positive ID');
    assert.equal(created.sku, testSku);
    assert.equal(created.price, '49.99');
    assert.equal(created.status, 'draft');

    // Read back to confirm persistence
    const fetched = await client.getProductBySku(testSku);
    assert.equal(fetched?.id, created.id);
    assert.equal(fetched?.sku, testSku);

    // Clean up via WP-CLI inside WordPress pod
    const wpPod = execSync(
      `kubectl --context ${KUBECONTEXT} -n ${NAMESPACE} get pods -l app.kubernetes.io/component=wordpress -o jsonpath='{.items[0].metadata.name}'`,
      { encoding: 'utf-8' }
    ).trim();

    execSync(
      `kubectl --context ${KUBECONTEXT} -n ${NAMESPACE} exec ${wpPod} -- wp post delete ${created.id} --force --allow-root`,
      { stdio: 'pipe' }
    );

    // Verify cleanup
    const afterDelete = await client.getProductBySku(testSku);
    assert.equal(afterDelete, null, 'Deleted product must not be found');
  });

  test('9. Timeout Enforcement: aborts long-running request without retry', async () => {
    const fastTimeoutClient = new WooCommerceClient({
      ...baseConfig,
      REQUEST_TIMEOUT_MS: 1, // 1ms guaranteed timeout
    });

    await assert.rejects(
      async () => await fastTimeoutClient.listProducts({ per_page: 1 }),
      (err: unknown) => err instanceof UpstreamTimeoutError && err.statusCode === 504
    );
  });
});
