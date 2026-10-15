import crypto from 'node:crypto';
import { Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppConfig } from './config.js';
import { healthHandler } from './http/health.js';
import { registerCrmTools } from './tools/index.js';
import { logger } from './logging/logger.js';

// Polyfill global crypto for SDK Streamable HTTP transport streamId generation if needed
if (typeof (globalThis as any).crypto === 'undefined') {
  (globalThis as any).crypto = crypto;
}
if (typeof (global as any).crypto === 'undefined') {
  (global as any).crypto = crypto;
}

export function createCrmMcpServer(config?: AppConfig): McpServer {
  const server = new McpServer({
    name: 'urumi-mcp-crm',
    version: '1.0.0',
  });

  registerCrmTools(server, config);
  return server;
}

export function createExpressApp(config: AppConfig) {
  const app = createMcpExpressApp({
    host: config.HOST,
  });

  // Operational health probe
  app.get('/health', healthHandler);

  // Stateless Streamable HTTP transport endpoint
  app.post('/mcp', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const server = createCrmMcpServer(config);

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
