import crypto from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppConfig } from './config.js';
import { Authenticator, FailClosedAuthenticator } from './auth/authenticator.js';
import { createAuthMiddleware, AuthenticatedRequest } from './auth/middleware.js';
import { healthHandler, liveHandler, createReadyHandler } from './http/health.js';
import { createAdminRouter } from './http/admin.js';
import { logger } from './logging/logger.js';

// Polyfill global crypto for SDK Streamable HTTP transport streamId generation
if (typeof (globalThis as any).crypto === 'undefined') {
  (globalThis as any).crypto = crypto;
}
if (typeof (global as any).crypto === 'undefined') {
  (global as any).crypto = crypto;
}

export interface ServerOptions {
  config: AppConfig;
  authenticator?: Authenticator;
  readinessCheck?: () => boolean;
}

/**
 * Creates an ephemeral McpServer instance for downstream protocol handling.
 * In Gate G3, zero admin handlers and zero unverified tools are mounted.
 */
export function createGatewayMcpServer(): McpServer {
  const server = new McpServer({
    name: 'urumi-gateway',
    version: '1.0.0',
  });

  // Enable tools capability for G3 skeleton (returns empty tools array until G5 upstream catalog is integrated)
  if (typeof (server as any).setToolRequestHandlers === 'function') {
    (server as any).setToolRequestHandlers();
  }

  return server;
}

/**
 * Creates and configures the Express application for the Team MCP Gateway.
 */
export function createExpressApp(options: ServerOptions): express.Application {
  const { config } = options;
  const authenticator = options.authenticator ?? new FailClosedAuthenticator();
  const readinessCheck = options.readinessCheck ?? (() => true);

  const app = express();

  // Disable x-powered-by header to avoid information disclosure
  app.disable('x-powered-by');

  // Operational health probes (always public, no auth required)
  app.get('/health', healthHandler);
  app.get('/health/live', liveHandler);
  app.get('/health/ready', createReadyHandler(readinessCheck));

  // Reserved admin API router (mounted at /admin/v1)
  app.use('/admin/v1', createAdminRouter(authenticator));

  // Downstream MCP endpoint pre-checks: HTTP Method and Content-Type validation
  app.all('/mcp', (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({
        error: 'Method Not Allowed: Only POST is supported on /mcp',
      });
      return;
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      res.status(415).json({
        error: 'Unsupported Media Type: Content-Type must be application/json',
      });
      return;
    }

    next();
  });

  // Enforce Bearer token authentication on /mcp BEFORE body parsing
  const authMiddleware = createAuthMiddleware(authenticator);
  app.post('/mcp', authMiddleware);

  // Bounded JSON body parser enforced on authenticated requests
  const jsonParser = express.json({
    limit: config.MAX_PAYLOAD_SIZE_BYTES,
  });

  app.post('/mcp', (req: Request, res: Response, next: NextFunction) => {
    jsonParser(req, res, (err: unknown) => {
      if (err) {
        const errorObj = err as { type?: string; status?: number };
        if (errorObj.type === 'entity.too.large' || errorObj.status === 413) {
          res.status(413).json({
            error: `Payload Too Large: Request body exceeds ${config.MAX_PAYLOAD_SIZE_BYTES} bytes limit`,
          });
          return;
        }

        if (err instanceof SyntaxError && 'body' in (err as unknown as Record<string, unknown>)) {
          res.status(400).json({
            error: 'Bad Request: Malformed JSON payload',
          });
          return;
        }

        next(err);
        return;
      }
      next();
    });
  });

  // Downstream Stateless Streamable HTTP MCP endpoint
  app.post('/mcp', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const server = createGatewayMcpServer();

    // Idempotent multi-event transport lifecycle cleanup guard
    let isCleanedUp = false;
    let transport: StreamableHTTPServerTransport | null = null;

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;

      if (transport) {
        transport.close().catch((err: unknown) => {
          logger.warn('Error during transport cleanup close', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      server.close().catch((err: unknown) => {
        logger.warn('Error during server cleanup close', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      logger.debug('MCP request handled and connection cleanly closed', {
        durationMs: Date.now() - startTime,
      });
    };

    res.on('finish', cleanup);
    res.on('close', cleanup);
    req.on('error', cleanup);

    try {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: unknown) {
      cleanup();

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

  // Global fallback error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    logger.error('Unhandled server error', {
      error: err instanceof Error ? err.message : String(err),
    });

    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return app;
}
