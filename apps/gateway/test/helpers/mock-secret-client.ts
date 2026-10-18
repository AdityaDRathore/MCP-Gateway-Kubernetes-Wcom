import {
  IKubernetesSecretClient,
  K8sSecretMetadata,
  K8sSecretPayload,
  KubernetesApiError,
} from '../../src/k8s/secret-client.js';

interface StoredSecret {
  name: string;
  namespace: string;
  labels: Record<string, string>;
  data: Record<string, string>;
  creationTimestamp: number;
  resourceVersion: string;
}

export class MockKubernetesSecretClient implements IKubernetesSecretClient {
  private secrets = new Map<string, StoredSecret>();
  private versionCounter = 1;
  private pendingFailures = new Map<string, Error>();
  private delayMs = 0;

  private makeKey(namespace: string, name: string): string {
    return `${namespace}/${name}`;
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  failNext(method: string, error: Error): void {
    this.pendingFailures.set(method, error);
  }

  private checkFailure(method: string): void {
    const err = this.pendingFailures.get(method);
    if (err) {
      this.pendingFailures.delete(method);
      throw err;
    }
  }

  private async maybeDelay(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  reset(): void {
    this.secrets.clear();
    this.versionCounter = 1;
    this.pendingFailures.clear();
    this.delayMs = 0;
  }

  setSecretCreationTimestamp(namespace: string, name: string, timestamp: number): void {
    const key = this.makeKey(namespace, name);
    const existing = this.secrets.get(key);
    if (existing) {
      existing.creationTimestamp = timestamp;
    }
  }

  getRawStoredSecret(namespace: string, name: string): StoredSecret | undefined {
    return this.secrets.get(this.makeKey(namespace, name));
  }

  getAllSecrets(): StoredSecret[] {
    return Array.from(this.secrets.values());
  }

  async createSecret(namespace: string, payload: K8sSecretPayload): Promise<void> {
    await this.maybeDelay();
    this.checkFailure('createSecret');

    const key = this.makeKey(namespace, payload.name);
    if (this.secrets.has(key)) {
      throw new KubernetesApiError(
        `Secret "${payload.name}" already exists in namespace "${namespace}"`,
        409,
        'AlreadyExists'
      );
    }

    const data: Record<string, string> = {};
    if (payload.stringData) {
      Object.assign(data, payload.stringData);
    }
    if (payload.data) {
      for (const [k, v] of Object.entries(payload.data)) {
        data[k] = Buffer.from(v, 'base64').toString('utf8');
      }
    }

    const stored: StoredSecret = {
      name: payload.name,
      namespace,
      labels: { ...(payload.labels || {}) },
      data,
      creationTimestamp: Date.now(),
      resourceVersion: String(this.versionCounter++),
    };

    this.secrets.set(key, stored);
  }

  async getSecret(namespace: string, name: string): Promise<K8sSecretMetadata | null> {
    await this.maybeDelay();
    this.checkFailure('getSecret');

    const key = this.makeKey(namespace, name);
    const stored = this.secrets.get(key);
    if (!stored) {
      return null;
    }

    return {
      name: stored.name,
      namespace: stored.namespace,
      labels: { ...stored.labels },
      dataKeys: Object.keys(stored.data),
      creationTimestamp: stored.creationTimestamp,
      resourceVersion: stored.resourceVersion,
    };
  }

  async getSecretData(namespace: string, name: string): Promise<Record<string, string> | null> {
    await this.maybeDelay();
    this.checkFailure('getSecretData');

    const key = this.makeKey(namespace, name);
    const stored = this.secrets.get(key);
    if (!stored) {
      return null;
    }

    return { ...stored.data };
  }

  async updateSecret(namespace: string, payload: K8sSecretPayload): Promise<void> {
    await this.maybeDelay();
    this.checkFailure('updateSecret');

    const key = this.makeKey(namespace, payload.name);
    const existing = this.secrets.get(key);
    if (!existing) {
      throw new KubernetesApiError(
        `Secret "${payload.name}" not found in namespace "${namespace}"`,
        404,
        'NotFound'
      );
    }

    if (payload.resourceVersion && payload.resourceVersion !== existing.resourceVersion) {
      throw new KubernetesApiError(
        `Conflict: Resource version mismatch on Secret "${payload.name}"`,
        409,
        'Conflict'
      );
    }

    const data: Record<string, string> = { ...existing.data };
    if (payload.stringData) {
      Object.assign(data, payload.stringData);
    }
    if (payload.data) {
      for (const [k, v] of Object.entries(payload.data)) {
        data[k] = Buffer.from(v, 'base64').toString('utf8');
      }
    }

    existing.labels = { ...(payload.labels || existing.labels) };
    existing.data = data;
    existing.resourceVersion = String(this.versionCounter++);
  }

  async deleteSecret(namespace: string, name: string): Promise<boolean> {
    await this.maybeDelay();
    this.checkFailure('deleteSecret');

    const key = this.makeKey(namespace, name);
    if (!this.secrets.has(key)) {
      return false;
    }

    this.secrets.delete(key);
    return true;
  }

  async listSecrets(namespace: string, labelSelector?: string): Promise<K8sSecretMetadata[]> {
    await this.maybeDelay();
    this.checkFailure('listSecrets');

    const result: K8sSecretMetadata[] = [];
    let requiredLabels: Record<string, string> = {};

    if (labelSelector) {
      // Parse key=val pairs
      const pairs = labelSelector.split(',');
      for (const p of pairs) {
        const [k, v] = p.split('=').map((s) => s.trim());
        if (k && v) {
          requiredLabels[k] = v;
        }
      }
    }

    for (const stored of this.secrets.values()) {
      if (stored.namespace !== namespace) {
        continue;
      }

      let matches = true;
      for (const [rk, rv] of Object.entries(requiredLabels)) {
        if (stored.labels[rk] !== rv) {
          matches = false;
          break;
        }
      }

      if (matches) {
        result.push({
          name: stored.name,
          namespace: stored.namespace,
          labels: { ...stored.labels },
          dataKeys: Object.keys(stored.data),
          creationTimestamp: stored.creationTimestamp,
          resourceVersion: stored.resourceVersion,
        });
      }
    }

    return result;
  }
}
