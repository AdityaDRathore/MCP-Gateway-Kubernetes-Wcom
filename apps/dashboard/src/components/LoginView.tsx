import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Please provide both username and password.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const result = await login(username.trim(), password);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error || 'Authentication failed. Please verify your credentials.');
    }
  };

  return (
    <div
      id="login-view-container"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '1.5rem',
      }}
    >
      <div
        className="glass-panel animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '2.5rem',
        }}
      >
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px',
              height: '56px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, var(--brand-primary), var(--accent-cyan))',
              marginBottom: '1rem',
              boxShadow: '0 8px 24px var(--brand-glow)',
            }}
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h1 style={{ fontSize: '1.65rem', marginBottom: '0.5rem' }}>Urumi Team Gateway</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Kubernetes-Native MCP Gateway Dashboard
          </p>
        </div>

        {/* Error Alert Banner */}
        {error && (
          <div
            id="login-error-banner"
            className="animate-fade-in"
            style={{
              padding: '0.85rem 1rem',
              marginBottom: '1.5rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--status-danger-bg)',
              border: '1px solid var(--status-danger)',
              color: '#fca5a5',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} id="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="login-username-input">
              Username
            </label>
            <input
              id="login-username-input"
              type="text"
              className="form-input"
              placeholder="e.g. admin or member"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSubmitting}
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1.75rem' }}>
            <label className="form-label" htmlFor="login-password-input">
              Password
            </label>
            <input
              id="login-password-input"
              type="password"
              className="form-input"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            id="login-submit-button"
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.85rem' }}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span>Authenticating...</span>
            ) : (
              <span>Sign In to Dashboard</span>
            )}
          </button>
        </form>

        {/* Security Perimeter Notice */}
        <div
          style={{
            marginTop: '2rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          🔒 Dual-Listener Security Perimeter Active: Browser API &amp; Session Controls strictly isolated on Port 3001.
        </div>
      </div>
    </div>
  );
};
