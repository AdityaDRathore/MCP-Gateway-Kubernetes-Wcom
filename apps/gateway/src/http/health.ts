import { Request, Response } from 'express';

/**
 * Liveness probe handler (Kubernetes livenessProbe).
 * Verifies that the Node.js process and event loop are responsive.
 */
export function liveHandler(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'urumi-gateway',
  });
}

/**
 * Creates a readiness probe handler (Kubernetes readinessProbe).
 * Verifies local gateway readiness (configuration integrity and handler initialization).
 * 
 * ADR-016 Invariant:
 * The readiness probe MUST NOT fail merely because one or more external upstreams are down.
 * It strictly evaluates local gateway operational readiness.
 */
export function createReadyHandler(readinessCheck: () => boolean = () => true) {
  return (_req: Request, res: Response): void => {
    const isReady = readinessCheck();
    if (isReady) {
      res.status(200).json({
        status: 'ok',
        service: 'urumi-gateway',
        ready: true,
      });
    } else {
      res.status(503).json({
        status: 'degraded',
        service: 'urumi-gateway',
        ready: false,
      });
    }
  };
}

/**
 * General health check handler.
 */
export function healthHandler(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'urumi-gateway',
  });
}
