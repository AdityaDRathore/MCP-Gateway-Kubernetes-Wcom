import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../../src/upstream/circuit-breaker.js';
import {
  UpstreamTimeoutError,
  UpstreamConnectionError,
  UpstreamProtocolError,
} from '../../src/upstream/types.js';

describe('Gateway Circuit Breaker State Machine Unit Tests', () => {
  it('starts in CLOSED state and grants execution permits', () => {
    const breaker = new CircuitBreaker('crm', { failureThreshold: 3 });
    assert.equal(breaker.getState(), 'closed');

    const result = breaker.tryAcquirePermit();
    assert.equal(result.allowed, true);
    assert.ok(result.permit);
    assert.equal(result.permit.state, 'closed');

    result.permit.recordSuccess();
    assert.equal(breaker.getState(), 'closed');
  });

  it('trips to OPEN after reaching consecutive infrastructure failure threshold', () => {
    const breaker = new CircuitBreaker('crm', { failureThreshold: 3, resetTimeoutMs: 1000 });

    // Failure 1
    const p1 = breaker.tryAcquirePermit().permit!;
    p1.recordFailure(new UpstreamConnectionError('fetch failed'));
    assert.equal(breaker.getState(), 'closed');

    // Failure 2
    const p2 = breaker.tryAcquirePermit().permit!;
    p2.recordFailure(new UpstreamTimeoutError('timeout after 10000ms'));
    assert.equal(breaker.getState(), 'closed');

    // Failure 3 -> Trips to OPEN
    const p3 = breaker.tryAcquirePermit().permit!;
    p3.recordFailure(new UpstreamProtocolError('502 Bad Gateway'));
    assert.equal(breaker.getState(), 'open');

    // Subsequent calls fail fast while OPEN
    const blocked = breaker.tryAcquirePermit();
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason!, /circuit breaker is OPEN/);
  });

  it('transitions from OPEN to HALF_OPEN after cooldown and enforces single probe permit', async () => {
    // 50ms cooldown for deterministic fast unit test
    const breaker = new CircuitBreaker('tasks', { failureThreshold: 2, resetTimeoutMs: 50, halfOpenMaxProbes: 1 });

    // Trip to OPEN
    breaker.tryAcquirePermit().permit!.recordFailure(new UpstreamConnectionError('conn reset'));
    breaker.tryAcquirePermit().permit!.recordFailure(new UpstreamTimeoutError('timeout'));
    assert.equal(breaker.getState(), 'open');

    // Wait 60ms for cooldown expiration
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Must transition to HALF_OPEN
    assert.equal(breaker.getState(), 'half_open');

    // Probe 1 is granted
    const probe1 = breaker.tryAcquirePermit();
    assert.equal(probe1.allowed, true);
    assert.equal(probe1.permit?.state, 'half_open');

    // Concurrent probe 2 MUST be rejected (atomic reservation guarantee)
    const probe2 = breaker.tryAcquirePermit();
    assert.equal(probe2.allowed, false);
    assert.match(probe2.reason!, /HALF_OPEN state with probe in progress/);

    // Probe 1 succeeds -> closes breaker
    probe1.permit!.recordSuccess();
    assert.equal(breaker.getState(), 'closed');

    // Verify calls are permitted again in CLOSED state
    const afterClose = breaker.tryAcquirePermit();
    assert.equal(afterClose.allowed, true);
    assert.equal(afterClose.permit?.state, 'closed');
  });

  it('re-opens circuit if HALF_OPEN probe fails', async () => {
    const breaker = new CircuitBreaker('woocommerce', { failureThreshold: 1, resetTimeoutMs: 50 });

    // Trip to OPEN
    breaker.tryAcquirePermit().permit!.recordFailure(new UpstreamConnectionError('down'));
    assert.equal(breaker.getState(), 'open');

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(breaker.getState(), 'half_open');

    // Probe fails
    const probe = breaker.tryAcquirePermit().permit!;
    probe.recordFailure(new UpstreamConnectionError('still down'));

    // Must re-open immediately
    assert.equal(breaker.getState(), 'open');
    assert.equal(breaker.tryAcquirePermit().allowed, false);
  });

  it('discards late responses from previous epochs without corrupting breaker state', async () => {
    const breaker = new CircuitBreaker('crm', { failureThreshold: 2, resetTimeoutMs: 50 });

    // Call A acquires permit in Epoch 1
    const callAPermit = breaker.tryAcquirePermit().permit!;
    assert.equal(callAPermit.epoch, 1);

    // Trip breaker with two subsequent calls -> advances epoch to 2 (OPEN)
    breaker.tryAcquirePermit().permit!.recordFailure(new UpstreamConnectionError('err1'));
    breaker.tryAcquirePermit().permit!.recordFailure(new UpstreamConnectionError('err2'));
    assert.equal(breaker.getState(), 'open');

    // Wait for half_open -> advances epoch to 3
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(breaker.getState(), 'half_open');

    // Call A now returns late success from Epoch 1!
    // Must be safely ignored and NOT close the breaker prematurely
    callAPermit.recordSuccess();
    assert.equal(breaker.getState(), 'half_open');
  });

  it('does NOT count client cancellations or domain errors toward tripping the breaker', () => {
    const breaker = new CircuitBreaker('crm', { failureThreshold: 2 });

    // 1. Client Abort
    const p1 = breaker.tryAcquirePermit().permit!;
    p1.recordAbort();
    assert.equal(breaker.getState(), 'closed');

    // 2. AbortError passed as failure
    const p2 = breaker.tryAcquirePermit().permit!;
    const abortErr = new Error('Client disconnected prematurely before response finished');
    (abortErr as any).name = 'AbortError';
    p2.recordFailure(abortErr);
    assert.equal(breaker.getState(), 'closed');

    // 3. Business tool error string
    const p3 = breaker.tryAcquirePermit().permit!;
    p3.recordFailure(new Error('Product not found: 999'));
    assert.equal(breaker.getState(), 'closed');
  });

  it('isolates failures per-upstream: failing CRM does not affect Tasks or WooCommerce', () => {
    const crmBreaker = new CircuitBreaker('crm', { failureThreshold: 1 });
    const tasksBreaker = new CircuitBreaker('tasks', { failureThreshold: 1 });

    // Trip CRM
    crmBreaker.tryAcquirePermit().permit!.recordFailure(new UpstreamConnectionError('CRM down'));
    assert.equal(crmBreaker.getState(), 'open');
    assert.equal(crmBreaker.tryAcquirePermit().allowed, false);

    // Tasks must remain unaffected and healthy
    assert.equal(tasksBreaker.getState(), 'closed');
    const tasksPermit = tasksBreaker.tryAcquirePermit();
    assert.equal(tasksPermit.allowed, true);
    tasksPermit.permit!.recordSuccess();
  });
});
