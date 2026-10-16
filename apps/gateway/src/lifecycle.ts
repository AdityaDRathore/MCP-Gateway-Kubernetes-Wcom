import http from 'node:http';
import { Socket } from 'node:net';
import { AppConfig } from './config.js';
import { logger } from './logging/logger.js';

export class LifecycleManager {
  private server: http.Server;
  private config: AppConfig;
  private sockets = new Set<Socket>();
  private isShuttingDown = false;
  private exitHandler: (code: number) => void;

  constructor(
    server: http.Server,
    config: AppConfig,
    exitHandler: (code: number) => void = (code) => process.exit(code)
  ) {
    this.server = server;
    this.config = config;
    this.exitHandler = exitHandler;

    this.trackConnections();
  }

  private trackConnections(): void {
    this.server.on('connection', (socket: Socket) => {
      this.sockets.add(socket);
      socket.on('close', () => {
        this.sockets.delete(socket);
      });
    });
  }

  /**
   * Attaches process signal handlers for SIGTERM and SIGINT.
   */
  registerSignalHandlers(): void {
    const onSignal = (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown...`, {
        activeConnections: this.sockets.size,
        drainTimeoutMs: this.config.DRAIN_TIMEOUT_MS,
      });
      this.stop();
    };

    process.once('SIGTERM', () => onSignal('SIGTERM'));
    process.once('SIGINT', () => onSignal('SIGINT'));
  }

  /**
   * Gracefully shuts down the HTTP server within the configured drain deadline.
   */
  stop(): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.resolve();
    }
    this.isShuttingDown = true;

    return new Promise((resolve) => {
      let finished = false;
      const finish = (code: number) => {
        if (finished) return;
        finished = true;
        clearTimeout(forceTimer);
        resolve();
        this.exitHandler(code);
      };

      // Force shutdown timer if in-flight requests do not drain within deadline
      const forceTimer = setTimeout(() => {
        logger.warn('Drain deadline exceeded, forcefully terminating lingering connections', {
          lingeringConnections: this.sockets.size,
        });

        if (typeof (this.server as any).closeAllConnections === 'function') {
          (this.server as any).closeAllConnections();
        }

        for (const socket of this.sockets) {
          try {
            socket.destroy();
          } catch {
            // Ignore
          }
        }
        this.sockets.clear();
        finish(0);
      }, this.config.DRAIN_TIMEOUT_MS);

      // Unref timer so it doesn't hold event loop open if closed naturally
      if (typeof forceTimer.unref === 'function') {
        forceTimer.unref();
      }

      this.server.close((err?: Error) => {
        if (err) {
          logger.error('Error during server.close()', { error: err.message });
        } else {
          logger.info('HTTP server closed cleanly, all in-flight connections drained');
        }
        finish(0);
      });
    });
  }

  getShuttingDownState(): boolean {
    return this.isShuttingDown;
  }
}
