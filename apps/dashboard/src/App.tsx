import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginView } from './components/LoginView';
import { DashboardLayout } from './components/DashboardLayout';

const AppContent: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        id="app-loading-screen"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: '1rem',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '3px solid rgba(255, 255, 255, 0.1)',
            borderTopColor: 'var(--brand-primary)',
            borderRadius: '50%',
            animation: 'spin 800ms linear infinite',
          }}
        />
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Verifying security perimeter...
        </div>
      </div>
    );
  }

  return user ? <DashboardLayout /> : <LoginView />;
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};
