/**
 * Per-Upstream Circuit Breaker State Machine for Gate G6.
 * Enforces failure isolation, atomic permit reservations, epoch tracking,
 * and strict error classification.
 * 
 * Non-Negotiable Invariants:
 * - Atomic probe permit reservation: guarantees strictly bounded concurrent probes in half_open.
 * - Epoch tracking: ignores late responses from prior epochs.
 * - Local cancellation and business tool errors NEVER trip the breaker.
 * - Per-upstream isolation: failures on one upstream do not impact other upstreams.
 */

import {
  UpstreamTimeoutError,
  UpstreamConnectionError,
  UpstreamProtocolError,
} from './types.js';
import { logger } from '../logging/logger.js';

export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  readonly failureThreshold?: number; // default 3 consecutive infrastructure failures
  readonly resetTimeoutMs?: number;   // default 15,000 ms cooldown
  readonly halfOpenMaxProbes?: number; // default 1 probe
}

export interface CircuitBreakerPermit {
  readonly state: CircuitBreakerState;
  readonly epoch: number;
  recordSuccess(): void;
  recordFailure(error: unknown): void;
  recordAbort(): void;
}

export interface AcquirePermitResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly permit?: CircuitBreakerPermit;
}

export interface CircuitBreakerMetrics {
  readonly slug: string;
  readonly state: CircuitBreakerState;
  readonly consecutiveFailures: number;
  readonly epoch: number;
  readonly openedAt: number | null;
  readonly lastFailureTime: number | null;
  readonly lastError: string | null;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private epoch = 1;
  private openedAt: number | null = null;
  private activeHalfOpenProbes = 0;
  private lastFailureTime: number | null = null;
  private lastError: string | null = null;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxProbes: number;

  constructor(
    private readonly slug: string,
    options: CircuitBreakerOptions = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 15000;
    this.halfOpenMaxProbes = options.halfOpenMaxProbes ?? 1;
  }

  getSlug(): string {
    return this.slug;
  }

  getState(): CircuitBreakerState {
    this.checkStateTransition();
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    this.checkStateTransition();
    return {
      slug: this.slug,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      epoch: this.epoch,
      openedAt: this.openedAt,
      lastFailureTime: this.lastFailureTime,
      lastError: this.lastError,
    };
  }

  /**
   * Atomically evaluates breaker state and reserves execution permit.
   * In half_open, guarantees strictly up to halfOpenMaxProbes can execute concurrently.
   */
  tryAcquirePermit(): AcquirePermitResult {
    this.checkStateTransition();

    if (this.state === 'open') {
      const remainingCooldownMs = this.openedAt ? Math.max(0, this.resetTimeoutMs - (Date.now() - this.openedAt)) : this.resetTimeoutMs;
      return {
        allowed: false,
        reason: `Upstream service '${this.slug}' circuit breaker is OPEN due to consecutive infrastructure failures. Cooldown remaining: ${Math.ceil(remainingCooldownMs / 1000)}s`,
      };
    }

    if (this.state === 'half_open') {
      if (this.activeHalfOpenProbes >= this.halfOpenMaxProbes) {
        return {
          allowed: false,
          reason: `Upstream service '${this.slug}' circuit breaker is in HALF_OPEN state with probe in progress`,
        };
      }
      this.activeHalfOpenProbes++;
    }

    const acquiredState = this.state;
    const acquiredEpoch = this.epoch;
    let released = false;

    const permit: CircuitBreakerPermit = {
      state: acquiredState,
      epoch: acquiredEpoch,
      recordSuccess: () => {
        if (released) return;
        released = true;
        this.onPermitSuccess(acquiredState, acquiredEpoch);
      },
      recordFailure: (err: unknown) => {
        if (released) return;
        released = true;
        this.onPermitFailure(acquiredState, acquiredEpoch, err);
      },
      recordAbort: () => {
        if (released) return;
        released = true;
        this.onPermitAbort(acquiredState, acquiredEpoch);
      },
    };

    return {
      allowed: true,
      permit,
    };
  }

  /**
   * Manually resets circuit breaker to CLOSED (for testing and administrative reset).
   */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.activeHalfOpenProbes = 0;
    this.epoch++;
    logger.info(`Circuit breaker for upstream '${this.slug}' manually reset to CLOSED`, {
      slug: this.slug,
      epoch: this.epoch,
    });
  }

  private checkStateTransition(): void {
    if (this.state === 'open' && this.openedAt) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'half_open';
        this.activeHalfOpenProbes = 0;
        this.epoch++;
        logger.info(`Circuit breaker for upstream '${this.slug}' transitioned from OPEN to HALF_OPEN after ${elapsed}ms cooldown`, {
          slug: this.slug,
          epoch: this.epoch,
        });
      }
    }
  }

  private onPermitSuccess(permitState: CircuitBreakerState, permitEpoch: number): void {
    // Discard late response from previous epoch
    if (permitEpoch !== this.epoch) {
      return;
    }

    if (permitState === 'half_open') {
      this.activeHalfOpenProbes = Math.max(0, this.activeHalfOpenProbes - 1);
      this.state = 'closed';
      this.consecutiveFailures = 0;
      this.openedAt = null;
      this.epoch++;
      logger.info(`Circuit breaker for upstream '${this.slug}' probe succeeded; transitioned to CLOSED`, {
        slug: this.slug,
        epoch: this.epoch,
      });
    } else if (permitState === 'closed') {
      this.consecutiveFailures = 0;
    }
  }

  private onPermitFailure(permitState: CircuitBreakerState, permitEpoch: number, err: unknown): void {
    // Only qualifying infrastructure failures count toward tripping the breaker
    if (!this.isInfrastructureFailure(err)) {
      if (permitState === 'half_open') {
        this.activeHalfOpenProbes = Math.max(0, this.activeHalfOpenProbes - 1);
      }
      return;
    }

    // Discard late failure from previous epoch
    if (permitEpoch !== this.epoch) {
      return;
    }

    this.lastFailureTime = Date.now();
    this.lastError = err instanceof Error ? err.message : String(err);

    if (permitState === 'half_open') {
      this.activeHalfOpenProbes = Math.max(0, this.activeHalfOpenProbes - 1);
      this.state = 'open';
      this.openedAt = Date.now();
      this.epoch++;
      logger.warn(`Circuit breaker for upstream '${this.slug}' probe FAILED; transitioned back to OPEN`, {
        slug: this.slug,
        epoch: this.epoch,
        error: this.lastError,
      });
    } else if (permitState === 'closed') {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.state = 'open';
        this.openedAt = Date.now();
        this.epoch++;
        logger.warn(`Circuit breaker for upstream '${this.slug}' TRIPPED after ${this.consecutiveFailures} consecutive failures; transitioned to OPEN`, {
          slug: this.slug,
          epoch: this.epoch,
          error: this.lastError,
          cooldownMs: this.resetTimeoutMs,
        });
      }
    }
  }

  private onPermitAbort(permitState: CircuitBreakerState, permitEpoch: number): void {
    // Client cancellations decrement active half-open probe count but NEVER count toward breaker failure
    if (permitEpoch === this.epoch && permitState === 'half_open') {
      this.activeHalfOpenProbes = Math.max(0, this.activeHalfOpenProbes - 1);
    }
  }

  /**
   * Evaluates whether an error represents an infrastructure / transport failure.
   */
  private isInfrastructureFailure(err: unknown): boolean {
    if (!err) return false;

    // Direct typed infrastructure errors
    if (
      err instanceof UpstreamTimeoutError ||
      err instanceof UpstreamConnectionError ||
      err instanceof UpstreamProtocolError
    ) {
      return true;
    }

    const message = err instanceof Error ? err.message : String(err);
    const code = (err as any).code;

    // Client cancellations or aborts do NOT count as upstream failure
    if (
      message.includes('Client disconnected') ||
      message.includes('aborted') ||
      message.includes('AbortError') ||
      (err as any).name === 'AbortError'
    ) {
      return false;
    }

    // Connection & transport failures
    if (
      code === 'ECONNREFUSED' ||
      code === 'EHOSTUNREACH' ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      message.includes('fetch failed') ||
      message.includes('ECONNREFUSED') ||
      message.includes('EHOSTUNREACH') ||
      message.includes('ENOTFOUND')
    ) {
      return true;
    }

    // Upstream 5xx protocol errors
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
      return true;
    }

    return false;
  }
}
