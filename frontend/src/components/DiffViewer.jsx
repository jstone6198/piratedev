import React, { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { VscClose, VscDiff, VscLoading } from 'react-icons/vsc';
import api from '../api';

function getLanguage(file = '') {
  const ext = file.split('.').pop()?.toLowerCase();
  const languages = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    py: 'python',
    go: 'go',
    rs: 'rust',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
  };
  return languages[ext] || 'plaintext';
}

export default function DiffViewer({ project, file, onClose }) {
  const [diff, setDiff] = useState({ original: '', modified: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadDiff() {
      if (!project || !file) return;
      setLoading(true);
      setError('');
      try {
        const res = await api.get(`/diff/file/${encodeURIComponent(project)}`, {
          params: { path: file },
        });
        if (!cancelled) {
          setDiff({
            original: res.data.original || '',
            modified: res.data.modified || '',
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDiff();
    return () => {
      cancelled = true;
    };
  }, [project, file]);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.title}>
          <VscDiff size={15} />
          <span style={styles.path}>{file || 'Diff'}</span>
        </div>
        <button type="button" onClick={onClose} style={styles.closeBtn} title="Close diff">
          <VscClose size={16} />
        </button>
      </div>

      {loading ? (
        <div style={styles.center}>
          <VscLoading size={18} />
          <span>Loading diff...</span>
        </div>
      ) : error ? (
        <div style={styles.error}>{error}</div>
      ) : (
        <DiffEditor
          height="100%"
          language={getLanguage(file)}
          original={diff.original}
          modified={diff.modified}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            automaticLayout: true,
            wordWrap: 'on',
          }}
        />
      )}
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
    border: '1px solid #45475a',
    fontFamily: "'JetBrains Mono', monospace",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '7px 10px',
    borderBottom: '1px solid #45475a',
    background: '#181825',
    flexShrink: 0,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    color: '#89b4fa',
    fontSize: 12,
    fontWeight: 600,
  },
  path: {
    color: '#cdd6f4',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  closeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid #45475a',
    color: '#cdd6f4',
    width: 28,
    height: 26,
    borderRadius: 6,
    cursor: 'pointer',
    flexShrink: 0,
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    color: '#a6adc8',
    fontSize: 13,
  },
  error: {
    margin: 12,
    padding: 10,
    border: '1px solid #f38ba8',
    color: '#f38ba8',
    borderRadius: 6,
    background: '#2b1b24',
    fontSize: 12,
  },
};
