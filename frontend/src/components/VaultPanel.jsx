import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { FaKey, FaCheck, FaTimes } from 'react-icons/fa';

export default function VaultPanel({ visible, onClose, project }) {
  const [services, setServices] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [message, setMessage] = useState(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/vault/keys');
      setServices(res.data.services || []);
    } catch (err) {
      console.error('Vault fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      fetchKeys();
      setSelected(new Set());
      setMessage(null);
    }
  }, [visible, fetchKeys]);

  const toggle = (keyPath) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(keyPath)) next.delete(keyPath);
      else next.add(keyPath);
      return next;
    });
  };

  const inject = async () => {
    if (!project || selected.size === 0) return;
    setInjecting(true);
    setMessage(null);
    try {
      const res = await api.post('/vault/inject', {
        project,
        keys: Array.from(selected),
      });
      setMessage({ type: 'success', text: `Injected ${res.data.injected} keys to .env` });
      setSelected(new Set());
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || err.message });
    } finally {
      setInjecting(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="vault-panel-modal" onClick={e => e.stopPropagation()}>
        <div className="vault-header">
          <FaKey style={{ marginRight: 8 }} />
          <span>API Key Vault</span>
          <button className="vps-close-btn" onClick={onClose}><FaTimes /></button>
        </div>

        {loading && <div className="vps-loading">Loading keys...</div>}

        {!loading && services.map(svc => (
          <div key={svc.name} className="vault-service">
            <div className="vault-service-name">{svc.name}</div>
            {svc.keys.map(k => (
              <label key={k.key} className="vault-key-row">
                <input
                  type="checkbox"
                  checked={selected.has(k.key)}
                  onChange={() => toggle(k.key)}
                />
                <span className="vault-key-name">{k.key}</span>
                <span className="vault-key-value">{k.masked}</span>
              </label>
            ))}
          </div>
        ))}

        {message && (
          <div className={`vault-message vault-message-${message.type}`}>
            {message.type === 'success' ? <FaCheck /> : null} {message.text}
          </div>
        )}

        <div className="vault-actions">
          <button
            className="vault-inject-btn"
            onClick={inject}
            disabled={!project || selected.size === 0 || injecting}
          >
            {injecting ? 'Injecting...' : `Inject ${selected.size} key${selected.size !== 1 ? 's' : ''} to ${project || '...'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
