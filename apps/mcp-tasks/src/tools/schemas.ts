import { z } from 'zod';

export const VALID_CRM_ASSIGNEES: ReadonlySet<string> = new Set([
  'CRM-CONT-001',
  'CRM-CONT-002',
  'CRM-CONT-003',
]);

export const TaskPriorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPriorityEnum>;

export const TaskStatusEnum = z.enum(['todo', 'in_progress', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskRecordSchema = z.object({
  id: z.string().regex(/^TASK-[0-9]{3,}$/, 'ID must match TASK-###'),
  title: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  priority: TaskPriorityEnum,
  status: TaskStatusEnum,
  assignee_contact_id: z.string().optional(),
  idempotency_key: z.string().max(64).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

/**
 * Tool 1: create_task input parameter shape
 */
export const CreateTaskInputShape = {
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe('Task title (1 to 120 characters)'),
  description: z
    .string()
    .max(500)
    .optional()
    .describe('Optional task description (max 500 characters)'),
  priority: TaskPriorityEnum.default('medium').describe(
    'Task priority level (low, medium, high, urgent; defaults to medium)'
  ),
  assignee_contact_id: z
    .string()
    .optional()
    .describe('Optional CRM contact ID to assign task to (must match CRM-CONT-001..003)'),
  idempotency_key: z
    .string()
    .max(64)
    .optional()
    .describe('Optional client idempotency key for deduplication (max 64 characters)'),
};

/**
 * Tool 2: list_tasks input parameter shape
 */
export const ListTasksInputShape = {
  status: TaskStatusEnum.optional().describe('Optional status filter (todo, in_progress, done, cancelled)'),
  priority: TaskPriorityEnum.optional().describe('Optional priority filter (low, medium, high, urgent)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe('Maximum number of tasks to return (bounded 1 to 50, default 20)'),
};

/**
 * Tool 3: update_task_status input parameter shape
 */
export const UpdateTaskStatusInputShape = {
  task_id: z
    .string()
    .regex(/^TASK-[0-9]{3,}$/, 'Invalid Task ID format. Must match TASK-###')
    .describe('Unique task ID (e.g. TASK-001)'),
  status: TaskStatusEnum.describe('Target task status (todo, in_progress, done, cancelled)'),
};
