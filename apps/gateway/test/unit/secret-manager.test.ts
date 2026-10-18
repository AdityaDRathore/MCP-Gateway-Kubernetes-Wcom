import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SecretManager } from '../../src/k8s/secret-manager.js';
import { DirectKubernetesSecretClient } from '../../src/k8s/secret-client.js';
import { MockKubernetesSecretClient } from '../helpers/mock-secret-client.js';

describe('Gate G7: Kubernetes Secret Manager Unit Tests', () => {
  let mockClient: MockKubernetesSecretClient;
  let secretManager: SecretManager;

  beforeEach(() => {
    mockClient = new MockKubernetesSecretClient();
    secretManager = new SecretManager(mockClient, {
      namespace: 'urumi-gateway-secrets',
    });
  });

  test('enforces namespace security boundary: rejects prohibited workload and cluster namespaces', () => {
    assert.throws(
      () => new SecretManager(mockClient, { namespace: 'urumi' }),
      /Security Boundary Violation/
    );
    assert.throws(
      () => new SecretManager(mockClient, { namespace: 'default' }),
      /Security Boundary Violation/
    );
    assert.throws(
      () => new SecretManager(mockClient, { namespace: 'kube-system' }),
      /Security Boundary Violation/
    );
    assert.throws(
      () => new SecretManager(mockClient, { namespace: 'INVALID_DNS!' }),
      /Invalid Kubernetes Secret namespace/
    );
  });

  test('generates deterministic, collision-resistant Secret names with 8-char SHA-256 hash', () => {
    const slug = 'test-service';
    const id1 = '00000000-0000-0000-0000-000000000001';
    const id2 = '00000000-0000-0000-0000-000000000002';

    const name1 = secretManager.generateSecretName(slug, id1);
    const name2 = secretManager.generateSecretName(slug, id2);
    const name1Repeat = secretManager.generateSecretName(slug, id1);

    assert.equal(name1, name1Repeat, 'Same slug and ID must produce identical secret name');
    assert.notEqual(name1, name2, 'Different IDs must produce different secret names');
    assert.match(name1, /^upstream-sec-test-service-[a-f0-9]{8}$/);
  });

  test('creates secret with required metadata labels and single token key without logging credentials', async () => {
    const slug = 'custom-crm';
    const secretName = secretManager.generateSecretName(slug, 'uuid-crm-1');
    const credential = 'super-secret-bearer-token-12345';

    await secretManager.createUpstreamSecret(slug, secretName, credential);

    const stored = mockClient.getRawStoredSecret('urumi-gateway-secrets', secretName);
    assert.ok(stored, 'Secret must be stored in mock client');
    assert.equal(stored.name, secretName);
    assert.equal(stored.namespace, 'urumi-gateway-secrets');
    assert.equal(stored.labels['app.kubernetes.io/managed-by'], 'urumi-gateway');
    assert.equal(stored.labels['app.kubernetes.io/name'], 'urumi-platform');
    assert.equal(stored.labels['urumi.io/upstream-slug'], slug);
    assert.equal(stored.data['token'], credential);

    // Verify metadata getter does not expose secret data
    const meta = await secretManager.getSecretMetadata(secretName);
    assert.ok(meta);
    assert.deepEqual(meta.dataKeys, ['token']);
    assert.equal((meta as any).data, undefined);
    assert.equal((meta as any).stringData, undefined);
  });

  test('creates multi-key credential secret matching custom authentication contracts', async () => {
    const slug = 'custom-woo';
    const secretName = secretManager.generateSecretName(slug, 'uuid-woo-custom');
    const credentials = {
      consumerKey: 'ck_1234567890abcdef',
      consumerSecret: 'cs_fedcba0987654321',
    };

    await secretManager.createUpstreamSecret(slug, secretName, credentials);

    const stored = mockClient.getRawStoredSecret('urumi-gateway-secrets', secretName);
    assert.ok(stored);
    assert.equal(stored.data['consumerKey'], credentials.consumerKey);
    assert.equal(stored.data['consumerSecret'], credentials.consumerSecret);

    const secretData = await secretManager.getSecretData(secretName);
    assert.deepEqual(secretData, credentials);
  });

  test('rotates credential on existing secret and updates resourceVersion', async () => {
    const slug = 'custom-tasks';
    const secretName = secretManager.generateSecretName(slug, 'uuid-tasks-1');
    const oldCredential = 'old-token';
    const newCredential = 'new-rotated-token';

    await secretManager.createUpstreamSecret(slug, secretName, oldCredential);
    const initialStored = mockClient.getRawStoredSecret('urumi-gateway-secrets', secretName);
    assert.equal(initialStored?.data['token'], oldCredential);
    const initialVersion = initialStored?.resourceVersion;

    await secretManager.updateUpstreamSecret(slug, secretName, newCredential);

    const updatedStored = mockClient.getRawStoredSecret('urumi-gateway-secrets', secretName);
    assert.equal(updatedStored?.data['token'], newCredential);
    assert.notEqual(updatedStored?.resourceVersion, initialVersion);
  });

  test('refuses to delete Secret if ownership labels do not match target upstream slug', async () => {
    // Secret belonging to slug A
    await mockClient.createSecret('urumi-gateway-secrets', {
      name: 'foreign-secret',
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'urumi-gateway',
        'urumi.io/upstream-slug': 'upstream-a',
      },
      stringData: { token: 'secret-a' },
    });

    // Attempt deletion specifying slug B
    await assert.rejects(
      async () => {
        await secretManager.deleteUpstreamSecret('upstream-b', 'foreign-secret');
      },
      {
        message: /Ownership validation failed/,
      }
    );

    // Verify secret was NOT deleted
    const stillExists = mockClient.getRawStoredSecret('urumi-gateway-secrets', 'foreign-secret');
    assert.ok(stillExists, 'Foreign secret must remain untouched');
  });

  test('refuses to delete Secret if managed-by label is not urumi-gateway', async () => {
    // Secret not managed by urumi-gateway (e.g. system or store secret)
    await mockClient.createSecret('urumi-gateway-secrets', {
      name: 'unmanaged-secret',
      namespace: 'urumi-gateway-secrets',
      labels: {
        'app.kubernetes.io/managed-by': 'helm',
        'urumi.io/upstream-slug': 'woocommerce',
      },
      stringData: { token: 'store-api' },
    });

    await assert.rejects(
      async () => {
        await secretManager.deleteUpstreamSecret('woocommerce', 'unmanaged-secret');
      },
      {
        message: /Ownership validation failed/,
      }
    );

    const stillExists = mockClient.getRawStoredSecret('urumi-gateway-secrets', 'unmanaged-secret');
    assert.ok(stillExists);
  });

  test('successfully deletes Secret when ownership matches', async () => {
    const slug = 'woocommerce';
    const secretName = secretManager.generateSecretName(slug, 'uuid-woo');
    await secretManager.createUpstreamSecret(slug, secretName, 'cred-123');

    const deleted = await secretManager.deleteUpstreamSecret(slug, secretName);
    assert.equal(deleted, true);

    const stored = mockClient.getRawStoredSecret('urumi-gateway-secrets', secretName);
    assert.equal(stored, undefined);
  });

  test('reconcileOrphans handles active in-flight, crashed provisioning, and 5-min grace period correctly', async () => {
    const now = 1700000000000;

    // 1. Secret referenced by active upstream
    const activeSecret = 'sec-active';
    await mockClient.createSecret('urumi-gateway-secrets', {
      name: activeSecret,
      namespace: 'urumi-gateway-secrets',
      labels: { 'app.kubernetes.io/managed-by': 'urumi-gateway', 'urumi.io/upstream-slug': 'active-svc' },
      stringData: { token: 't1' },
    });

    // 2. Secret in-flight provisioning (< 120s old)
    const inFlightSecret = 'sec-inflight';
    await mockClient.createSecret('urumi-gateway-secrets', {
      name: inFlightSecret,
      namespace: 'urumi-gateway-secrets',
      labels: { 'app.kubernetes.io/managed-by': 'urumi-gateway', 'urumi.io/upstream-slug': 'inflight-svc' },
      stringData: { token: 't2' },
    });

    // 3. Secret crashed provisioning (>= 120s old)
    const crashedSecret = 'sec-crashed';
    await mockClient.createSecret('urumi-gateway-secrets', {
      name: crashedSecret,
      namespace: 'urumi-gateway-secrets',
      labels: { 'app.kubernetes.io/managed-by': 'urumi-gateway', 'urumi.io/upstream-slug': 'crashed-svc' },
      stringData: { token: 't3' },
    });

    // 4. Unreferenced orphan within 5-min grace period (created 100s ago)
    const freshOrphan = 'sec-fresh-orphan';
    await mockClient.createSecret('urumi-gateway-secrets', {
      name: freshOrphan,
      namespace: 'urumi-gateway-secrets',
      labels: { 'app.kubernetes.io/managed-by': 'urumi-gateway', 'urumi.io/upstream-slug': 'orphan-a' },
      stringData: { token: 't4' },
    });
    mockClient.setSecretCreationTimestamp('urumi-gateway-secrets', freshOrphan, now - 100_000);

    // 5. Unreferenced orphan exceeding 5-min grace period (created 400s ago)
    const oldOrphan = 'sec-old-orphan';
    await mockClient.createSecret('urumi-gateway-secrets', {
      name: oldOrphan,
      namespace: 'urumi-gateway-secrets',
      labels: { 'app.kubernetes.io/managed-by': 'urumi-gateway', 'urumi.io/upstream-slug': 'orphan-b' },
      stringData: { token: 't5' },
    });
    mockClient.setSecretCreationTimestamp('urumi-gateway-secrets', oldOrphan, now - 400_000);

    const reconcileResult = await secretManager.reconcileOrphans({
      referencedSecretNames: new Set([activeSecret]),
      activeRegistrationSlugs: new Set(['active-lock-svc']),
      staleProvisioningMap: new Map([
        [inFlightSecret, { createdAt: Math.floor((now - 30_000) / 1000), slug: 'inflight-svc' }], // 30s old
        [crashedSecret, { createdAt: Math.floor((now - 150_000) / 1000), slug: 'crashed-svc' }],   // 150s old
      ]),
      nowMs: now,
    });

    assert.deepEqual(reconcileResult.retainedInFlight, [inFlightSecret]);
    assert.deepEqual(reconcileResult.deletedCrashedProvisioning, [crashedSecret]);
    assert.deepEqual(reconcileResult.retainedGracePeriod, [freshOrphan]);
    assert.deepEqual(reconcileResult.deletedOrphans, [oldOrphan]);

    // Check states in mock client
    assert.ok(mockClient.getRawStoredSecret('urumi-gateway-secrets', activeSecret), 'Active secret retained');
    assert.ok(mockClient.getRawStoredSecret('urumi-gateway-secrets', inFlightSecret), 'In-flight provisioning retained');
    assert.equal(mockClient.getRawStoredSecret('urumi-gateway-secrets', crashedSecret), undefined, 'Crashed provisioning deleted');
    assert.ok(mockClient.getRawStoredSecret('urumi-gateway-secrets', freshOrphan), 'Fresh orphan retained in grace period');
    assert.equal(mockClient.getRawStoredSecret('urumi-gateway-secrets', oldOrphan), undefined, 'Old orphan deleted');
  });

  test('sanitizes errors and hides sensitive token substrings', async () => {
    mockClient.failNext(
      'createSecret',
      new Error('API failure: token=super-secret-bearer-12345 could not be parsed')
    );

    await assert.rejects(
      async () => {
        await secretManager.createUpstreamSecret('demo', 'sec-demo', 'super-secret-bearer-12345');
      },
      (err: Error) => {
        assert.ok(!err.message.includes('super-secret-bearer-12345'));
        assert.ok(err.message.includes('[REDACTED]'));
        return true;
      }
    );
  });

  test('DirectKubernetesSecretClient rejects plain HTTP, userinfo, metadata, and production insecureSkipTlsVerify', () => {
    // 1. Plain HTTP rejected
    assert.throws(
      () => new DirectKubernetesSecretClient({ apiUrl: 'http://kubernetes.default.svc:80' }),
      /Kubernetes API URL must use HTTPS protocol/
    );

    // 2. Embedded userinfo credentials rejected
    assert.throws(
      () => new DirectKubernetesSecretClient({ apiUrl: 'https://admin:pass@kubernetes.default.svc:443' }),
      /must not contain embedded userinfo credentials/
    );

    // 3. Prohibited cloud metadata destination rejected
    assert.throws(
      () => new DirectKubernetesSecretClient({ apiUrl: 'https://169.254.169.254:443' }),
      /destination "169.254.169.254" is prohibited/
    );

    // 4. Query parameters or fragments rejected
    assert.throws(
      () => new DirectKubernetesSecretClient({ apiUrl: 'https://kubernetes.default.svc:443?token=leak' }),
      /must not contain query parameters or fragments/
    );

    // 5. Insecure TLS skip rejected in production mode
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      assert.throws(
        () =>
          new DirectKubernetesSecretClient({
            apiUrl: 'https://kubernetes.default.svc:443',
            insecureSkipTlsVerify: true,
          }),
        /insecureSkipTlsVerify is strictly prohibited in production mode/
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
