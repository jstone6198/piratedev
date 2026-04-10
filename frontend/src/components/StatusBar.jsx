import React, { useState, useEffect } from 'react';
import api, { socket } from '../api';

const EXT_LANG = {
  js: 'JavaScript', mjs: 'JavaScript', jsx: 'React JSX', ts: 'TypeScript', tsx: 'React TSX',
  py: 'Python', sh: 'Shell', go: 'Go', rb: 'Ruby', c: 'C', cpp: 'C++', rs: 'Rust',
  html: 'HTML', css: 'CSS', json: 'JSON', md: 'Markdown', yml: 'YAML', yaml: 'YAML',
  sql: 'SQL', xml: 'XML', txt: 'Plain Text',
};

function getLang(file) {
  if (!file) return '';
  const ext = file.split('.').pop().toLowerCase();
  return EXT_LANG[ext] || ext.toUpperCase();
}

export default function StatusBar({ activeFile, project }) {
  const [connected, setConnected] = useState(socket.connected);
  const [branch, setBranch] = useState('');
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // Track socket connection
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // Fetch git branch
  useEffect(() => {
    if (!project) {
      setBranch('');
      return undefined;
    }

    let cancelled = false;
    const loadBranch = async () => {
      try {
        const [statusRes, branchesRes] = await Promise.all([
          api.get(`/git/${encodeURIComponent(project)}/status`).catch(() => ({ data: {} })),
          api.get(`/git/${encodeURIComponent(project)}/branches`).catch(() => ({ data: {} })),
        ]);
        if (!cancelled) {
          setBranch(statusRes.data.branch || branchesRes.data.currentBranch || '');
        }
      } catch {
        if (!cancelled) setBranch('');
      }
    };

    const handleBranchChanged = (event) => {
      if (event.detail?.project === project) {
        setBranch(event.detail?.branch || '');
      }
    };

    loadBranch();
    const interval = setInterval(loadBranch, 10000);
    window.addEventListener('git:branch-changed', handleBranchChanged);
    window.addEventListener('focus', loadBranch);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('git:branch-changed', handleBranchChanged);
      window.removeEventListener('focus', loadBranch);
    };
  }, [project]);

  // Track cursor position from Monaco editor
  useEffect(() => {
    const interval = setInterval(() => {
      const editors = window._monacoEditors;
      if (editors) {
        const editor = Object.values(editors).find(Boolean);
        if (editor) {
          const pos = editor.getPosition();
          if (pos) setCursorPos({ line: pos.lineNumber, col: pos.column });
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {branch && (
          <span className="status-bar-item" title="Git branch" style={styles.branchBadge}>
            <span style={styles.branchIcon}>⎇</span>
            <span style={styles.branchText}>{branch}</span>
          </span>
        )}
      </div>
      <div className="status-bar-right">
        {activeFile && (
          <span className="status-bar-item">
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
        )}
        <span className="status-bar-item">UTF-8</span>
        {activeFile && (
          <span className="status-bar-item">{getLang(activeFile)}</span>
        )}
        <span className={`status-bar-item status-bar-connection ${connected ? 'connected' : 'disconnected'}`}>
          <span className="status-bar-dot" />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
    </div>
  );
}

const styles = {
  branchBadge: {
    background: 'rgba(14, 99, 156, 0.18)',
    border: '1px solid rgba(86, 156, 214, 0.4)',
    borderRadius: 999,
    padding: '2px 8px',
    color: '#d6ecff',
    fontWeight: 600,
  },
  branchIcon: {
    color: '#73c991',
  },
  branchText: {
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};
