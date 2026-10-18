import crypto from 'node:crypto';
import { IKubernetesSecretClient, K8sSecretMetadata, KubernetesConflictError } from './secret-client.js';
import { logger } from '../logging/logger.js';

export interface SecretManagerOptions {
  namespace?: string;
}

export interface ReconcileOrphanResult {
  deletedOrphans: string[];
  deletedCrashedProvisioning: string[];
  retainedGracePeriod: string[];
  retainedInFlight: string[];
  retainedAmbiguous: string[];
}

const PROHIBITED_SECRET_NAMESPACES = new Set([
  'urumi',
  'default',
  'kube-system',
  'kube-public',
  'kube-node-lease',
]);

export class SecretManager {
  private readonly namespace: string;

  constructor(
    private readonly client: IKubernetesSecretClient,
    options: SecretManagerOptions = {}
  ) {
    const ns = (options.namespace || 'urumi-gateway-secrets').trim().toLowerCase();

    // Enforce security boundary: Namespace must not be empty or targeting workload/system namespaces
    if (!ns || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(ns) || ns.length > 63) {
      throw new Error(`Invalid Kubernetes Secret namespace: "${ns}". Must be a valid DNS label.`);
    }

    if (PROHIBITED_SECRET_NAMESPACES.has(ns)) {
      throw new Error(
        `Security Boundary Violation: Secret namespace "${ns}" is prohibited. Secrets must reside in an isolated namespace.`
      );
    }

    this.namespace = ns;
  }

  getNamespace(): string {
    return this.namespace;
  }

  /**
   * Generates deterministic, collision-resistant Secret naming based on upstream slug and ID.
   * Format: upstream-sec-${slug}-${hash8}
   */
  generateSecretName(slug: string, upstreamId: string): string {
    const hash = crypto.createHash('sha256').update(upstreamId).digest('hex').slice(0, 8);
    return `upstream-sec-${slug}-${hash}`;
  }

  /**
   * Creates a Kubernetes Secret for an upstream MCP server.
   * Supports both single-string credentials (under credentialKey) and multi-key credential maps.
   * Never prints or logs the raw credentials.
   */
  async createUpstreamSecret(
    slug: string,
    secretName: string,
    credentials: string | Record<string, string>,
    defaultCredentialKey = 'token'
  ): Promise<void> {
    const stringData: Record<string, string> =
      typeof credentials === 'string'
        ? { [defaultCredentialKey]: credentials }
        : { ...credentials };

    try {
      await this.client.createSecret(this.namespace, {
        name: secretName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'urumi-gateway',
          'app.kubernetes.io/name': 'urumi-platform',
          'urumi.io/upstream-slug': slug,
        },
        stringData,
      });

      logger.debug('Successfully created Kubernetes upstream secret', {
        secretName,
        namespace: this.namespace,
        slug,
        keys: Object.keys(stringData),
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const sanitized = this.sanitizeError(errMessage);
      logger.error('Failed to create Kubernetes upstream secret', {
        secretName,
        namespace: this.namespace,
        slug,
        error: sanitized,
      });
      throw new Error(`Failed to create Kubernetes Secret for upstream "${slug}": ${sanitized}`);
    }
  }

  /**
   * Updates an existing upstream Secret with a rotated credential map or single token.
   * Handles optimistic concurrency through resourceVersion verification.
   */
  async updateUpstreamSecret(
    slug: string,
    secretName: string,
    newCredentials: string | Record<string, string>,
    defaultCredentialKey = 'token'
  ): Promise<void> {
    const stringData: Record<string, string> =
      typeof newCredentials === 'string'
        ? { [defaultCredentialKey]: newCredentials }
        : { ...newCredentials };

    try {
      const existing = await this.client.getSecret(this.namespace, secretName);
      if (!existing) {
        throw new Error(`Secret "${secretName}" not found for rotation`);
      }

      this.verifyOwnership(existing, slug);

      await this.client.updateSecret(this.namespace, {
        name: secretName,
        namespace: this.namespace,
        labels: {
          ...existing.labels,
          'app.kubernetes.io/managed-by': 'urumi-gateway',
          'urumi.io/upstream-slug': slug,
        },
        stringData,
        resourceVersion: existing.resourceVersion,
      });

      logger.debug('Successfully rotated Kubernetes upstream secret credential', {
        secretName,
        namespace: this.namespace,
        slug,
        keys: Object.keys(stringData),
      });
    } catch (err: unknown) {
      if (err instanceof KubernetesConflictError) {
        throw err;
      }
      const errMessage = err instanceof Error ? err.message : String(err);
      const sanitized = this.sanitizeError(errMessage);
      logger.error('Failed to rotate Kubernetes upstream secret credential', {
        secretName,
        namespace: this.namespace,
        slug,
        error: sanitized,
      });
      throw new Error(`Failed to rotate Kubernetes Secret for upstream "${slug}": ${sanitized}`);
    }
  }

  /**
   * Deletes an upstream Secret safely with explicit ownership verification.
   * Never deletes a Secret unless it is strictly owned by urumi-gateway and matches the target slug.
   * Returns true if deleted, false if Secret did not exist (already deleted).
   */
  async deleteUpstreamSecret(slug: string, secretName: string): Promise<boolean> {
    try {
      const metadata = await this.client.getSecret(this.namespace, secretName);
      if (!metadata) {
        logger.debug('Secret to delete does not exist (already deleted or never created)', {
          secretName,
          slug,
        });
        return false;
      }

      this.verifyOwnership(metadata, slug);

      const deleted = await this.client.deleteSecret(this.namespace, secretName);
      logger.debug('Successfully deleted Kubernetes upstream secret', {
        secretName,
        namespace: this.namespace,
        slug,
      });
      return deleted;
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const sanitized = this.sanitizeError(errMessage);
      logger.error('Failed to delete Kubernetes upstream secret', {
        secretName,
        namespace: this.namespace,
        slug,
        error: sanitized,
      });
      throw new Error(`Failed to delete Kubernetes Secret for upstream "${slug}": ${sanitized}`);
    }
  }

  /**
   * Retrieves Secret metadata (without data values).
   */
  async getSecretMetadata(secretName: string): Promise<K8sSecretMetadata | null> {
    return this.client.getSecret(this.namespace, secretName);
  }

  /**
   * Retrieves Secret data securely for upstream client authentication.
   */
  async getSecretData(secretName: string): Promise<Record<string, string> | null> {
    return this.client.getSecretData(this.namespace, secretName);
  }

  /**
   * Reconciles orphaned and crashed secrets per ADR-017 Section 2.5 and Gate G7 invariants:
   * 1. Proves no operation is active: skips any Secret whose slug is in activeRegistrationSlugs.
   * 2. Proves ownership for stale provisioning: checks that the Secret is owned by the specific stale row
   *    and that age >= 120 seconds.
   * 3. Proves unreferenced status for orphans: checks that the Secret has no registry row in SQLite AND
   *    its age exceeds the 300-second (5-minute) grace period.
   * 4. Ambiguous or unmanaged Secrets are NEVER deleted automatically.
   */
  async reconcileOrphans(params: {
    referencedSecretNames: Set<string>;
    activeRegistrationSlugs: Set<string>;
    staleProvisioningMap?: Map<string, { slug: string; createdAt: number }>;
    nowMs?: number;
  }): Promise<ReconcileOrphanResult> {
    const now = params.nowMs ?? Date.now();
    const result: ReconcileOrphanResult = {
      deletedOrphans: [],
      deletedCrashedProvisioning: [],
      retainedGracePeriod: [],
      retainedInFlight: [],
      retainedAmbiguous: [],
    };

    const secrets = await this.client.listSecrets(
      this.namespace,
      'app.kubernetes.io/managed-by=urumi-gateway'
    );

    for (const secret of secrets) {
      const managedBy = secret.labels['app.kubernetes.io/managed-by'];
      const slug = secret.labels['urumi.io/upstream-slug'];

      // Proof 0: Verify management label and slug presence
      if (managedBy !== 'urumi-gateway' || !slug) {
        result.retainedAmbiguous.push(secret.name);
        logger.warn('Ambiguous Secret ownership detected; retaining for operator inspection', {
          secretName: secret.name,
          managedBy,
          slug,
        });
        continue;
      }

      // Proof 1: Verify no operation is active for this slug
      if (params.activeRegistrationSlugs.has(slug)) {
        result.retainedInFlight.push(secret.name);
        continue;
      }

      // Proof 2: Check if associated with a stale provisioning registry entry
      const provInfo = params.staleProvisioningMap?.get(secret.name);
      if (provInfo) {
        // Verify Secret ownership matches the stale row's slug
        if (provInfo.slug !== slug) {
          result.retainedAmbiguous.push(secret.name);
          logger.warn('Secret slug mismatch with provisioning row; retaining for operator', {
            secretName: secret.name,
            secretSlug: slug,
            rowSlug: provInfo.slug,
          });
          continue;
        }

        const ageSeconds = Math.floor((now - provInfo.createdAt * 1000) / 1000);
        if (ageSeconds < 120) {
          // Actively in-flight registration within 120s timeout
          result.retainedInFlight.push(secret.name);
        } else {
          // Crashed registration with proven ownership and exceeded 120s threshold: delete
          try {
            await this.client.deleteSecret(this.namespace, secret.name);
            result.deletedCrashedProvisioning.push(secret.name);
            logger.warn('Deleted orphaned Secret from confirmed crashed provisioning', {
              secretName: secret.name,
              slug,
              ageSeconds,
            });
          } catch (err: unknown) {
            logger.error('Failed to delete orphaned secret from crashed provisioning', {
              secretName: secret.name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        continue;
      }

      // Proof 3: Check if secret is referenced by an active or disabled row in SQLite
      if (params.referencedSecretNames.has(secret.name)) {
        // Legitimate referenced secret
        continue;
      }

      // Proof 4: Secret is completely unreferenced in SQLite
      const creationTs = secret.creationTimestamp ?? now;
      const ageMs = now - creationTs;
      if (ageMs < 300_000) {
        // Within 5-minute (300s) grace period: retain
        result.retainedGracePeriod.push(secret.name);
      } else {
        // Exceeded 5-minute grace period with verified ownership and no active lock: delete
        try {
          await this.client.deleteSecret(this.namespace, secret.name);
          result.deletedOrphans.push(secret.name);
          logger.warn('Deleted unreferenced orphaned Secret exceeding 5-minute grace period', {
            secretName: secret.name,
            slug,
            ageSeconds: Math.floor(ageMs / 1000),
          });
        } catch (err: unknown) {
          logger.error('Failed to delete unreferenced orphaned secret', {
            secretName: secret.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return result;
  }

  private verifyOwnership(metadata: K8sSecretMetadata, slug: string): void {
    const managedBy = metadata.labels['app.kubernetes.io/managed-by'];
    const secretSlug = metadata.labels['urumi.io/upstream-slug'];

    if (managedBy !== 'urumi-gateway' || secretSlug !== slug) {
      throw new Error(
        `Ownership validation failed: Secret "${metadata.name}" is not managed by urumi-gateway for upstream "${slug}"`
      );
    }
  }

  private sanitizeError(message: string): string {
    return message
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/(?:key|token|secret|password)=[^&\s]+/gi, '$1=[REDACTED]');
  }
}
