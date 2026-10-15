import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExpressApp } from '../../src/server.js';
import { TaskStore } from '../../src/store/task-store.js';
import { AppConfig } from '../../src/config.js';

const TEST_PORT = 7811;
const TEST_CONFIG: AppConfig = {
  PORT: TEST_PORT,
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  MOCK_DELAY_MS: 0,
  MOCK_FAIL_MODE: 'none',
};

describe('Tasks Mock Service Streamable HTTP Protocol Test Suite', () => {
  let server: http.Server;
  let mcpClient: Client;
  let transport: StreamableHTTPClientTransport;
  let store: TaskStore;

  before(async () => {
    store = new TaskStore();
    const app = createExpressApp(TEST_CONFIG, store);
    await new Promise<void>((resolve) => {
      server = app.listen(TEST_PORT, '127.0.0.1', () => resolve());
    });

    mcpClient = new Client(
      {
        name: 'urumi-test-tasks-client',
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
    assert.equal(body.service, 'urumi-mcp-tasks');
    assert.ok(body.timestamp);
  });

  test('2. MCP Tool Discovery advertises exactly create_task, list_tasks, update_task_status', async () => {
    const toolsResult = await mcpClient.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, ['create_task', 'list_tasks', 'update_task_status']);

    const createTool = toolsResult.tools.find((t) => t.name === 'create_task');
    assert.ok(createTool);
    assert.equal(createTool.inputSchema.type, 'object');
    assert.ok(createTool.inputSchema.properties?.title);
    assert.ok(createTool.inputSchema.properties?.priority);
    assert.ok(createTool.inputSchema.properties?.assignee_contact_id);
    assert.ok(createTool.inputSchema.properties?.idempotency_key);
  });

  test('3. Wire execution of create_task with valid parameters and CRM assignee', async () => {
    const res = await mcpClient.callTool({
      name: 'create_task',
      arguments: {
        title: 'Protocol Test Task',
        description: 'Testing task creation over Streamable HTTP',
        priority: 'urgent',
        assignee_contact_id: 'CRM-CONT-001',
      },
    });

    assert.equal(res.isError, undefined);
    assert.ok(Array.isArray(res.content));
    assert.equal(res.content[0].type, 'text');

    const task = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(task.id, 'TASK-003');
    assert.equal(task.title, 'Protocol Test Task');
    assert.equal(task.priority, 'urgent');
    assert.equal(task.assignee_contact_id, 'CRM-CONT-001');
  });

  test('4. Wire execution of create_task rejects unknown assignee contact ID', async () => {
    const res = await mcpClient.callTool({
      name: 'create_task',
      arguments: {
        title: 'Task with invalid assignee',
        assignee_contact_id: 'CRM-CONT-999',
      },
    });

    assert.equal(res.isError, true);
    assert.ok(Array.isArray(res.content));
    assert.ok((res.content[0] as { text: string }).text.includes('Unknown assignee_contact_id'));
  });

  test('5. Wire execution of create_task tests idempotency deduplication and conflict detection', async () => {
    const key = 'wire-idemp-key-1';
    const payload = {
      title: 'Idempotent Wire Task',
      description: 'Should return same task on retry',
      priority: 'high',
      idempotency_key: key,
    };

    // First call: creates new task
    const res1 = await mcpClient.callTool({
      name: 'create_task',
      arguments: payload,
    });
    assert.equal(res1.isError, undefined);
    const task1 = JSON.parse((res1.content[0] as { text: string }).text);

    // Second call: exact same payload returns original task
    const res2 = await mcpClient.callTool({
      name: 'create_task',
      arguments: payload,
    });
    assert.equal(res2.isError, undefined);
    const task2 = JSON.parse((res2.content[0] as { text: string }).text);
    assert.equal(task2.id, task1.id);
    assert.equal(task2.created_at, task1.created_at);

    // Third call: same key with different title returns idempotency conflict
    const resConflict = await mcpClient.callTool({
      name: 'create_task',
      arguments: {
        ...payload,
        title: 'Conflicting Title For Same Key',
      },
    });
    assert.equal(resConflict.isError, true);
    assert.ok((resConflict.content[0] as { text: string }).text.includes('Idempotency conflict'));
  });

  test('6. Wire execution of list_tasks returns numerical ordering', async () => {
    const res = await mcpClient.callTool({
      name: 'list_tasks',
      arguments: {
        limit: 10,
      },
    });

    assert.equal(res.isError, undefined);
    const tasks = JSON.parse((res.content[0] as { text: string }).text);
    assert.ok(tasks.length >= 3);
    assert.equal(tasks[0].id, 'TASK-001');
    assert.equal(tasks[1].id, 'TASK-002');
  });

  test('7. Wire execution of update_task_status updates status', async () => {
    const res = await mcpClient.callTool({
      name: 'update_task_status',
      arguments: {
        task_id: 'TASK-001',
        status: 'done',
      },
    });

    assert.equal(res.isError, undefined);
    const result = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(result.task.id, 'TASK-001');
    assert.equal(result.task.status, 'done');
    assert.equal(result.updated, true);
  });

  test('8. Wire execution with invalid input schema returns validation error', async () => {
    const res = await mcpClient.callTool({
      name: 'update_task_status',
      arguments: {
        task_id: 'INVALID-TASK-ID-FORMAT',
        status: 'done',
      },
    });

    assert.equal(res.isError, true);
    assert.ok(Array.isArray(res.content));
    assert.ok((res.content[0] as { text: string }).text.includes('Input validation error'));
  });
});
