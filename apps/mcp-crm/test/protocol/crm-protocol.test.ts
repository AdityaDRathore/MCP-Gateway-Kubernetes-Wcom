import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExpressApp } from '../../src/server.js';
import { AppConfig } from '../../src/config.js';

const TEST_PORT = 7810;
const TEST_CONFIG: AppConfig = {
  PORT: TEST_PORT,
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  MOCK_DELAY_MS: 0,
  MOCK_FAIL_MODE: 'none',
};

describe('CRM Mock Service Streamable HTTP Protocol Test Suite', () => {
  let server: http.Server;
  let mcpClient: Client;
  let transport: StreamableHTTPClientTransport;

  before(async () => {
    const app = createExpressApp(TEST_CONFIG);
    await new Promise<void>((resolve) => {
      server = app.listen(TEST_PORT, '127.0.0.1', () => resolve());
    });

    mcpClient = new Client(
      {
        name: 'urumi-test-crm-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`)
    );

    await mcpClient.connect(transport);
  });

  after(async () => {
    try {
      await transport.close();
      await mcpClient.close();
    } catch {
      // Ignore client closure errors during test teardown
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  test('1. Operational Health Check (/health) probe returns HTTP 200', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; service: string; timestamp: string };
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'urumi-mcp-crm');
    assert.ok(body.timestamp);
  });

  test('2. MCP Tool Discovery advertises exactly search_contacts and get_contact', async () => {
    const toolsResult = await mcpClient.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, ['get_contact', 'search_contacts']);

    // Check search_contacts schema
    const searchTool = toolsResult.tools.find((t) => t.name === 'search_contacts');
    assert.ok(searchTool);
    assert.equal(searchTool.inputSchema.type, 'object');
    assert.ok(searchTool.inputSchema.properties?.query);
    assert.ok(searchTool.inputSchema.properties?.limit);

    // Check get_contact schema
    const getTool = toolsResult.tools.find((t) => t.name === 'get_contact');
    assert.ok(getTool);
    assert.equal(getTool.inputSchema.type, 'object');
    assert.ok(getTool.inputSchema.properties?.contact_id);
  });

  test('3. Wire execution of search_contacts returns synthetic fixtures', async () => {
    const res = await mcpClient.callTool({
      name: 'search_contacts',
      arguments: {
        query: 'Alice',
        limit: 5,
      },
    });

    assert.equal(res.isError, undefined);
    assert.ok(Array.isArray(res.content));
    assert.equal(res.content[0].type, 'text');

    const contacts = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].id, 'CRM-CONT-001');
    assert.equal(contacts[0].email, 'alice.smith@example.mock');
  });

  test('4. Wire execution of get_contact retrieves full contact', async () => {
    const res = await mcpClient.callTool({
      name: 'get_contact',
      arguments: {
        contact_id: 'CRM-CONT-002',
      },
    });

    assert.equal(res.isError, undefined);
    const contact = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(contact.id, 'CRM-CONT-002');
    assert.equal(contact.name, 'Bob Jones');
    assert.equal(contact.company, 'Globex Supply Chain');
  });

  test('5. Wire execution of get_contact returns structured error for nonexistent ID', async () => {
    const res = await mcpClient.callTool({
      name: 'get_contact',
      arguments: {
        contact_id: 'CRM-CONT-999',
      },
    });

    assert.equal(res.isError, true);
    assert.ok(Array.isArray(res.content));
    assert.equal(res.content[0].type, 'text');
    assert.ok((res.content[0] as { text: string }).text.includes('Contact not found'));
  });

  test('6. Wire execution with invalid input schema returns validation error', async () => {
    const res = await mcpClient.callTool({
      name: 'get_contact',
      arguments: {
        contact_id: 'INVALID_FORMAT_ID',
      },
    });

    assert.equal(res.isError, true);
    assert.ok(Array.isArray(res.content));
    assert.equal(res.content[0].type, 'text');
    assert.ok((res.content[0] as { text: string }).text.includes('Input validation error'));
  });
});
