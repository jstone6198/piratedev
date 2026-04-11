import React, { useState } from 'react';
import api from '../api';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
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

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>PirateDev™</h1>
          <p style={styles.subtitle}>Sign in to access the IDE.</p>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
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
          <label style={styles.label}>
            Password
            <input
              style={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
            />
          </label>
          {error ? <div style={styles.error}>{error}</div> : null}
          <button style={styles.button} type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
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
  },
  card: {
    width: '100%',
    maxWidth: '360px',
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
  },
};
