import React, { useState, useEffect } from 'react';

export const OverviewTab: React.FC = () => {
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'checking' | 'degraded'>('checking');
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const checkHealth = async () => {
      const start = performance.now();
      try {
        const res = await fetch('/health/ready');
        if (res.ok) {
          setHealthStatus('healthy');
          setLatency(Math.round(performance.now() - start));
        } else {
          setHealthStatus('degraded');
        }
      } catch {
        setHealthStatus('degraded');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div id="overview-tab-view" className="animate-fade-in">
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Gateway Architecture &amp; Health Overview</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Real-time telemetry, dual-listener network boundaries, and service discovery health.
        </p>
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.25rem',
          marginBottom: '2rem',
        }}
      >
        <div className="glass-card" id="metric-gateway-health">
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            OPERATIONAL STATUS
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: healthStatus === 'healthy' ? 'var(--status-success)' : 'var(--status-danger)',
                boxShadow: `0 0 10px ${healthStatus === 'healthy' ? 'var(--status-success)' : 'var(--status-danger)'}`,
              }}
            />
            <span style={{ fontSize: '1.25rem', fontWeight: 700, textTransform: 'capitalize' }}>
              {healthStatus}
            </span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Readiness probe response: {latency ? `${latency}ms` : 'polling...'}
          </div>
        </div>

        <div className="glass-card" id="metric-active-upstreams">
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            REGISTERED UPSTREAMS
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
            3 Services
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            WooCommerce, CRM, Tasks (Kubernetes DNS)
          </div>
        </div>

        <div className="glass-card" id="metric-discovered-tools">
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            DYNAMIC MCP TOOLS
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--brand-primary)' }}>
            10 Tools
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Aggregated into downstream MCP catalog
          </div>
        </div>

        <div className="glass-card" id="metric-security-perimeter">
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            SECURITY PERIMETER
          </div>
          <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Dual-Listener (3000 / 3001)
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Strict origin allowlist &amp; CSRF protection active
          </div>
        </div>
      </div>

      {/* Architecture Topology & Boundary Invariants */}
      <div className="glass-panel" style={{ padding: '1.75rem', marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>Perimeter Boundary Segregation (P5-G1 Approved Architecture)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          <div style={{ background: 'rgba(0,0,0,0.25)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span className="badge badge-admin">Port 3000</span>
              <strong style={{ fontSize: '0.9375rem' }}>MCP &amp; Private Admin Boundary</strong>
            </div>
            <ul style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
              <li>Downstream Streamable HTTP MCP (<code>/mcp</code>) with Bearer API Key auth.</li>
              <li>Administrative API (<code>/admin/v1/*</code>) for cluster-internal controllers.</li>
              <li>Strictly rejects browser cookies; zero SPA static files served.</li>
            </ul>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.25)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span className="badge badge-member">Port 3001</span>
              <strong style={{ fontSize: '0.9375rem' }}>Browser API &amp; SPA Dashboard</strong>
            </div>
            <ul style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
              <li>Browser session authentication (<code>/api/v1/browser/session</code>) with HTTP-only cookies.</li>
              <li>Enforces canonical Origin allowlist, safe Referer fallback, and CSRF token verification.</li>
              <li>Strictly unmounts <code>/mcp</code> and <code>/admin/v1</code> (returns 404).</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
