import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { OverviewTab } from './OverviewTab';
import { UpstreamsTab } from './UpstreamsTab';
import { MembersTab } from './MembersTab';
import { KeysTab } from './KeysTab';
import { AuditTab } from './AuditTab';
import { ChatTab } from './ChatTab';

export type TabType = 'overview' | 'chat' | 'upstreams' | 'members' | 'keys' | 'audit';

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const navItems: { id: TabType; label: string; icon: React.ReactNode; count?: string }[] = [
    {
      id: 'overview',
      label: 'Architecture & Health',
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path d="M2 3a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm0 9a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4z" />
        </svg>
      ),
    },
    {
      id: 'chat',
      label: 'AI MCP Assistant',
      count: 'Copilot',
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 0 1-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-5 0H8v2h2V9z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      id: 'upstreams',
      label: 'Upstreams & Tools',
      count: '3',
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path d="M11.3 1.046A1 1 0 0 1 12 2v5h4a1 1 0 0 1 .82 1.573l-7 10A1 1 0 0 1 8 18v-5H4a1 1 0 0 1-.82-1.573l7-10a1 1 0 0 1 1.12-.381z" />
        </svg>
      ),
    },
    {
      id: 'members',
      label: 'Team Members',
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path d="M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm7 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm-8 7c0-2.21-3.58-3-5-3s-5 .79-5 3v1h10v-1zm9-1c0-1.66-2.69-2.25-3.75-2.25-.5 0-.96.08-1.39.22.68.83 1.14 1.83 1.14 2.03v1h4v-1z" />
        </svg>
      ),
    },
    {
      id: 'keys',
      label: 'Team API Keys',
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 8a6 6 0 0 1-7.743 5.743L10 14l-1 1-1 1H6v2H4v2H2v-4l5.257-5.257A6 6 0 1 1 18 8zm-6-4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      id: 'audit',
      label: 'Audit Trail Ledger',
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4zm2 6a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1zm1 3a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7z" clipRule="evenodd" />
        </svg>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', background: 'var(--wp-bg-canvas)' }}>
      {/* WordPress Admin Top Bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '46px',
          padding: '0 1.5rem',
          background: 'var(--wp-admin-bar)',
          color: '#ffffff',
          position: 'sticky',
          top: 0,
          zIndex: 9999,
          borderBottom: '1px solid #101517',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        {/* Left: WordPress Brand & Site Name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Official WordPress W Logo SVG */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <svg width="24" height="24" viewBox="0 0 20 20" fill="#ffffff">
              <path d="M10 0C4.477 0 0 4.477 0 10c0 5.523 4.477 10 10 10s10-4.477 10-10c0-5.523-4.477-10-10-10zm0 1.25c4.832 0 8.75 3.918 8.75 8.75 0 2.227-.833 4.26-2.207 5.81l-4.52-12.388c.026-.007.054-.015.083-.021.572-.115 1.137-.184 1.137-.184s.138-.023.138-.184c0-.161-.253-.161-.253-.161l-3.565.184s-.138.023-.138.184c0 .161.161.184.161.184s.552.069 1.058.161l2.484 6.786-3.473-9.513c.023-.008.046-.017.07-.024.575-.115 1.138-.184 1.138-.184s.138-.023.138-.184c0-.161-.253-.161-.253-.161l-3.565.184s-.138.023-.138.184c0 .161.161.184.161.184s.552.069 1.058.161l3.565 9.765L6.44 3.738s.552-.069 1.058-.161c0 0 .161-.023.161-.184 0-.161-.138-.184-.138-.184l-3.565.184s-.138.023-.138.184c0 .161.161.184.161.184s.552.069 1.058.161c.025.005.048.012.072.018L1.758 12.92A8.72 8.72 0 0 1 1.25 10c0-4.832 3.918-8.75 8.75-8.75zm-6.52 9.435L6.685 17.5A8.71 8.71 0 0 1 2.37 12.44c.32-.056.702-.12 1.11-.155zm6.543 8.058c-1.282 0-2.485-.276-3.57-.77l3.714-10.793 3.805 10.428a8.71 8.71 0 0 1-3.95.135h.001z" />
            </svg>
            <span style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '-0.01em', color: '#f0f0f1' }}>
              Urumi Store
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '12px', color: '#c3c4c7', borderLeft: '1px solid #3c434a', paddingLeft: '0.85rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00a32a' }} />
            <span>MCP Gateway 1.0.0 (Kubernetes Active)</span>
          </div>
        </div>

        {/* Right: Howdy, User & Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '13px', color: '#c3c4c7' }}>
              Howdy, <strong style={{ color: '#ffffff' }}>{user?.username}</strong>
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '0.15rem 0.45rem',
                borderRadius: '3px',
                background: user?.role === 'admin' ? '#2271b1' : '#7f54b3',
                color: '#ffffff',
                textTransform: 'uppercase',
              }}
            >
              {user?.role}
            </span>
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: '#4f5760',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {user?.username.charAt(0).toUpperCase()}
            </div>
          </div>

          <button
            id="nav-logout-btn"
            onClick={logout}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#72aee6',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.35rem 0.5rem',
            }}
          >
            <span>Log Out</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* WordPress Admin Sidebar */}
        <nav
          style={{
            width: '220px',
            background: 'var(--wp-admin-menu)',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #101517',
          }}
        >
          <div style={{ padding: '0.75rem 0' }}>
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
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '0.65rem 1rem',
                    border: 'none',
                    borderLeft: isActive ? '4px solid #2271b1' : '4px solid transparent',
                    background: isActive ? '#2271b1' : 'transparent',
                    color: isActive ? '#ffffff' : '#c3c4c7',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: '13px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#2c3338';
                      e.currentTarget.style.color = '#72aee6';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#c3c4c7';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <span style={{ color: isActive ? '#ffffff' : '#a7aaad' }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  {item.count && (
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '0.1rem 0.45rem',
                        borderRadius: '9999px',
                        background: isActive ? 'rgba(255,255,255,0.2)' : '#3c434a',
                        color: '#ffffff',
                        fontWeight: 600,
                      }}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* WordPress Footer Info */}
          <div
            style={{
              marginTop: 'auto',
              padding: '1rem',
              borderTop: '1px solid #2c3338',
              fontSize: '11px',
              color: '#8c8f94',
              lineHeight: 1.5,
            }}
          >
            <div><strong>WordPress 6.7</strong> &amp; <strong>WooCommerce</strong></div>
            <div>MCP Cluster Gateway Engine</div>
            <div style={{ color: '#00a32a', marginTop: '0.25rem' }}>● Ingress Port 8080 Active</div>
          </div>
        </nav>

        {/* Main Content Area */}
        <main style={{ flex: 1, padding: '2rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
          {activeTab === 'overview' && <OverviewTab onNavigateTab={(tab) => setActiveTab(tab)} />}
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
