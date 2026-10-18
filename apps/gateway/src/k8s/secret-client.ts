import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { logger } from '../logging/logger.js';

export interface K8sSecretMetadata {
  name: string;
  namespace: string;
  labels: Record<string, string>;
  dataKeys: string[];
  creationTimestamp?: number; // epoch ms
  resourceVersion?: string;
}

export interface K8sSecretPayload {
  name: string;
  namespace: string;
  labels?: Record<string, string>;
  stringData?: Record<string, string>;
  data?: Record<string, string>;
  resourceVersion?: string;
}

export class KubernetesApiError extends Error {
  public readonly statusCode: number;
  public readonly reason: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, statusCode = 500, reason = 'InternalError', details?: Record<string, unknown>) {
    super(message);
    this.name = 'KubernetesApiError';
    this.statusCode = statusCode;
    this.reason = reason;
    this.details = details;
  }
}

export class KubernetesNotFoundError extends KubernetesApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 404, 'NotFound', details);
    this.name = 'KubernetesNotFoundError';
  }
}

export class KubernetesConflictError extends KubernetesApiError {
  constructor(message: string, reason = 'Conflict', details?: Record<string, unknown>) {
    super(message, 409, reason, details);
    this.name = 'KubernetesConflictError';
  }
}

export class KubernetesAuthError extends KubernetesApiError {
  constructor(message: string, statusCode = 401, reason = 'Unauthorized', details?: Record<string, unknown>) {
    super(message, statusCode, reason, details);
    this.name = 'KubernetesAuthError';
  }
}

export class KubernetesTimeoutError extends KubernetesApiError {
  constructor(message: string) {
    super(message, 504, 'Timeout');
    this.name = 'KubernetesTimeoutError';
  }
}

export interface IKubernetesSecretClient {
  createSecret(namespace: string, payload: K8sSecretPayload): Promise<void>;
  getSecret(namespace: string, name: string): Promise<K8sSecretMetadata | null>;
  getSecretData(namespace: string, name: string): Promise<Record<string, string> | null>;
  updateSecret(namespace: string, payload: K8sSecretPayload): Promise<void>;
  deleteSecret(namespace: string, name: string): Promise<boolean>;
  listSecrets(namespace: string, labelSelector?: string): Promise<K8sSecretMetadata[]>;
}

export interface DirectKubernetesClientOptions {
  apiUrl?: string;
  token?: string;
  tokenPath?: string;
  caCertPath?: string;
  insecureSkipTlsVerify?: boolean;
  requestTimeoutMs?: number;
}

/**
 * Direct Kubernetes Secret Client communicating with the K8s API server using in-cluster ServiceAccount credentials.
 * Implements strict TLS verification, dynamic token reading, request timeouts, K8s Status object parsing,
 * and optimistic concurrency conflict handling.
 */
export class DirectKubernetesSecretClient implements IKubernetesSecretClient {
  private readonly apiUrl: string;
  private readonly tokenPath: string;
  private readonly caCertPath: string;
  private readonly insecureSkipTlsVerify: boolean;
  private readonly requestTimeoutMs: number;
  private explicitToken?: string;
  private httpsAgent?: https.Agent;

  constructor(options: DirectKubernetesClientOptions = {}) {
    const envHost = process.env.KUBERNETES_SERVICE_HOST;
    const envPort = process.env.KUBERNETES_SERVICE_PORT;
    const defaultHost = envHost && envPort ? `https://${envHost}:${envPort}` : 'https://kubernetes.default.svc';

    this.apiUrl = (options.apiUrl || defaultHost).replace(/\/+$/, '');
    this.tokenPath = options.tokenPath || '/var/run/secrets/kubernetes.io/serviceaccount/token';
    this.caCertPath = options.caCertPath || '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
    this.insecureSkipTlsVerify = Boolean(options.insecureSkipTlsVerify);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10000;
    this.explicitToken = options.token;

    if (this.apiUrl.startsWith('https://')) {
      let ca: Buffer | undefined;
      if (fs.existsSync(this.caCertPath)) {
        try {
          ca = fs.readFileSync(this.caCertPath);
        } catch (err: unknown) {
          logger.warn('Could not read Kubernetes CA certificate; falling back to system CAs', {
            caCertPath: this.caCertPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      this.httpsAgent = new https.Agent({
        ca,
        rejectUnauthorized: !this.insecureSkipTlsVerify,
        keepAlive: true,
      });
    }
  }

  private getToken(): string {
    if (this.explicitToken) {
      return this.explicitToken;
    }
    if (fs.existsSync(this.tokenPath)) {
      try {
        return fs.readFileSync(this.tokenPath, 'utf8').trim();
      } catch (err: unknown) {
        throw new KubernetesAuthError(
          `Failed to read Kubernetes serviceaccount token from ${this.tokenPath}: ${err instanceof Error ? err.message : String(err)}`,
          401,
          'Unauthorized'
        );
      }
    }
    throw new KubernetesAuthError(
      'Kubernetes serviceaccount token not found. Running outside cluster without explicit token.',
      401,
      'Unauthorized'
    );
  }

  private sanitize(message: string): string {
    return message
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/(?:key|token|secret|password)=[^&\s]+/gi, '$1=[REDACTED]');
  }

  private async request(
    path: string,
    method = 'GET',
    body?: unknown
  ): Promise<{ status: number; body: any }> {
    const token = this.getToken();
    const parsedUrl = new URL(`${this.apiUrl}${path}`);
    const isHttps = parsedUrl.protocol === 'https:';

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };

    let payloadBuffer: Buffer | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payloadBuffer = Buffer.from(JSON.stringify(body), 'utf8');
      headers['Content-Length'] = String(payloadBuffer.length);
    }

    const requestOptions: https.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method,
      headers,
      agent: isHttps ? this.httpsAgent : undefined,
      timeout: this.requestTimeoutMs,
    };

    const clientModule = isHttps ? https : http;

    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = clientModule.request(requestOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf8');
          let parsedBody: any = null;
          if (rawText.length > 0) {
            try {
              parsedBody = JSON.parse(rawText);
            } catch {
              parsedBody = rawText;
            }
          }

          const status = res.statusCode ?? 500;
          if (status >= 200 && status < 300) {
            resolve({ status, body: parsedBody });
            return;
          }

          // Parse standard Kubernetes Status object
          const reason = parsedBody?.reason || res.statusMessage || 'Error';
          const details = parsedBody?.details;
          const k8sMessage = parsedBody?.message || `HTTP ${status} (${reason})`;
          const sanitizedMessage = this.sanitize(
            `Kubernetes API request failed: ${method} ${parsedUrl.pathname} returned HTTP ${status}: ${k8sMessage}`
          );

          if (status === 404) {
            reject(new KubernetesNotFoundError(sanitizedMessage, details));
          } else if (status === 409) {
            reject(new KubernetesConflictError(sanitizedMessage, reason, details));
          } else if (status === 401 || status === 403) {
            reject(new KubernetesAuthError(sanitizedMessage, status, reason, details));
          } else {
            reject(new KubernetesApiError(sanitizedMessage, status, reason, details));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(
          new KubernetesTimeoutError(
            `Kubernetes API request timed out after ${this.requestTimeoutMs}ms: ${method} ${parsedUrl.pathname}`
          )
        );
      });

      req.on('error', (err: Error) => {
        const sanitized = this.sanitize(err.message);
        reject(new KubernetesApiError(`Kubernetes API connection error: ${sanitized}`, 502, 'BadGateway'));
      });

      if (payloadBuffer) {
        req.write(payloadBuffer);
      }
      req.end();
    });
  }

  async createSecret(namespace: string, payload: K8sSecretPayload): Promise<void> {
    const k8sPayload = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: payload.name,
        namespace,
        labels: payload.labels || {},
      },
      type: 'Opaque',
      stringData: payload.stringData,
      data: payload.data,
    };

    await this.request(`/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`, 'POST', k8sPayload);
  }

  async getSecret(namespace: string, name: string): Promise<K8sSecretMetadata | null> {
    try {
      const { body } = await this.request(
        `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`
      );

      const dataKeys = Object.keys(body.data || body.stringData || {});
      const creationTimestamp = body.metadata?.creationTimestamp
        ? new Date(body.metadata.creationTimestamp).getTime()
        : undefined;

      return {
        name: body.metadata?.name ?? name,
        namespace: body.metadata?.namespace ?? namespace,
        labels: body.metadata?.labels ?? {},
        dataKeys,
        creationTimestamp,
        resourceVersion: body.metadata?.resourceVersion,
      };
    } catch (err: unknown) {
      if (err instanceof KubernetesNotFoundError || (err instanceof KubernetesApiError && err.statusCode === 404)) {
        return null;
      }
      throw err;
    }
  }

  async getSecretData(namespace: string, name: string): Promise<Record<string, string> | null> {
    try {
      const { body } = await this.request(
        `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`
      );

      const result: Record<string, string> = {};
      if (body.data) {
        for (const [k, v] of Object.entries(body.data as Record<string, string>)) {
          result[k] = Buffer.from(v, 'base64').toString('utf8');
        }
      }
      if (body.stringData) {
        for (const [k, v] of Object.entries(body.stringData as Record<string, string>)) {
          result[k] = v;
        }
      }

      return result;
    } catch (err: unknown) {
      if (err instanceof KubernetesNotFoundError || (err instanceof KubernetesApiError && err.statusCode === 404)) {
        return null;
      }
      throw err;
    }
  }

  async updateSecret(namespace: string, payload: K8sSecretPayload): Promise<void> {
    const k8sPayload = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: payload.name,
        namespace,
        labels: payload.labels || {},
        resourceVersion: payload.resourceVersion,
      },
      type: 'Opaque',
      stringData: payload.stringData,
      data: payload.data,
    };

    await this.request(
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(payload.name)}`,
      'PUT',
      k8sPayload
    );
  }

  async deleteSecret(namespace: string, name: string): Promise<boolean> {
    try {
      await this.request(
        `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`,
        'DELETE'
      );
      return true;
    } catch (err: unknown) {
      if (err instanceof KubernetesNotFoundError || (err instanceof KubernetesApiError && err.statusCode === 404)) {
        return false;
      }
      throw err;
    }
  }

  async listSecrets(namespace: string, labelSelector?: string): Promise<K8sSecretMetadata[]> {
    let query = '';
    if (labelSelector) {
      query = `?labelSelector=${encodeURIComponent(labelSelector)}`;
    }
    const { body } = await this.request(
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets${query}`
    );

    const items = Array.isArray(body?.items) ? body.items : [];
    return items.map((item: any) => {
      const dataKeys = Object.keys(item.data || item.stringData || {});
      const creationTimestamp = item.metadata?.creationTimestamp
        ? new Date(item.metadata.creationTimestamp).getTime()
        : undefined;

      return {
        name: item.metadata?.name,
        namespace: item.metadata?.namespace ?? namespace,
        labels: item.metadata?.labels ?? {},
        dataKeys,
        creationTimestamp,
        resourceVersion: item.metadata?.resourceVersion,
      };
    });
  }
}
