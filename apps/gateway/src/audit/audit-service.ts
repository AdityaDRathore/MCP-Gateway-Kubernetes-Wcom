import crypto from 'node:crypto';
import { AuditRepository, AuditStatus, AuditRecord } from '../db/audit-repo.js';
import { logger } from '../logging/logger.js';

export class AuditStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditStartError';
  }
}

export interface StartAuditParams {
  userId?: string | null;
  upstreamSlug?: string | null;
  toolName: string;
  arguments?: unknown;
}

export interface FinalizeAuditOptions {
  status: AuditStatus;
  startTimeMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface FinalizeAuditResult {
  auditId: string;
  status: AuditStatus;
  degraded: boolean;
}

/**
 * Computes a SHA-256 fingerprint of the tool call arguments.
 * Ensures customer PII and sensitive parameters are never persisted in plaintext.
 */
export function computeArgumentsHash(args: unknown): string {
  try {
    const serialized = JSON.stringify(args ?? {});
    return crypto.createHash('sha256').update(serialized).digest('hex');
  } catch {
    return crypto.createHash('sha256').update('{}').digest('hex');
  }
}

/**
 * Two-Phase Audit Service enforcing ADR-014 lifecycle and failure safety invariants.
 * 
 * Non-Negotiable Invariants:
 * 1. Phase 1 (Start Write): Fails closed. If writing 'pending' record fails, upstream tool is NEVER called.
 * 2. Phase 2 (Finalize Write): Truthful reporting invariant. If upstream mutation succeeds but Phase 2 write
 *    fails (e.g. disk full), local degradation is flagged via X-Urumi-Audit-Status / logs without returning a false failure.
 * 3. Zero customer PII or raw secrets in SQLite or logs.
 * 4. Background reconciliation marks abandoned 'pending' records as 'unconfirmed_outcome'.
 */
export class AuditService {
  constructor(private repo: AuditRepository) {}

  /**
   * Phase 1: Commits initial 'pending' audit record before upstream dispatch.
   * Throws AuditStartError on write failure (Fail Closed).
   */
  startAudit(params: StartAuditParams): string {
    const auditId = crypto.randomUUID();
    const argumentsHash = computeArgumentsHash(params.arguments);

    try {
      this.repo.insertAuditStart({
        id: auditId,
        user_id: params.userId ?? null,
        upstream_slug: params.upstreamSlug ?? null,
        tool_name: params.toolName,
        arguments_hash: argumentsHash,
      });

      return auditId;
    } catch (err: unknown) {
      logger.error('Phase 1 audit start write failed. Halting upstream dispatch to preserve fail-closed invariant.', {
        auditId,
        toolName: params.toolName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new AuditStartError(
        `Failed to persist audit start record: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Phase 2: Finalizes audit outcome with duration, status, and error classification.
   * If finalization write fails, flags degraded status without raising an error that would mask successful mutations.
   */
  finalizeAudit(auditId: string, options: FinalizeAuditOptions): FinalizeAuditResult {
    const durationMs = Math.max(0, Date.now() - options.startTimeMs);

    try {
      const updated = this.repo.updateAuditFinalize(auditId, {
        status: options.status,
        duration_ms: durationMs,
        error_code: options.errorCode ?? null,
        error_message: options.errorMessage ?? null,
      });

      if (!updated) {
        logger.warn('Audit record not found for finalization update', { auditId });
      }

      return {
        auditId,
        status: options.status,
        degraded: false,
      };
    } catch (err: unknown) {
      // Phase 2 Finalization Failure (e.g. SQLITE_FULL, disk error)
      // CRITICAL: Do NOT throw if upstream succeeded, to prevent caller false retry.
      logger.warn('AUDIT_FINALIZATION_DEGRADED: Failed to write final audit record to storage', {
        auditId,
        intendedStatus: options.status,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        auditId,
        status: options.status,
        degraded: true,
      };
    }
  }

  /**
   * Reconciles dangling 'pending' records older than threshold into 'unconfirmed_outcome'.
   */
  reconcileDanglingRecords(olderThanSeconds = 30): number {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
    const count = this.repo.reconcileDanglingRecords(cutoff);
    if (count > 0) {
      logger.info(`Reconciled ${count} dangling audit records to 'unconfirmed_outcome'`, {
        reconciledCount: count,
        cutoffSeconds: olderThanSeconds,
      });
    }
    return count;
  }

  /**
   * Bounded batch pruning of audit records older than retention threshold.
   */
  pruneAuditLogs(retentionDays = 30, batchLimit = 500): number {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
    const count = this.repo.pruneOldRecords(cutoff, batchLimit);
    if (count > 0) {
      logger.info(`Pruned ${count} old audit records exceeding retention limit`, {
        prunedCount: count,
        retentionDays,
      });
    }
    return count;
  }

  /**
   * Retrieves an audit record by ID.
   */
  getAuditById(id: string): AuditRecord | null {
    return this.repo.findAuditById(id);
  }
}
