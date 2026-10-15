import crypto from 'node:crypto';
import { Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppConfig } from './config.js';
import { healthHandler } from './http/health.js';
import { registerTasksTools } from './tools/index.js';
import { TaskStore, defaultTaskStore } from './store/task-store.js';
import { logger } from './logging/logger.js';

// Polyfill global crypto for SDK Streamable HTTP transport streamId generation if needed
if (typeof (globalThis as any).crypto === 'undefined') {
  (globalThis as any).crypto = crypto;
}
if (typeof (global as any).crypto === 'undefined') {
  (global as any).crypto = crypto;
}

export function createTasksMcpServer(store: TaskStore = defaultTaskStore, config?: AppConfig): McpServer {
  const server = new McpServer({
    name: 'urumi-mcp-tasks',
    version: '1.0.0',
  });

  registerTasksTools(server, store, config);
  return server;
}

export function createExpressApp(config: AppConfig, store: TaskStore = defaultTaskStore) {
  const app = createMcpExpressApp({
    host: config.HOST,
  });

  // Operational health probe
  app.get('/health', healthHandler);

  // Stateless Streamable HTTP transport endpoint
  app.post('/mcp', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const server = createTasksMcpServer(store, config);

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on('close', () => {
        transport.close();
        server.close();
        logger.debug('MCP request handled and connection closed cleanly', {
          durationMs: Date.now() - startTime,
        });
      });
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      logger.error('Unhandled error during MCP Streamable HTTP request', {
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      });

      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  });

  return app;
}
