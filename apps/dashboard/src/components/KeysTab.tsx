import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export interface ApiKeyDTO {
  id: string;
  userId: string;
  username: string;
  name: string;
  keyPrefix: string;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

interface CreatedKeyResult {
  apiKey: {
    id: string;
    userId: string;
    username: string;
    name: string;
    keyPrefix: string;
    expiresAt: number | null;
    createdAt: number;
  };
  rawKey: string;
}

export const KeysTab: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const [keys, setKeys] = useState<ApiKeyDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create Key Modal State
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [keyName, setKeyName] = useState<string>('');
  const [expiresInDays, setExpiresInDays] = useState<number>(90);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createdResult, setCreatedResult] = useState<CreatedKeyResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  // Action Loading State
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/browser/keys', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Failed to fetch API keys (HTTP ${res.status})`);
      }

      const data = await res.json();
      setKeys(data.keys || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error loading API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) {
      setError('Key name is required.');
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: keyName.trim(),
      };
      if (expiresInDays > 0) {
        payload.expiresInDays = expiresInDays;
      }

      const res = await fetch('/api/v1/browser/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate API key');
      }

      setCreatedResult(data);
      setSuccessMsg(`Generated API key: "${data.apiKey.name}"`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error generating key');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyRawKey = () => {
    if (!createdResult) return;
    navigator.clipboard.writeText(createdResult.rawKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2500);
  };

  const handleRevokeKey = async (key: ApiKeyDTO) => {
    if (!confirm(`Are you sure you want to permanently revoke API key "${key.name}"? External clients using this key will immediately receive 401 Unauthorized.`)) {
      return;
    }

    setRevokingId(key.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/v1/browser/keys/${key.id}/revoke`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to revoke key');
      }

      setSuccessMsg(`API key "${key.name}" was successfully revoked.`);
      await fetchKeys();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error revoking key');
    } finally {
      setRevokingId(null);
    }
  };

  const formatEpoch = (epoch: number | null) => {
    if (!epoch) return 'Never';
    const ms = epoch < 10000000000 ? epoch * 1000 : epoch;
    return new Date(ms).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div id="keys-tab-view" className="animate-fade-in">
      {/* WordPress Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ fontSize: '23px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
            MCP API Keys (Self-Service)
          </h1>
          <button
            id="btn-create-key"
            onClick={() => {
              setKeyName('');
              setExpiresInDays(90);
              setCreatedResult(null);
              setIsCreateOpen(true);
            }}
            className="btn btn-primary"
            style={{ padding: '0.25rem 0.75rem', fontSize: '13px', minHeight: '30px' }}
          >
            <span>+ Add New API Key</span>
          </button>
        </div>
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

      {/* WordPress List Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Key Name</th>
              <th>Prefix Verifier</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last Used</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--wp-text-muted)' }}>
                  Loading API keys from database...
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--wp-text-muted)' }}>
                  No API keys registered yet. Click "+ Add New API Key" above.
                </td>
              </tr>
            ) : (
              keys.map((k) => {
                const isRevoked = Boolean(k.revokedAt);
                const isWorking = revokingId === k.id;
                const canManage = user?.role === 'admin' || k.userId === user?.id;

                return (
                  <tr key={k.id} id={`key-row-${k.id}`}>
                    <td>
                      <div style={{ fontWeight: 600, color: isRevoked ? 'var(--wp-text-muted)' : 'var(--wp-text-primary)' }}>
                        {k.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--wp-text-muted)', fontFamily: 'var(--wp-font-mono)' }}>
                        ID: {k.id.slice(0, 18)}...
                      </div>
                    </td>

                    <td>
                      <span className="code-pill">
                        {k.keyPrefix}...
                      </span>
                    </td>

                    <td style={{ color: 'var(--wp-text-secondary)' }}>
                      {k.username || (k.userId === user?.id ? user?.username : k.userId.slice(0, 8))}
                    </td>

                    <td>
                      <span className={`badge badge-${isRevoked ? 'danger' : 'success'}`}>
                        {isRevoked ? 'revoked' : 'active'}
                      </span>
                    </td>

                    <td style={{ color: 'var(--wp-text-secondary)', fontSize: '12px' }}>
                      {formatEpoch(k.createdAt)}
                    </td>

                    <td style={{ color: 'var(--wp-text-secondary)', fontSize: '12px' }}>
                      {formatEpoch(k.lastUsedAt)}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      {isRevoked ? (
                        <span style={{ fontSize: '12px', color: 'var(--wp-text-muted)' }}>
                          Revoked
                        </span>
                      ) : canManage ? (
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.2rem 0.65rem', fontSize: '12px', minHeight: '26px' }}
                          onClick={() => handleRevokeKey(k)}
                          disabled={isWorking}
                        >
                          {isWorking ? 'Revoking...' : 'Revoke Key'}
                        </button>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--wp-text-muted)' }}>
                          Protected
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Security Architecture Postbox */}
      <div className="wp-card" style={{ marginTop: '1.5rem', background: '#ffffff', borderLeft: '4px solid #2271b1' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '0.35rem', color: '#1d2327' }}>
          🔒 Zero Plaintext Storage Invariant (DEC-05)
        </h3>
        <p style={{ color: 'var(--wp-text-secondary)', fontSize: '12px', lineHeight: 1.5 }}>
          The Gateway database persists cryptographic SHA-256 verifiers only. Plaintext tokens (<code>urumi_live_...</code>) are generated via secure random bytes and revealed strictly once.
        </p>
      </div>

      {/* Generate API Key Modal Dialog */}
      {isCreateOpen && (
        <div className="modal-overlay" onClick={() => !isCreating && setIsCreateOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '1.75rem', border: '1px solid var(--wp-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--wp-border-subtle)', paddingBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
                {createdResult ? 'API Key Generated' : 'Generate Downstream MCP API Key'}
              </h2>
              <button
                onClick={() => setIsCreateOpen(false)}
                style={{ background: 'none', border: 'none', color: '#50575e', fontSize: '16px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {!createdResult ? (
              <form onSubmit={handleCreateKey}>
                <p style={{ color: 'var(--wp-text-secondary)', fontSize: '13px', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                  Generates an authenticated Bearer token for your AI assistant client (Claude Desktop, Cursor, or custom script) to connect to Port 3000 (<code>/mcp</code>).
                </p>

                <div className="form-group">
                  <label className="form-label">Key Descriptive Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Claude Desktop Production"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    disabled={isCreating}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Expiration Period</label>
                  <select
                    className="form-select"
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(Number(e.target.value))}
                    disabled={isCreating}
                  >
                    <option value={30}>30 Days</option>
                    <option value={60}>60 Days</option>
                    <option value={90}>90 Days (Recommended)</option>
                    <option value={180}>180 Days</option>
                    <option value={365}>365 Days (1 Year)</option>
                    <option value={0}>No Expiration (Indefinite)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.75rem', borderTop: '1px solid var(--wp-border-subtle)', paddingTop: '1rem' }}>
                  <button
                    type="button"
                    onClick={() => setIsCreateOpen(false)}
                    className="btn btn-secondary"
                    disabled={isCreating}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isCreating}
                  >
                    {isCreating ? 'Generating...' : 'Generate Secret Key'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div className="wp-notice wp-notice-warning" style={{ margin: '0 0 1.25rem 0' }}>
                  <div>
                    <strong>⚠️ Important: Copy your secret key now!</strong>
                    <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', marginTop: '0.2rem' }}>
                      This token is stored as a SHA-256 hash on the server and will <strong>never</strong> be displayed again.
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Plaintext Bearer Key</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      className="form-input"
                      readOnly
                      value={createdResult.rawKey}
                      style={{ fontFamily: 'var(--wp-font-mono)', fontSize: '12px', color: '#135e96' }}
                    />
                    <button
                      type="button"
                      onClick={handleCopyRawKey}
                      className="btn btn-primary"
                    >
                      {copiedKey ? 'Copied! ✓' : 'Copy Key'}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: '1.25rem', fontSize: '12px', color: 'var(--wp-text-muted)' }}>
                  <strong>Claude Desktop Configuration:</strong>
                  <pre style={{ background: '#f6f7f7', padding: '0.75rem', borderRadius: '3px', marginTop: '0.4rem', fontFamily: 'var(--wp-font-mono)', fontSize: '11px', overflowX: 'auto', border: '1px solid var(--wp-border)' }}>
{`"mcpServers": {
  "urumi": {
    "url": "http://dashboard.127.0.0.1.nip.io:8080/mcp",
    "headers": {
      "Authorization": "Bearer ${createdResult.rawKey}"
    }
  }
}`}
                  </pre>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', borderTop: '1px solid var(--wp-border-subtle)', paddingTop: '1rem' }}>
                  <button
                    onClick={() => {
                      setIsCreateOpen(false);
                      fetchKeys();
                    }}
                    className="btn btn-secondary"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
