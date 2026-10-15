import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CreateTaskInputShape,
  ListTasksInputShape,
  UpdateTaskStatusInputShape,
} from './schemas.js';
import { TaskStore } from '../store/task-store.js';
import { AppConfig } from '../config.js';
import { logger } from '../logging/logger.js';

export function registerTasksTools(server: McpServer, store: TaskStore, config?: AppConfig): void {
  // 1. create_task
  server.registerTool(
    'create_task',
    {
      description: 'Create a task with strict assignee validation against CRM contacts and 1,000-key payload-aware idempotency caching.',
      inputSchema: CreateTaskInputShape,
    },
    async (args) => {
      // Failure injection support for controlled resilience tests
      if (config?.MOCK_DELAY_MS && config.MOCK_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.MOCK_DELAY_MS));
      }

      if (config?.MOCK_FAIL_MODE === 'tool-error') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Injected failure: Tasks create_task simulated error' }],
        };
      }

      if (config?.MOCK_FAIL_MODE === 'http-500') {
        throw new Error('Injected failure: Tasks simulated 500 internal server error');
      }

      const result = store.createTask({
        title: args.title,
        description: args.description,
        priority: args.priority,
        assignee_contact_id: args.assignee_contact_id,
        idempotency_key: args.idempotency_key,
      });

      if (!result.success) {
        logger.warn('Task creation rejected', {
          errorType: result.errorType,
          message: result.message,
        });
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: result.message,
            },
          ],
        };
      }

      logger.debug('Task created', {
        id: result.task.id,
        isCached: result.isCached ?? false,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.task, null, 2),
          },
        ],
      };
    }
  );

  // 2. list_tasks
  server.registerTool(
    'list_tasks',
    {
      description: 'List tasks with bounded limit, optional status/priority filtering, and numerical ID suffix ordering.',
      inputSchema: ListTasksInputShape,
    },
    async (args) => {
      if (config?.MOCK_DELAY_MS && config.MOCK_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.MOCK_DELAY_MS));
      }

      if (config?.MOCK_FAIL_MODE === 'tool-error') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Injected failure: Tasks list_tasks simulated error' }],
        };
      }

      if (config?.MOCK_FAIL_MODE === 'http-500') {
        throw new Error('Injected failure: Tasks simulated 500 internal server error');
      }

      const tasks = store.listTasks({
        status: args.status,
        priority: args.priority,
        limit: args.limit,
      });

      logger.debug('Listed tasks', {
        count: tasks.length,
        status: args.status,
        priority: args.priority,
        limit: args.limit,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(tasks, null, 2),
          },
        ],
      };
    }
  );

  // 3. update_task_status
  server.registerTool(
    'update_task_status',
    {
      description: 'Update status of an existing task. Detects already-matching status as a no-op.',
      inputSchema: UpdateTaskStatusInputShape,
    },
    async (args) => {
      if (config?.MOCK_DELAY_MS && config.MOCK_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.MOCK_DELAY_MS));
      }

      if (config?.MOCK_FAIL_MODE === 'tool-error') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Injected failure: Tasks update_task_status simulated error' }],
        };
      }

      if (config?.MOCK_FAIL_MODE === 'http-500') {
        throw new Error('Injected failure: Tasks simulated 500 internal server error');
      }

      const result = store.updateTaskStatus(args.task_id, args.status);

      if (!result.success) {
        logger.warn('Task status update failed', {
          task_id: args.task_id,
          message: result.message,
        });
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: result.message,
            },
          ],
        };
      }

      logger.debug('Task status updated', {
        id: args.task_id,
        status: args.status,
        updated: result.updated,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                task: result.task,
                updated: result.updated,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
