import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export interface UpstreamHealthDTO {
  state: string;
  toolCount: number;
  lastCheck: number | null;
  lastError: string | null;
}

export interface UpstreamDTO {
  id: string;
  slug: string;
  displayName: string;
  endpointUrl: string;
  timeoutMs: number;
  isEnabled: boolean;
  status: string;
  health: UpstreamHealthDTO;
  createdAt: number;
  updatedAt: number;
  tools?: {
    name: string;
    publicName: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  }[];
}

export const UpstreamsTab: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const [upstreams, setUpstreams] = useState<UpstreamDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Expanded Tools View
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Register Modal State
  const [isRegisterOpen, setIsRegisterOpen] = useState<boolean>(false);
  const [formSlug, setFormSlug] = useState<string>('');
  const [formDisplayName, setFormDisplayName] = useState<string>('');
  const [formEndpointUrl, setFormEndpointUrl] = useState<string>('');
  const [formTimeoutMs, setFormTimeoutMs] = useState<number>(10000);
  const [formSecretRef, setFormSecretRef] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchUpstreams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/browser/upstreams', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Failed to fetch upstreams (HTTP ${res.status})`);
      }

      const data = await res.json();
      const rawUpstreams: UpstreamDTO[] = data.upstreams || [];

      // Fetch tools for each upstream in parallel
      const enriched = await Promise.all(
        rawUpstreams.map(async (u) => {
          try {
            const toolRes = await fetch(`/api/v1/browser/upstreams/${u.id}/tools`, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
              credentials: 'same-origin',
            });
            if (toolRes.ok) {
              const toolData = await toolRes.json();
              return { ...u, tools: toolData.tools || [] };
            }
          } catch {
            // Fallback gracefully
          }
          return { ...u, tools: [] };
        })
      );

      setUpstreams(enriched);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error loading upstreams');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUpstreams();
  }, [fetchUpstreams]);

  const handleToggleEnable = async (upstream: UpstreamDTO) => {
    const action = upstream.isEnabled ? 'disable' : 'enable';
    setActionLoadingId(upstream.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/v1/browser/upstreams/${upstream.id}/${action}`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${action} upstream`);
      }

      setSuccessMsg(`Upstream "${upstream.displayName}" was ${action}d.`);
      await fetchUpstreams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Error during ${action}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRegisterUpstream = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/browser/upstreams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          slug: formSlug.trim(),
          displayName: formDisplayName.trim(),
          endpointUrl: formEndpointUrl.trim(),
          timeoutMs: formTimeoutMs,
          secretRefName: formSecretRef.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to register upstream');
      }

      setSuccessMsg(`Successfully registered upstream: ${data.upstream.displayName}`);
      setIsRegisterOpen(false);
      setFormSlug('');
      setFormDisplayName('');
      setFormEndpointUrl('');
      setFormSecretRef('');
      await fetchUpstreams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error registering upstream');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="upstreams-tab-view" className="animate-fade-in">
      {/* WordPress Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ fontSize: '23px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
            Upstream Services &amp; Tools Catalog
          </h1>
          {user?.role === 'admin' && (
            <button
              onClick={() => setIsRegisterOpen(true)}
              className="btn btn-primary"
              style={{ padding: '0.25rem 0.75rem', fontSize: '13px', minHeight: '30px' }}
            >
              <span>+ Add New Upstream</span>
            </button>
          )}
        </div>

        <button
          onClick={fetchUpstreams}
          className="btn btn-secondary"
          disabled={loading}
          style={{ padding: '0.25rem 0.75rem', fontSize: '13px', minHeight: '30px' }}
        >
          <span>🔄 Refresh Catalog</span>
        </button>
      </div>

      {/* WordPress Notices */}
      {successMsg && (
        <div className="wp-notice wp-notice-success animate-fade-in">
          <span>✓ {successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', color: '#50575e', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {error && (
        <div className="wp-notice wp-notice-error animate-fade-in">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#50575e', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Upstreams Postbox Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {loading ? (
          <div className="wp-card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--wp-text-muted)' }}>
            Polling upstream MCP services across cluster...
          </div>
        ) : upstreams.length === 0 ? (
          <div className="wp-card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--wp-text-muted)' }}>
            No upstream services registered in gateway catalog.
          </div>
        ) : (
          upstreams.map((upstream) => {
            const isWorking = actionLoadingId === upstream.id;
            const isExpanded = expandedSlug === upstream.slug;
            const toolCount = upstream.tools?.length || upstream.health.toolCount || 0;

            return (
              <div key={upstream.id} className="wp-card" style={{ background: '#ffffff', border: '1px solid var(--wp-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
                        {upstream.displayName}
                      </h3>
                      <span className="code-pill">{upstream.slug}</span>
                      <span className={`badge badge-${upstream.isEnabled ? 'success' : 'danger'}`}>
                        {upstream.isEnabled ? 'active' : 'disabled'}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>Endpoint:</span>
                      <code>{upstream.endpointUrl}</code>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--wp-text-muted)' }}>
                      <div>Timeout: <strong style={{ color: 'var(--wp-text-primary)' }}>{upstream.timeoutMs}ms</strong></div>
                      <div>Tools: <strong style={{ color: 'var(--wp-blue)' }}>{toolCount} Available</strong></div>
                    </div>

                    {user?.role === 'admin' && (
                      <button
                        onClick={() => handleToggleEnable(upstream)}
                        className={`btn ${upstream.isEnabled ? 'btn-danger' : 'btn-secondary'}`}
                        style={{ padding: '0.2rem 0.65rem', fontSize: '12px', minHeight: '26px' }}
                        disabled={isWorking}
                      >
                        {isWorking ? 'Updating...' : upstream.isEnabled ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Tool Inventory */}
                <div style={{ borderTop: '1px solid var(--wp-border-subtle)', paddingTop: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--wp-text-muted)', fontWeight: 600 }}>
                      Exposed MCP Tools ({toolCount})
                    </div>
                    {toolCount > 0 && (
                      <button
                        onClick={() => setExpandedSlug(isExpanded ? null : upstream.slug)}
                        style={{ background: 'none', border: 'none', color: 'var(--wp-blue)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {isExpanded ? 'Hide Schemas ▲' : 'View Input Schemas ▼'}
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
                    {upstream.tools && upstream.tools.length > 0 ? (
                      upstream.tools.map((tool) => (
                        <div
                          key={tool.name}
                          style={{
                            background: '#f6f7f7',
                            padding: '0.75rem 1rem',
                            borderRadius: '3px',
                            border: '1px solid var(--wp-border-subtle)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                            <div style={{ color: 'var(--wp-blue-dark)', fontFamily: 'var(--wp-font-mono)', fontSize: '12px', fontWeight: 600 }}>
                              {tool.name}
                            </div>
                            <span style={{ fontSize: '10px', color: 'var(--wp-text-muted)' }}>
                              MCP
                            </span>
                          </div>

                          <div style={{ color: 'var(--wp-text-secondary)', fontSize: '12px', lineHeight: 1.4, marginBottom: isExpanded ? '0.5rem' : '0' }}>
                            {tool.description || 'No description provided.'}
                          </div>

                          {isExpanded && tool.inputSchema && (
                            <div style={{ marginTop: '0.5rem', borderTop: '1px solid #dcdcde', paddingTop: '0.4rem' }}>
                              <pre style={{ background: '#ffffff', padding: '0.5rem', borderRadius: '3px', fontSize: '11px', color: '#2c3338', fontFamily: 'var(--wp-font-mono)', overflowX: 'auto', border: '1px solid var(--wp-border-subtle)' }}>
                                {JSON.stringify(tool.inputSchema, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div style={{ color: 'var(--wp-text-muted)', fontSize: '12px' }}>
                        No tools currently exposed by this upstream provider.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Register Upstream Modal Dialog */}
      {isRegisterOpen && (
        <div className="modal-overlay" onClick={() => !isSubmitting && setIsRegisterOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '1.75rem', border: '1px solid var(--wp-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--wp-border-subtle)', paddingBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
                Register Upstream Service
              </h2>
              <button
                onClick={() => setIsRegisterOpen(false)}
                style={{ background: 'none', border: 'none', color: '#50575e', fontSize: '16px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegisterUpstream}>
              <div className="form-group">
                <label className="form-label">Service Slug (Identifier)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. inventory-service"
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Warehouse Inventory Engine"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Internal ClusterIP URL</label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="http://urumi-inventory.urumi.svc.cluster.local:3000/mcp"
                  value={formEndpointUrl}
                  onChange={(e) => setFormEndpointUrl(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Timeout (Milliseconds)</label>
                <input
                  type="number"
                  className="form-input"
                  value={formTimeoutMs}
                  onChange={(e) => setFormTimeoutMs(Number(e.target.value))}
                  disabled={isSubmitting}
                  min={1000}
                  max={60000}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Kubernetes Secret Reference (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. urumi-upstream-inventory-token"
                  value={formSecretRef}
                  onChange={(e) => setFormSecretRef(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.75rem', borderTop: '1px solid var(--wp-border-subtle)', paddingTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setIsRegisterOpen(false)}
                  className="btn btn-secondary"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Registering...' : 'Register Upstream'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
