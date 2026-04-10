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
    if (!project) { setBranch(''); return; }
    api.get(`/git/${encodeURIComponent(project)}/status`)
      .then((res) => setBranch(res.data.branch || ''))
      .catch(() => setBranch(''));
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
          <span className="status-bar-item" title="Git branch">
            ⎇ {branch}
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
