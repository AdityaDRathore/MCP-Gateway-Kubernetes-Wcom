/**
 * Upstream and Tool Catalog Types, Enums, and Error Classes for Gate G5.
 */

/**
 * In-memory operational health / connectivity state.
 * Strictly decoupled from SQLite upstreams.status column.
 */
export type UpstreamHealthState = 'connecting' | 'available' | 'unavailable' | 'disabled';

/**
 * Normalized catalog tool representation.
 */
export interface CatalogTool {
  /**
   * Namespaced public tool name: {server_slug}__{original_tool_name}
   */
  readonly name: string;
  readonly originalName: string;
  readonly upstreamSlug: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly annotations?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

/**
 * Health and discovery status of an upstream within a catalog snapshot.
 */
export interface UpstreamStatusSummary {
  readonly slug: string;
  readonly healthState: UpstreamHealthState;
  readonly persistedStatus: string;
  readonly isEnabled: boolean;
  readonly toolCount: number;
  readonly lastCheckedAt: number;
  readonly lastError?: string;
}

/**
 * Immutable catalog snapshot object. Swapped atomically in memory.
 */
export interface CatalogSnapshot {
  readonly version: number;
  readonly tools: readonly CatalogTool[];
  readonly toolsByPublicName: ReadonlyMap<string, CatalogTool>;
  readonly upstreamStatuses: ReadonlyMap<string, UpstreamStatusSummary>;
  readonly createdAt: number;
  readonly fingerprint: string;
}

/**
 * Result of a successful upstream discovery operation.
 */
export interface DiscoveredToolsResult {
  readonly slug: string;
  readonly tools: readonly CatalogTool[];
  readonly discoveredAt: number;
}

/**
 * Catalog bounds configuration and enforcement limits.
 */
export const CATALOG_BOUNDS = Object.freeze({
  MAX_TOOLS_PER_UPSTREAM: 50,
  MAX_TOTAL_CATALOG_TOOLS: 200,
  MAX_TOOL_SCHEMA_BYTES: 32768, // 32 KiB UTF-8
  MAX_TOOL_DESCRIPTION_CHARS: 2048,
  MAX_TOTAL_CATALOG_BYTES: 524288, // 512 KiB UTF-8
  SLUG_REGEX: /^[a-z0-9-]{2,32}$/,
  TOOL_NAME_REGEX: /^[a-zA-Z0-9_-]{1,64}$/,
});

// ==============================================================================
// Error Hierarchy
// ==============================================================================

export class UpstreamError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'UPSTREAM_ERROR') {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
  }
}

export class UpstreamConnectionError extends UpstreamError {
  constructor(message: string) {
    super(message, 'UPSTREAM_CONNECTION_ERROR');
    this.name = 'UpstreamConnectionError';
  }
}

export class UpstreamTimeoutError extends UpstreamError {
  constructor(message: string) {
    super(message, 'UPSTREAM_TIMEOUT_ERROR');
    this.name = 'UpstreamTimeoutError';
  }
}

export class UpstreamProtocolError extends UpstreamError {
  constructor(message: string) {
    super(message, 'UPSTREAM_PROTOCOL_ERROR');
    this.name = 'UpstreamProtocolError';
  }
}

export class UpstreamDisabledError extends UpstreamError {
  constructor(message: string) {
    super(message, 'UPSTREAM_DISABLED_ERROR');
    this.name = 'UpstreamDisabledError';
  }
}

export class SSRFValidationError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'SSRF_VALIDATION_ERROR') {
    super(message);
    this.name = 'SSRFValidationError';
    this.code = code;
  }
}

export class SecurityError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'SECURITY_ERROR') {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

export class InvalidMetadataError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'INVALID_METADATA_ERROR') {
    super(message);
    this.name = 'InvalidMetadataError';
    this.code = code;
  }
}

export class DuplicateToolNameError extends InvalidMetadataError {
  constructor(message: string) {
    super(message, 'DUPLICATE_TOOL_NAME_ERROR');
    this.name = 'DuplicateToolNameError';
  }
}

export class CatalogBoundsExceededError extends InvalidMetadataError {
  constructor(message: string) {
    super(message, 'CATALOG_BOUNDS_EXCEEDED_ERROR');
    this.name = 'CatalogBoundsExceededError';
  }
}

export class ProhibitedRemoteRefError extends InvalidMetadataError {
  constructor(message: string) {
    super(message, 'PROHIBITED_REMOTE_REF_ERROR');
    this.name = 'ProhibitedRemoteRefError';
  }
}
