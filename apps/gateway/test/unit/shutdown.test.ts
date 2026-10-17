import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { LifecycleManager } from '../../src/lifecycle.js';
import { parseConfig } from '../../src/config.js';

describe('Gateway Graceful Shutdown Coordinator Unit Tests', () => {
  test('gracefully closes server when no active connections remain', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;

    const config = parseConfig({ DRAIN_TIMEOUT_MS: '2000' });
    let exitCode: number | null = null;
    const lifecycle = new LifecycleManager(server, config, (code) => {
      exitCode = code;
    });

    assert.equal(lifecycle.getShuttingDownState(), false);

    await lifecycle.stop();

    assert.equal(lifecycle.getShuttingDownState(), true);
    assert.equal(exitCode, 0);

    // Verify server is closed and rejects new connections
    await assert.rejects(
      async () => {
        await fetch(`http://127.0.0.1:${port}/health`);
      },
      /fetch failed|ECONNREFUSED/
    );
  });

  test('destroys lingering sockets if drain deadline is exceeded', async () => {
    const server = http.createServer((_req, res) => {
      // Intentionally do not end the response to simulate stalled client
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;
    const config = parseConfig({ DRAIN_TIMEOUT_MS: '500' });
    let exitCode: number | null = null;
    const lifecycle = new LifecycleManager(server, config, (code) => {
      exitCode = code;
    });

    // Connect a raw socket to simulate lingering TCP connection
    const clientSocket = new net.Socket();
    await new Promise<void>((resolve) => clientSocket.connect(port, '127.0.0.1', () => resolve()));

    const stopPromise = lifecycle.stop();

    // Await socket termination due to drain timeout
    const socketClosed = new Promise<void>((resolve) => {
      clientSocket.on('close', () => resolve());
      clientSocket.on('error', () => resolve());
    });

    await Promise.all([stopPromise, socketClosed]);

    // Exit code 1 verifies distinction between clean drain (0) and forced termination (1)
    assert.equal(exitCode, 1);
  });
});
