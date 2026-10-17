import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConcurrencyLimiter,
  ConcurrencyLimitExceededError,
  QueueTimeoutError,
} from '../../src/upstream/concurrency-limiter.js';

describe('Gateway Concurrency Limiter Unit Tests', () => {
  it('enforces global limit with fail-fast rejection', async () => {
    const limiter = new ConcurrencyLimiter({ globalLimit: 2, perUpstreamLimit: 2 });

    const p1 = await limiter.acquire('crm', 5000);
    const p2 = await limiter.acquire('tasks', 5000);

    assert.equal(limiter.getActiveGlobalCount(), 2);

    // 3rd call exceeds global limit of 2 -> must reject immediately
    await assert.rejects(
      () => limiter.acquire('woocommerce', 5000),
      (err: unknown) => {
        assert(err instanceof ConcurrencyLimitExceededError);
        assert.match((err as Error).message, /global concurrency limit of 2/);
        return true;
      }
    );

    // Release slot 1
    p1.release();
    assert.equal(limiter.getActiveGlobalCount(), 1);

    // Now call 3 can acquire
    const p3 = await limiter.acquire('woocommerce', 5000);
    assert.equal(limiter.getActiveGlobalCount(), 2);

    p2.release();
    p3.release();
    assert.equal(limiter.getActiveGlobalCount(), 0);
  });

  it('queues calls when per-upstream limit is reached and resolves on slot release', async () => {
    const limiter = new ConcurrencyLimiter({
      globalLimit: 10,
      perUpstreamLimit: 1,
      maxQueueLengthPerUpstream: 5,
      maxQueueWaitMs: 2000,
    });

    const p1 = await limiter.acquire('crm', 5000);
    assert.equal(limiter.getActiveUpstreamCount('crm'), 1);

    // Call 2 queues for 'crm'
    let call2Resolved = false;
    const p2Promise = limiter.acquire('crm', 5000).then((p) => {
      call2Resolved = true;
      return p;
    });

    assert.equal(call2Resolved, false);
    assert.equal(limiter.getQueueLength('crm'), 1);

    // Release p1 -> awakens p2
    p1.release();
    const p2 = await p2Promise;
    assert.equal(call2Resolved, true);
    assert.equal(limiter.getQueueLength('crm'), 0);
    assert.equal(limiter.getActiveUpstreamCount('crm'), 1);

    p2.release();
    assert.equal(limiter.getActiveUpstreamCount('crm'), 0);
  });

  it('deducts queue wait time from remaining execution deadline', async () => {
    const limiter = new ConcurrencyLimiter({
      globalLimit: 5,
      perUpstreamLimit: 1,
      maxQueueLengthPerUpstream: 5,
      maxQueueWaitMs: 2000,
    });

    const p1 = await limiter.acquire('tasks', 5000);

    // Enqueue p2 with 5000ms deadline
    const p2Promise = limiter.acquire('tasks', 5000);

    // Hold p1 for 50ms before release
    await new Promise((resolve) => setTimeout(resolve, 50));
    p1.release();

    const p2 = await p2Promise;

    // Remaining deadline on permit must be less than original 5000ms by at least ~50ms
    assert.ok(
      p2.remainingDeadlineMs <= 4960,
      `Expected remaining deadline <= 4960ms, got ${p2.remainingDeadlineMs}ms`
    );

    p2.release();
  });

  it('rejects immediately when per-upstream queue capacity is exhausted', async () => {
    const limiter = new ConcurrencyLimiter({
      globalLimit: 10,
      perUpstreamLimit: 1,
      maxQueueLengthPerUpstream: 2,
    });

    const p1 = await limiter.acquire('crm', 5000);

    // Fill queue slots (2 items)
    const q1 = limiter.acquire('crm', 5000);
    const q2 = limiter.acquire('crm', 5000);
    assert.equal(limiter.getQueueLength('crm'), 2);

    // 4th call exceeds queue capacity of 2 -> must reject fast
    await assert.rejects(
      () => limiter.acquire('crm', 5000),
      (err: unknown) => {
        assert(err instanceof ConcurrencyLimitExceededError);
        assert.match((err as Error).message, /concurrency queue is full/);
        return true;
      }
    );

    // Cleanup
    p1.release();
    const resolvedQ1 = await q1;
    resolvedQ1.release();
    const resolvedQ2 = await q2;
    resolvedQ2.release();
  });

  it('rejects with QueueTimeoutError if wait exceeds deadline or maxQueueWaitMs', async () => {
    const limiter = new ConcurrencyLimiter({
      globalLimit: 5,
      perUpstreamLimit: 1,
      maxQueueLengthPerUpstream: 5,
      maxQueueWaitMs: 50, // 50ms max queue wait
    });

    const p1 = await limiter.acquire('crm', 5000);

    await assert.rejects(
      () => limiter.acquire('crm', 5000),
      (err: unknown) => {
        assert(err instanceof QueueTimeoutError);
        assert.match((err as Error).message, /Timed out after 50ms waiting in concurrency queue/);
        return true;
      }
    );

    // Global permit must have been rolled back and not leaked
    assert.equal(limiter.getActiveGlobalCount(), 1);

    p1.release();
    assert.equal(limiter.getActiveGlobalCount(), 0);
  });

  it('immediately dequeues and rolls back global permit on client abort', async () => {
    const limiter = new ConcurrencyLimiter({
      globalLimit: 5,
      perUpstreamLimit: 1,
      maxQueueLengthPerUpstream: 5,
    });

    const p1 = await limiter.acquire('crm', 5000);

    const abortController = new AbortController();
    const queuedPromise = limiter.acquire('crm', 5000, abortController.signal);

    assert.equal(limiter.getQueueLength('crm'), 1);

    // Trigger client abort
    abortController.abort('Client disconnected');

    await assert.rejects(
      () => queuedPromise,
      /aborted while waiting in upstream concurrency queue/
    );

    // Queue must be empty and global permit rolled back
    assert.equal(limiter.getQueueLength('crm'), 0);
    assert.equal(limiter.getActiveGlobalCount(), 1); // only p1 active

    p1.release();
    assert.equal(limiter.getActiveGlobalCount(), 0);
  });

  it('guarantees release() is idempotent and does not double decrement permits', async () => {
    const limiter = new ConcurrencyLimiter({ globalLimit: 5, perUpstreamLimit: 2 });

    const permit = await limiter.acquire('crm', 5000);
    assert.equal(limiter.getActiveGlobalCount(), 1);
    assert.equal(limiter.getActiveUpstreamCount('crm'), 1);

    permit.release();
    assert.equal(limiter.getActiveGlobalCount(), 0);
    assert.equal(limiter.getActiveUpstreamCount('crm'), 0);

    // Second release must be a safe no-op
    permit.release();
    assert.equal(limiter.getActiveGlobalCount(), 0);
    assert.equal(limiter.getActiveUpstreamCount('crm'), 0);
  });

  it('drains and rejects all queued calls on close() during shutdown', async () => {
    const limiter = new ConcurrencyLimiter({
      globalLimit: 5,
      perUpstreamLimit: 1,
      maxQueueLengthPerUpstream: 5,
    });

    const p1 = await limiter.acquire('crm', 5000);

    const q1 = limiter.acquire('crm', 5000);
    const q2 = limiter.acquire('crm', 5000);

    limiter.close();

    await assert.rejects(() => q1, /Gateway is shutting down/);
    await assert.rejects(() => q2, /Gateway is shutting down/);

    // New acquisitions rejected
    await assert.rejects(() => limiter.acquire('crm', 5000), /Gateway is currently shutting down/);

    p1.release();
  });
});
