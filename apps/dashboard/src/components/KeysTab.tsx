import React from 'react';

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  owner: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
}

const KEYS_DATA: ApiKeyItem[] = [
  {
    id: 'key-1',
    name: 'Claude Desktop Local Dev',
    prefix: 'urumi_live_a1b2c3...',
    owner: 'admin',
    createdAt: '2026-10-18',
    lastUsedAt: '2 mins ago',
    status: 'active',
  },
  {
    id: 'key-2',
    name: 'CI/CD Regression Bot',
    prefix: 'urumi_live_x9y8z7...',
    owner: 'developer',
    createdAt: '2026-10-19',
    lastUsedAt: '1 hour ago',
    status: 'active',
  },
];

export const KeysTab: React.FC = () => {
  return (
    <div id="keys-tab-view" className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Team MCP API Keys (Self-Service)</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Generate and manage Bearer API tokens for downstream MCP clients (Claude Desktop, Cursor, Custom Agents).
          </p>
        </div>
        <div>
          <button className="btn btn-primary" id="btn-create-key">
            + Generate New API Key
          </button>
        </div>
      </div>

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Key Name</th>
              <th>Key Prefix</th>
              <th>Owner</th>
              <th>Created</th>
              <th>Last Used</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {KEYS_DATA.map((k) => (
              <tr key={k.id} id={`key-row-${k.id}`}>
                <td style={{ fontWeight: 600 }}>{k.name}</td>
                <td>
                  <span className="code-pill">{k.prefix}</span>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{k.owner}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{k.createdAt}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{k.lastUsedAt || 'Never'}</td>
                <td>
                  <span className={`badge badge-${k.status === 'active' ? 'success' : 'danger'}`}>
                    {k.status}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', color: 'var(--status-danger)' }}>
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '1.5rem', padding: '1rem', borderRadius: 'var(--radius-md)', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-subtle)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
        🔒 <strong>Zero Plaintext Storage Invariant:</strong> The Gateway persists cryptographic SHA-256 verifiers only. Plaintext bearer keys are revealed exactly once upon generation.
      </div>
    </div>
  );
};
