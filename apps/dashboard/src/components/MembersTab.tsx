import React from 'react';

interface MemberItem {
  id: string;
  username: string;
  role: 'admin' | 'member';
  status: 'active' | 'deactivated';
  createdDate: string;
}

const MEMBERS_DATA: MemberItem[] = [
  { id: 'usr-admin-1', username: 'admin', role: 'admin', status: 'active', createdDate: '2026-10-18' },
  { id: 'usr-member-1', username: 'developer', role: 'member', status: 'active', createdDate: '2026-10-19' },
  { id: 'usr-deact-1', username: 'contractor_legacy', role: 'member', status: 'deactivated', createdDate: '2026-10-15' },
];

export const MembersTab: React.FC = () => {
  return (
    <div id="members-tab-view" className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Team Members &amp; Lifecycle Management</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Manage team access, account roles, and membership lifecycle (DEC-07).
          </p>
        </div>
        <div>
          <button className="btn btn-primary" id="btn-invite-member">
            + Invite Member
          </button>
        </div>
      </div>

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined Date</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {MEMBERS_DATA.map((member) => (
              <tr key={member.id} id={`member-row-${member.username}`}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: member.role === 'admin' ? 'linear-gradient(135deg, var(--brand-primary), #4338ca)' : 'rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 600,
                        fontSize: '0.875rem',
                      }}
                    >
                      {member.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{member.username}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {member.id}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`badge badge-${member.role}`}>{member.role}</span>
                </td>
                <td>
                  <span className={`badge badge-${member.status === 'active' ? 'success' : 'danger'}`}>
                    {member.status}
                  </span>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{member.createdDate}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
