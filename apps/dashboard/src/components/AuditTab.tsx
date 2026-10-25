import React, { useState, useEffect, useCallback } from 'react';

export type AuditStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'client_disconnected'
  | 'unconfirmed_outcome';

export interface BrowserAuditDTO {
  id: string;
  userId: string | null;
  username: string | null;
  upstreamSlug: string | null;
  toolName: string;
  status: AuditStatus;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
}

interface AuditApiResponse {
  audits: BrowserAuditDTO[];
  limit: number;
  offset: number;
}

export const AuditTab: React.FC = () => {
  const [audits, setAudits] = useState<BrowserAuditDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);
  const limit = 25;

  const fetchAudits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (statusFilter) {
        params.set('status', statusFilter);
      }

      const res = await fetch(`/api/v1/browser/audit?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        credentials: 'same-origin',
      });

      if (res.status === 403) {
        throw new Error('Access denied: Administrator privileges required to inspect global audit logs.');
      }
      if (res.status === 401) {
        throw new Error('Authentication session required. Please sign in again.');
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Failed to fetch audit logs (HTTP ${res.status})`);
      }

      const data: AuditApiResponse = await res.json();
      setAudits(data.audits || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error loading audit logs');
      setAudits([]);
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter]);

  useEffect(() => {
    fetchAudits();
  }, [fetchAudits]);

  const handleStatusFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(e.target.value);
    setOffset(0);
  };

  const handlePrevPage = () => {
    setOffset((prev) => Math.max(0, prev - limit));
  };

  const handleNextPage = () => {
    setOffset((prev) => prev + limit);
  };

  const formatTimestamp = (epochSeconds: number): string => {
    try {
      const ms = epochSeconds < 10000000000 ? epochSeconds * 1000 : epochSeconds;
      const d = new Date(ms);
      return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      return String(epochSeconds);
    }
  };

  const renderStatusBadge = (status: AuditStatus) => {
    switch (status) {
      case 'success':
        return <span className="badge badge-success">success</span>;
      case 'failed':
        return <span className="badge badge-danger">failed</span>;
      case 'timeout':
        return <span className="badge badge-warning">timeout</span>;
      case 'unconfirmed_outcome':
        return <span className="badge badge-warning">unconfirmed</span>;
      case 'client_disconnected':
        return <span className="badge badge-warning">disconnected</span>;
      case 'pending':
        return <span className="badge badge-admin">pending</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const hasMore = audits.length === limit;

  return (
    <div id="audit-tab-view" className="animate-fade-in">
      {/* WordPress Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '23px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
            Audit Trail &amp; Immutable Ledger
          </h1>
          <p style={{ color: 'var(--wp-text-secondary)', fontSize: '13px' }}>
            Authoritative, tamper-resistant record of all Model Context Protocol tool execution events and caller identities.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
          <select
            id="audit-status-filter"
            value={statusFilter}
            onChange={handleStatusFilterChange}
            className="form-select"
            style={{ padding: '0.25rem 0.65rem', fontSize: '12px', minHeight: '30px', width: 'auto' }}
          >
            <option value="">All Statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="timeout">Timeout</option>
            <option value="unconfirmed_outcome">Unconfirmed</option>
            <option value="pending">Pending</option>
          </select>

          <button
            id="btn-refresh-audit"
            className="btn btn-secondary"
            onClick={fetchAudits}
            disabled={loading}
            style={{ padding: '0.25rem 0.75rem', fontSize: '13px', minHeight: '30px' }}
          >
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* WordPress Error Notice */}
      {error && (
        <div className="wp-notice wp-notice-error animate-fade-in">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#50575e', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* WordPress List Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Status</th>
              <th>Tool Name</th>
              <th>Upstream</th>
              <th>Operator</th>
              <th>Duration</th>
              <th>Diagnostics</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--wp-text-muted)' }}>
                  Loading audit events from SQLite WAL ledger...
                </td>
              </tr>
            ) : audits.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--wp-text-muted)' }}>
                  No audit log events found.
                </td>
              </tr>
            ) : (
              audits.map((a) => (
                <tr key={a.id}>
                  <td style={{ color: 'var(--wp-text-secondary)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {formatTimestamp(a.createdAt)}
                  </td>
                  <td>{renderStatusBadge(a.status)}</td>
                  <td>
                    <code style={{ color: '#135e96', fontWeight: 600 }}>{a.toolName}</code>
                  </td>
                  <td>
                    <span className="code-pill">{a.upstreamSlug || 'internal'}</span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 500, color: 'var(--wp-text-primary)' }}>
                      {a.username || (a.userId ? a.userId.slice(0, 8) : 'Anonymous')}
                    </span>
                  </td>
                  <td style={{ color: 'var(--wp-text-muted)', fontSize: '12px' }}>
                    {a.durationMs !== null ? `${a.durationMs}ms` : '--'}
                  </td>
                  <td style={{ fontSize: '11px', color: a.errorCode ? '#d63638' : 'var(--wp-text-muted)' }}>
                    {a.errorCode || a.errorMessage ? (
                      <code>{a.errorCode || a.errorMessage}</code>
                    ) : (
                      'None'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* WordPress Pagination Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '1rem',
          padding: '0.5rem 0',
        }}
      >
        <span style={{ fontSize: '12px', color: 'var(--wp-text-secondary)' }}>
          Page <strong>{currentPage}</strong> (Showing up to {limit} records per page)
        </span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            onClick={handlePrevPage}
            disabled={offset === 0 || loading}
            className="btn btn-secondary"
            style={{ padding: '0.2rem 0.65rem', minHeight: '28px', fontSize: '12px' }}
          >
            « Previous
          </button>
          <button
            onClick={handleNextPage}
            disabled={!hasMore || loading}
            className="btn btn-secondary"
            style={{ padding: '0.2rem 0.65rem', minHeight: '28px', fontSize: '12px' }}
          >
            Next »
          </button>
        </div>
      </div>
    </div>
  );
};
