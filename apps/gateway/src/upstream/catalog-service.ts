import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  CatalogSnapshot,
  CatalogTool,
  UpstreamStatusSummary,
  DiscoveredToolsResult,
} from './types.js';
import { validateGlobalCatalogBounds } from './tool-validator.js';
import { logger } from '../logging/logger.js';

/**
 * Immutable Map implementation for CatalogSnapshot.
 * Overrides mutator methods to prevent runtime modification.
 */
export class ReadonlySnapshotMap<K, V> extends Map<K, V> {
  private isSealed = false;

  constructor(entries?: readonly (readonly [K, V])[] | null) {
    super();
    if (entries) {
      for (const [k, v] of entries) {
        super.set(k, v);
      }
    }
    this.isSealed = true;
    Object.freeze(this);
  }

  override set(_key: K, _value: V): this {
    if (this.isSealed) {
      throw new TypeError('Cannot modify immutable CatalogSnapshot Map: set() is prohibited');
    }
    return super.set(_key, _value);
  }

  override delete(_key: K): boolean {
    if (this.isSealed) {
      throw new TypeError('Cannot modify immutable CatalogSnapshot Map: delete() is prohibited');
    }
    return super.delete(_key);
  }

  override clear(): void {
    if (this.isSealed) {
      throw new TypeError('Cannot modify immutable CatalogSnapshot Map: clear() is prohibited');
    }
    super.clear();
  }
}

/**
 * Recursively freezes an object and all nested objects, arrays, and properties.
 * Handles circular references safely using a WeakSet.
 */
export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);

  if (value instanceof Map) {
    for (const [k, v] of value.entries()) {
      if (k !== null && typeof k === 'object') {
        deepFreeze(k, seen);
      }
      if (v !== null && typeof v === 'object') {
        deepFreeze(v, seen);
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        deepFreeze(item, seen);
      }
    }
  } else {
    const propNames = Object.getOwnPropertyNames(value);
    for (const name of propNames) {
      const val = (value as Record<string, unknown>)[name];
      if (val !== null && typeof val === 'object') {
        deepFreeze(val, seen);
      }
    }
  }

  return Object.freeze(value);
}

/**
 * Computes a deterministic canonical SHA-256 fingerprint for tools and relevant upstream statuses.
 */
export function computeSnapshotFingerprint(
  tools: readonly CatalogTool[],
  statuses: Map<string, UpstreamStatusSummary>
): string {
  const normalizedTools = tools.map((t) => ({
    name: t.name,
    originalName: t.originalName,
    upstreamSlug: t.upstreamSlug,
    description: t.description ?? null,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema ?? null,
    annotations: t.annotations ?? null,
    _meta: t._meta ?? null,
  }));

  const normalizedStatuses = Array.from(statuses.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, s]) => ({
      slug,
      healthState: s.healthState,
      persistedStatus: s.persistedStatus,
      isEnabled: s.isEnabled,
      toolCount: s.toolCount,
      lastError: s.lastError ?? null,
    }));

  const canonicalPayload = JSON.stringify({
    tools: normalizedTools,
    statuses: normalizedStatuses,
  });

  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

/**
 * Manages the in-memory immutable CatalogSnapshot.
 * Enforces atomic pointer swap, deterministic alphabetical ordering,
 * snapshot reference stability, deep immutability, and last-valid snapshot preservation.
 */
export class CatalogService {
  private currentSnapshot: CatalogSnapshot;

  constructor() {
    const emptyTools = deepFreeze([] as CatalogTool[]);
    const emptyToolsByPublicName = new ReadonlySnapshotMap<string, CatalogTool>();
    const emptyStatuses = new ReadonlySnapshotMap<string, UpstreamStatusSummary>();
    const initialFingerprint = computeSnapshotFingerprint([], new Map());

    this.currentSnapshot = deepFreeze({
      version: 0,
      tools: emptyTools,
      toolsByPublicName: emptyToolsByPublicName,
      upstreamStatuses: emptyStatuses,
      createdAt: Date.now(),
      fingerprint: initialFingerprint,
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

    // 5. Reference stability: compare complete downstream-visible tool definitions & status metadata
    if (this.areSnapshotsEqual(this.currentSnapshot, candidateTools, statusMap)) {
      return this.currentSnapshot;
    }

    // 6. Defensive cloning and deep immutability:
    // Create deep clones so that future caller mutations cannot mutate snapshot internals
    const clonedCandidateTools: CatalogTool[] = candidateTools.map((t) => ({
      name: t.name,
      originalName: t.originalName,
      upstreamSlug: t.upstreamSlug,
      description: t.description,
      inputSchema: structuredClone(t.inputSchema),
      outputSchema: t.outputSchema ? structuredClone(t.outputSchema) : undefined,
      annotations: t.annotations ? structuredClone(t.annotations) : undefined,
      _meta: t._meta ? structuredClone(t._meta) : undefined,
    }));

    const toolEntries = clonedCandidateTools.map((t) => [t.name, t] as const);
    const toolsByPublicName = new ReadonlySnapshotMap<string, CatalogTool>(toolEntries);

    const statusEntries = Array.from(statusMap.entries()).map(
      ([slug, status]) => [slug, structuredClone(status)] as const
    );
    const upstreamStatuses = new ReadonlySnapshotMap<string, UpstreamStatusSummary>(statusEntries);

    const fingerprint = computeSnapshotFingerprint(clonedCandidateTools, statusMap);

    const newSnapshot: CatalogSnapshot = {
      version: this.currentSnapshot.version + 1,
      tools: clonedCandidateTools,
      toolsByPublicName,
      upstreamStatuses,
      createdAt: Date.now(),
      fingerprint,
    };

    // Deeply freeze snapshot and all nested structures
    this.currentSnapshot = deepFreeze(newSnapshot);

    logger.debug('Catalog snapshot atomically updated', {
      version: this.currentSnapshot.version,
      toolCount: this.currentSnapshot.tools.length,
      upstreamCount: statuses.length,
      fingerprint,
    });

    return this.currentSnapshot;
  }

  /**
   * Compares candidate tools and statuses against existing snapshot for complete reference stability.
   * Compares full tool definitions (name, description, schemas, annotations, _meta) and relevant status metadata.
   */
  private areSnapshotsEqual(
    current: CatalogSnapshot,
    candidateTools: readonly CatalogTool[],
    candidateStatusMap: Map<string, UpstreamStatusSummary>
  ): boolean {
    if (current.tools.length !== candidateTools.length) {
      return false;
    }

    // 1. Compare upstream statuses count and fields
    if (current.upstreamStatuses.size !== candidateStatusMap.size) {
      return false;
    }

    for (const [slug, status] of candidateStatusMap) {
      const curStatus = current.upstreamStatuses.get(slug);
      if (!curStatus) return false;
      if (
        curStatus.healthState !== status.healthState ||
        curStatus.isEnabled !== status.isEnabled ||
        curStatus.persistedStatus !== status.persistedStatus ||
        curStatus.toolCount !== status.toolCount ||
        curStatus.lastError !== status.lastError
      ) {
        return false;
      }
    }

    // 2. Compare complete downstream-visible tool definitions
    for (let i = 0; i < current.tools.length; i++) {
      const curTool = current.tools[i];
      const candTool = candidateTools[i];

      // Primitive equality checks
      if (
        curTool.name !== candTool.name ||
        curTool.originalName !== candTool.originalName ||
        curTool.upstreamSlug !== candTool.upstreamSlug ||
        curTool.description !== candTool.description
      ) {
        return false;
      }

      // Deep equality checks for schemas, annotations, and metadata
      if (!isDeepStrictEqual(curTool.inputSchema, candTool.inputSchema)) {
        return false;
      }
      if (!isDeepStrictEqual(curTool.outputSchema, candTool.outputSchema)) {
        return false;
      }
      if (!isDeepStrictEqual(curTool.annotations, candTool.annotations)) {
        return false;
      }
      if (!isDeepStrictEqual(curTool._meta, candTool._meta)) {
        return false;
      }
    }

    return true;
  }
}
