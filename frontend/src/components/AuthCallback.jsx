import React, { useEffect } from 'react';

export default function AuthCallback({ onLogin }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const username = params.get('username');
    const error = params.get('error');

    if (error) {
      window.location.href = '/login?error=oauth_failed';
      return;
    }

    if (token) {
      localStorage.setItem('auth-token', token);
      if (username) {
        localStorage.setItem('piratedev_user', username);
      }
      if (onLogin) {
        onLogin({ token, user: { username, role: 'user' } });
      }
      window.history.replaceState({}, '', '/');
      window.location.href = '/';
    } else {
      window.location.href = '/login?error=no_token';
    }
  }, [onLogin]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1e1e1e',
        color: '#f3f3f3',
        fontSize: '16px',
      }}
    >
      Signing you in...
    </div>
  );
}
