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
      setError(result.error || 'Authentication failed. Please check your username and password.');
    }
  };

  return (
    <div
      id="login-view-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem 1.5rem',
        background: '#f0f0f1',
      }}
    >
      {/* WordPress Official Mark */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <svg width="84" height="84" viewBox="0 0 20 20" fill="#1d2327">
          <path d="M10 0C4.477 0 0 4.477 0 10c0 5.523 4.477 10 10 10s10-4.477 10-10c0-5.523-4.477-10-10-10zm0 1.25c4.832 0 8.75 3.918 8.75 8.75 0 2.227-.833 4.26-2.207 5.81l-4.52-12.388c.026-.007.054-.015.083-.021.572-.115 1.137-.184 1.137-.184s.138-.023.138-.184c0-.161-.253-.161-.253-.161l-3.565.184s-.138.023-.138.184c0 .161.161.184.161.184s.552.069 1.058.161l2.484 6.786-3.473-9.513c.023-.008.046-.017.07-.024.575-.115 1.138-.184 1.138-.184s.138-.023.138-.184c0-.161-.253-.161-.253-.161l-3.565.184s-.138.023-.138.184c0 .161.161.184.161.184s.552.069 1.058.161l3.565 9.765L6.44 3.738s.552-.069 1.058-.161c0 0 .161-.023.161-.184 0-.161-.138-.184-.138-.184l-3.565.184s-.138.023-.138.184c0 .161.161.184.161.184s.552.069 1.058.161c.025.005.048.012.072.018L1.758 12.92A8.72 8.72 0 0 1 1.25 10c0-4.832 3.918-8.75 8.75-8.75zm-6.52 9.435L6.685 17.5A8.71 8.71 0 0 1 2.37 12.44c.32-.056.702-.12 1.11-.155zm6.543 8.058c-1.282 0-2.485-.276-3.57-.77l3.714-10.793 3.805 10.428a8.71 8.71 0 0 1-3.95.135h.001z" />
        </svg>
        <div style={{ marginTop: '0.5rem', fontWeight: 600, fontSize: '16px', color: '#1d2327' }}>
          Urumi Store Administration
        </div>
      </div>

      {/* Login Box */}
      <div
        className="wp-card animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '380px',
          padding: '2rem 1.75rem',
          background: '#ffffff',
          border: '1px solid #c3c4c7',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          borderRadius: '4px',
        }}
      >
        {/* Error Notice */}
        {error && (
          <div
            id="login-error-banner"
            className="wp-notice wp-notice-error animate-fade-in"
            style={{ margin: '0 0 1.25rem 0' }}
          >
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} id="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="login-username-input">
              Username or Email Address
            </label>
            <input
              id="login-username-input"
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSubmitting}
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label" htmlFor="login-password-input">
              Password
            </label>
            <input
              id="login-password-input"
              type="password"
              className="form-input"
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
            style={{ width: '100%', padding: '0.55rem', fontSize: '13px' }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Authenticating...' : 'Log In'}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', borderTop: '1px solid #dcdcde', paddingTop: '1rem', fontSize: '12px', color: '#646970', textAlign: 'center' }}>
          🔒 Port 3001 Isolated Browser Management Session
        </div>
      </div>
    </div>
  );
};
