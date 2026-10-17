import { UpstreamRepository, UpstreamRow } from '../db/upstream-repo.js';
import { CatalogService } from './catalog-service.js';
import { ManagedUpstreamClient } from './upstream-client.js';
import {
  CatalogSnapshot,
  UpstreamStatusSummary,
  DiscoveredToolsResult,
} from './types.js';
import { logger } from '../logging/logger.js';

export interface UpstreamManagerOptions {
  allowLocalhostForTesting?: boolean;
}

/**
 * Coordinates upstream client instances, SQLite upstream definitions,
 * concurrent tool discovery, and dynamic catalog snapshotting.
 */
export class UpstreamManager {
  private readonly clients = new Map<string, ManagedUpstreamClient>();

  constructor(
    private readonly upstreamRepo: UpstreamRepository,
    private readonly catalogService: CatalogService,
    private readonly options: UpstreamManagerOptions = {}
  ) {}

  getCatalogService(): CatalogService {
    return this.catalogService;
  }

  getSnapshot(): CatalogSnapshot {
    return this.catalogService.getSnapshot();
  }

  getClient(slug: string): ManagedUpstreamClient | undefined {
    return this.clients.get(slug);
  }

  getAllClients(): ManagedUpstreamClient[] {
    return Array.from(this.clients.values());
  }

  getUpstreamStatuses(): UpstreamStatusSummary[] {
    const statuses: UpstreamStatusSummary[] = [];
    const rows = this.upstreamRepo.getAllUpstreams();
    const rowMap = new Map(rows.map((r) => [r.slug, r]));

    for (const [slug, client] of this.clients) {
      const row = rowMap.get(slug);
      statuses.push({
        slug,
        healthState: client.getHealthState(),
        persistedStatus: row?.status ?? 'active',
        isEnabled: client.isEnabled(),
        toolCount: 0,
        lastCheckedAt: client.getLastCheckedAt(),
        lastError: client.getLastError() ?? undefined,
      });
    }

    return statuses;
  }

  getUpstreamStatus(slug: string): UpstreamStatusSummary | undefined {
    return this.getUpstreamStatuses().find((s) => s.slug === slug);
  }

  async refreshUpstream(slug: string): Promise<CatalogSnapshot> {
    const client = this.clients.get(slug);
    if (!client) {
      throw new Error(`Upstream '${slug}' is not registered`);
    }

    try {
      await client.discoverTools();
    } catch {
      // Error is tracked in client state
    }

    return this.refreshAll();
  }

  /**
   * Initializes the manager:
   * 1. Seeds default upstreams in SQLite.
   * 2. Instantiates managed clients for all configured upstreams.
   * 3. Triggers initial catalog discovery.
   */
  async initialize(): Promise<void> {
    // 1. Idempotently seed default upstreams
    const seedResult = this.upstreamRepo.seedDefaults();
    logger.debug('Seeded default upstreams', seedResult);

    // 2. Synchronize managed clients from SQLite rows
    this.syncClientsWithRepository();

    // 3. Compile initial catalog snapshot
    await this.refreshAll();
  }

  /**
   * Synchronizes managed client instances with current upstream rows in the repository.
   */
  syncClientsWithRepository(): void {
    const rows = this.upstreamRepo.getAllUpstreams();
    for (const row of rows) {
      if (!this.clients.has(row.slug)) {
        this.registerClientFromRow(row);
      }
    }
  }

  /**
   * Discovers tools from all enabled upstreams concurrently with partial failure isolation.
   * Updates the atomic catalog snapshot.
   */
  async refreshAll(): Promise<CatalogSnapshot> {
    this.syncClientsWithRepository();
    const rows = this.upstreamRepo.getAllUpstreams();
    const rowMap = new Map(rows.map((r) => [r.slug, r]));

    const clientEntries = Array.from(this.clients.entries());
    const discoveryPromises = clientEntries.map(async ([slug, client]) => {
      try {
        const result = await client.discoverTools();
        return { slug, result, error: null };
      } catch (err: unknown) {
        return {
          slug,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const settled = await Promise.all(discoveryPromises);

    const discoveredResults: DiscoveredToolsResult[] = [];
    const statuses: UpstreamStatusSummary[] = [];

    for (const item of settled) {
      const client = this.clients.get(item.slug)!;
      const row = rowMap.get(item.slug);

      if (item.result) {
        discoveredResults.push(item.result);
      }

      statuses.push({
        slug: item.slug,
        healthState: client.getHealthState(),
        persistedStatus: row?.status ?? 'active',
        isEnabled: client.isEnabled(),
        toolCount: item.result ? item.result.tools.length : 0,
        lastCheckedAt: client.getLastCheckedAt(),
        lastError: item.error ?? client.getLastError() ?? undefined,
      });
    }

    try {
      this.catalogService.updateSnapshot(discoveredResults, statuses);
    } catch (err: unknown) {
      logger.error('Failed to update catalog snapshot; preserving previous snapshot', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return this.catalogService.getSnapshot();
  }

  private registerClientFromRow(row: UpstreamRow): ManagedUpstreamClient {
    const isEnabled = Boolean(row.is_enabled === 1 && row.status === 'active');
    const client = new ManagedUpstreamClient({
      slug: row.slug,
      endpointUrl: row.endpoint_url,
      timeoutMs: row.timeout_ms,
      isEnabled,
      allowLocalhostForTesting: this.options.allowLocalhostForTesting,
    });

    this.clients.set(row.slug, client);
    return client;
  }

  /**
   * Gracefully tears down all managed upstream clients.
   */
  async close(): Promise<void> {
    const closePromises = Array.from(this.clients.values()).map((c) => c.close());
    this.clients.clear();
    await Promise.all(closePromises);
  }
}
