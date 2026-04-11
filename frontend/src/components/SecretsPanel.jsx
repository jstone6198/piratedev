import React, { useCallback, useEffect, useState } from 'react';
import { VscKey, VscLock, VscRefresh, VscSave, VscTrash } from 'react-icons/vsc';
import api from '../api';

export default function SecretsPanel({ project }) {
  const [keys, setKeys] = useState([]);
  const [form, setForm] = useState({ key: '', value: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const loadKeys = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setStatus('');
    try {
      const res = await api.get(`/secrets/${encodeURIComponent(project)}`);
      setKeys(res.data.keys || []);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    setKeys([]);
    setForm({ key: '', value: '' });
    loadKeys();
  }, [loadKeys]);

  const saveSecret = async () => {
    if (!form.key.trim() || !form.value || !project) return;
    setSaving(true);
    setStatus('');
    try {
      await api.post(`/secrets/${encodeURIComponent(project)}`, {
        key: form.key.trim(),
        value: form.value,
      });
      setForm({ key: '', value: '' });
      setStatus('Saved');
      await loadKeys();
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteSecret = async (key) => {
    if (!window.confirm(`Delete secret ${key}?`)) return;
    setStatus('');
    try {
      await api.delete(`/secrets/${encodeURIComponent(project)}/${encodeURIComponent(key)}`);
      await loadKeys();
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  if (!project) {
    return <div style={styles.panel}><p style={styles.muted}>Select a project</p></div>;
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.title}>
          <VscLock size={15} />
          <span>Secrets</span>
        </div>
        <button type="button" onClick={loadKeys} style={styles.iconBtn} disabled={loading} title="Refresh">
          <VscRefresh size={14} />
        </button>
      </div>

      <div style={styles.form}>
        <input
          style={styles.keyInput}
          value={form.key}
          onChange={(e) => setForm((prev) => ({ ...prev, key: e.target.value }))}
          placeholder="KEY"
        />
        <input
          style={styles.valueInput}
          value={form.value}
          onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && saveSecret()}
          placeholder="value"
          type="password"
        />
        <button type="button" onClick={saveSecret} style={styles.saveBtn} disabled={saving || !form.key.trim() || !form.value}>
          <VscSave size={14} />
          Save
        </button>
      </div>

      {status && <div style={styles.status}>{status}</div>}

      <div style={styles.list}>
        {loading && keys.length === 0 ? (
          <div style={styles.empty}>Loading secrets...</div>
        ) : keys.length === 0 ? (
          <div style={styles.empty}>No secrets stored</div>
        ) : (
          keys.map((key) => (
            <div key={key} style={styles.row}>
              <VscKey size={14} style={styles.keyIcon} />
              <span style={styles.name}>{key}</span>
              <span style={styles.masked}>****</span>
              <button type="button" onClick={() => deleteSecret(key)} style={styles.deleteBtn} title={`Delete ${key}`}>
                <VscTrash size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: '#1e1e2e',
    color: '#cdd6f4',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '7px 10px',
    borderBottom: '1px solid #45475a',
    background: '#181825',
    flexShrink: 0,
  },
  title: { display: 'flex', alignItems: 'center', gap: 7, color: '#89b4fa', fontWeight: 600 },
  form: { display: 'flex', gap: 6, padding: 10, borderBottom: '1px solid #45475a', flexShrink: 0 },
  keyInput: {
    width: '32%',
    minWidth: 90,
    background: '#313244',
    color: '#f9e2af',
    border: '1px solid #45475a',
    borderRadius: 6,
    padding: '6px 8px',
    outline: 'none',
    fontFamily: 'inherit',
    fontSize: 12,
  },
  valueInput: {
    flex: 1,
    minWidth: 80,
    background: '#313244',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    borderRadius: 6,
    padding: '6px 8px',
    outline: 'none',
    fontFamily: 'inherit',
    fontSize: 12,
  },
  saveBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    background: '#89b4fa',
    color: '#11111b',
    border: '1px solid #89b4fa',
    borderRadius: 6,
    padding: '6px 10px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  iconBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid #45475a',
    color: '#cdd6f4',
    borderRadius: 6,
    width: 28,
    height: 26,
    cursor: 'pointer',
  },
  status: { padding: '6px 10px', color: '#a6e3a1', borderBottom: '1px solid #45475a' },
  list: { overflowY: 'auto', minHeight: 0 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    borderBottom: '1px solid #313244',
  },
  keyIcon: { color: '#89b4fa', flexShrink: 0 },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  masked: { color: '#a6adc8', letterSpacing: 0, flexShrink: 0 },
  deleteBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: '#f38ba8',
    cursor: 'pointer',
    padding: 3,
    flexShrink: 0,
  },
  empty: { padding: 14, color: '#a6adc8', fontStyle: 'italic' },
  muted: { color: '#a6adc8', margin: 10 },
};
