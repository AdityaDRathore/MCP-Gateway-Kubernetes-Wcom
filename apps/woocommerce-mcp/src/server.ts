import { Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppConfig } from './config.js';
import { healthHandler } from './http/health.js';
import { registerAllTools } from './tools/index.js';
import { logger } from './logging/logger.js';
import { WooCommerceClient } from './woocommerce/client.js';

/**
 * Creates and configures an MCP server instance with all five WooCommerce tools registered.
 */
export function createWooCommerceMcpServer(client?: WooCommerceClient): McpServer {
  const server = new McpServer({
    name: 'urumi-woocommerce-mcp',
    version: '1.0.0',
  });

  registerAllTools(server, client);
  return server;
}

/**
 * Builds the Express application hosting the Streamable HTTP transport and health probe.
 */
export function createExpressApp(config: AppConfig, client?: WooCommerceClient) {
  const app = createMcpExpressApp({
    host: config.HOST,
  });

  const wcClient = client ?? new WooCommerceClient(config);

  // Operational health probe for Kubernetes liveness & readiness checks
  app.get('/health', healthHandler);

  // Stateless Streamable HTTP transport endpoint
  app.post('/mcp', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const server = createWooCommerceMcpServer(wcClient);

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
