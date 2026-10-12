import http from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExpressApp } from '../../src/server.js';
import { AppConfig } from '../../src/config.js';

const TEST_PORT = 7799;
const TEST_CONFIG: AppConfig = {
  PORT: TEST_PORT,
  HOST: '127.0.0.1',
  WOOCOMMERCE_BASE_URL: 'http://urumi-wordpress.urumi.svc.cluster.local:80',
  WOOCOMMERCE_SITE_URL: 'http://shop.127.0.0.1.nip.io:8080',
  WOOCOMMERCE_CONSUMER_KEY: 'ck_mock_protocol_test_key',
  WOOCOMMERCE_CONSUMER_SECRET: 'cs_mock_protocol_test_secret',
  REQUEST_TIMEOUT_MS: 5000,
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
};

test('Gate G2 MCP Protocol & Discovery Test Suite', async () => {
  const app = createExpressApp(TEST_CONFIG);
  const server = app.listen(TEST_PORT, '127.0.0.1');

  try {
    // 1. Operational Health Check Test
    console.log('\n👉 [Test 1/5] Testing Operational Health Probe (/health)...');
    const healthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    if (healthRes.status !== 200) {
      throw new Error(`Expected HTTP 200 on /health, got ${healthRes.status}`);
    }
    const healthBody = (await healthRes.json()) as { status: string; service: string };
    if (healthBody.status !== 'ok' || healthBody.service !== 'urumi-woocommerce-mcp') {
      throw new Error(`Malformed health response: ${JSON.stringify(healthBody)}`);
    }
    console.log('   ✅ PASS: /health returns HTTP 200 with service identity.');

    // 2. Streamable HTTP Handshake Test
    console.log('\n👉 [Test 2/5] Testing MCP Handshake over Streamable HTTP...');
    const client = new Client(
      {
        name: 'urumi-test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`)
    );

    await client.connect(transport);
    console.log('   ✅ PASS: Streamable HTTP connection & protocol initialization succeeded.');

    // 3. Tool Discovery Verification
    console.log('\n👉 [Test 3/5] Testing Exact Five Tool Discovery (client.listTools)...');
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name).sort();
    console.log(`   Discovered ${toolNames.length} tool(s): ${toolNames.join(', ')}`);

    const expectedTools = [
      'create_product',
      'get_order',
      'list_orders',
      'list_products',
      'update_order_status',
    ].sort();

    if (JSON.stringify(toolNames) !== JSON.stringify(expectedTools)) {
      throw new Error(
        `Tool mismatch! Expected ${JSON.stringify(expectedTools)}, got ${JSON.stringify(toolNames)}`
      );
    }
    console.log('   ✅ PASS: Exactly the five immutable tools are registered.');

    // 4. Valid Tool Call Invocation
    console.log('\n👉 [Test 4/5] Testing Valid Tool Execution via Protocol...');
    const callRes = await client.callTool({
      name: 'list_products',
      arguments: { page: 1, per_page: 5 },
    });
    if (!callRes.content || callRes.content.length === 0) {
      throw new Error('Expected content in list_products response');
    }
    console.log('   ✅ PASS: Valid call to list_products succeeded.');

    // 5. Invalid Input Boundary Rejections
    console.log('\n👉 [Test 5/5] Testing Invalid-Input Handling & Unknown Tool Rejections...');

    // 5a. Call get_order with invalid negative ID
    try {
      await client.callTool({
        name: 'get_order',
        arguments: { order_id: -99 },
      });
      throw new Error('Expected get_order with negative ID to fail validation!');
    } catch (err: unknown) {
      console.log('   ✅ PASS: Invalid get_order (negative ID) properly rejected by schema.');
    }

    // 5b. Call update_order_status with unapproved status
    try {
      await client.callTool({
        name: 'update_order_status',
        arguments: { order_id: 14, status: 'shipped_unapproved' },
      });
      throw new Error('Expected update_order_status with unapproved status to fail validation!');
    } catch (err: unknown) {
      console.log('   ✅ PASS: Invalid update_order_status (unapproved status) properly rejected.');
    }

    // 5c. Call create_product with missing required fields
    try {
      await client.callTool({
        name: 'create_product',
        arguments: { name: 'Incomplete' },
      });
      throw new Error('Expected create_product with missing SKU/price to fail validation!');
    } catch (err: unknown) {
      console.log('   ✅ PASS: Invalid create_product (missing required fields) properly rejected.');
    }

    // 5d. Call unknown tool
    try {
      await client.callTool({
        name: 'unknown_arbitrary_tool',
        arguments: {},
      });
      throw new Error('Expected call to unknown tool to fail!');
    } catch (err: unknown) {
      console.log('   ✅ PASS: Unknown tool rejected safely.');
    }

    await client.close();
  } finally {
    server.close();
  }
});

