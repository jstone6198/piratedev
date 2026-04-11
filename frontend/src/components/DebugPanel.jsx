import React, { useCallback, useEffect, useState } from 'react';
import { VscDebugAlt, VscDebugStart, VscDebugStop, VscLoading, VscRefresh } from 'react-icons/vsc';
import api from '../api';

export default function DebugPanel({ project }) {
  const [state, setState] = useState({ running: false, url: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    if (!project) return;
    setError('');
    try {
      const res = await api.get(`/debugger/${encodeURIComponent(project)}/status`);
      setState({
        running: Boolean(res.data.running),
        url: res.data.url || '',
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setState({ running: false, url: '' });
    }
  }, [project]);

  useEffect(() => {
    setState({ running: false, url: '' });
    loadStatus();
  }, [loadStatus]);

  const start = async () => {
    if (!project || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/debugger/${encodeURIComponent(project)}/start`);
      setState({
        running: Boolean(res.data.running),
        url: res.data.url || '',
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!project || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/debugger/${encodeURIComponent(project)}/stop`);
      setState({ running: false, url: '' });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!project) {
    return <div style={styles.container}><div style={styles.empty}>Select a project</div></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>
          <VscDebugAlt size={15} />
          <span>Debugger</span>
        </div>
        <button type="button" onClick={loadStatus} style={styles.iconBtn} disabled={busy} title="Refresh">
          {busy ? <VscLoading size={14} /> : <VscRefresh size={14} />}
        </button>
      </div>

      <div style={styles.content}>
        <div style={styles.statusRow}>
          <span style={state.running ? styles.runningDot : styles.stoppedDot} />
          <span>{state.running ? 'Running' : 'Stopped'}</span>
        </div>

        {state.url && (
          <div style={styles.urlBox}>
            <span style={styles.label}>Inspector URL</span>
            <code style={styles.code}>{state.url}</code>
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.actions}>
          {state.running ? (
            <button type="button" onClick={stop} style={styles.stopBtn} disabled={busy}>
              {busy ? <VscLoading size={14} /> : <VscDebugStop size={14} />}
              Stop Debugger
            </button>
          ) : (
            <button type="button" onClick={start} style={styles.startBtn} disabled={busy}>
              {busy ? <VscLoading size={14} /> : <VscDebugStart size={14} />}
              Start Debugger
            </button>
          )}

          <a href="chrome://inspect" style={styles.link}>
            Open Chrome DevTools
          </a>
        </div>

        <div style={styles.note}>
          Use Chrome inspect to attach to the Node process on port 9229.
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
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
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 14,
    overflowY: 'auto',
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8, color: '#cdd6f4', fontWeight: 600 },
  runningDot: { width: 9, height: 9, borderRadius: 8, background: '#a6e3a1' },
  stoppedDot: { width: 9, height: 9, borderRadius: 8, background: '#f38ba8' },
  urlBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    padding: 10,
    background: '#181825',
    border: '1px solid #45475a',
    borderRadius: 6,
  },
  label: { color: '#a6adc8', textTransform: 'uppercase', fontSize: 11 },
  code: { color: '#f9e2af', overflowWrap: 'anywhere', fontFamily: 'inherit' },
  error: {
    color: '#f38ba8',
    background: '#2a1d2a',
    border: '1px solid #5f3343',
    borderRadius: 6,
    padding: 9,
  },
  actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  startBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#a6e3a1',
    color: '#11111b',
    border: '1px solid #a6e3a1',
    borderRadius: 6,
    padding: '7px 10px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  stopBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#f38ba8',
    color: '#11111b',
    border: '1px solid #f38ba8',
    borderRadius: 6,
    padding: '7px 10px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  link: {
    color: '#89b4fa',
    border: '1px solid #45475a',
    borderRadius: 6,
    padding: '7px 10px',
    textDecoration: 'none',
  },
  note: { color: '#a6adc8', lineHeight: 1.5 },
  empty: { padding: 14, color: '#a6adc8', fontStyle: 'italic' },
};
