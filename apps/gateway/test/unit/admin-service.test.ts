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
import {
  AdminService,
  AdminConflictError,
  AdminValidationError,
  AdminDependencyError,
  CleanupRequiredError,
} from '../../src/admin/admin-service.js';
import { AuthenticatedUser } from '../../src/auth/authenticator.js';

describe('Gate G7: AdminService Saga Lifecycle & Coordination Unit Tests', () => {
  let db: DatabaseSync;
  let upstreamRepo: UpstreamRepository;
  let catalogService: CatalogService;
  let upstreamManager: UpstreamManager;
  let auditRepo: AuditRepository;
  let auditService: AuditService;
  let mockK8sClient: MockKubernetesSecretClient;
  let secretManager: SecretManager;
  let adminService: AdminService;

  const adminActor: AuthenticatedUser = {
    id: 'user-admin-1',
    username: 'admin',
    role: 'admin',
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    for (const m of MIGRATIONS) {
      db.exec(m.sql);
    }

    db.prepare('INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?);').run(
      adminActor.id,
      adminActor.username,
      adminActor.role,
      Math.floor(Date.now() / 1000)
    );

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

  test('createUpstream executes full Saga successfully with Kubernetes Secret', async () => {
    // Mock the upstream client discovery by pre-intercepting or creating mock client behavior
    // For unit tests, we test the Saga flow where discovery succeeds or fails
    const mockDiscoverResult = {
      slug: 'test-upstream',
      tools: [
        {
          name: 'test-upstream__do_something',
          originalName: 'do_something',
          upstreamSlug: 'test-upstream',
          inputSchema: { type: 'object' },
        },
      ],
      discoveredAt: Date.now(),
    };

    // Override registerAndDiscover on upstreamManager to simulate fast successful discovery
    upstreamManager.registerAndDiscover = async (row) => {
      catalogService.updateSnapshot(
        [mockDiscoverResult],
        [
          {
            slug: row.slug,
            healthState: 'available',
            persistedStatus: 'active',
            isEnabled: true,
            toolCount: 1,
            lastCheckedAt: Date.now(),
          },
        ]
      );
      return mockDiscoverResult;
    };

    const res = await adminService.createUpstream(
      {
        slug: 'test-upstream',
        displayName: 'Test Upstream Service',
        endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
        timeoutMs: 5000,
        credential: 'test-secret-token-value',
      },
      adminActor
    );

    // 1. DTO asserts (zero credentials in DTO!)
    assert.equal(res.slug, 'test-upstream');
    assert.equal(res.displayName, 'Test Upstream Service');
    assert.equal(res.status, 'active');
    assert.equal(res.isEnabled, true);
    assert.ok(res.secretRefName);
    assert.equal((res as any).credential, undefined);
    assert.equal((res as any).token, undefined);

    // 2. SQLite row asserts
    const row = upstreamRepo.getUpstreamBySlug('test-upstream');
    assert.ok(row);
    assert.equal(row.status, 'active');
    assert.equal(row.is_enabled, 1);
    assert.equal(row.secret_ref_name, res.secretRefName);

    // 3. Kubernetes Secret asserts
    const secret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', res.secretRefName!);
    assert.ok(secret);
    assert.equal(secret.data['token'], 'test-secret-token-value');
    assert.equal(secret.labels['urumi.io/upstream-slug'], 'test-upstream');

    // 4. In-process lock released
    assert.equal(adminService.getActiveLocks().has('test-upstream'), false);

    // 5. Audit record verified
    const audits = auditRepo.listAudits();
    const createAudit = audits.find((a) => a.tool_name === 'UPSTREAM_CREATE');
    assert.ok(createAudit);
    assert.equal(createAudit.user_id, adminActor.id);
    assert.equal(createAudit.upstream_slug, 'test-upstream');
    assert.equal(createAudit.status, 'success');
  });

  test('createUpstream compensates cleanly when Kubernetes Secret creation fails', async () => {
    mockK8sClient.failNext('createSecret', new Error('K8s API Outage: connection refused'));

    await assert.rejects(
      async () => {
        await adminService.createUpstream(
          {
            slug: 'failing-k8s',
            displayName: 'Failing K8s Service',
            endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
            credential: 'secret-val',
          },
          adminActor
        );
      },
      (err: Error) => {
        assert.ok(err instanceof AdminDependencyError);
        assert.ok(err.message.includes('Failed to create Kubernetes Secret'));
        return true;
      }
    );

    // Row in SQLite marked failed
    const row = upstreamRepo.getUpstreamBySlug('failing-k8s');
    assert.ok(row);
    assert.equal(row.status, 'failed');

    // Lock released
    assert.equal(adminService.getActiveLocks().has('failing-k8s'), false);

    // Audit record marks failed
    const audits = auditRepo.listAudits();
    const failedAudit = audits.find((a) => a.upstream_slug === 'failing-k8s');
    assert.ok(failedAudit);
    assert.equal(failedAudit.status, 'failed');
  });

  test('createUpstream compensates cleanly when upstream discovery fails', async () => {
    upstreamManager.registerAndDiscover = async () => {
      throw new Error('ECONNREFUSED: Connection refused at http://urumi-woocommerce-mcp:3000/mcp');
    };

    await assert.rejects(
      async () => {
        await adminService.createUpstream(
          {
            slug: 'unreachable-svc',
            displayName: 'Unreachable Service',
            endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
            credential: 'secret-to-be-compensated',
          },
          adminActor
        );
      },
      (err: Error) => {
        assert.ok(err instanceof AdminDependencyError);
        assert.ok(err.message.includes('Failed to discover tools'));
        return true;
      }
    );

    // SAGA COMPENSATION: Secret must have been deleted!
    const secrets = mockK8sClient.getAllSecrets();
    const orphanSecret = secrets.find((s) => s.labels['urumi.io/upstream-slug'] === 'unreachable-svc');
    assert.equal(orphanSecret, undefined, 'Secret must be deleted on discovery failure');

    // Row in SQLite marked failed
    const row = upstreamRepo.getUpstreamBySlug('unreachable-svc');
    assert.ok(row);
    assert.equal(row.status, 'failed');

    // Lock released
    assert.equal(adminService.getActiveLocks().has('unreachable-svc'), false);
  });

  test('createUpstream rejects duplicate slug and SSRF violations', async () => {
    upstreamRepo.insertUpstream({
      slug: 'existing-svc',
      displayName: 'Existing Service',
      endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
      status: 'active',
    });

    // 1. Duplicate slug rejection
    await assert.rejects(
      async () => {
        await adminService.createUpstream(
          {
            slug: 'existing-svc',
            displayName: 'Duplicate',
            endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
          },
          adminActor
        );
      },
      (err: Error) => {
        assert.ok(err instanceof AdminConflictError);
        return true;
      }
    );

    // 2. SSRF URL rejection (e.g. metadata service, port != 3000, https)
    await assert.rejects(
      async () => {
        await adminService.createUpstream(
          {
            slug: 'ssrf-test',
            displayName: 'SSRF',
            endpointUrl: 'http://169.254.169.254/latest/meta-data',
          },
          adminActor
        );
      },
      (err: Error) => {
        assert.ok(err instanceof AdminValidationError);
        return true;
      }
    );
  });

  test('updateUpstream updates config and rotates credentials safely', async () => {
    const row = upstreamRepo.insertUpstream({
      slug: 'rotating-svc',
      displayName: 'Before Rotation',
      endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
      timeoutMs: 5000,
      status: 'active',
      isEnabled: 1,
      secretRefName: 'upstream-sec-rotating-svc-11111111',
    });

    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: row.secret_ref_name!,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'rotating-svc',
      },
      stringData: { token: 'initial-token' },
    });

    const updated = await adminService.updateUpstream(
      'rotating-svc',
      {
        displayName: 'After Rotation',
        timeoutMs: 15000,
        credential: 'new-rotated-token',
      },
      adminActor
    );

    assert.equal(updated.displayName, 'After Rotation');
    assert.equal(updated.timeoutMs, 15000);

    // Verify K8s Secret was rotated
    const secret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', row.secret_ref_name!);
    assert.equal(secret?.data['token'], 'new-rotated-token');

    // Verify lock released
    assert.equal(adminService.getActiveLocks().has('rotating-svc'), false);
  });

  test('disable and enable lifecycle transitions work and preserve catalog consistency', async () => {
    upstreamRepo.insertUpstream({
      slug: 'toggle-svc',
      displayName: 'Toggle Service',
      endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
      status: 'active',
      isEnabled: 1,
    });

    // 1. Disable
    const disabled = await adminService.disableUpstream('toggle-svc', adminActor);
    assert.equal(disabled.status, 'disabled');
    assert.equal(disabled.isEnabled, false);

    const dbRowDisabled = upstreamRepo.getUpstreamBySlug('toggle-svc');
    assert.equal(dbRowDisabled?.status, 'disabled');
    assert.equal(dbRowDisabled?.is_enabled, 0);

    // 2. Enable
    const enabled = await adminService.enableUpstream('toggle-svc', adminActor);
    assert.equal(enabled.status, 'active');
    assert.equal(enabled.isEnabled, true);

    const dbRowEnabled = upstreamRepo.getUpstreamBySlug('toggle-svc');
    assert.equal(dbRowEnabled?.status, 'active');
    assert.equal(dbRowEnabled?.is_enabled, 1);
  });

  test('deleteUpstream deletes Secret and SQLite row cleanly', async () => {
    const row = upstreamRepo.insertUpstream({
      slug: 'delete-me',
      displayName: 'Delete Target',
      endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
      status: 'active',
      isEnabled: 1,
      secretRefName: 'upstream-sec-delete-me-22222222',
    });

    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: row.secret_ref_name!,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'delete-me',
      },
      stringData: { token: 'tok' },
    });

    const result = await adminService.deleteUpstream('delete-me', adminActor);
    assert.equal(result.slug, 'delete-me');

    // SQLite row deleted
    assert.equal(upstreamRepo.getUpstreamBySlug('delete-me'), null);

    // Kubernetes Secret deleted
    assert.equal(mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', row.secret_ref_name!), undefined);
  });

  test('deleteUpstream transitions to cleanup_required when Secret deletion fails', async () => {
    const row = upstreamRepo.insertUpstream({
      slug: 'stuck-secret',
      displayName: 'Stuck Secret Service',
      endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
      status: 'active',
      isEnabled: 1,
      secretRefName: 'upstream-sec-stuck-secret-33333333',
    });

    await mockK8sClient.createSecret('urumi-gateway-secrets', {
      name: row.secret_ref_name!,
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'stuck-secret',
      },
      stringData: { token: 'tok' },
    });

    // Inject K8s delete error
    mockK8sClient.failNext('deleteSecret', new Error('Kubernetes API timeout during DELETE'));

    await assert.rejects(
      async () => {
        await adminService.deleteUpstream('stuck-secret', adminActor);
      },
      (err: Error) => {
        assert.ok(err instanceof CleanupRequiredError);
        assert.ok(err.message.includes('cleanup_required'));
        return true;
      }
    );

    // Row MUST NOT be deleted from SQLite; marked as cleanup_required
    const stuckRow = upstreamRepo.getUpstreamBySlug('stuck-secret');
    assert.ok(stuckRow);
    assert.equal(stuckRow.status, 'cleanup_required');
    assert.ok(stuckRow.cleanup_error?.includes('Kubernetes API timeout'));

    // Retry cleanup
    const retryResult = await adminService.retryCleanup('stuck-secret', adminActor);
    assert.ok(retryResult.message.includes('Cleanup retry succeeded'));

    // Now row is completely deleted
    assert.equal(upstreamRepo.getUpstreamBySlug('stuck-secret'), null);
    assert.equal(mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', row.secret_ref_name!), undefined);
  });

  test('createUpstream without credentials creates active upstream with secretRefName: null', async () => {
    const mockDiscoverResult = {
      slug: 'no-secret-svc',
      tools: [
        {
          name: 'no-secret-svc__public_ping',
          originalName: 'public_ping',
          upstreamSlug: 'no-secret-svc',
          inputSchema: { type: 'object' },
        },
      ],
      discoveredAt: Date.now(),
    };

    upstreamManager.registerAndDiscover = async (row) => {
      catalogService.updateSnapshot([mockDiscoverResult], [
        {
          slug: row.slug,
          healthState: 'available',
          persistedStatus: 'active',
          isEnabled: true,
          toolCount: 1,
          lastCheckedAt: Date.now(),
        },
      ]);
      return mockDiscoverResult;
    };

    const res = await adminService.createUpstream(
      {
        slug: 'no-secret-svc',
        displayName: 'Public Unauthenticated Service',
        endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
      },
      adminActor
    );

    assert.equal(res.slug, 'no-secret-svc');
    assert.equal(res.status, 'active');
    assert.equal(res.secretRefName, null);

    // Assert zero K8s secrets created
    const secrets = mockK8sClient.getAllSecrets();
    const svcSecret = secrets.find((s) => s.labels['urumi.io/upstream-slug'] === 'no-secret-svc');
    assert.equal(svcSecret, undefined);

    const row = upstreamRepo.getUpstreamBySlug('no-secret-svc');
    assert.ok(row);
    assert.equal(row.secret_ref_name, null);
    assert.equal(row.status, 'active');
  });

  test('createUpstream with multi-key credentials map stores all keys in Kubernetes Secret', async () => {
    const mockDiscoverResult = {
      slug: 'multi-key-svc',
      tools: [],
      discoveredAt: Date.now(),
    };

    upstreamManager.registerAndDiscover = async () => mockDiscoverResult;

    const res = await adminService.createUpstream(
      {
        slug: 'multi-key-svc',
        displayName: 'Multi-Key Service',
        endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
        credentials: {
          consumerKey: 'ck_live_1234567890',
          consumerSecret: 'cs_live_0987654321',
        },
      },
      adminActor
    );

    assert.equal(res.slug, 'multi-key-svc');
    assert.ok(res.secretRefName);

    // Verify secret contents
    const storedSecret = mockK8sClient.getRawStoredSecret('urumi-gateway-secrets', res.secretRefName!);
    assert.ok(storedSecret);
    assert.equal(storedSecret.data['consumerKey'], 'ck_live_1234567890');
    assert.equal(storedSecret.data['consumerSecret'], 'cs_live_0987654321');
  });

  test('createUpstream halts immediately if Phase 1 audit fails (Fail Closed)', async () => {
    // Force auditRepo insertAuditStart to fail
    auditRepo.insertAuditStart = () => {
      throw new Error('Disk full on SQLite audit table');
    };

    await assert.rejects(
      async () => {
        await adminService.createUpstream(
          {
            slug: 'fail-audit-phase1',
            displayName: 'Phase 1 Audit Fail',
            endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
            credential: 'top-secret',
          },
          adminActor
        );
      },
      (err: Error) => {
        assert.ok(err.name === 'AuditStartError');
        assert.ok(err.message.includes('Disk full on SQLite audit table'));
        return true;
      }
    );

    // CRITICAL INVARIANT: Zero side effects permitted!
    // No SQLite upstream inserted
    assert.equal(upstreamRepo.getUpstreamBySlug('fail-audit-phase1'), null);
    // No K8s secret created
    const secrets = mockK8sClient.getAllSecrets();
    const svcSecret = secrets.find((s) => s.labels['urumi.io/upstream-slug'] === 'fail-audit-phase1');
    assert.equal(svcSecret, undefined);
    // Lock released
    assert.equal(adminService.getActiveLocks().has('fail-audit-phase1'), false);
  });

  test('createUpstream reports auditDegraded: true if Phase 2 audit finalization fails', async () => {
    upstreamManager.registerAndDiscover = async () => ({
      slug: 'phase2-degrade',
      tools: [],
      discoveredAt: Date.now(),
    });

    // Mock Phase 2 finalize to simulate DB write failure after side effect
    auditRepo.updateAuditFinalize = () => {
      throw new Error('SQLite write lock timeout during audit finalization');
    };

    const res = await adminService.createUpstream(
      {
        slug: 'phase2-degrade',
        displayName: 'Phase 2 Audit Degrade Service',
        endpointUrl: 'http://urumi-woocommerce-mcp:3000/mcp',
        credential: 'test-token',
      },
      adminActor
    );

    // Side effect succeeded, upstream is active, but auditDegraded is true
    assert.equal(res.status, 'active');
    assert.equal(res.auditDegraded, true);
  });
});
