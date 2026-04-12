import React, { useState, useEffect } from 'react';
import api from '../api';

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [providers, setProviders] = useState({ githubConfigured: false, googleConfigured: false });

  useEffect(() => {
    // Check URL for OAuth error
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'oauth_failed') {
      setError('OAuth sign-in failed. Please try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Fetch available providers
    api
      .get('/auth/providers')
      .then(({ data }) => setProviders(data))
      .catch(() => {});
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const { data } = await api.post('/auth/login', { username, password });
      localStorage.setItem('auth-token', data.token);
      onLogin?.({ token: data.token, user: data.user });
    } catch (submitError) {
      setError(submitError.response?.data?.error || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data } = await api.post('/auth/register', { username, email, password });
      localStorage.setItem('auth-token', data.token);
      onLogin?.({ token: data.token, user: data.user });
    } catch (submitError) {
      setError(submitError.response?.data?.error || 'Registration failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = (provider) => {
    window.location.href = `/api/auth/${provider}`;
  };

  const isLogin = mode === 'login';

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>PirateDev™</h1>
          <p style={styles.subtitle}>
            {isLogin ? 'Sign in to access the IDE.' : 'Create your account.'}
          </p>
        </div>

        {/* OAuth Buttons */}
        {(providers.githubConfigured || providers.googleConfigured) && (
          <>
            <div style={styles.oauthSection}>
              {providers.githubConfigured && (
                <button
                  style={styles.oauthButton}
                  onClick={() => handleOAuth('github')}
                  type="button"
                >
                  <svg style={styles.oauthIcon} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  Continue with GitHub
                </button>
              )}
              {providers.googleConfigured && (
                <button
                  style={styles.oauthButton}
                  onClick={() => handleOAuth('google')}
                  type="button"
                >
                  <svg style={styles.oauthIcon} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>
              )}
            </div>
            <div style={styles.divider}>
              <span style={styles.dividerLine} />
              <span style={styles.dividerText}>or</span>
              <span style={styles.dividerLine} />
            </div>
          </>
        )}

        {/* Login / Register Form */}
        <form onSubmit={isLogin ? handleLogin : handleRegister} style={styles.form}>
          <label style={styles.label}>
            Username
            <input
              style={styles.input}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={isSubmitting}
            />
          </label>

          {!isLogin && (
            <label style={styles.label}>
              Email
              <input
                style={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
              />
            </label>
          )}

          <label style={styles.label}>
            Password
            <input
              style={styles.input}
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
            />
          </label>

          {!isLogin && (
            <label style={styles.label}>
              Confirm Password
              <input
                style={styles.input}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={isSubmitting}
              />
            </label>
          )}

          {error ? <div style={styles.error}>{error}</div> : null}

          <button style={styles.button} type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? isLogin
                ? 'Signing in...'
                : 'Creating account...'
              : isLogin
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <div style={styles.switchMode}>
          {isLogin ? (
            <span>
              Don't have an account?{' '}
              <button
                type="button"
                style={styles.switchLink}
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
              >
                Register
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{' '}
              <button
                type="button"
                style={styles.switchLink}
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
              >
                Sign in
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'radial-gradient(circle at top, #252526 0%, #1e1e1e 55%, #141414 100%)',
    color: '#f3f3f3',
    padding: '24px',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: '380px',
    backgroundColor: '#252526',
    border: '1px solid #333333',
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
    padding: '28px',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 700,
  },
  subtitle: {
    margin: '8px 0 0',
    color: '#a6a6a6',
    fontSize: '14px',
  },
  oauthSection: {
    display: 'grid',
    gap: '10px',
    marginBottom: '0',
  },
  oauthButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    width: '100%',
    padding: '11px 14px',
    backgroundColor: '#1e1e1e',
    border: '1px solid #3c3c3c',
    borderRadius: '8px',
    color: '#f3f3f3',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'border-color 0.15s, background-color 0.15s',
  },
  oauthIcon: {
    width: '18px',
    height: '18px',
    flexShrink: 0,
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '20px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    backgroundColor: '#3c3c3c',
  },
  dividerText: {
    color: '#6c6c6c',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  form: {
    display: 'grid',
    gap: '16px',
  },
  label: {
    display: 'grid',
    gap: '8px',
    fontSize: '13px',
    color: '#d4d4d4',
  },
  input: {
    backgroundColor: '#1e1e1e',
    border: '1px solid #3c3c3c',
    borderRadius: '8px',
    color: '#f3f3f3',
    fontSize: '14px',
    padding: '12px 14px',
    outline: 'none',
    fontFamily: 'inherit',
  },
  error: {
    borderRadius: '8px',
    backgroundColor: 'rgba(248, 81, 73, 0.14)',
    border: '1px solid rgba(248, 81, 73, 0.4)',
    color: '#ff7b72',
    padding: '10px 12px',
    fontSize: '13px',
  },
  button: {
    border: 0,
    borderRadius: '8px',
    backgroundColor: '#0e639c',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
    padding: '12px 14px',
    fontFamily: 'inherit',
  },
  switchMode: {
    textAlign: 'center',
    marginTop: '16px',
    fontSize: '13px',
    color: '#a6a6a6',
  },
  switchLink: {
    background: 'none',
    border: 'none',
    color: '#4fc1ff',
    cursor: 'pointer',
    fontSize: '13px',
    padding: 0,
    textDecoration: 'underline',
    fontFamily: 'inherit',
  },
};
