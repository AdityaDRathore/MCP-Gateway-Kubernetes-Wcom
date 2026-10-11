import { Request, Response, NextFunction } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PORT = parseInt(process.env.PORT || '7777', 10);
// Network binding: Defaults to 127.0.0.1 for local isolation, but in Kubernetes
// pods or Docker containers, HOST=0.0.0.0 allows traffic from ingress / cluster service mesh.
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const ALLOWED_HOSTS = process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',').map(s => s.trim()) : undefined;

// Strict security: require explicit environment variable, fail fast on missing secret
const EXPECTED_API_KEY = process.env.MCP_SPIKE_API_KEY;
if (!EXPECTED_API_KEY || EXPECTED_API_KEY.trim().length === 0) {
  console.error('[FATAL] MCP_SPIKE_API_KEY environment variable is required. Server will not start without configured authentication.');
  process.exit(1);
}

// Use official createMcpExpressApp helper with host validation & JSON parser
const app = createMcpExpressApp({ host: HOST, allowedHosts: ALLOWED_HOSTS });

// Custom Header Authentication Middleware
// Enforces static API key authentication via Authorization header
const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${EXPECTED_API_KEY}`) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Expected Bearer <api_key>.'
    });
    return;
  }
  next();
};

// Health check endpoint (unauthenticated)
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'mcp-echo-spike',
    transport: 'Streamable HTTP'
  });
});

// Factory for MCP Echo Server
function createEchoServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-echo-server',
    version: '1.0.0'
  });

  // Register the echo_message tool
  server.registerTool(
    'echo_message',
    {
      description: 'Echoes back the received message with a server timestamp',
      inputSchema: {
        message: z.string().describe('The message text to echo back')
      }
    },
    async ({ message }) => {
      return {
        content: [
          {
            type: 'text',
            text: `Echo from Streamable HTTP Server: ${message} (timestamp: ${new Date().toISOString()})`
          }
        ]
      };
    }
  );

  return server;
}

// Streamable HTTP endpoint (Stateless mode following official MCP SDK architecture)
app.post('/mcp', authMiddleware, async (req: Request, res: Response) => {
  const server = createEchoServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (err: unknown) {
    console.error('Error handling MCP request:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// Start Express HTTP listener
const httpServer = app.listen(PORT, HOST, () => {
  console.log(`[MCP Spike Server] Listening on http://${HOST}:${PORT}/mcp`);
  console.log(`[MCP Spike Server] Transport: Streamable HTTP (Stateless)`);
  console.log(`[MCP Spike Server] Auth: Bearer token enforcement enabled (secret value redacted)`);
});

process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});
