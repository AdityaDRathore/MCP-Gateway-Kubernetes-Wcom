import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../../src/db/schema.js';
import { UpstreamRepository } from '../../src/db/upstream-repo.js';
import { CatalogService } from '../../src/upstream/catalog-service.js';
import { UpstreamManager } from '../../src/upstream/upstream-manager.js';
import { AuditRepository } from '../../src/db/audit-repo.js';
import { AuditService } from '../../src/audit/audit-service.js';
import { SecretManager } from '../../src/k8s/secret-manager.js';
import { MockKubernetesSecretClient } from '../helpers/mock-secret-client.js';
import { AdminService } from '../../src/admin/admin-service.js';

describe('Gate G7: Startup Reconciliation & Orphan Handling Unit Tests', () => {
  let db: DatabaseSync;
  let upstreamRepo: UpstreamRepository;
  let catalogService: CatalogService;
  let upstreamManager: UpstreamManager;
  let auditRepo: AuditRepository;
  let auditService: AuditService;
  let mockK8sClient: MockKubernetesSecretClient;
  let secretManager: SecretManager;
  let adminService: AdminService;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS) {
      db.exec(m.sql);
    }

    upstreamRepo = new UpstreamRepository(db);
    catalogService = new CatalogService();
    mockK8sClient = new MockKubernetesSecretClient();
    secretManager = new SecretManager(mockK8sClient, {
      namespace: 'urumi-gateway-secrets',
    });
    auditRepo = new AuditRepository(db);
    auditService = new AuditService(auditRepo);

    upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
      allowLocalhostForTesting: true,
    });

    adminService = new AdminService(
      upstreamRepo,
      secretManager,
      upstreamManager,
      auditService,
      {
        allowLocalhostForTesting: true,
      }
    );
  });

  test('reconciles stale provisioning upstream (>120s old) and deletes associated Secret', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const staleSecret = 'upstream-sec-stale-provisioning-1111';

    // Secret in K8s
    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: staleSecret,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'stale-provisioning',
      },
      stringData: { token: 'tok' },
    });

    // Row created 200 seconds ago (older than 120s threshold)
    upstreamRepo.insertUpstream({
      slug: 'stale-provisioning',
      displayName: 'Stale Provisioning',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'provisioning',
      secretRefName: staleSecret,
      isEnabled: 0,
    });
    // Manually backdate created_at
    db.prepare("UPDATE upstreams SET created_at = ? WHERE slug = 'stale-provisioning';").run(nowSec - 200);

    const result = await adminService.runStartupReconciliation();
    assert.equal(result.staleProvisioningReconciled, 1);

    // Assert row transitioned to 'failed'
    const row = upstreamRepo.getUpstreamBySlug('stale-provisioning');
    assert.ok(row);
    assert.equal(row.status, 'failed');

    // Assert secret in K8s was deleted
    const secret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', staleSecret);
    assert.equal(secret, undefined);
  });

  test('does NOT delete stale provisioning Secret if an operation is still active in activeLocks', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const activeLockSecret = 'upstream-sec-locked-svc-1234';

    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: activeLockSecret,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'locked-svc',
      },
      stringData: { token: 'tok' },
    });

    upstreamRepo.insertUpstream({
      slug: 'locked-svc',
      displayName: 'Locked Service',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'provisioning',
      secretRefName: activeLockSecret,
      isEnabled: 0,
    });
    db.prepare("UPDATE upstreams SET created_at = ? WHERE slug = 'locked-svc';").run(nowSec - 200);

    // Lock the slug in activeLocks
    adminService.getActiveLocks().add('locked-svc');

    try {
      const result = await adminService.runStartupReconciliation();
      assert.equal(result.staleProvisioningReconciled, 0);

      // Verify Secret is NOT deleted because operation is active!
      const secret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', activeLockSecret);
      assert.ok(secret, 'Secret must be preserved while operation lock is held');
    } finally {
      adminService.getActiveLocks().delete('locked-svc');
    }
  });

  test('does NOT delete stale provisioning Secret if ownership labels do not match stale row', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const mismatchedSecret = 'upstream-sec-mismatched-5678';

    // Secret owned by 'other-svc', not 'stale-mismatch'
    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: mismatchedSecret,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'other-svc',
      },
      stringData: { token: 'tok' },
    });

    upstreamRepo.insertUpstream({
      slug: 'stale-mismatch',
      displayName: 'Stale Mismatch',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'provisioning',
      secretRefName: mismatchedSecret,
      isEnabled: 0,
    });
    db.prepare("UPDATE upstreams SET created_at = ? WHERE slug = 'stale-mismatch';").run(nowSec - 200);

    const result = await adminService.runStartupReconciliation();
    // Row marked failed, but Secret NOT deleted due to ownership mismatch
    assert.equal(result.staleProvisioningReconciled, 1);

    const secret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', mismatchedSecret);
    assert.ok(secret, 'Secret must be preserved due to ownership mismatch');
  });

  test('leaves fresh provisioning upstream (<120s old) completely untouched', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const freshSecret = 'upstream-sec-fresh-provisioning-2222';

    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: freshSecret,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'fresh-provisioning',
      },
      stringData: { token: 'tok' },
    });

    // Row created 30 seconds ago
    upstreamRepo.insertUpstream({
      slug: 'fresh-provisioning',
      displayName: 'Fresh Provisioning',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'provisioning',
      secretRefName: freshSecret,
      isEnabled: 0,
    });
    db.prepare("UPDATE upstreams SET created_at = ? WHERE slug = 'fresh-provisioning';").run(nowSec - 30);

    const result = await adminService.runStartupReconciliation();
    assert.equal(result.staleProvisioningReconciled, 0);

    // Row remains provisioning
    const row = upstreamRepo.getUpstreamBySlug('fresh-provisioning');
    assert.ok(row);
    assert.equal(row.status, 'provisioning');

    // Secret remains stored
    const secret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', freshSecret);
    assert.ok(secret);
  });

  test('reconciles cleanup_required and deleting rows by completing Secret and SQLite deletion', async () => {
    const cleanupSecret = 'upstream-sec-stuck-cleanup-3333';

    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: cleanupSecret,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'stuck-cleanup',
      },
      stringData: { token: 'tok' },
    });

    upstreamRepo.insertUpstream({
      slug: 'stuck-cleanup',
      displayName: 'Stuck Cleanup',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'cleanup_required',
      secretRefName: cleanupSecret,
      cleanupError: 'Previous connection timeout',
      isEnabled: 0,
    });

    const result = await adminService.runStartupReconciliation();
    assert.equal(result.cleanupRequiredReconciled, 1);

    // Both row and secret must be deleted
    assert.equal(upstreamRepo.getUpstreamBySlug('stuck-cleanup'), null);
    assert.equal(mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', cleanupSecret), undefined);
  });

  test('reconciles orphan Secrets in Kubernetes with 5-minute grace period enforcement', async () => {
    const now = Date.now();

    // 1. Fresh orphan (created 120s ago): < 300s grace period -> RETAINED
    const freshOrphan = 'upstream-sec-orphan-fresh-4444';
    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: freshOrphan,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'orphan-fresh',
      },
      stringData: { token: 'tok' },
    });
    mockK8sClient.setSecretCreationTimestamp('urumi-gateway-secrets', freshOrphan, now - 120_000);

    // 2. Old orphan (created 350s ago): > 300s grace period -> DELETED
    const oldOrphan = 'upstream-sec-orphan-old-5555';
    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: oldOrphan,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'orphan-old',
      },
      stringData: { token: 'tok' },
    });
    mockK8sClient.setSecretCreationTimestamp('urumi-gateway-secrets', oldOrphan, now - 350_000);

    const result = await adminService.runStartupReconciliation();
    assert.equal(result.orphansReconciled, 1);

    // Fresh orphan retained
    assert.ok(mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', freshOrphan));
    // Old orphan deleted
    assert.equal(mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', oldOrphan), undefined);
  });

  test('detects active upstream whose Secret is missing in Kubernetes and marks as failed', async () => {
    upstreamRepo.insertUpstream({
      slug: 'missing-secret-svc',
      displayName: 'Missing Secret Svc',
      endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      status: 'active',
      secretRefName: 'upstream-sec-ghost-secret-6666',
      isEnabled: 1,
    });

    const result = await adminService.runStartupReconciliation();
    assert.equal(result.missingSecretsDetected, 1);

    const row = upstreamRepo.getUpstreamBySlug('missing-secret-svc');
    assert.ok(row);
    assert.equal(row.status, 'failed');
    assert.ok(row.cleanup_error?.includes('is missing in Kubernetes'));
  });

  test('startup reconciliation is idempotent when rerun multiple times', async () => {
    const run1 = await adminService.runStartupReconciliation();
    const run2 = await adminService.runStartupReconciliation();

    assert.equal(run2.staleProvisioningReconciled, 0);
    assert.equal(run2.cleanupRequiredReconciled, 0);
    assert.equal(run2.orphansReconciled, 0);
    assert.equal(run2.missingSecretsDetected, 0);
  });
});
