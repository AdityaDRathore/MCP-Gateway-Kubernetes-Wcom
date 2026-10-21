import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { OverviewTab } from './OverviewTab';
import { UpstreamsTab } from './UpstreamsTab';
import { MembersTab } from './MembersTab';
import { KeysTab } from './KeysTab';
import { AuditTab } from './AuditTab';
import { ChatTab } from './ChatTab';

type TabType = 'overview' | 'upstreams' | 'members' | 'keys' | 'audit' | 'chat';

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const navItems: { id: TabType; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'chat', label: 'AI Assistant', icon: '🤖' },
    { id: 'upstreams', label: 'Upstreams & Catalog', icon: '⚡' },
    { id: 'members', label: 'Team Members', icon: '👥' },
    { id: 'keys', label: 'API Keys', icon: '🔑' },
    { id: 'audit', label: 'Audit Trail', icon: '📜' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column' }}>
      {/* Top Navbar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 2rem',
          background: 'rgba(16, 23, 38, 0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-subtle)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(135deg, var(--brand-primary), var(--accent-cyan))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px var(--brand-glow)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
              Urumi Team Gateway
            </h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Kubernetes MCP Cluster
            </span>
          </div>
        </div>

        {/* User Pill & Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              padding: '0.35rem 0.85rem',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: user?.role === 'admin' ? 'var(--brand-primary)' : 'var(--accent-cyan)',
                color: '#fff',
                fontSize: '0.75rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {user?.username.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{user?.username}</span>
            <span className={`badge badge-${user?.role}`}>{user?.role}</span>
          </div>

          <button
            id="nav-logout-btn"
            onClick={logout}
            className="btn btn-secondary"
            style={{ padding: '0.45rem 0.85rem', fontSize: '0.8125rem' }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* Sidebar Navigation */}
        <aside
          style={{
            width: '240px',
            background: 'rgba(10, 15, 26, 0.6)',
            borderRight: '1px solid var(--border-subtle)',
            padding: '1.5rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', padding: '0 0.75rem 0.5rem' }}>
            Control Center
          </div>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-tab-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: isActive ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  color: isActive ? '#a5b4fc' : 'var(--text-secondary)',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '0.875rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Content View */}
        <main style={{ flex: 1, padding: '2.5rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'chat' && <ChatTab />}
          {activeTab === 'upstreams' && <UpstreamsTab />}
          {activeTab === 'members' && <MembersTab />}
          {activeTab === 'keys' && <KeysTab />}
          {activeTab === 'audit' && <AuditTab />}
        </main>
      </div>
    </div>
  );
};
