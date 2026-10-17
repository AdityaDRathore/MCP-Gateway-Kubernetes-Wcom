import {
  CatalogSnapshot,
  CatalogTool,
  UpstreamStatusSummary,
  DiscoveredToolsResult,
} from './types.js';
import { validateGlobalCatalogBounds } from './tool-validator.js';
import { logger } from '../logging/logger.js';

/**
 * Manages the in-memory immutable CatalogSnapshot.
 * Enforces atomic pointer swap, deterministic alphabetical ordering,
 * snapshot reference stability, and last-valid snapshot preservation.
 */
export class CatalogService {
  private currentSnapshot: CatalogSnapshot;

  constructor() {
    this.currentSnapshot = Object.freeze({
      version: 0,
      tools: Object.freeze([]),
      toolsByPublicName: Object.freeze(new Map<string, CatalogTool>()),
      upstreamStatuses: Object.freeze(new Map<string, UpstreamStatusSummary>()),
      createdAt: Date.now(),
    });
  }

  /**
   * Returns current immutable catalog snapshot in O(1) time without blocking.
   */
  getSnapshot(): CatalogSnapshot {
    return this.currentSnapshot;
  }

  /**
   * Compiles discovered tools and upstream statuses into a validated, sorted, immutable snapshot.
   * Swaps the memory pointer atomically.
   */
  updateSnapshot(
    discoveredResults: DiscoveredToolsResult[],
    statuses: UpstreamStatusSummary[]
  ): CatalogSnapshot {
    const candidateTools: CatalogTool[] = [];
    const statusMap = new Map(statuses.map((s) => [s.slug, s]));

    // 1. Collect tools from currently discovered available upstreams
    const discoveredMap = new Map<string, readonly CatalogTool[]>();
    for (const res of discoveredResults) {
      discoveredMap.set(res.slug, res.tools);
    }

    // 2. Iterate through all statuses to determine catalog representation
    for (const status of statuses) {
      if (!status.isEnabled || status.healthState === 'disabled') {
        // Disabled upstreams: tools are strictly excluded from catalog
        continue;
      }

      if (status.healthState === 'available') {
        const tools = discoveredMap.get(status.slug) ?? [];
        for (const t of tools) {
          candidateTools.push({
            ...t,
            _meta: {
              ...(t._meta || {}),
              reachable: true,
            },
          });
        }
      } else if (status.healthState === 'unavailable' || status.healthState === 'connecting') {
        // Unreachable / degraded upstreams: retain tools from last valid snapshot with reachable: false
        const priorTools = this.currentSnapshot.tools.filter(
          (t) => t.upstreamSlug === status.slug
        );

        for (const pt of priorTools) {
          const sanitizedError = status.lastError
            ? status.lastError.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
            : `Upstream service '${status.slug}' is currently unreachable`;

          candidateTools.push({
            ...pt,
            _meta: {
              ...(pt._meta || {}),
              reachable: false,
              error: sanitizedError,
            },
          });
        }
      }
    }

    // 3. Enforce global catalog bounds (max 200 tools, max 512 KiB total, unique public names)
    validateGlobalCatalogBounds(candidateTools);

    // 4. Enforce deterministic ordering: server_slug ascending, then original_tool_name ascending
    candidateTools.sort((a, b) => {
      const slugCmp = a.upstreamSlug.localeCompare(b.upstreamSlug);
      if (slugCmp !== 0) return slugCmp;
      return a.originalName.localeCompare(b.originalName);
    });

    // 5. Reference stability: if tools and statuses are identical to current snapshot, preserve reference
    if (this.areSnapshotsEqual(this.currentSnapshot, candidateTools, statusMap)) {
      return this.currentSnapshot;
    }

    // 6. Build new immutable snapshot and atomically swap pointer
    const toolsByPublicName = new Map<string, CatalogTool>();
    for (const tool of candidateTools) {
      toolsByPublicName.set(tool.name, Object.freeze(tool));
    }

    const newSnapshot: CatalogSnapshot = Object.freeze({
      version: this.currentSnapshot.version + 1,
      tools: Object.freeze(candidateTools),
      toolsByPublicName: Object.freeze(toolsByPublicName),
      upstreamStatuses: Object.freeze(statusMap),
      createdAt: Date.now(),
    });

    this.currentSnapshot = newSnapshot;

    logger.debug('Catalog snapshot atomically updated', {
      version: newSnapshot.version,
      toolCount: newSnapshot.tools.length,
      upstreamCount: statuses.length,
    });

    return this.currentSnapshot;
  }

  /**
   * Compares candidate tools and statuses against existing snapshot for reference stability.
   */
  private areSnapshotsEqual(
    current: CatalogSnapshot,
    candidateTools: CatalogTool[],
    candidateStatusMap: Map<string, UpstreamStatusSummary>
  ): boolean {
    if (current.tools.length !== candidateTools.length) {
      return false;
    }

    // Compare upstream statuses
    if (current.upstreamStatuses.size !== candidateStatusMap.size) {
      return false;
    }
    for (const [slug, status] of candidateStatusMap) {
      const curStatus = current.upstreamStatuses.get(slug);
      if (!curStatus) return false;
      if (
        curStatus.healthState !== status.healthState ||
        curStatus.isEnabled !== status.isEnabled ||
        curStatus.toolCount !== status.toolCount
      ) {
        return false;
      }
    }

    // Compare tool names and reachability
    for (let i = 0; i < current.tools.length; i++) {
      const curTool = current.tools[i];
      const candTool = candidateTools[i];
      if (curTool.name !== candTool.name) {
        return false;
      }
      const curReachable = curTool._meta?.reachable !== false;
      const candReachable = candTool._meta?.reachable !== false;
      if (curReachable !== candReachable) {
        return false;
      }
    }

    return true;
  }
}
