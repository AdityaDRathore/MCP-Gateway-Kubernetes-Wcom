import { TaskRecord, VALID_CRM_ASSIGNEES, TaskPriority, TaskStatus } from '../tools/schemas.js';

export interface CreateTaskParams {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignee_contact_id?: string;
  idempotency_key?: string;
}

export interface ListTasksParams {
  status?: TaskStatus;
  priority?: TaskPriority;
  limit?: number;
}

export interface IdempotencyEntry {
  taskId: string;
  payloadFingerprint: string;
  createdAt: number;
}

export type CreateTaskResult =
  | { success: true; task: TaskRecord; isCached?: boolean }
  | { success: false; errorType: 'invalid_assignee'; message: string }
  | { success: false; errorType: 'idempotency_conflict'; message: string };

export type UpdateTaskResult =
  | { success: true; task: TaskRecord; updated: boolean }
  | { success: false; errorType: 'not_found'; message: string };

export const SEEDED_TASKS: readonly TaskRecord[] = Object.freeze([
  {
    id: 'TASK-001',
    title: 'Review corporate mug order fulfillment',
    description: 'Verify warehouse inventory for Order 14.',
    priority: 'high',
    status: 'in_progress',
    assignee_contact_id: 'CRM-CONT-001',
    created_at: '2026-10-15T10:00:00.000Z',
    updated_at: '2026-10-15T10:00:00.000Z',
  },
  {
    id: 'TASK-002',
    title: 'Update wireless mouse warranty guide',
    description: 'Prepare warranty documentation for URUMI-MOUSE-001.',
    priority: 'medium',
    status: 'todo',
    assignee_contact_id: 'CRM-CONT-002',
    created_at: '2026-10-15T11:00:00.000Z',
    updated_at: '2026-10-15T11:00:00.000Z',
  },
]);

export const parseTaskIdSuffix = (id: string): number => {
  const match = id.match(/^TASK-([0-9]+)$/);
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * In-Memory Task Store with Idempotency Caching and Assignee Cross-Validation.
 *
 * Operational Invariants:
 * - Volatile In-Memory Array: Resets to seeded baseline on pod restart or store.reset().
 * - Task Ordering: Sorted numerically by ID suffix (TASK-999 precedes TASK-1000).
 * - Idempotency Scope: Max 1,000 keys with a 24-hour TTL.
 * - Idempotency Conflict: Same key with identical payload returns cached task;
 *   same key with different payload is rejected with an idempotency conflict error.
 * - Cache Capacity Eviction: Oldest-first (FIFO) eviction when capacity hits 1,000.
 *   High-volume ingestion may evict keys before the 24h TTL expires.
 */
export class TaskStore {
  private tasks: Map<string, TaskRecord> = new Map();
  private nextId = 3;
  private idempotencyCache: Map<string, IdempotencyEntry> = new Map();

  readonly MAX_IDEMPOTENCY_CAPACITY = 1000;
  readonly IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.reset();
  }

  /**
   * Resets the store strictly to the initial baseline state.
   */
  reset(): void {
    this.tasks.clear();
    for (const task of SEEDED_TASKS) {
      this.tasks.set(task.id, { ...task });
    }
    this.nextId = 3;
    this.idempotencyCache.clear();
  }

  private generateNextId(): string {
    const id = `TASK-${String(this.nextId).padStart(3, '0')}`;
    this.nextId++;
    return id;
  }

  private computePayloadFingerprint(params: CreateTaskParams): string {
    return JSON.stringify({
      title: params.title.trim(),
      description: params.description ?? '',
      priority: params.priority ?? 'medium',
      assignee_contact_id: params.assignee_contact_id ?? null,
    });
  }

  private evictExpiredIdempotencyKeys(now: number): void {
    for (const [key, entry] of this.idempotencyCache.entries()) {
      if (now - entry.createdAt > this.IDEMPOTENCY_TTL_MS) {
        this.idempotencyCache.delete(key);
      }
    }
  }

  createTask(params: CreateTaskParams, now = Date.now()): CreateTaskResult {
    // 1. Assignee Relationship Validation
    if (params.assignee_contact_id !== undefined && !VALID_CRM_ASSIGNEES.has(params.assignee_contact_id)) {
      return {
        success: false,
        errorType: 'invalid_assignee',
        message: `Unknown assignee_contact_id: "${params.assignee_contact_id}". Must match a valid CRM contact ID (e.g. CRM-CONT-001, CRM-CONT-002, CRM-CONT-003).`,
      };
    }

    const fingerprint = this.computePayloadFingerprint(params);

    // 2. Idempotency Check
    if (params.idempotency_key) {
      this.evictExpiredIdempotencyKeys(now);

      const cached = this.idempotencyCache.get(params.idempotency_key);
      if (cached) {
        if (now - cached.createdAt <= this.IDEMPOTENCY_TTL_MS) {
          if (cached.payloadFingerprint === fingerprint) {
            const existingTask = this.tasks.get(cached.taskId);
            if (existingTask) {
              return { success: true, task: { ...existingTask }, isCached: true };
            }
          } else {
            return {
              success: false,
              errorType: 'idempotency_conflict',
              message: `Idempotency conflict: key "${params.idempotency_key}" has already been used with different request parameters.`,
            };
          }
        } else {
          // Expired entry
          this.idempotencyCache.delete(params.idempotency_key);
        }
      }
    }

    // 3. Create New Task
    const id = this.generateNextId();
    const timestamp = new Date(now).toISOString();

    const task: TaskRecord = {
      id,
      title: params.title.trim(),
      description: params.description ?? '',
      priority: params.priority ?? 'medium',
      status: 'todo',
      assignee_contact_id: params.assignee_contact_id,
      idempotency_key: params.idempotency_key,
      created_at: timestamp,
      updated_at: timestamp,
    };

    this.tasks.set(id, task);

    // 4. Save Idempotency Key with Capacity Management
    if (params.idempotency_key) {
      if (this.idempotencyCache.size >= this.MAX_IDEMPOTENCY_CAPACITY) {
        // Oldest-first FIFO eviction: first key in Map
        const oldestKey = this.idempotencyCache.keys().next().value;
        if (oldestKey) {
          this.idempotencyCache.delete(oldestKey);
        }
      }

      this.idempotencyCache.set(params.idempotency_key, {
        taskId: id,
        payloadFingerprint: fingerprint,
        createdAt: now,
      });
    }

    return { success: true, task: { ...task } };
  }

  listTasks(params: ListTasksParams = {}): TaskRecord[] {
    const limit = params.limit ?? 20;
    let list = Array.from(this.tasks.values());

    if (params.status) {
      list = list.filter((t) => t.status === params.status);
    }

    if (params.priority) {
      list = list.filter((t) => t.priority === params.priority);
    }

    // Numerical ID suffix sorting (TASK-999 before TASK-1000)
    list.sort((a, b) => parseTaskIdSuffix(a.id) - parseTaskIdSuffix(b.id));

    return list.slice(0, limit).map((t) => ({ ...t }));
  }

  getTask(id: string): TaskRecord | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  updateTaskStatus(taskId: string, status: TaskStatus, now = Date.now()): UpdateTaskResult {
    const task = this.tasks.get(taskId);
    if (!task) {
      return {
        success: false,
        errorType: 'not_found',
        message: `Task not found: ${taskId}`,
      };
    }

    // No-op detection if status is already matching
    if (task.status === status) {
      return {
        success: true,
        task: { ...task },
        updated: false,
      };
    }

    task.status = status;
    task.updated_at = new Date(now).toISOString();

    return {
      success: true,
      task: { ...task },
      updated: true,
    };
  }

  getIdempotencyCacheSize(): number {
    return this.idempotencyCache.size;
  }

  getTaskCount(): number {
    return this.tasks.size;
  }
}

export const defaultTaskStore = new TaskStore();
