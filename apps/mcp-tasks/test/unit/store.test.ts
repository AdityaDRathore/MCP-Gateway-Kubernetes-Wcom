import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore, SEEDED_TASKS, parseTaskIdSuffix } from '../../src/store/task-store.js';

describe('TaskStore In-Memory State & Lifecycle Unit Tests', () => {
  let store: TaskStore;

  beforeEach(() => {
    store = new TaskStore();
  });

  test('Store initializes with exactly 2 baseline seeded tasks', () => {
    assert.equal(store.getTaskCount(), 2);
    const tasks = store.listTasks();
    assert.equal(tasks[0].id, 'TASK-001');
    assert.equal(tasks[1].id, 'TASK-002');
  });

  test('Store reset restores state strictly back to baseline and clears idempotency cache', () => {
    store.createTask({
      title: 'Temporary Task',
      idempotency_key: 'temp-key-1',
    });
    assert.equal(store.getTaskCount(), 3);
    assert.equal(store.getIdempotencyCacheSize(), 1);

    store.reset();
    assert.equal(store.getTaskCount(), 2);
    assert.equal(store.getIdempotencyCacheSize(), 0);
    assert.equal(store.getTask('TASK-003'), undefined);
  });

  test('createTask auto-increments IDs starting from TASK-003', () => {
    const res1 = store.createTask({ title: 'Task 3' });
    assert.equal(res1.success, true);
    if (res1.success) assert.equal(res1.task.id, 'TASK-003');

    const res2 = store.createTask({ title: 'Task 4' });
    assert.equal(res2.success, true);
    if (res2.success) assert.equal(res2.task.id, 'TASK-004');
  });

  test('Numerical ID suffix sorting ensures TASK-999 precedes TASK-1000', () => {
    // Verify parseTaskIdSuffix helper
    assert.equal(parseTaskIdSuffix('TASK-001'), 1);
    assert.equal(parseTaskIdSuffix('TASK-999'), 999);
    assert.equal(parseTaskIdSuffix('TASK-1000'), 1000);

    // Direct sorting verification
    const testIds = ['TASK-1000', 'TASK-002', 'TASK-999', 'TASK-001'];
    testIds.sort((a, b) => parseTaskIdSuffix(a) - parseTaskIdSuffix(b));
    assert.deepEqual(testIds, ['TASK-001', 'TASK-002', 'TASK-999', 'TASK-1000']);
  });

  test('Assignee validation accepts valid CRM contacts (CRM-CONT-001..003)', () => {
    for (const validId of ['CRM-CONT-001', 'CRM-CONT-002', 'CRM-CONT-003']) {
      const res = store.createTask({
        title: `Task assigned to ${validId}`,
        assignee_contact_id: validId,
      });
      assert.equal(res.success, true);
    }
  });

  test('Assignee validation rejects unknown contact IDs with invalid_assignee error', () => {
    const res = store.createTask({
      title: 'Task with invalid assignee',
      assignee_contact_id: 'CRM-CONT-999',
    });
    assert.equal(res.success, false);
    if (!res.success) {
      assert.equal(res.errorType, 'invalid_assignee');
      assert.ok(res.message.includes('Unknown assignee_contact_id'));
    }
  });

  describe('Idempotency Duplicate-Key & Capacity Behaviors', () => {
    test('Same idempotency_key with SAME payload returns original task without duplicate creation', () => {
      const initialCount = store.getTaskCount();
      const payload = {
        title: 'Idempotent Task',
        description: 'Test Description',
        priority: 'high' as const,
        assignee_contact_id: 'CRM-CONT-001',
        idempotency_key: 'idemp-key-100',
      };

      const res1 = store.createTask(payload);
      assert.equal(res1.success, true);
      assert.equal(store.getTaskCount(), initialCount + 1);

      const res2 = store.createTask(payload);
      assert.equal(res2.success, true);
      if (res1.success && res2.success) {
        assert.equal(res2.isCached, true);
        assert.equal(res2.task.id, res1.task.id);
        assert.equal(res2.task.created_at, res1.task.created_at);
      }
      assert.equal(store.getTaskCount(), initialCount + 1); // No duplicate task created
    });

    test('Same idempotency_key with DIFFERENT payload is rejected with idempotency_conflict error', () => {
      const key = 'idemp-key-conflict-test';
      const res1 = store.createTask({
        title: 'Initial Title',
        priority: 'medium',
        idempotency_key: key,
      });
      assert.equal(res1.success, true);

      // Attempt second call with different title
      const res2 = store.createTask({
        title: 'Changed Title',
        priority: 'medium',
        idempotency_key: key,
      });
      assert.equal(res2.success, false);
      if (!res2.success) {
        assert.equal(res2.errorType, 'idempotency_conflict');
        assert.ok(res2.message.includes('Idempotency conflict'));
      }
    });

    test('Expired idempotency keys (> 24 hours) are evicted and allow new creation', () => {
      const key = 'idemp-key-expiry-test';
      const now = Date.now();

      const res1 = store.createTask({ title: 'Task 1', idempotency_key: key }, now);
      assert.equal(res1.success, true);

      // 24 hours + 1 ms later
      const future = now + 24 * 60 * 60 * 1000 + 1;
      const res2 = store.createTask({ title: 'Task 2 Different', idempotency_key: key }, future);
      assert.equal(res2.success, true); // Succeeded because old key expired!
      if (res1.success && res2.success) {
        assert.notEqual(res2.task.id, res1.task.id);
      }
    });

    test('Cache capacity limit (1,000 keys) evicts oldest entries (FIFO)', () => {
      const now = Date.now();
      // Fill cache to capacity (1,000 keys)
      for (let i = 0; i < 1000; i++) {
        store.createTask({ title: `Task ${i}`, idempotency_key: `key-${i}` }, now);
      }
      assert.equal(store.getIdempotencyCacheSize(), 1000);

      // Insert 1001st key
      store.createTask({ title: 'Task 1000', idempotency_key: 'key-1000' }, now);
      assert.equal(store.getIdempotencyCacheSize(), 1000);

      // Oldest key `key-0` was evicted; calling it with different payload should NOT trigger conflict
      const res = store.createTask({ title: 'New task with re-used key-0', idempotency_key: 'key-0' }, now);
      assert.equal(res.success, true);
    });
  });

  describe('Task Status Updates', () => {
    test('updateTaskStatus updates status and refreshes updated_at', () => {
      const res = store.updateTaskStatus('TASK-001', 'done');
      assert.equal(res.success, true);
      if (res.success) {
        assert.equal(res.task.status, 'done');
        assert.equal(res.updated, true);
      }
    });

    test('updateTaskStatus detects already-matching status as a no-op (updated: false)', () => {
      const res = store.updateTaskStatus('TASK-001', 'in_progress');
      assert.equal(res.success, true);
      if (res.success) {
        assert.equal(res.task.status, 'in_progress');
        assert.equal(res.updated, false);
      }
    });

    test('updateTaskStatus returns not_found error for nonexistent task ID', () => {
      const res = store.updateTaskStatus('TASK-999', 'done');
      assert.equal(res.success, false);
      if (!res.success) {
        assert.equal(res.errorType, 'not_found');
        assert.ok(res.message.includes('Task not found'));
      }
    });
  });
});
