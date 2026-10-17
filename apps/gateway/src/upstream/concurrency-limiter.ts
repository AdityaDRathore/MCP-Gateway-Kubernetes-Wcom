/**
 * Bounded Concurrency Limiter for Gate G6.
 * Enforces process-local global and per-upstream concurrency caps,
 * bounded FIFO queueing, strict deadline accounting, and deadlock-free permit acquisition.
 * 
 * Non-Negotiable Invariants:
 * - Hierarchical acquisition: Global -> Upstream. If upstream acquisition fails, global is immediately released.
 * - Global limit: 20 concurrent requests, fail-fast (no unbounded global queue).
 * - Per-upstream limit: 4 concurrent requests, bounded queue of max 10 items.
 * - Queue wait time is measured and deducted from the request's execution deadline.
 * - Spliced cancellation: cancelled or timed-out queued requests are removed immediately.
 * - Slots are released exactly once on every terminal path.
 */

import { logger } from '../logging/logger.js';

export class ConcurrencyLimitExceededError extends Error {
  public readonly code = 'CONCURRENCY_LIMIT_EXCEEDED';
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyLimitExceededError';
  }
}

export class QueueTimeoutError extends Error {
  public readonly code = 'QUEUE_TIMEOUT_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'QueueTimeoutError';
  }
}

export interface ConcurrencyLimiterOptions {
  readonly globalLimit?: number;              // default 20
  readonly perUpstreamLimit?: number;         // default 4
  readonly maxQueueLengthPerUpstream?: number; // default 10
  readonly maxQueueWaitMs?: number;           // default 1,000 ms per ADR-015
}

export interface ConcurrencyPermit {
  readonly slug: string;
  readonly remainingDeadlineMs: number;
  release(): void;
}

interface QueuedItem {
  readonly id: string;
  readonly enqueuedAt: number;
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
  readonly resolve: (permit: ConcurrencyPermit) => void;
  readonly reject: (err: Error) => void;
  readonly cleanup: () => void;
}

export class ConcurrencyLimiter {
  private readonly globalLimit: number;
  private readonly perUpstreamLimit: number;
  private readonly maxQueueLength: number;
  private readonly maxQueueWaitMs: number;

  private activeGlobalCount = 0;
  private readonly activePerUpstream = new Map<string, number>();
  private readonly queues = new Map<string, QueuedItem[]>();
  private isShuttingDown = false;

  constructor(options: ConcurrencyLimiterOptions = {}) {
    this.globalLimit = options.globalLimit ?? 20;
    this.perUpstreamLimit = options.perUpstreamLimit ?? 4;
    this.maxQueueLength = options.maxQueueLengthPerUpstream ?? 10;
    this.maxQueueWaitMs = options.maxQueueWaitMs ?? 1000;
  }

  getActiveGlobalCount(): number {
    return this.activeGlobalCount;
  }

  getActiveUpstreamCount(slug: string): number {
    return this.activePerUpstream.get(slug) ?? 0;
  }

  getQueueLength(slug: string): number {
    return this.queues.get(slug)?.length ?? 0;
  }

  /**
   * Acquires hierarchical permits (Global -> Per-Upstream).
   * Enforces bounded queueing and deadline deduction.
   */
  async acquire(
    slug: string,
    totalBudgetMs: number,
    signal?: AbortSignal
  ): Promise<ConcurrencyPermit> {
    if (this.isShuttingDown) {
      throw new ConcurrencyLimitExceededError('Gateway is currently shutting down. Rejecting new tool requests.');
    }

    if (signal?.aborted) {
      throw new Error('Request was aborted prior to acquiring concurrency permits');
    }

    // Step 1: Acquire Global Permit (fail fast if saturated)
    if (this.activeGlobalCount >= this.globalLimit) {
      logger.warn('Global gateway concurrency cap reached', {
        active: this.activeGlobalCount,
        limit: this.globalLimit,
      });
      throw new ConcurrencyLimitExceededError(
        `Gateway global concurrency limit of ${this.globalLimit} active requests reached. Please retry shortly.`
      );
    }

    this.activeGlobalCount++;

    // Step 2: Acquire Per-Upstream Permit (with bounded queueing)
    try {
      const permit = await this.acquireUpstreamPermit(slug, totalBudgetMs, signal);
      return permit;
    } catch (err) {
      // Rollback global permit immediately if upstream acquisition fails
      this.activeGlobalCount = Math.max(0, this.activeGlobalCount - 1);
      throw err;
    }
  }

  private acquireUpstreamPermit(
    slug: string,
    totalBudgetMs: number,
    signal?: AbortSignal
  ): Promise<ConcurrencyPermit> {
    const currentActive = this.activePerUpstream.get(slug) ?? 0;

    // Fast path: slot is available immediately
    if (currentActive < this.perUpstreamLimit) {
      this.activePerUpstream.set(slug, currentActive + 1);
      return Promise.resolve(this.createPermit(slug, totalBudgetMs));
    }

    // Slow path: queue for slot
    let queue = this.queues.get(slug);
    if (!queue) {
      queue = [];
      this.queues.set(slug, queue);
    }

    if (queue.length >= this.maxQueueLength) {
      logger.warn(`Per-upstream concurrency queue full for '${slug}'`, {
        slug,
        active: currentActive,
        queued: queue.length,
        maxQueue: this.maxQueueLength,
      });
      return Promise.reject(
        new ConcurrencyLimitExceededError(
          `Upstream service '${slug}' concurrency queue is full (${queue.length}/${this.maxQueueLength}). Please retry shortly.`
        )
      );
    }

    const enqueuedAt = Date.now();
    const allowedWaitMs = Math.min(this.maxQueueWaitMs, totalBudgetMs);

    return new Promise<ConcurrencyPermit>((resolve, reject) => {
      const itemId = `queue-${slug}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      let timer: NodeJS.Timeout | null = null;
      let onAbort: (() => void) | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
          onAbort = null;
        }
      };

      const item: QueuedItem = {
        id: itemId,
        enqueuedAt,
        deadlineMs: totalBudgetMs,
        signal,
        resolve: (permit: ConcurrencyPermit) => {
          cleanup();
          resolve(permit);
        },
        reject: (err: Error) => {
          cleanup();
          reject(err);
        },
        cleanup,
      };

      // Set queue timeout timer
      timer = setTimeout(() => {
        this.removeFromQueue(slug, itemId);
        item.reject(
          new QueueTimeoutError(
            `Timed out after ${allowedWaitMs}ms waiting in concurrency queue for upstream '${slug}'`
          )
        );
      }, allowedWaitMs);

      // Bind client cancellation listener
      if (signal) {
        onAbort = () => {
          this.removeFromQueue(slug, itemId);
          item.reject(new Error('Request was aborted while waiting in upstream concurrency queue'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      queue!.push(item);
    });
  }

  private removeFromQueue(slug: string, itemId: string): void {
    const queue = this.queues.get(slug);
    if (!queue) return;
    const index = queue.findIndex((i) => i.id === itemId);
    if (index !== -1) {
      const [removed] = queue.splice(index, 1);
      removed.cleanup();
    }
  }

  private createPermit(slug: string, remainingDeadlineMs: number): ConcurrencyPermit {
    let released = false;

    return {
      slug,
      remainingDeadlineMs,
      release: () => {
        if (released) return;
        released = true;
        this.releaseSlot(slug);
      },
    };
  }

  private releaseSlot(slug: string): void {
    // 1. Release Global Slot held by the finishing operation
    this.activeGlobalCount = Math.max(0, this.activeGlobalCount - 1);

    // 2. Process next queued item for this upstream if present
    const queue = this.queues.get(slug);
    while (queue && queue.length > 0) {
      const nextItem = queue.shift()!;
      nextItem.cleanup();

      if (nextItem.signal?.aborted) {
        nextItem.reject(new Error('Request was aborted while waiting in upstream concurrency queue'));
        continue;
      }

      const queueWaitMs = Date.now() - nextItem.enqueuedAt;
      const remainingDeadline = nextItem.deadlineMs - queueWaitMs;

      if (remainingDeadline <= 0) {
        nextItem.reject(
          new QueueTimeoutError(
            `Request deadline expired during concurrency queue wait (${queueWaitMs}ms) for upstream '${slug}'`
          )
        );
        continue;
      }

      // Slot transferred to dequeued item.
      // Global permit for nextItem was already accounted when nextItem called acquire().
      nextItem.resolve(this.createPermit(slug, remainingDeadline));
      return;
    }

    // No queued item took the slot: decrement active upstream count
    const current = this.activePerUpstream.get(slug) ?? 1;
    if (current <= 1) {
      this.activePerUpstream.delete(slug);
    } else {
      this.activePerUpstream.set(slug, current - 1);
    }
  }

  /**
   * Drains all active and queued operations during gateway shutdown.
   */
  close(): void {
    this.isShuttingDown = true;

    for (const [slug, queue] of this.queues) {
      for (const item of queue) {
        item.cleanup();
        item.reject(new ConcurrencyLimitExceededError(`Gateway is shutting down. Dequeued request for upstream '${slug}'.`));
      }
      queue.length = 0;
    }
    this.queues.clear();
  }
}
