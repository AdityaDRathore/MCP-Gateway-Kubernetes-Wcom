import { Request, Response } from 'express';

export function healthHandler(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'urumi-mcp-tasks',
    timestamp: new Date().toISOString(),
  });
}
