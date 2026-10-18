import crypto from 'node:crypto';
import { UpstreamRepository, UpstreamRow } from '../db/upstream-repo.js';
import { SecretManager } from '../k8s/secret-manager.js';
import { UpstreamManager } from '../upstream/upstream-manager.js';
import { AuditService } from '../audit/audit-service.js';
import { validateAndNormalizeUpstreamUrl } from '../upstream/url-validator.js';
import {
  CreateUpstreamInput,
  UpdateUpstreamInput,
  UpstreamResponseDTO,
} from './admin-types.js';
import { AuthenticatedUser } from '../auth/authenticator.js';
import { logger } from '../logging/logger.js';

export class AdminError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = 'ADMIN_ERROR') {
    super(message);
    this.name = 'AdminError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class AdminValidationError extends AdminError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'AdminValidationError';
  }
}

export class AdminNotFoundError extends AdminError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND');
    this.name = 'AdminNotFoundError';
  }
}

export class AdminConflictError extends AdminError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
    this.name = 'AdminConflictError';
  }
}

export class AdminDependencyError extends AdminError {
  constructor(message: string) {
    super(message, 502, 'DEPENDENCY_ERROR');
    this.name = 'AdminDependencyError';
  }
}

export class CleanupRequiredError extends AdminError {
  constructor(message: string) {
    super(message, 502, 'CLEANUP_REQUIRED');
    this.name = 'CleanupRequiredError';
  }
}

export interface AdminServiceOptions {
  allowLocalhostForTesting?: boolean;
}

export class AdminService {
  private readonly activeLocks = new Set<string>();

  constructor(
    private readonly upstreamRepo: UpstreamRepository,
    private readonly secretManager: SecretManager,
    private readonly upstreamManager: UpstreamManager,
    private readonly auditService: AuditService,
    private readonly options: AdminServiceOptions = {}
  ) {}

  getActiveLocks(): Set<string> {
    return this.activeLocks;
  }

  /**
   * Transforms an UpstreamRow and current runtime health status into an UpstreamResponseDTO.
   * Invariant: Never exposes raw credentials or secret values.
   */
  private toDTO(row: UpstreamRow, auditDegraded?: boolean): UpstreamResponseDTO {
    const health = this.upstreamManager.getUpstreamStatus(row.slug);
    const client = this.upstreamManager.getClient(row.slug);

    return {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      endpointUrl: row.endpoint_url,
      timeoutMs: row.timeout_ms,
      isEnabled: Boolean(row.is_enabled === 1 && row.status === 'active'),
      status: row.status,
      secretRefName: row.secret_ref_name,
      cleanupError: row.cleanup_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      health: {
        healthState: health?.healthState ?? (client ? client.getHealthState() : 'disabled'),
        toolCount: health?.toolCount ?? 0,
        lastCheckedAt: health?.lastCheckedAt ?? 0,
        lastError: health?.lastError ?? client?.getLastError() ?? undefined,
      },
      auditDegraded: auditDegraded ? true : undefined,
    };
  }

  /**
   * Lists all configured upstreams merged with current runtime health states.
   */
  async listUpstreams(): Promise<UpstreamResponseDTO[]> {
    const rows = this.upstreamRepo.getAllUpstreams();
    return rows.map((r) => this.toDTO(r));
  }

  /**
   * Retrieves an individual upstream by id or slug.
   */
  async getUpstream(idOrSlug: string): Promise<UpstreamResponseDTO> {
    const row =
      this.upstreamRepo.getUpstreamBySlug(idOrSlug) ??
      this.upstreamRepo.getUpstreamById(idOrSlug);

    if (!row) {
      throw new AdminNotFoundError(`Upstream "${idOrSlug}" not found`);
    }

    return this.toDTO(row);
  }

  /**
   * Creates a new upstream configuration with Saga compensation across SQLite, Kubernetes, and runtime catalog.
   * Enforces G4 two-phase audit logging (fail-closed on Phase 1, explicit degradation on Phase 2).
   */
  async createUpstream(
    input: CreateUpstreamInput,
    actor: AuthenticatedUser
  ): Promise<UpstreamResponseDTO> {
    const startTime = Date.now();

    // 1. Validate and normalize URL against SSRF policy
    let normalizedUrl: string;
    try {
      const validated = validateAndNormalizeUpstreamUrl(input.endpointUrl, {
        allowLocalhostForTesting: this.options.allowLocalhostForTesting,
      });
      normalizedUrl = validated.normalizedFqdnUrl;
    } catch (err: unknown) {
      throw new AdminValidationError(
        `Invalid endpoint URL: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 2. In-process registration lock to prevent duplicate concurrent creations
    if (this.activeLocks.has(input.slug)) {
      throw new AdminConflictError(
        `An operation is already in progress for upstream "${input.slug}"`
      );
    }
    this.activeLocks.add(input.slug);

    // 3. Phase 1 Audit: Fails closed. Halts before any side effect if audit start write fails.
    let auditId: string;
    try {
      auditId = this.auditService.startAdminAudit({
        userId: actor.id,
        upstreamSlug: input.slug,
        action: 'UPSTREAM_CREATE',
        payloadSummary: { slug: input.slug, displayName: input.displayName },
      });
    } catch (err: unknown) {
      this.activeLocks.delete(input.slug);
      throw err;
    }

    try {
      // 4. SQLite uniqueness check
      if (this.upstreamRepo.getUpstreamBySlug(input.slug)) {
        this.auditService.finalizeAdminAudit(auditId, {
          status: 'failed',
          startTimeMs: startTime,
          errorCode: 'CONFLICT',
          errorMessage: `Upstream with slug "${input.slug}" already exists`,
        });
        throw new AdminConflictError(`Upstream with slug "${input.slug}" already exists`);
      }

      // 5. Reserve transitional state in SQLite: 'provisioning'
      const rowId = crypto.randomUUID();
      let row = this.upstreamRepo.insertUpstream({
        id: rowId,
        slug: input.slug,
        displayName: input.displayName,
        endpointUrl: normalizedUrl,
        timeoutMs: input.timeoutMs ?? 10000,
        isEnabled: 0,
        status: 'provisioning',
      });

      // 6. Create Kubernetes Secret if credentials provided (single token or multi-key map)
      let secretName: string | null = null;
      let secretRefKey: string | null = null;

      const hasCredentials = Boolean(input.credential || input.credentials);
      if (hasCredentials) {
        secretName = this.secretManager.generateSecretName(input.slug, rowId);
        const credsToStore = input.credentials || input.credential!;
        const defaultKey = input.credentialKey || 'token';
        secretRefKey = input.credentialKey || (input.credentials ? Object.keys(input.credentials).join(',') : 'token');

        try {
          await this.secretManager.createUpstreamSecret(
            input.slug,
            secretName,
            credsToStore,
            defaultKey
          );
          row = this.upstreamRepo.updateUpstream(input.slug, {
            secretRefName: secretName,
            secretRefKey,
          })!;
        } catch (err: unknown) {
          // K8s Secret creation failed: mark SQLite row as failed
          this.upstreamRepo.updateUpstream(input.slug, { status: 'failed' });
          this.auditService.finalizeAdminAudit(auditId, {
            status: 'failed',
            startTimeMs: startTime,
            errorCode: 'SECRET_PROVISIONING_FAILED',
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          throw new AdminDependencyError(
            `Failed to create Kubernetes Secret for upstream "${input.slug}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // 7. Initialize upstream client and discover tools
      try {
        await this.upstreamManager.registerAndDiscover(row);
      } catch (err: unknown) {
        // Upstream discovery failed: SAGA COMPENSATION
        if (secretName) {
          await this.secretManager.deleteUpstreamSecret(input.slug, secretName).catch(() => {});
        }
        this.upstreamRepo.updateUpstream(input.slug, { status: 'failed' });
        this.auditService.finalizeAdminAudit(auditId, {
          status: 'failed',
          startTimeMs: startTime,
          errorCode: 'UPSTREAM_DISCOVERY_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw new AdminDependencyError(
          `Failed to discover tools from upstream "${input.slug}": ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // 8. Transition to 'active' state only after all readiness conditions succeed
      row = this.upstreamRepo.updateUpstream(input.slug, {
        status: 'active',
        isEnabled: 1,
      })!;
      await this.upstreamManager.updateClient(row);

      // 9. Phase 2 Audit finalization
      const finalizeResult = this.auditService.finalizeAdminAudit(auditId, {
        status: 'success',
        startTimeMs: startTime,
      });

      return this.toDTO(row, finalizeResult.degraded);
    } finally {
      this.activeLocks.delete(input.slug);
    }
  }

  /**
   * Updates an existing upstream configuration and optional credential rotation.
   */
  async updateUpstream(
    idOrSlug: string,
    updates: UpdateUpstreamInput,
    actor: AuthenticatedUser
  ): Promise<UpstreamResponseDTO> {
    const startTime = Date.now();
    const existing =
      this.upstreamRepo.getUpstreamBySlug(idOrSlug) ??
      this.upstreamRepo.getUpstreamById(idOrSlug);

    if (!existing) {
      throw new AdminNotFoundError(`Upstream "${idOrSlug}" not found`);
    }

    if (this.activeLocks.has(existing.slug)) {
      throw new AdminConflictError(
        `An operation is already in progress for upstream "${existing.slug}"`
      );
    }
    this.activeLocks.add(existing.slug);

    // Phase 1 Audit Start (Fail Closed)
    let auditId: string;
    try {
      auditId = this.auditService.startAdminAudit({
        userId: actor.id,
        upstreamSlug: existing.slug,
        action: 'UPSTREAM_UPDATE',
        payloadSummary: {
          slug: existing.slug,
          hasDisplayNameUpdate: updates.displayName !== undefined,
          hasUrlUpdate: updates.endpointUrl !== undefined,
          hasTimeoutUpdate: updates.timeoutMs !== undefined,
          hasCredentialUpdate: updates.credential !== undefined || updates.credentials !== undefined,
        },
      });
    } catch (err: unknown) {
      this.activeLocks.delete(existing.slug);
      throw err;
    }

    try {
      let normalizedUrl: string | undefined;
      if (updates.endpointUrl) {
        try {
          const validated = validateAndNormalizeUpstreamUrl(updates.endpointUrl, {
            allowLocalhostForTesting: this.options.allowLocalhostForTesting,
          });
          normalizedUrl = validated.normalizedFqdnUrl;
        } catch (err: unknown) {
          this.auditService.finalizeAdminAudit(auditId, {
            status: 'failed',
            startTimeMs: startTime,
            errorCode: 'VALIDATION_ERROR',
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          throw new AdminValidationError(
            `Invalid endpoint URL: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // Handle credential rotation / creation
      let secretRefName = existing.secret_ref_name;
      let secretRefKey = existing.secret_ref_key;
      const hasNewCredentials = Boolean(updates.credential || updates.credentials);

      if (hasNewCredentials) {
        const credsToStore = updates.credentials || updates.credential!;
        const defaultKey = updates.credentialKey || 'token';

        if (existing.secret_ref_name) {
          // Rotate existing Secret
          await this.secretManager.updateUpstreamSecret(
            existing.slug,
            existing.secret_ref_name,
            credsToStore,
            defaultKey
          );
          if (updates.credentialKey || updates.credentials) {
            secretRefKey = updates.credentialKey || Object.keys(updates.credentials!).join(',');
          }
        } else {
          // Create new Secret for previously unauthenticated upstream
          const newSecretName = this.secretManager.generateSecretName(existing.slug, existing.id);
          await this.secretManager.createUpstreamSecret(
            existing.slug,
            newSecretName,
            credsToStore,
            defaultKey
          );
          secretRefName = newSecretName;
          secretRefKey = updates.credentialKey || (updates.credentials ? Object.keys(updates.credentials).join(',') : 'token');
        }
      }

      const updatedRow = this.upstreamRepo.updateUpstream(existing.slug, {
        displayName: updates.displayName,
        endpointUrl: normalizedUrl,
        timeoutMs: updates.timeoutMs,
        secretRefName,
        secretRefKey,
      });

      if (!updatedRow) {
        this.auditService.finalizeAdminAudit(auditId, {
          status: 'failed',
          startTimeMs: startTime,
          errorCode: 'UPDATE_FAILED',
        });
        throw new AdminNotFoundError(`Failed to update upstream "${existing.slug}"`);
      }

      // Refresh client and dynamic catalog
      await this.upstreamManager.updateClient(updatedRow);

      const finalizeResult = this.auditService.finalizeAdminAudit(auditId, {
        status: 'success',
        startTimeMs: startTime,
      });

      return this.toDTO(updatedRow, finalizeResult.degraded);
    } catch (err: unknown) {
      if (!(err instanceof AdminError)) {
        this.auditService.finalizeAdminAudit(auditId, {
          status: 'failed',
          startTimeMs: startTime,
          errorCode: 'INTERNAL_ERROR',
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    } finally {
      this.activeLocks.delete(existing.slug);
    }
  }

  /**
   * Disables an upstream. In-flight dispatches complete; new dispatches are immediately rejected.
   */
  async disableUpstream(
    idOrSlug: string,
    actor: AuthenticatedUser
  ): Promise<UpstreamResponseDTO> {
    const startTime = Date.now();
    const existing =
      this.upstreamRepo.getUpstreamBySlug(idOrSlug) ??
      this.upstreamRepo.getUpstreamById(idOrSlug);

    if (!existing) {
      throw new AdminNotFoundError(`Upstream "${idOrSlug}" not found`);
    }

    if (this.activeLocks.has(existing.slug)) {
      throw new AdminConflictError(
        `An operation is already in progress for upstream "${existing.slug}"`
      );
    }
    this.activeLocks.add(existing.slug);

    // Phase 1 Audit Start
    let auditId: string;
    try {
      auditId = this.auditService.startAdminAudit({
        userId: actor.id,
        upstreamSlug: existing.slug,
        action: 'UPSTREAM_DISABLE',
        payloadSummary: { slug: existing.slug },
      });
    } catch (err: unknown) {
      this.activeLocks.delete(existing.slug);
      throw err;
    }

    try {
      const updatedRow = this.upstreamRepo.updateUpstream(existing.slug, {
        isEnabled: 0,
        status: 'disabled',
      });

      if (!updatedRow) {
        throw new AdminNotFoundError(`Failed to disable upstream "${existing.slug}"`);
      }

      await this.upstreamManager.setClientEnabled(existing.slug, false);

      const finalizeResult = this.auditService.finalizeAdminAudit(auditId, {
        status: 'success',
        startTimeMs: startTime,
      });

      return this.toDTO(updatedRow, finalizeResult.degraded);
    } finally {
      this.activeLocks.delete(existing.slug);
    }
  }

  /**
   * Re-enables an upstream after verifying connectivity and tool discovery.
   */
  async enableUpstream(
    idOrSlug: string,
    actor: AuthenticatedUser
  ): Promise<UpstreamResponseDTO> {
    const startTime = Date.now();
    const existing =
      this.upstreamRepo.getUpstreamBySlug(idOrSlug) ??
      this.upstreamRepo.getUpstreamById(idOrSlug);

    if (!existing) {
      throw new AdminNotFoundError(`Upstream "${idOrSlug}" not found`);
    }

    if (this.activeLocks.has(existing.slug)) {
      throw new AdminConflictError(
        `An operation is already in progress for upstream "${existing.slug}"`
      );
    }
    this.activeLocks.add(existing.slug);

    // Phase 1 Audit Start
    let auditId: string;
    try {
      auditId = this.auditService.startAdminAudit({
        userId: actor.id,
        upstreamSlug: existing.slug,
        action: 'UPSTREAM_ENABLE',
        payloadSummary: { slug: existing.slug },
      });
    } catch (err: unknown) {
      this.activeLocks.delete(existing.slug);
      throw err;
    }

    try {
      const updatedRow = this.upstreamRepo.updateUpstream(existing.slug, {
        isEnabled: 1,
        status: 'active',
      });

      if (!updatedRow) {
        throw new AdminNotFoundError(`Failed to enable upstream "${existing.slug}"`);
      }

      await this.upstreamManager.setClientEnabled(existing.slug, true);

      const finalizeResult = this.auditService.finalizeAdminAudit(auditId, {
        status: 'success',
        startTimeMs: startTime,
      });

      return this.toDTO(updatedRow, finalizeResult.degraded);
    } finally {
      this.activeLocks.delete(existing.slug);
    }
  }

  /**
   * Safely deletes an upstream and its associated Kubernetes Secret.
   * INVARIANT: If Secret deletion fails, the registry record is strictly preserved in 'cleanup_required'.
   * Never deletes the SQLite record until Secret deletion is confirmed.
   */
  async deleteUpstream(
    idOrSlug: string,
    actor: AuthenticatedUser
  ): Promise<{ message: string; slug: string; auditDegraded?: boolean }> {
    const startTime = Date.now();
    const existing =
      this.upstreamRepo.getUpstreamBySlug(idOrSlug) ??
      this.upstreamRepo.getUpstreamById(idOrSlug);

    if (!existing) {
      throw new AdminNotFoundError(`Upstream "${idOrSlug}" not found`);
    }

    if (this.activeLocks.has(existing.slug)) {
      throw new AdminConflictError(
        `An operation is already in progress for upstream "${existing.slug}"`
      );
    }
    this.activeLocks.add(existing.slug);

    // Phase 1 Audit Start
    let auditId: string;
    try {
      auditId = this.auditService.startAdminAudit({
        userId: actor.id,
        upstreamSlug: existing.slug,
        action: 'UPSTREAM_DELETE',
        payloadSummary: { slug: existing.slug },
      });
    } catch (err: unknown) {
      this.activeLocks.delete(existing.slug);
      throw err;
    }

    try {
      // 1. Mark SQLite row as 'deleting'
      this.upstreamRepo.updateUpstream(existing.slug, {
        status: 'deleting',
        isEnabled: 0,
      });

      // 2. Remove managed client from runtime and refresh catalog snapshot
      await this.upstreamManager.removeClient(existing.slug);

      // 3. Delete Kubernetes Secret if present
      if (existing.secret_ref_name) {
        try {
          await this.secretManager.deleteUpstreamSecret(existing.slug, existing.secret_ref_name);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          // CRITICAL INVARIANT: Preserve row in cleanup_required. DO NOT delete row.
          this.upstreamRepo.updateUpstream(existing.slug, {
            status: 'cleanup_required',
            cleanupError: errMsg,
          });

          this.auditService.finalizeAdminAudit(auditId, {
            status: 'failed',
            startTimeMs: startTime,
            errorCode: 'SECRET_CLEANUP_FAILED',
            errorMessage: errMsg,
          });

          throw new CleanupRequiredError(
            `Upstream "${existing.slug}" deactivated from runtime, but Kubernetes Secret cleanup failed: ${errMsg}. Preserved in cleanup_required for retry.`
          );
        }
      }

      // 4. Finalize deletion from SQLite ONLY when Secret cleanup is confirmed
      this.upstreamRepo.deleteUpstream(existing.id);

      const finalizeResult = this.auditService.finalizeAdminAudit(auditId, {
        status: 'success',
        startTimeMs: startTime,
      });

      return {
        message: `Upstream "${existing.slug}" and associated Secret successfully deleted`,
        slug: existing.slug,
        auditDegraded: finalizeResult.degraded ? true : undefined,
      };
    } finally {
      this.activeLocks.delete(existing.slug);
    }
  }

  /**
   * Retries cleanup for an upstream currently in 'cleanup_required' or 'deleting' state.
   */
  async retryCleanup(
    idOrSlug: string,
    actor: AuthenticatedUser
  ): Promise<{ message: string; slug: string; auditDegraded?: boolean }> {
    const startTime = Date.now();
    const existing =
      this.upstreamRepo.getUpstreamBySlug(idOrSlug) ??
      this.upstreamRepo.getUpstreamById(idOrSlug);

    if (!existing) {
      throw new AdminNotFoundError(`Upstream "${idOrSlug}" not found`);
    }

    if (existing.status !== 'cleanup_required' && existing.status !== 'deleting') {
      return {
        message: `Upstream "${existing.slug}" does not require cleanup (status: ${existing.status})`,
        slug: existing.slug,
      };
    }

    if (this.activeLocks.has(existing.slug)) {
      throw new AdminConflictError(
        `An operation is already in progress for upstream "${existing.slug}"`
      );
    }
    this.activeLocks.add(existing.slug);

    // Phase 1 Audit Start
    let auditId: string;
    try {
      auditId = this.auditService.startAdminAudit({
        userId: actor.id,
        upstreamSlug: existing.slug,
        action: 'UPSTREAM_CLEANUP_RETRY',
        payloadSummary: { slug: existing.slug },
      });
    } catch (err: unknown) {
      this.activeLocks.delete(existing.slug);
      throw err;
    }

    try {
      if (existing.secret_ref_name) {
        try {
          await this.secretManager.deleteUpstreamSecret(existing.slug, existing.secret_ref_name);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.upstreamRepo.updateUpstream(existing.slug, {
            cleanupError: errMsg,
          });
          this.auditService.finalizeAdminAudit(auditId, {
            status: 'failed',
            startTimeMs: startTime,
            errorCode: 'RETRY_CLEANUP_FAILED',
            errorMessage: errMsg,
          });
          throw new CleanupRequiredError(`Retry cleanup failed: ${errMsg}`);
        }
      }

      this.upstreamRepo.deleteUpstream(existing.id);

      const finalizeResult = this.auditService.finalizeAdminAudit(auditId, {
        status: 'success',
        startTimeMs: startTime,
      });

      return {
        message: `Cleanup retry succeeded: upstream "${existing.slug}" and Secret deleted`,
        slug: existing.slug,
        auditDegraded: finalizeResult.degraded ? true : undefined,
      };
    } finally {
      this.activeLocks.delete(existing.slug);
    }
  }

  /**
   * Executes startup reconciliation across SQLite records and Kubernetes Secrets:
   * 1. Sweeps stale provisioning rows (>120s old) with proven ownership and no active operation.
   * 2. Sweeps deleting / cleanup_required rows -> re-attempts cleanup.
   * 3. Sweeps unreferenced orphaned Secrets (>300s old, 5-minute grace period).
   * 4. Flags active rows whose Kubernetes Secret is missing and halts unauthenticated dispatch.
   */
  async runStartupReconciliation(): Promise<{
    staleProvisioningReconciled: number;
    cleanupRequiredReconciled: number;
    orphansReconciled: number;
    missingSecretsDetected: number;
  }> {
    const nowSec = Math.floor(Date.now() / 1000);
    let staleProvisioningReconciled = 0;
    let cleanupRequiredReconciled = 0;
    let missingSecretsDetected = 0;

    // 1. Reconcile stale provisioning rows (>120s old)
    // PROOF: Verify no active lock is held AND prove Secret ownership before deleting
    const staleRows = this.upstreamRepo.getStaleProvisioningUpstreams(nowSec - 120);
    for (const row of staleRows) {
      if (this.activeLocks.has(row.slug)) {
        logger.debug('Skipping provisioning row currently in active locks', { slug: row.slug });
        continue;
      }

      if (row.secret_ref_name) {
        try {
          const meta = await this.secretManager.getSecretMetadata(row.secret_ref_name);
          if (meta) {
            // Verify ownership: labels must match urumi-gateway and row slug
            const managedBy = meta.labels['app.kubernetes.io/managed-by'];
            const secretSlug = meta.labels['urumi.io/upstream-slug'];
            if (managedBy === 'urumi-gateway' && secretSlug === row.slug) {
              await this.secretManager.deleteUpstreamSecret(row.slug, row.secret_ref_name);
            } else {
              logger.warn('Provisioning secret ownership mismatch; preserving for operator inspection', {
                slug: row.slug,
                secretName: row.secret_ref_name,
                managedBy,
                secretSlug,
              });
            }
          }
        } catch (err: unknown) {
          logger.warn('Failed to delete secret for stale provisioning upstream during startup reconciliation', {
            slug: row.slug,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.upstreamRepo.updateUpstream(row.slug, {
        status: 'failed',
        cleanupError: 'Provisioning timed out or gateway process crashed during creation',
      });
      staleProvisioningReconciled++;
      logger.warn('Reconciled stale provisioning upstream to failed', {
        slug: row.slug,
        createdAt: row.created_at,
      });
    }

    // 2. Reconcile cleanup_required / deleting rows
    const cleanupRows = this.upstreamRepo.getCleanupRequiredUpstreams();
    for (const row of cleanupRows) {
      if (this.activeLocks.has(row.slug)) {
        continue;
      }

      try {
        if (row.secret_ref_name) {
          await this.secretManager.deleteUpstreamSecret(row.slug, row.secret_ref_name);
        }
        this.upstreamRepo.deleteUpstream(row.id);
        cleanupRequiredReconciled++;
        logger.info('Reconciled and finalized deletion for cleanup_required upstream', {
          slug: row.slug,
        });
      } catch (err: unknown) {
        logger.warn('Cleanup required reconciliation attempt failed; retaining record for operator', {
          slug: row.slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Reconcile orphaned Secrets in Kubernetes
    const allRows = this.upstreamRepo.getAllUpstreams();
    const referencedSecretNames = new Set(
      allRows.map((r) => r.secret_ref_name).filter((name): name is string => Boolean(name))
    );

    const orphanResult = await this.secretManager.reconcileOrphans({
      referencedSecretNames,
      activeRegistrationSlugs: this.activeLocks,
    });

    // 4. Verify that active upstreams expecting Secrets actually have them
    for (const row of allRows) {
      if (row.status === 'active' && row.secret_ref_name) {
        const secretMeta = await this.secretManager.getSecretMetadata(row.secret_ref_name);
        if (!secretMeta) {
          missingSecretsDetected++;
          this.upstreamRepo.updateUpstream(row.slug, {
            status: 'failed',
            cleanupError: `Secret "${row.secret_ref_name}" is missing in Kubernetes`,
          });
          // Disable client in runtime so it does not silently attempt unauthenticated calls
          await this.upstreamManager.removeClient(row.slug);
          logger.error('Active upstream has missing Kubernetes Secret; deactivated and marked as failed', {
            slug: row.slug,
            secretName: row.secret_ref_name,
          });
        }
      }
    }

    return {
      staleProvisioningReconciled,
      cleanupRequiredReconciled,
      orphansReconciled: orphanResult.deletedOrphans.length,
      missingSecretsDetected,
    };
  }
}
