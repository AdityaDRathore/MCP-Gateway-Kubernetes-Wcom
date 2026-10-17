import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export interface UpstreamRow {
  id: string;
  slug: string;
  display_name: string;
  endpoint_url: string;
  timeout_ms: number;
  is_enabled: number;
  status: 'provisioning' | 'active' | 'disabled' | 'deleting' | 'cleanup_required' | 'failed';
  secret_ref_name: string | null;
  secret_ref_key: string | null;
  cleanup_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface NewUpstreamInput {
  id?: string;
  slug: string;
  displayName: string;
  endpointUrl: string;
  timeoutMs?: number;
  isEnabled?: number;
  status?: 'provisioning' | 'active' | 'disabled' | 'deleting' | 'cleanup_required' | 'failed';
  secretRefName?: string | null;
  secretRefKey?: string | null;
  cleanupError?: string | null;
}

export interface DefaultUpstreamDefinition {
  slug: string;
  displayName: string;
  endpointUrl: string;
  timeoutMs: number;
}

export const DEFAULT_UPSTREAMS: readonly DefaultUpstreamDefinition[] = Object.freeze([
  {
    slug: 'woocommerce',
    displayName: 'WooCommerce MCP',
    endpointUrl: 'http://urumi-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp',
    timeoutMs: 10000,
  },
  {
    slug: 'crm',
    displayName: 'CRM Mock MCP',
    endpointUrl: 'http://urumi-mcp-crm.urumi.svc.cluster.local:3000/mcp',
    timeoutMs: 10000,
  },
  {
    slug: 'tasks',
    displayName: 'Tasks Mock MCP',
    endpointUrl: 'http://urumi-mcp-tasks.urumi.svc.cluster.local:3000/mcp',
    timeoutMs: 10000,
  },
]);

export class UpstreamRepository {
  constructor(private readonly db: DatabaseSync) {}

  getUpstreamBySlug(slug: string): UpstreamRow | null {
    const row = this.db
      .prepare('SELECT * FROM upstreams WHERE slug = ?;')
      .get(slug) as UpstreamRow | undefined;
    return row ?? null;
  }

  getUpstreamById(id: string): UpstreamRow | null {
    const row = this.db
      .prepare('SELECT * FROM upstreams WHERE id = ?;')
      .get(id) as UpstreamRow | undefined;
    return row ?? null;
  }

  getAllUpstreams(): UpstreamRow[] {
    const rows = this.db
      .prepare('SELECT * FROM upstreams ORDER BY slug ASC;')
      .all() as unknown as UpstreamRow[];
    return rows;
  }

  getEnabledUpstreams(): UpstreamRow[] {
    const rows = this.db
      .prepare("SELECT * FROM upstreams WHERE is_enabled = 1 AND status = 'active' ORDER BY slug ASC;")
      .all() as unknown as UpstreamRow[];
    return rows;
  }

  insertUpstream(input: NewUpstreamInput): UpstreamRow {
    const id = input.id ?? crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const timeoutMs = input.timeoutMs ?? 10000;
    const isEnabled = input.isEnabled ?? 1;
    const status = input.status ?? 'active';

    this.db.prepare(`
      INSERT INTO upstreams (
        id, slug, display_name, endpoint_url, timeout_ms, is_enabled, status,
        secret_ref_name, secret_ref_key, cleanup_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      id,
      input.slug,
      input.displayName,
      input.endpointUrl,
      timeoutMs,
      isEnabled,
      status,
      input.secretRefName ?? null,
      input.secretRefKey ?? null,
      input.cleanupError ?? null,
      now,
      now
    );

    const created = this.getUpstreamById(id);
    if (!created) {
      throw new Error(`Failed to retrieve newly created upstream ${input.slug}`);
    }
    return created;
  }

  updateUpstream(
    slug: string,
    updates: Partial<{
      displayName: string;
      endpointUrl: string;
      timeoutMs: number;
      isEnabled: number;
      status: 'provisioning' | 'active' | 'disabled' | 'deleting' | 'cleanup_required' | 'failed';
      secretRefName: string | null;
      secretRefKey: string | null;
      cleanupError: string | null;
    }>
  ): UpstreamRow | null {
    const existing = this.getUpstreamBySlug(slug);
    if (!existing) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const displayName = updates.displayName ?? existing.display_name;
    const endpointUrl = updates.endpointUrl ?? existing.endpoint_url;
    const timeoutMs = updates.timeoutMs ?? existing.timeout_ms;
    const isEnabled = updates.isEnabled ?? existing.is_enabled;
    const status = updates.status ?? existing.status;
    const secretRefName = updates.secretRefName !== undefined ? updates.secretRefName : existing.secret_ref_name;
    const secretRefKey = updates.secretRefKey !== undefined ? updates.secretRefKey : existing.secret_ref_key;
    const cleanupError = updates.cleanupError !== undefined ? updates.cleanupError : existing.cleanup_error;

    this.db.prepare(`
      UPDATE upstreams SET
        display_name = ?,
        endpoint_url = ?,
        timeout_ms = ?,
        is_enabled = ?,
        status = ?,
        secret_ref_name = ?,
        secret_ref_key = ?,
        cleanup_error = ?,
        updated_at = ?
      WHERE slug = ?;
    `).run(
      displayName,
      endpointUrl,
      timeoutMs,
      isEnabled,
      status,
      secretRefName,
      secretRefKey,
      cleanupError,
      now,
      slug
    );

    return this.getUpstreamBySlug(slug);
  }

  /**
   * Idempotently seeds default upstreams.
   * If a default upstream does not exist, it is created.
   * If an upstream already exists with the same slug, it is preserved without overwriting operator changes.
   */
  seedDefaults(defaults: readonly DefaultUpstreamDefinition[] = DEFAULT_UPSTREAMS): { inserted: number; existing: number } {
    let inserted = 0;
    let existing = 0;

    for (const def of defaults) {
      const found = this.getUpstreamBySlug(def.slug);
      if (found) {
        existing++;
      } else {
        this.insertUpstream({
          slug: def.slug,
          displayName: def.displayName,
          endpointUrl: def.endpointUrl,
          timeoutMs: def.timeoutMs,
          isEnabled: 1,
          status: 'active',
        });
        inserted++;
      }
    }

    return { inserted, existing };
  }
}
