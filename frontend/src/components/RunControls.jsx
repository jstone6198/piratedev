import React, { useCallback, useEffect, useState } from 'react';
import { VscDebugStop, VscLoading, VscPlay, VscTerminal } from 'react-icons/vsc';
import api, { socket } from '../api';

function labelForType(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('node')) return 'Node';
  if (normalized.includes('python')) return 'Python';
  if (normalized.includes('go')) return 'Go';
  if (normalized.includes('static')) return 'Static';
  return type || 'Unknown';
}

export default function RunControls({ project }) {
  const [state, setState] = useState({ running: false, projectType: '', output: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const detect = useCallback(async () => {
    if (!project) return;
    setError('');
    try {
      const [detectRes, statusRes] = await Promise.all([
        api.post(`/runner/detect/${encodeURIComponent(project)}`),
        api.get(`/runner/status/${encodeURIComponent(project)}`).catch(() => ({ data: {} })),
      ]);
      setState((prev) => ({
        ...prev,
        projectType: detectRes.data.type || statusRes.data.type || '',
        running: Boolean(statusRes.data.running),
      }));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }, [project]);

  useEffect(() => {
    setState({ running: false, projectType: '', output: '' });
    detect();
  }, [detect]);

  useEffect(() => {
    function handleOutput(payload) {
      if (!payload || payload.project !== project) return;
      setState((prev) => ({
        ...prev,
        running: payload.stream === 'system' && payload.data?.includes('Process exited') ? false : prev.running,
        output: `${prev.output}${payload.data || ''}`.slice(-4000),
      }));
    }

    socket.on('runner:output', handleOutput);
    return () => socket.off('runner:output', handleOutput);
  }, [project]);

  const start = async () => {
    if (!project || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/runner/start/${encodeURIComponent(project)}`);
      setState((prev) => ({
        ...prev,
        running: true,
        projectType: res.data.type || prev.projectType,
        output: `${prev.output}$ ${res.data.command || 'started'}\n`,
      }));
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
      await api.post(`/runner/stop/${encodeURIComponent(project)}`);
      setState((prev) => ({ ...prev, running: false, output: `${prev.output}$ stopped\n` }));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <span style={styles.badge}>{labelForType(state.projectType)}</span>
      {state.running ? (
        <button type="button" onClick={stop} style={styles.stopBtn} disabled={!project || busy}>
          {busy ? <VscLoading size={14} /> : <VscDebugStop size={14} />}
          Stop
        </button>
      ) : (
        <button type="button" onClick={start} style={styles.playBtn} disabled={!project || busy}>
          {busy ? <VscLoading size={14} /> : <VscPlay size={14} />}
          Run
        </button>
      )}
      <div style={styles.output} title={state.output || error || 'No runner output'}>
        <VscTerminal size={14} />
        <span style={styles.outputText}>{error || state.output.trim().split('\n').slice(-1)[0] || 'Ready'}</span>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    color: '#cdd6f4',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  badge: {
    border: '1px solid #45475a',
    background: '#313244',
    color: '#89b4fa',
    borderRadius: 6,
    padding: '3px 7px',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  },
  playBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    background: '#a6e3a1',
    color: '#11111b',
    border: '1px solid #a6e3a1',
    borderRadius: 6,
    padding: '3px 9px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  stopBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    background: '#f38ba8',
    color: '#11111b',
    border: '1px solid #f38ba8',
    borderRadius: 6,
    padding: '3px 9px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  output: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
    maxWidth: 280,
    color: '#a6adc8',
  },
  outputText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
};
