import http from 'node:http';
import { Socket } from 'node:net';
import { AppConfig } from './config.js';
import { logger } from './logging/logger.js';

export class LifecycleManager {
  private servers: http.Server[];
  private config: AppConfig;
  private sockets = new Set<Socket>();
  private isShuttingDown = false;
  private exitHandler: (code: number) => void;
  private cleanupHooks: (() => Promise<void> | void)[] = [];

  constructor(
    server: http.Server | http.Server[],
    config: AppConfig,
    exitHandler: (code: number) => void = (code) => process.exit(code)
  ) {
    this.servers = Array.isArray(server) ? server : [server];
    this.config = config;
    this.exitHandler = exitHandler;

    this.trackConnections();
  }

  registerCleanupHook(fn: () => Promise<void> | void): void {
    this.cleanupHooks.push(fn);
  }

  private trackConnections(): void {
    for (const s of this.servers) {
      s.on('connection', (socket: Socket) => {
        this.sockets.add(socket);
        socket.on('close', () => {
          this.sockets.delete(socket);
        });
      });
    }
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
   * Gracefully shuts down all HTTP servers within the configured drain deadline.
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

        let cleanupFailed = false;
        for (const hook of this.cleanupHooks) {
          try {
            await hook();
          } catch (err: unknown) {
            cleanupFailed = true;
            logger.error('Error executing lifecycle cleanup hook', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        resolve();
        this.exitHandler(cleanupFailed ? 1 : code);
      };

      // Force shutdown timer if in-flight requests do not drain within deadline
      const forceTimer = setTimeout(() => {
        logger.warn('Drain deadline exceeded, forcefully terminating lingering connections', {
          lingeringConnections: this.sockets.size,
        });

        for (const s of this.servers) {
          if (typeof (s as any).closeAllConnections === 'function') {
            (s as any).closeAllConnections();
          }
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

      if (this.servers.length === 0) {
        finish(0);
        return;
      }

      let closedCount = 0;
      let hasError = false;

      for (const server of this.servers) {
        server.close((err?: Error) => {
          closedCount++;
          if (err) {
            logger.error('Error during server.close()', { error: err.message });
            hasError = true;
          }
          if (closedCount === this.servers.length) {
            if (hasError) {
              finish(1);
            } else {
              logger.info('All HTTP servers closed cleanly, all in-flight connections drained');
              finish(0);
            }
          }
        });
      }
    });
  }

  getShuttingDownState(): boolean {
    return this.isShuttingDown;
  }
}
