import crypto from 'node:crypto';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Polyfill global crypto for SDK Streamable HTTP transport streamId generation
if (typeof (globalThis as any).crypto === 'undefined') {
  (globalThis as any).crypto = crypto;
}
if (typeof (global as any).crypto === 'undefined') {
  (global as any).crypto = crypto;
}

/**
 * ADR-011 Mandated Contract Regression Test: TEST-GTW-SDK-ABORT-PUBLIC-API
 * 
 * Objective:
 * Validates the pinned @modelcontextprotocol/sdk@1.32.1 public API contract for
 * request-level cancellation using `client.request(..., { signal })`.
 * 
 * Invariants Proven:
 * 1. Multiplexed shared client allows cancelling Call A via `signal.abort()` without closing transport.
 * 2. Cancelled Call A rejects with abort indication.
 * 3. SDK automatically formats and transmits `notifications/cancelled` targeting Call A's EXACT request ID.
 * 4. Sibling Call B's request ID is NOT cancelled and Call B completes successfully.
 * 5. Subsequent Call C on the shared client succeeds without session contamination.
 * 6. Dynamic ephemeral port binding (listen(0)) prevents CI/CD port collision.
 * 
 * Note (Per Technical Head Guidance):
 * This is an isolated SDK contract test using a controlled in-test mock server.
 * It establishes the prerequisite SDK cancellation contract before gateway upstream routing is built in G6.
 */
describe('TEST-GTW-SDK-ABORT-PUBLIC-API: SDK Cancellation Contract Regression Suite', () => {
  test('Public SDK cancellation on shared client sends notifications/cancelled with exact request ID correlation without disrupting sibling calls', async () => {
    let callARequestId: number | string | null = null;
    let callBRequestId: number | string | null = null;
    const cancelledNotifications: Array<{ requestId: number | string; reason?: string }> = [];

    // Create standalone mock upstream server
    const app = express();
    app.use(express.json());

    // Middleware to capture request IDs and record notifications/cancelled messages from SDK client
    app.use('/mcp', (req: Request, _res: Response, next) => {
      if (req.body?.method === 'tools/call') {
        if (req.body?.params?.name === 'slow_operation') {
          callARequestId = req.body.id;
        } else if (
          req.body?.params?.name === 'fast_operation' &&
          req.body?.params?.arguments?.id === 'sibling-call-b'
        ) {
          callBRequestId = req.body.id;
        }
      }
      if (req.body?.method === 'notifications/cancelled') {
        cancelledNotifications.push(req.body.params);
      }
      next();
    });

    app.post('/mcp', async (req: Request, res: Response) => {
      const server = new McpServer({
        name: 'mock-cancellation-upstream',
        version: '1.0.0',
      });

      // Register slow tool
      server.tool(
        'slow_operation',
        'Simulates long-running upstream operation',
        { delayMs: z.number().default(1000) },
        async ({ delayMs }) => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return {
            content: [{ type: 'text', text: 'slow_operation_completed' }],
          };
        }
      );

      // Register fast tool
      server.tool(
        'fast_operation',
        'Simulates rapid upstream operation',
        { id: z.string().default('fast-1') },
        async ({ id }) => {
          return {
            content: [{ type: 'text', text: `fast_operation_completed:${id}` }],
          };
        }
      );

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    });

    // Ephemeral port allocation (listen(0)) to prevent process/CI port collisions
    const httpServer = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const boundPort = (httpServer.address() as any).port;

    try {
      // Create single shared client multiplexing over StreamableHTTPClientTransport
      const sharedClient = new Client(
        { name: 'test-gateway-shared-client', version: '1.0.0' },
        { capabilities: {} }
      );

      const clientTransport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${boundPort}/mcp`)
      );

      await sharedClient.connect(clientTransport);

      // Step 1: Launch Call A (slow operation) with an AbortController signal
      const abortController = new AbortController();
      const callAPromise = sharedClient.request(
        {
          method: 'tools/call',
          params: {
            name: 'slow_operation',
            arguments: { delayMs: 2000 },
          },
        },
        CallToolResultSchema,
        { signal: abortController.signal }
      );

      // Step 2: Launch concurrent Call B (fast operation) on the same shared client without abort signal
      const callBPromise = sharedClient.request(
        {
          method: 'tools/call',
          params: {
            name: 'fast_operation',
            arguments: { id: 'sibling-call-b' },
          },
        },
        CallToolResultSchema
      );

      // Step 3: Trigger cancellation on Call A after a short delay (100ms)
      await new Promise((resolve) => setTimeout(resolve, 100));
      abortController.abort('Aborted by caller');

      // Step 4: Verify Call A rejected with abort indication
      let callAFailed = false;
      try {
        await callAPromise;
      } catch (err: unknown) {
        callAFailed = true;
        const msg = err instanceof Error ? err.message : String(err);
        assert.ok(
          msg.includes('Aborted') || msg.includes('aborted') || (err as any).name === 'AbortError',
          `Expected abort error message, got: ${msg}`
        );
      }
      assert.equal(callAFailed, true, 'Call A must reject when abort signal fires');

      // Step 5: Verify Call B completed successfully despite Call A cancellation
      const resultB = await callBPromise;
      assert.ok(resultB.content && resultB.content.length > 0);
      assert.equal(resultB.content[0].type, 'text');
      assert.equal((resultB.content[0] as any).text, 'fast_operation_completed:sibling-call-b');

      // Step 6: Verify exact Request ID correlation in notifications/cancelled
      // Allow async cancellation notification HTTP POST to flush
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.ok(callARequestId !== null, 'Server must have captured Call A request ID');
      assert.ok(callBRequestId !== null, 'Server must have captured Call B request ID');
      assert.notEqual(callARequestId, callBRequestId, 'Call A and Call B must have distinct request IDs');

      // Prove that the cancellation notification specifically matches Call A's request ID
      const matchingCancelled = cancelledNotifications.find(
        (n) => n.requestId === callARequestId
      );
      assert.ok(
        matchingCancelled,
        `Upstream must receive notifications/cancelled specifically for Call A request ID ${callARequestId}`
      );
      assert.ok(
        String(matchingCancelled.reason).includes('Aborted'),
        'Cancelled notification must report the abort reason'
      );

      // Prove that Call B's request ID was NEVER cancelled
      const bWasCancelled = cancelledNotifications.some((n) => n.requestId === callBRequestId);
      assert.equal(bWasCancelled, false, 'Call B request ID must NEVER be cancelled');

      // Step 7: Verify subsequent Call C on the shared client succeeds
      const resultC = await sharedClient.request(
        {
          method: 'tools/call',
          params: {
            name: 'fast_operation',
            arguments: { id: 'subsequent-call-c' },
          },
        },
        CallToolResultSchema
      );
      assert.ok(resultC.content && resultC.content.length > 0);
      assert.equal((resultC.content[0] as any).text, 'fast_operation_completed:subsequent-call-c');

      // Clean client teardown
      await sharedClient.close();
    } finally {
      httpServer.close();
    }
  });
});
