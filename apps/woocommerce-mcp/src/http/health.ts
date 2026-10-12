import { Request, Response } from 'express';

/**
 * Health probe handler for Kubernetes liveness, readiness, and startup probes.
 * Operational check only; does not expose internal endpoints, tokens, or configuration.
 */
export function healthHandler(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'urumi-woocommerce-mcp',
    transport: 'Streamable HTTP',
    timestamp: new Date().toISOString(),
  });
}
