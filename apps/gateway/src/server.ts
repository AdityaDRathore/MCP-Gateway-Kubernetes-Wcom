import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppConfig } from './config.js';
import { Authenticator, FailClosedAuthenticator } from './auth/authenticator.js';
import { createAuthMiddleware, AuthenticatedRequest } from './auth/middleware.js';
import { healthHandler, liveHandler, createReadyHandler } from './http/health.js';
import { createAdminRouter } from './http/admin.js';
import { createBrowserRouter } from './http/browser.js';
import { createOriginMiddleware } from './http/browser-middleware.js';
import { SessionService } from './auth/session-service.js';
import { UserRepository } from './db/user-repo.js';
import { ScryptPasswordService } from './auth/scrypt-password-service.js';
import { logger } from './logging/logger.js';

import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { CatalogService } from './upstream/catalog-service.js';
import { ToolRouter } from './upstream/tool-router.js';
import { AuthenticatedUser } from './auth/authenticator.js';
import { AdminService } from './admin/admin-service.js';
import { InvitationService } from './auth/invitation-service.js';
import { InvitationRepository } from './db/invitation-repo.js';
import { ApiKeyService } from './auth/api-key-service.js';
import { ApiKeyRepository } from './db/api-key-repo.js';
import { AuditRepository } from './db/audit-repo.js';
import { DatabaseManager } from './db/connection.js';
import { ModelProvider } from './chat/types.js';
import { ConfirmationManager } from './chat/confirmation.js';
import { AgentLoopOrchestrator } from './chat/agent-loop.js';

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
  catalogService?: CatalogService;
  toolRouter?: ToolRouter;
  adminService?: AdminService;
  onMcpRequestStart?: (req: Request, res: Response) => void | Promise<void>;
  onMcpRequestCleanup?: (reason: 'finish' | 'close' | 'error') => void;
}

export interface GatewayMcpServerOptions {
  catalogService?: CatalogService;
  toolRouter?: ToolRouter;
  user?: AuthenticatedUser;
  clientSignal?: AbortSignal;
  onDegradedAudit?: () => void;
}

/**
 * Creates an ephemeral McpServer instance for downstream protocol handling.
 * Resolves tool calls through the Gate G6 Dynamic Tool Router when provided,
 * or enforces truthful G5 boundary as fallback.
 */
export function createGatewayMcpServer(
  catalogOrOptions?: CatalogService | GatewayMcpServerOptions,
  routerFallback?: ToolRouter
): McpServer {
  let catalogService: CatalogService | undefined;
  let toolRouter: ToolRouter | undefined;
  let user: AuthenticatedUser | undefined;
  let clientSignal: AbortSignal | undefined;
  let onDegradedAudit: (() => void) | undefined;

  if (catalogOrOptions && typeof (catalogOrOptions as any).getSnapshot === 'function') {
    catalogService = catalogOrOptions as CatalogService;
    toolRouter = routerFallback;
  } else if (catalogOrOptions) {
    const opts = catalogOrOptions as GatewayMcpServerOptions;
    catalogService = opts.catalogService;
    toolRouter = opts.toolRouter;
    user = opts.user;
    clientSignal = opts.clientSignal;
    onDegradedAudit = opts.onDegradedAudit;
  }

  const server = new McpServer({
    name: 'urumi-gateway',
    version: '1.0.0',
  });

  // Register tools capability
  server.server.registerCapabilities({
    tools: {
      listChanged: true,
    },
  });

  // Handle downstream tools/list from atomic catalog snapshot
  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const snapshot = catalogService?.getSnapshot();
    const tools = snapshot?.tools ?? [];

    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        annotations: t.annotations,
        _meta: t._meta,
      })),
    };
  });

  // Handle downstream tools/call via dynamic ToolRouter
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (toolRouter) {
      return toolRouter.dispatch({
        publicToolName: request.params.name,
        arguments: request.params.arguments as Record<string, unknown> | undefined,
        user,
        clientSignal,
        onDegradedAudit,
      });
    }

    // Fallback truthful Gate G5 boundary if router is not provided
    const snapshot = catalogService?.getSnapshot();
    const tool = snapshot?.toolsByPublicName.get(request.params.name);

    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Tool "${request.params.name}" not found`);
    }

    if (tool._meta && (tool._meta as any).reachable === false) {
      return {
        content: [
          {
            type: 'text',
            text: `Upstream service '${tool.upstreamSlug}' is currently unreachable. The tool could not be executed.`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: 'Tool execution is not implemented in Gate G5. Gateway router and tool dispatch will be activated in Gate G6.',
        },
      ],
      isError: true,
    };
  });

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

  // Administrative API router (mounted at /admin/v1)
  app.use('/admin/v1', createAdminRouter(authenticator, options.adminService));

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

    // Scoped client abort controller for this specific request
    const clientAbortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        clientAbortController.abort(new Error('Client disconnected prematurely before response finished'));
      }
    });

    const server = createGatewayMcpServer({
      catalogService: options.catalogService,
      toolRouter: options.toolRouter,
      user: req.user,
      clientSignal: clientAbortController.signal,
      onDegradedAudit: () => {
        if (!res.headersSent) {
          res.setHeader('X-Urumi-Audit-Status', 'finalization-degraded');
        }
      },
    });

    // Idempotent multi-event transport lifecycle cleanup guard
    let isCleanedUp = false;
    let transport: StreamableHTTPServerTransport | null = null;

    const cleanup = (reason: 'finish' | 'close' | 'error') => {
      if (isCleanedUp) return;
      isCleanedUp = true;

      options.onMcpRequestCleanup?.(reason);

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
        reason,
      });
    };

    res.on('finish', () => cleanup('finish'));
    res.on('close', () => cleanup('close'));
    req.on('error', () => cleanup('error'));

    if (options.onMcpRequestStart) {
      await options.onMcpRequestStart(req, res);
    }

    if (res.destroyed || res.writableEnded) {
      cleanup('close');
      return;
    }

    try {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: unknown) {
      cleanup('error');

      const durationMs = Date.now() - startTime;
      logger.error('Unhandled error during MCP Streamable HTTP request', {
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      });

      if (!res.headersSent && !res.destroyed && !res.writableEnded) {
        try {
          res.status(500).json({ error: 'Internal Server Error' });
        } catch {
          // Socket was already destroyed by client abort
        }
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

export interface BrowserServerOptions {
  config: AppConfig;
  sessionService: SessionService;
  userRepo: UserRepository;
  passwordService: ScryptPasswordService;
  adminService?: AdminService;
  catalogService?: CatalogService;
  readinessCheck?: () => boolean;
  invitationService?: InvitationService;
  invitationRepo?: InvitationRepository;
  apiKeyService?: ApiKeyService;
  apiKeyRepo?: ApiKeyRepository;
  dbManager?: DatabaseManager;
  auditRepo?: AuditRepository;
  toolRouter?: ToolRouter;
  modelProvider?: ModelProvider;
  confirmationManager?: ConfirmationManager;
  agentLoop?: AgentLoopOrchestrator;
}

/**
 * Creates and configures the Express application for the Port 3001 Browser Listener.
 * Strictly isolates browser sessions, CSRF protection, and SPA static assets
 * from the Port 3000 MCP and Private Admin perimeters.
 */
export function createBrowserApp(options: BrowserServerOptions): express.Application {
  const { config, sessionService, userRepo, passwordService } = options;
  const readinessCheck = options.readinessCheck ?? (() => true);

  const app = express();
  app.disable('x-powered-by');

  // Operational health probes (always public, no auth required)
  app.get('/health', healthHandler);
  app.get('/health/live', liveHandler);
  app.get('/health/ready', createReadyHandler(readinessCheck));

  // Canonical Origin Allowlist Middleware enforced across all /api/v1/browser routes
  const allowedOriginsList = config.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  const originMiddleware = createOriginMiddleware(allowedOriginsList);

  // Bounded JSON body parser enforced on API requests
  const jsonParser = express.json({
    limit: config.MAX_PAYLOAD_SIZE_BYTES,
  });

  const trustedProxiesList = config.TRUSTED_PROXIES.split(',').map((s) => s.trim()).filter(Boolean);

  const browserRouter = createBrowserRouter({
    sessionService,
    userRepo,
    passwordService,
    cookieSecure: config.COOKIE_SECURE,
    trustedProxies: trustedProxiesList,
    adminService: options.adminService,
    catalogService: options.catalogService,
    invitationService: options.invitationService,
    invitationRepo: options.invitationRepo,
    apiKeyService: options.apiKeyService,
    apiKeyRepo: options.apiKeyRepo,
    dbManager: options.dbManager,
    auditRepo: options.auditRepo,
    toolRouter: options.toolRouter,
    modelProvider: options.modelProvider,
    confirmationManager: options.confirmationManager,
    agentLoop: options.agentLoop,
    chatTurnTimeoutMs: config.CHAT_TURN_TIMEOUT_MS,
  });

  // Mount browser API at /api/v1/browser with origin enforcement and json parsing
  app.use('/api/v1/browser', originMiddleware, jsonParser, browserRouter);

  // Serve Dashboard SPA static files if static bundle directory exists
  const staticPath = config.DASHBOARD_STATIC_PATH;
  if (fs.existsSync(staticPath)) {
    app.use(express.static(staticPath));
    // SPA fallback: return index.html for non-API client routes
    app.get('*', (req: Request, res: Response, next: NextFunction): void => {
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/admin') ||
        req.path.startsWith('/mcp')
      ) {
        return next();
      }
      const indexPath = path.join(staticPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  }

  // Fallback 404 handler for unmapped routes
  app.use((_req: Request, res: Response): void => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Global error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    logger.error('Unhandled browser server error', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return app;
}
