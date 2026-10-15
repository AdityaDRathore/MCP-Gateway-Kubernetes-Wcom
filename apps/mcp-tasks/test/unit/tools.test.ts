import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createTasksMcpServer } from '../../src/server.js';
import {
  CreateTaskInputShape,
  ListTasksInputShape,
  UpdateTaskStatusInputShape,
} from '../../src/tools/schemas.js';
import { TaskStore } from '../../src/store/task-store.js';
import { AppConfig } from '../../src/config.js';

const DEFAULT_TEST_CONFIG: AppConfig = {
  PORT: 3000,
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  MOCK_DELAY_MS: 0,
  MOCK_FAIL_MODE: 'none',
};

describe('Tasks Mock Tools Unit Tests', () => {
  let store: TaskStore;

  beforeEach(() => {
    store = new TaskStore();
  });

  describe('Schema Validation Bounds', () => {
    const createSchema = z.object(CreateTaskInputShape);
    const listSchema = z.object(ListTasksInputShape);
    const updateSchema = z.object(UpdateTaskStatusInputShape);

    test('create_task accepts valid title, priority, and bounds', () => {
      const parsed = createSchema.parse({
        title: 'Valid Task',
        priority: 'urgent',
        description: 'Details',
      });
      assert.equal(parsed.title, 'Valid Task');
      assert.equal(parsed.priority, 'urgent');
      assert.equal(parsed.description, 'Details');
    });

    test('create_task defaults priority to medium', () => {
      const parsed = createSchema.parse({ title: 'Task' });
      assert.equal(parsed.priority, 'medium');
    });

    test('create_task rejects empty title or title > 120 chars', () => {
      assert.throws(() => createSchema.parse({ title: '' }));
      assert.throws(() => createSchema.parse({ title: 'a'.repeat(121) }));
    });

    test('create_task rejects description > 500 chars', () => {
      assert.throws(() => createSchema.parse({ title: 'Task', description: 'a'.repeat(501) }));
    });

    test('list_tasks bounds limit between 1 and 50, defaulting to 20', () => {
      assert.equal(listSchema.parse({}).limit, 20);
      assert.equal(listSchema.parse({ limit: 50 }).limit, 50);
      assert.throws(() => listSchema.parse({ limit: 0 }));
      assert.throws(() => listSchema.parse({ limit: 51 }));
    });

    test('update_task_status enforces strict ID regex and valid status enum', () => {
      const parsed = updateSchema.parse({ task_id: 'TASK-001', status: 'done' });
      assert.equal(parsed.task_id, 'TASK-001');
      assert.equal(parsed.status, 'done');
      assert.throws(() => updateSchema.parse({ task_id: 'invalid-id', status: 'done' }));
      assert.throws(() => updateSchema.parse({ task_id: 'TASK-001', status: 'invalid_status' }));
    });
  });

  describe('Tool Handlers Wire Shape & Execution', () => {
    test('create_task tool handler creates task and returns valid MCP content array', async () => {
      const server = createTasksMcpServer(store, DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['create_task'];

      const res = await tool.handler({
        title: 'New Integration Task',
        priority: 'high',
        assignee_contact_id: 'CRM-CONT-001',
      });

      assert.equal(res.isError, undefined);
      assert.ok(Array.isArray(res.content));
      assert.equal(res.content[0].type, 'text');

      const task = JSON.parse(res.content[0].text);
      assert.equal(task.id, 'TASK-003');
      assert.equal(task.title, 'New Integration Task');
      assert.equal(task.priority, 'high');
      assert.equal(task.assignee_contact_id, 'CRM-CONT-001');
      assert.equal(task.status, 'todo');
    });

    test('create_task tool handler rejects unknown assignee with structured error', async () => {
      const server = createTasksMcpServer(store, DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['create_task'];

      const res = await tool.handler({
        title: 'Bad Assignee Task',
        assignee_contact_id: 'CRM-CONT-999',
      });

      assert.equal(res.isError, true);
      assert.ok(Array.isArray(res.content));
      assert.equal(res.content[0].type, 'text');
      assert.ok(res.content[0].text.includes('Unknown assignee_contact_id'));
    });

    test('create_task tool handler rejects conflicting idempotency payload', async () => {
      const server = createTasksMcpServer(store, DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['create_task'];

      await tool.handler({
        title: 'First Call Title',
        idempotency_key: 'idemp-conflict-tool-test',
      });

      const resConflict = await tool.handler({
        title: 'Second Different Title',
        idempotency_key: 'idemp-conflict-tool-test',
      });

      assert.equal(resConflict.isError, true);
      assert.ok(Array.isArray(resConflict.content));
      assert.ok(resConflict.content[0].text.includes('Idempotency conflict'));
    });

    test('list_tasks returns filtered and numerically sorted tasks', async () => {
      const server = createTasksMcpServer(store, DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['list_tasks'];

      const res = await tool.handler({ status: 'in_progress', limit: 10 });
      assert.equal(res.isError, undefined);
      const tasks = JSON.parse(res.content[0].text);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].id, 'TASK-001');
      assert.equal(tasks[0].status, 'in_progress');
    });

    test('update_task_status updates status and returns updated: true', async () => {
      const server = createTasksMcpServer(store, DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['update_task_status'];

      const res = await tool.handler({
        task_id: 'TASK-002',
        status: 'done',
      });

      assert.equal(res.isError, undefined);
      const result = JSON.parse(res.content[0].text);
      assert.equal(result.task.id, 'TASK-002');
      assert.equal(result.task.status, 'done');
      assert.equal(result.updated, true);
    });

    test('update_task_status detects identical status and returns updated: false', async () => {
      const server = createTasksMcpServer(store, DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['update_task_status'];

      const res = await tool.handler({
        task_id: 'TASK-002',
        status: 'todo',
      });

      assert.equal(res.isError, undefined);
      const result = JSON.parse(res.content[0].text);
      assert.equal(result.task.id, 'TASK-002');
      assert.equal(result.task.status, 'todo');
      assert.equal(result.updated, false);
    });

    test('update_task_status returns structured error for nonexistent task', async () => {
      const server = createTasksMcpServer(store, DEFAULT_TEST_CONFIG);
      const tool = (server as any)._registeredTools['update_task_status'];

      const res = await tool.handler({
        task_id: 'TASK-999',
        status: 'done',
      });

      assert.equal(res.isError, true);
      assert.ok(Array.isArray(res.content));
      assert.ok(res.content[0].text.includes('Task not found'));
    });
  });

  describe('Failure Injection Controls', () => {
    test('Simulates tool-error when MOCK_FAIL_MODE is tool-error', async () => {
      const failConfig: AppConfig = {
        ...DEFAULT_TEST_CONFIG,
        MOCK_FAIL_MODE: 'tool-error',
      };
      const server = createTasksMcpServer(store, failConfig);
      const tool = (server as any)._registeredTools['create_task'];

      const res = await tool.handler({ title: 'Task' });
      assert.equal(res.isError, true);
      assert.ok(res.content[0].text.includes('Injected failure'));
    });
  });
});
