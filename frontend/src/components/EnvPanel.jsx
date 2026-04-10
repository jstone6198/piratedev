import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import {
  VscKey,
  VscSave,
  VscAdd,
  VscTrash,
  VscEye,
  VscEyeClosed,
  VscRefresh,
} from 'react-icons/vsc';

export default function EnvPanel({ project }) {
  const [vars, setVars] = useState([]);
  const [revealed, setRevealed] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const loadVars = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const res = await api.get(`/env/${project}`);
      setVars((res.data.vars || []).map(v => ({ key: v.key, value: v.value, masked: v.masked })));
      setRevealed(new Set());
      setStatus('');
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
    setLoading(false);
  }, [project]);

  useEffect(() => { loadVars(); }, [loadVars]);

  const handleSave = async () => {
    const valid = vars.filter(v => v.key.trim());
    try {
      await api.put(`/env/${project}`, { vars: valid.map(v => ({ key: v.key, value: v.value })) });
      setStatus('Saved');
      setTimeout(() => setStatus(''), 2000);
      loadVars();
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const addRow = () => {
    setVars(prev => [...prev, { key: '', value: '', masked: '***' }]);
  };

  const removeRow = (idx) => {
    setVars(prev => prev.filter((_, i) => i !== idx));
  };

  const updateVar = (idx, field, val) => {
    setVars(prev => prev.map((v, i) => (i === idx ? { ...v, [field]: val } : v)));
  };

  const toggleReveal = (idx) => {
    setRevealed(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  if (!project) {
    return <div style={styles.panel}><p style={styles.muted}>Select a project</p></div>;
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}><VscKey size={14} /> Environment Variables</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={styles.iconBtn} onClick={loadVars} title="Refresh" disabled={loading}>
            <VscRefresh size={14} />
          </button>
          <button style={styles.iconBtn} onClick={addRow} title="Add variable">
            <VscAdd size={14} />
          </button>
        </div>
      </div>

      {status && <div style={styles.status}>{status}</div>}

      <div style={styles.table}>
        {vars.length === 0 ? (
          <p style={styles.muted}>No environment variables. Click + to add.</p>
        ) : (
          vars.map((v, idx) => (
            <div key={idx} style={styles.row}>
              <input
                style={styles.keyInput}
                placeholder="KEY"
                value={v.key}
                onChange={(e) => updateVar(idx, 'key', e.target.value)}
              />
              <span style={styles.eq}>=</span>
              <input
                style={styles.valInput}
                placeholder="value"
                type={revealed.has(idx) ? 'text' : 'password'}
                value={v.value}
                onChange={(e) => updateVar(idx, 'value', e.target.value)}
              />
              <button style={styles.iconBtn} onClick={() => toggleReveal(idx)} title={revealed.has(idx) ? 'Hide' : 'Reveal'}>
                {revealed.has(idx) ? <VscEye size={14} /> : <VscEyeClosed size={14} />}
              </button>
              <button style={{ ...styles.iconBtn, color: '#f14c4c' }} onClick={() => removeRow(idx)} title="Remove">
                <VscTrash size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {vars.length > 0 && (
        <button style={styles.saveBtn} onClick={handleSave}>
          <VscSave size={14} /> Save .env
        </button>
      )}
    </div>
  );
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 10,
    color: '#ccc',
    fontSize: 13,
    height: '100%',
    overflowY: 'auto',
    background: '#1e1e1e',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #333',
    paddingBottom: 6,
  },
  title: { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 14 },
  muted: { color: '#666', fontStyle: 'italic', margin: '2px 0', fontSize: 12 },
  status: {
    background: '#1a1a2e',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 12,
    color: '#7ec8e3',
  },
  table: { display: 'flex', flexDirection: 'column', gap: 4 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  keyInput: {
    background: '#2d2d2d',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#ce9178',
    padding: '4px 6px',
    fontSize: 12,
    fontFamily: 'monospace',
    width: '35%',
    outline: 'none',
    boxSizing: 'border-box',
  },
  eq: { color: '#666', fontSize: 14, flexShrink: 0 },
  valInput: {
    background: '#2d2d2d',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#eee',
    padding: '4px 6px',
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
    outline: 'none',
    boxSizing: 'border-box',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#ccc',
    cursor: 'pointer',
    padding: 2,
    display: 'inline-flex',
    flexShrink: 0,
  },
  saveBtn: {
    background: '#0e639c',
    border: 'none',
    color: '#fff',
    padding: '6px 14px',
    borderRadius: 4,
    fontSize: 13,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
};
