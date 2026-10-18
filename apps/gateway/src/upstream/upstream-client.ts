import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResult,
  CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  UpstreamHealthState,
  DiscoveredToolsResult,
  UpstreamConnectionError,
  UpstreamTimeoutError,
  UpstreamProtocolError,
  UpstreamDisabledError,
} from './types.js';
import { validateAndNormalizeUpstreamUrl } from './url-validator.js';
import { validateUpstreamToolList } from './tool-validator.js';
import { logger } from '../logging/logger.js';

export interface ManagedClientConfig {
  slug: string;
  endpointUrl: string;
  timeoutMs: number;
  isEnabled: boolean;
  allowLocalhostForTesting?: boolean;
  secretRefName?: string | null;
  secretRefKey?: string | null;
  credentialsResolver?: (secretName: string) => Promise<Record<string, string> | null>;
}

/**
 * Manages the connection lifecycle and tool discovery for a single upstream MCP service.
 * Enforces unified single-flight discovery, atomic availability transition,
 * classified error reporting, and leak-free resource teardown.
 */
export class ManagedUpstreamClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private healthState: UpstreamHealthState;
  private lastError: string | null = null;
  private lastCheckedAt = 0;
  private refreshPromise: Promise<DiscoveredToolsResult> | null = null;

  constructor(private readonly config: ManagedClientConfig) {
    this.healthState = config.isEnabled ? 'connecting' : 'disabled';
  }

  getSlug(): string {
    return this.config.slug;
  }

  getHealthState(): UpstreamHealthState {
    return this.healthState;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getLastCheckedAt(): number {
    return this.lastCheckedAt;
  }

  isEnabled(): boolean {
    return this.config.isEnabled;
  }

  getClient(): Client | null {
    return this.client;
  }

  getTimeoutMs(): number {
    return Math.max(500, Math.min(30000, this.config.timeoutMs || 10000));
  }

  /**
   * Ensures transport connection is established to the upstream service.
   * If a Secret is referenced, resolves credentials and configures authentication headers.
   * Never downgrades authentication or falls back to unauthenticated requests when credentials fail.
   */
  async ensureConnected(signal?: AbortSignal): Promise<Client> {
    if (this.client && this.transport) {
      return this.client;
    }

    const validated = validateAndNormalizeUpstreamUrl(this.config.endpointUrl, {
      allowLocalhostForTesting: this.config.allowLocalhostForTesting,
    });

    let headers: Record<string, string> | undefined;

    if (this.config.secretRefName) {
      if (!this.config.credentialsResolver) {
        throw new UpstreamConnectionError(
          `Upstream service '${this.config.slug}' requires Kubernetes Secret '${this.config.secretRefName}', but no credentials resolver is configured`
        );
      }

      const secretData = await this.config.credentialsResolver(this.config.secretRefName);
      if (!secretData || Object.keys(secretData).length === 0) {
        throw new UpstreamConnectionError(
          `Upstream service '${this.config.slug}' requires Kubernetes Secret '${this.config.secretRefName}', but Secret was not found or is empty in Kubernetes`
        );
      }

      headers = {};
      const targetKey = this.config.secretRefKey || 'token';

      if (secretData[targetKey]) {
        if (targetKey.toLowerCase().includes('token') || targetKey.toLowerCase().includes('bearer')) {
          headers['Authorization'] = `Bearer ${secretData[targetKey]}`;
        } else if (targetKey.toLowerCase().includes('api') || targetKey.toLowerCase().includes('key')) {
          headers['X-API-Key'] = secretData[targetKey];
        } else {
          headers[targetKey] = secretData[targetKey];
        }
      } else if (secretData['token']) {
        headers['Authorization'] = `Bearer ${secretData['token']}`;
      } else if (secretData['apiKey'] || secretData['api_key']) {
        headers['X-API-Key'] = secretData['apiKey'] || secretData['api_key'];
      } else {
        for (const [k, v] of Object.entries(secretData)) {
          headers[k] = v;
        }
      }
    }

    await this.close();
    this.transport = new StreamableHTTPClientTransport(
      new URL(validated.normalizedFqdnUrl),
      headers ? { requestInit: { headers } } : undefined
    );
    this.client = new Client(
      { name: 'urumi-gateway-upstream-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await this.client.connect(this.transport, { signal });
    return this.client;
  }

  /**
   * Executes a tool invocation against the managed upstream MCP client.
   * Ensures transport connectivity, passes request signal for granular cancellation,
   * classifies errors, and returns the truthful CallToolResult.
   */
  async callTool(
    originalName: string,
    args?: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<CallToolResult> {
    if (!this.config.isEnabled) {
      throw new UpstreamDisabledError(`Upstream service '${this.config.slug}' is disabled`);
    }

    try {
      const client = await this.ensureConnected(options?.signal);

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: originalName,
            arguments: args,
          },
        },
        CallToolResultSchema,
        { signal: options?.signal }
      );

      return result;
    } catch (err: unknown) {
      const classified = this.classifyError(err);
      throw classified;
    }
  }

  /**
   * Executes unified connection establishment and tool discovery.
   * Single-flight: concurrent calls return the identical in-flight promise.
   * Transitions to 'available' ONLY when tools/list succeeds and passes validation.
   */
  discoverTools(): Promise<DiscoveredToolsResult> {
    if (!this.config.isEnabled) {
      this.healthState = 'disabled';
      return Promise.resolve({
        slug: this.config.slug,
        tools: [],
        discoveredAt: Date.now(),
      });
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async (): Promise<DiscoveredToolsResult> => {
      this.healthState = 'connecting';
      const abortController = new AbortController();
      const timeoutMs = this.getTimeoutMs();
      const timeoutTimer = setTimeout(() => {
        abortController.abort(
          new UpstreamTimeoutError(
            `Discovery timed out after ${timeoutMs}ms waiting for upstream "${this.config.slug}"`
          )
        );
      }, timeoutMs);

      try {
        // Step 1: Establish connection if not already connected
        const client = await this.ensureConnected(abortController.signal);

        // Step 2: Discover tools via protocol-level tools/list
        const listResult = await client.listTools(undefined, {
          signal: abortController.signal,
        });

        // Step 4: Validate tool metadata, schemas, bounds, and no remote $ref
        const validatedTools = validateUpstreamToolList(this.config.slug, listResult.tools);

        // Step 5: Transition to 'available' only on successful completion
        this.healthState = 'available';
        this.lastError = null;
        this.lastCheckedAt = Date.now();

        logger.debug('Successfully discovered tools from upstream', {
          slug: this.config.slug,
          toolCount: validatedTools.length,
          durationMs: Date.now() - this.lastCheckedAt,
        });

        return {
          slug: this.config.slug,
          tools: validatedTools,
          discoveredAt: this.lastCheckedAt,
        };
      } catch (err: unknown) {
        this.healthState = 'unavailable';
        this.lastCheckedAt = Date.now();

        const classified = this.classifyError(err);
        this.lastError = classified.message;

        logger.warn('Failed to discover tools from upstream', {
          slug: this.config.slug,
          error: classified.message,
          errorCode: (classified as any).code || 'UPSTREAM_DISCOVERY_FAILED',
        });

        // Immediately tear down socket and client resources on failure
        await this.close();
        throw classified;
      } finally {
        clearTimeout(timeoutTimer);
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Cleanly closes underlying client, transport, and resets connection state.
   */
  async close(): Promise<void> {
    const transportToClose = this.transport;
    const clientToClose = this.client;

    this.transport = null;
    this.client = null;

    if (transportToClose) {
      try {
        await transportToClose.close();
      } catch (err: unknown) {
        logger.debug('Error closing upstream transport during teardown', {
          slug: this.config.slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (clientToClose) {
      try {
        await clientToClose.close();
      } catch (err: unknown) {
        logger.debug('Error closing upstream client during teardown', {
          slug: this.config.slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Classifies and redacts errors encountered during connection or tool discovery.
   */
  private classifyError(err: unknown): Error {
    if (err instanceof UpstreamTimeoutError) {
      return err;
    }

    const message = err instanceof Error ? err.message : String(err);

    // Sanitize message from credentials, Bearer tokens, passwords
    const sanitized = message
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/(?:key|token|secret|password)=[^&\s]+/gi, '$1=[REDACTED]');

    if (
      message.includes('ECONNREFUSED') ||
      message.includes('EHOSTUNREACH') ||
      message.includes('ENOTFOUND') ||
      message.includes('fetch failed')
    ) {
      return new UpstreamConnectionError(
        `Upstream service '${this.config.slug}' is currently unreachable: ${sanitized}`
      );
    }

    if (message.includes('aborted') || message.includes('AbortError') || message.includes('timed out')) {
      return new UpstreamTimeoutError(
        `Operation timed out communicating with upstream service '${this.config.slug}': ${sanitized}`
      );
    }

    return new UpstreamProtocolError(
      `Protocol error communicating with upstream service '${this.config.slug}': ${sanitized}`
    );
  }
}
