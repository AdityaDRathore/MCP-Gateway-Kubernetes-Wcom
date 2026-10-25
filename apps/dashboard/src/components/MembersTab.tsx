import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export interface MemberDTO {
  id: string;
  username: string;
  role: 'admin' | 'member';
  isActive: boolean;
  createdAt: number;
  activeKeyCount: number;
}

interface InvitationResult {
  id: string;
  role: 'admin' | 'member';
  expiresAt: number;
  inviteUrl: string;
  token: string;
}

export const MembersTab: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Invite Modal State
  const [isInviteOpen, setIsInviteOpen] = useState<boolean>(false);
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [isInviting, setIsInviting] = useState<boolean>(false);
  const [inviteResult, setInviteResult] = useState<InvitationResult | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Action Loading State
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/browser/members', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Failed to fetch members (HTTP ${res.status})`);
      }

      const data = await res.json();
      setMembers(data.members || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error fetching members');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsInviting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/browser/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
        body: JSON.stringify({ role: inviteRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate invitation');
      }

      setInviteResult(data.invitation);
      setSuccessMsg(`Invitation generated successfully for role: ${data.invitation.role}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create invitation');
    } finally {
      setIsInviting(false);
    }
  };

  const handleCopyInviteUrl = () => {
    if (!inviteResult) return;
    const fullUrl = inviteResult.inviteUrl.startsWith('http')
      ? inviteResult.inviteUrl
      : `${window.location.origin}${inviteResult.inviteUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleDeactivate = async (member: MemberDTO) => {
    if (!confirm(`Are you sure you want to deactivate member "${member.username}"? Their API keys will be revoked and active sessions terminated.`)) {
      return;
    }

    setActionLoadingId(member.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/v1/browser/members/${member.id}/deactivate`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to deactivate member');
      }

      setSuccessMsg(`Member ${member.username} was successfully deactivated.`);
      await fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error during deactivation');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReactivate = async (member: MemberDTO) => {
    setActionLoadingId(member.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/v1/browser/members/${member.id}/reactivate`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reactivate member');
      }

      setSuccessMsg(`Member ${member.username} was successfully reactivated.`);
      await fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error during reactivation');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleChangeRole = async (member: MemberDTO, newRole: 'admin' | 'member') => {
    if (member.role === newRole) return;
    if (!confirm(`Change role of "${member.username}" from ${member.role} to ${newRole}?`)) {
      return;
    }

    setActionLoadingId(member.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/v1/browser/members/${member.id}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(csrfToken ? { 'X-Urumi-CSRF': csrfToken } : {}),
        },
        credentials: 'same-origin',
        body: JSON.stringify({ role: newRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update member role');
      }

      setSuccessMsg(`Updated ${member.username}'s role to ${newRole}.`);
      await fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error updating role');
    } finally {
      setActionLoadingId(null);
    }
  };

  const formatEpoch = (epoch: number) => {
    if (!epoch) return 'N/A';
    const ms = epoch < 10000000000 ? epoch * 1000 : epoch;
    return new Date(ms).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div id="members-tab-view" className="animate-fade-in">
      {/* WordPress Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ fontSize: '23px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
            Users &amp; Team Members
          </h1>
          <button
            id="btn-invite-member"
            onClick={() => {
              setInviteResult(null);
              setIsInviteOpen(true);
            }}
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.75rem', fontSize: '13px', minHeight: '30px' }}
          >
            <span>+ Add New User (Invite)</span>
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
              <th>Username</th>
              <th>Role</th>
              <th>Account Status</th>
              <th>Active Keys</th>
              <th>Registered</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--wp-text-muted)' }}>
                  Loading users from database...
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--wp-text-muted)' }}>
                  No team members found.
                </td>
              </tr>
            ) : (
              members.map((member) => {
                const isSelf = member.id === user?.id;
                const isWorking = actionLoadingId === member.id;

                return (
                  <tr key={member.id} id={`member-row-${member.username}`}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '3px',
                            background: member.role === 'admin' ? '#2271b1' : '#7f54b3',
                            color: '#ffffff',
                            fontWeight: 600,
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {member.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--wp-text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span>{member.username}</span>
                            {isSelf && (
                              <span style={{ fontSize: '11px', color: '#2271b1', background: '#f0f6fc', padding: '0.1rem 0.35rem', borderRadius: '3px' }}>
                                (You)
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--wp-text-muted)', fontFamily: 'var(--wp-font-mono)' }}>
                            {member.id}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td>
                      {user?.role === 'admin' && !isSelf ? (
                        <select
                          className="form-select"
                          value={member.role}
                          onChange={(e) => handleChangeRole(member, e.target.value as 'admin' | 'member')}
                          disabled={isWorking}
                          style={{ padding: '0.2rem 0.45rem', fontSize: '12px', width: 'auto' }}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Administrator</option>
                        </select>
                      ) : (
                        <span className={`badge badge-${member.role}`}>{member.role}</span>
                      )}
                    </td>

                    <td>
                      <span className={`badge badge-${member.isActive ? 'success' : 'danger'}`}>
                        {member.isActive ? 'active' : 'deactivated'}
                      </span>
                    </td>

                    <td>
                      <span className="code-pill">
                        {member.activeKeyCount} {member.activeKeyCount === 1 ? 'key' : 'keys'}
                      </span>
                    </td>

                    <td style={{ color: 'var(--wp-text-secondary)', fontSize: '12px' }}>
                      {formatEpoch(member.createdAt)}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      {isSelf ? (
                        <span style={{ fontSize: '12px', color: 'var(--wp-text-muted)', fontStyle: 'italic' }}>
                          Current User
                        </span>
                      ) : member.isActive ? (
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.2rem 0.65rem', fontSize: '12px', minHeight: '26px' }}
                          onClick={() => handleDeactivate(member)}
                          disabled={isWorking}
                        >
                          {isWorking ? 'Processing...' : 'Deactivate'}
                        </button>
                      ) : (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.2rem 0.65rem', fontSize: '12px', minHeight: '26px' }}
                          onClick={() => handleReactivate(member)}
                          disabled={isWorking}
                        >
                          {isWorking ? 'Processing...' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* WordPress Invite Modal Dialog */}
      {isInviteOpen && (
        <div className="modal-overlay" onClick={() => !isInviting && setIsInviteOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '1.75rem', border: '1px solid var(--wp-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--wp-border-subtle)', paddingBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--wp-text-primary)' }}>
                {inviteResult ? 'Invitation Link Generated' : 'Invite New Team Member'}
              </h2>
              <button
                onClick={() => setIsInviteOpen(false)}
                style={{ background: 'none', border: 'none', color: '#50575e', fontSize: '16px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {!inviteResult ? (
              <form onSubmit={handleCreateInvite}>
                <p style={{ color: 'var(--wp-text-secondary)', fontSize: '13px', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                  Generates a single-use cryptographic invitation token (DEC-07). The invited colleague can redeem it to establish their password credentials and join the team.
                </p>

                <div className="form-group">
                  <label className="form-label">Assign Role</label>
                  <select
                    className="form-select"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
                    disabled={isInviting}
                  >
                    <option value="member">Member (Can execute tools, self-provision own API keys, chat)</option>
                    <option value="admin">Administrator (Full control, member management, upstreams, audit logs)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.75rem', borderTop: '1px solid var(--wp-border-subtle)', paddingTop: '1rem' }}>
                  <button
                    type="button"
                    onClick={() => setIsInviteOpen(false)}
                    className="btn btn-secondary"
                    disabled={isInviting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isInviting}
                  >
                    {isInviting ? 'Generating...' : 'Create Invitation Link'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div className="wp-notice wp-notice-success" style={{ margin: '0 0 1.25rem 0' }}>
                  <div>
                    <strong>✓ Invitation token ready!</strong>
                    <div style={{ fontSize: '12px', color: 'var(--wp-text-secondary)', marginTop: '0.2rem' }}>
                      Expires: {formatEpoch(inviteResult.expiresAt)} • Role: <strong>{inviteResult.role}</strong>
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Redemption URL</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      className="form-input"
                      readOnly
                      value={inviteResult.inviteUrl}
                      style={{ fontFamily: 'var(--wp-font-mono)', fontSize: '12px' }}
                    />
                    <button
                      type="button"
                      onClick={handleCopyInviteUrl}
                      className="btn btn-primary"
                    >
                      {copiedLink ? 'Copied! ✓' : 'Copy Link'}
                    </button>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label className="form-label">Invitation Token</label>
                  <div style={{ background: '#f6f7f7', padding: '0.5rem 0.75rem', borderRadius: '3px', border: '1px solid var(--wp-border-subtle)', fontFamily: 'var(--wp-font-mono)', fontSize: '12px', wordBreak: 'break-all' }}>
                    {inviteResult.token}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', borderTop: '1px solid var(--wp-border-subtle)', paddingTop: '1rem' }}>
                  <button
                    onClick={() => {
                      setIsInviteOpen(false);
                      fetchMembers();
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
