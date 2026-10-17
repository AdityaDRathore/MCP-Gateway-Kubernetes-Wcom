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
  private cleanupHooks: (() => Promise<void> | void)[] = [];

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

  registerCleanupHook(fn: () => Promise<void> | void): void {
    this.cleanupHooks.push(fn);
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
      const finish = async (code: number) => {
        if (finished) return;
        finished = true;
        clearTimeout(forceTimer);

        for (const hook of this.cleanupHooks) {
          try {
            await hook();
          } catch (err: unknown) {
            logger.warn('Error executing lifecycle cleanup hook', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

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
        // Exit code 1 indicates forced termination due to exceeded drain deadline
        finish(1);
      }, this.config.DRAIN_TIMEOUT_MS);

      // Unref timer so it doesn't hold event loop open if closed naturally
      if (typeof forceTimer.unref === 'function') {
        forceTimer.unref();
      }

      this.server.close((err?: Error) => {
        if (err) {
          logger.error('Error during server.close()', { error: err.message });
          finish(1);
        } else {
          logger.info('HTTP server closed cleanly, all in-flight connections drained');
          finish(0);
        }
      });
    });
  }

  getShuttingDownState(): boolean {
    return this.isShuttingDown;
  }
}
