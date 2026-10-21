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
    setOffset(0); // Reset to first page on filter change
  };

  const handlePrevPage = () => {
    setOffset((prev) => Math.max(0, prev - limit));
  };

  const handleNextPage = () => {
    setOffset((prev) => prev + limit);
  };

  const hasDegradedFinalization = audits.some(
    (a) => a.status === 'unconfirmed_outcome' || a.errorCode === 'FINALIZATION_TIMEOUT'
  );

  const formatTimestamp = (epochSeconds: number): string => {
    try {
      return new Date(epochSeconds * 1000).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
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
      case 'client_disconnected':
        return <span className="badge badge-warning">disconnected</span>;
      case 'pending':
        return (
          <span
            className="badge"
            style={{
              background: 'rgba(148, 163, 184, 0.2)',
              color: '#94a3b8',
              border: '1px solid rgba(148, 163, 184, 0.4)',
            }}
          >
            pending...
          </span>
        );
      case 'unconfirmed_outcome':
        return (
          <span
            className="badge badge-danger"
            style={{
              background: 'rgba(239, 68, 68, 0.25)',
              border: '1px solid var(--status-danger)',
              letterSpacing: '0.02em',
            }}
          >
            unconfirmed
          </span>
        );
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const hasMore = audits.length === limit;

  return (
    <div id="audit-tab-view" className="animate-fade-in">
      {/* Header & Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Immutable Audit Logging Trail</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Authoritative, tamper-evident record of all downstream tool execution events across registered upstreams.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {/* Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label htmlFor="audit-status-filter" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Status:
            </label>
            <select
              id="audit-status-filter"
              value={statusFilter}
              onChange={handleStatusFilterChange}
              style={{
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.4rem 0.75rem',
                fontSize: '0.8125rem',
              }}
            >
              <option value="">All Statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="timeout">Timeout</option>
              <option value="unconfirmed_outcome">Unconfirmed Outcome</option>
              <option value="client_disconnected">Disconnected</option>
              <option value="pending">Pending</option>
            </select>
          </div>

          {/* Refresh Button */}
          <button
            id="btn-refresh-audit"
            className="btn btn-secondary"
            onClick={fetchAudits}
            disabled={loading}
            style={{ padding: '0.4rem 0.85rem', fontSize: '0.8125rem' }}
          >
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Operational Warning for Degraded Audit Finalization */}
      {hasDegradedFinalization && (
        <div
          id="audit-degraded-warning-banner"
          style={{
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <div>
            <strong style={{ color: 'var(--status-warning)', fontSize: '0.875rem' }}>
              Operational Feedback — Audit Finalization Degraded:
            </strong>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
              One or more recent tool calls encountered a timeout or unconfirmed outcome during finalization.
              Downstream operations may have partially or fully executed. Do not blindly retry mutating actions without
              verifying entity state in WooCommerce or upstream systems.
            </p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div
          id="audit-error-banner"
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            color: 'var(--status-danger)',
            fontSize: '0.875rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            className="btn btn-secondary"
            onClick={fetchAudits}
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Table & Data Container */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Recorded At</th>
              <th>Tool Called</th>
              <th>Upstream</th>
              <th>Caller</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Duration</th>
              <th>Error Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && audits.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                  Loading authoritative audit records...
                </td>
              </tr>
            ) : audits.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                  No audit logs matching current query parameters.
                </td>
              </tr>
            ) : (
              audits.map((item) => (
                <tr key={item.id} id={`audit-row-${item.id}`}>
                  <td
                    style={{
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8125rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatTimestamp(item.createdAt)}
                  </td>
                  <td>
                    <span className="code-pill">{item.toolName}</span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{item.upstreamSlug || 'gateway'}</td>
                  <td>
                    <strong style={{ fontSize: '0.8125rem' }}>
                      {item.username || (item.userId ? `${item.userId.slice(0, 8)}...` : 'system')}
                    </strong>
                  </td>
                  <td>{renderStatusBadge(item.status)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8125rem',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.durationMs !== null ? `${item.durationMs}ms` : '—'}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '240px' }}>
                    {item.errorCode ? (
                      <span
                        title={item.errorMessage || undefined}
                        style={{ color: item.status === 'success' ? 'inherit' : 'var(--status-danger)' }}
                      >
                        {item.errorCode}
                        {item.errorMessage ? `: ${item.errorMessage}` : ''}
                      </span>
                    ) : item.errorMessage ? (
                      <span title={item.errorMessage}>{item.errorMessage}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '1.25rem',
          padding: '0 0.5rem',
        }}
      >
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          Showing {audits.length} record{audits.length === 1 ? '' : 's'} (Page {currentPage}, offset {offset})
        </span>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            id="btn-audit-prev-page"
            className="btn btn-secondary"
            onClick={handlePrevPage}
            disabled={offset === 0 || loading}
            style={{ padding: '0.35rem 0.8rem', fontSize: '0.8125rem' }}
          >
            ← Previous
          </button>
          <button
            id="btn-audit-next-page"
            className="btn btn-secondary"
            onClick={handleNextPage}
            disabled={!hasMore || loading}
            style={{ padding: '0.35rem 0.8rem', fontSize: '0.8125rem' }}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
};
