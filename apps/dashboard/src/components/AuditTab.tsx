import React from 'react';

interface AuditItem {
  id: string;
  timestamp: string;
  user: string;
  toolName: string;
  upstreamSlug: string;
  status: 'success' | 'failed' | 'timeout';
  durationMs: number;
}

const AUDIT_DATA: AuditItem[] = [
  {
    id: 'aud-1',
    timestamp: '2026-10-19 16:30:15',
    user: 'admin',
    toolName: 'woocommerce_list_products',
    upstreamSlug: 'woocommerce',
    status: 'success',
    durationMs: 42,
  },
  {
    id: 'aud-2',
    timestamp: '2026-10-19 16:29:45',
    user: 'admin',
    toolName: 'woocommerce_get_order',
    upstreamSlug: 'woocommerce',
    status: 'success',
    durationMs: 38,
  },
  {
    id: 'aud-3',
    timestamp: '2026-10-19 16:25:10',
    user: 'developer',
    toolName: 'crm_list_customers',
    upstreamSlug: 'crm',
    status: 'success',
    durationMs: 51,
  },
  {
    id: 'aud-4',
    timestamp: '2026-10-19 16:20:00',
    user: 'developer',
    toolName: 'tasks_list_tasks',
    upstreamSlug: 'tasks',
    status: 'success',
    durationMs: 33,
  },
];

export const AuditTab: React.FC = () => {
  return (
    <div id="audit-tab-view" className="animate-fade-in">
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Immutable Audit Logging Trail</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Real-time record of all downstream tool execution events across registered upstreams.
        </p>
      </div>

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Tool Called</th>
              <th>Upstream</th>
              <th>Caller</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {AUDIT_DATA.map((item) => (
              <tr key={item.id} id={`audit-row-${item.id}`}>
                <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                  {item.timestamp}
                </td>
                <td>
                  <span className="code-pill">{item.toolName}</span>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{item.upstreamSlug}</td>
                <td>
                  <strong style={{ fontSize: '0.8125rem' }}>{item.user}</strong>
                </td>
                <td>
                  <span
                    className={`badge badge-${
                      item.status === 'success' ? 'success' : item.status === 'timeout' ? 'warning' : 'danger'
                    }`}
                  >
                    {item.status}
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  {item.durationMs}ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
