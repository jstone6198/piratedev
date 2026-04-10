import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import {
  VscGitCommit,
  VscGitPullRequest,
  VscRefresh,
  VscCloudUpload,
  VscCloudDownload,
  VscDiff,
  VscAdd,
  VscEdit,
  VscTrash,
  VscQuestion,
} from 'react-icons/vsc';

const STATUS_LABELS = {
  M: { label: 'Modified', icon: VscEdit, color: '#e2b93d' },
  A: { label: 'Added', icon: VscAdd, color: '#73c991' },
  D: { label: 'Deleted', icon: VscTrash, color: '#f14c4c' },
  '??': { label: 'Untracked', icon: VscQuestion, color: '#888' },
  R: { label: 'Renamed', icon: VscEdit, color: '#3dc9b0' },
  C: { label: 'Copied', icon: VscAdd, color: '#3dc9b0' },
};

function StatusIcon({ status }) {
  const info = STATUS_LABELS[status] || STATUS_LABELS['??'];
  const Icon = info.icon;
  return (
    <span style={{ color: info.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon size={14} />
      <span style={{ fontSize: 11, fontWeight: 600 }}>{status}</span>
    </span>
  );
}

export default function GitPanel({ project }) {
  const [files, setFiles] = useState([]);
  const [commits, setCommits] = useState([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [diff, setDiff] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [initialized, setInitialized] = useState(true);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const [statusRes, logRes] = await Promise.all([
        api.get(`/git/${project}/status`),
        api.get(`/git/${project}/log`).catch(() => ({ data: { commits: [] } })),
      ]);
      const data = statusRes.data;
      setFiles(data.files || []);
      setInitialized(data.initialized !== false);
      setCommits(logRes.data.commits || []);
    } catch (err) {
      console.error('Git refresh error:', err);
    }
    setLoading(false);
  }, [project]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleInit = async () => {
    try {
      await api.post(`/git/${project}/init`);
      setInitialized(true);
      setOutput('Repository initialized');
      refresh();
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    try {
      const res = await api.post(`/git/${project}/commit`, { message: commitMsg });
      setOutput(res.data.output || 'Committed');
      setCommitMsg('');
      refresh();
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    }
  };

  const handlePush = async () => {
    try {
      const res = await api.post(`/git/${project}/push`);
      setOutput(res.data.output || 'Pushed');
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    }
  };

  const handlePull = async () => {
    try {
      const res = await api.post(`/git/${project}/pull`);
      setOutput(res.data.output || 'Pulled');
      refresh();
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    }
  };

  const handleDiff = async () => {
    try {
      const res = await api.get(`/git/${project}/diff`);
      setDiff(res.data.diff || '(no changes)');
      setShowDiff(true);
    } catch (err) {
      setDiff(err.response?.data?.error || err.message);
      setShowDiff(true);
    }
  };

  if (!project) {
    return <div className="git-panel" style={styles.panel}><p style={styles.muted}>Select a project</p></div>;
  }

  if (!initialized) {
    return (
      <div className="git-panel" style={styles.panel}>
        <p style={styles.muted}>Not a git repository</p>
        <button style={styles.btn} onClick={handleInit}>
          <VscGitCommit size={14} /> Initialize Git
        </button>
      </div>
    );
  }

  return (
    <div className="git-panel" style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}><VscGitCommit size={14} /> Git</span>
        <button style={styles.iconBtn} onClick={refresh} title="Refresh" disabled={loading}>
          <VscRefresh size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Changed files */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Changes ({files.length})</div>
        {files.length === 0 ? (
          <p style={styles.muted}>No changes</p>
        ) : (
          <ul style={styles.fileList}>
            {files.map((f, i) => (
              <li key={i} style={styles.fileItem}>
                <StatusIcon status={f.status} />
                <span style={styles.fileName}>{f.file}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Commit */}
      <div style={styles.section}>
        <input
          style={styles.input}
          placeholder="Commit message..."
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
        />
        <div style={styles.btnRow}>
          <button style={styles.btn} onClick={handleCommit} disabled={!commitMsg.trim()}>
            <VscGitCommit size={14} /> Commit
          </button>
          <button style={styles.btn} onClick={handlePush}>
            <VscCloudUpload size={14} /> Push
          </button>
          <button style={styles.btn} onClick={handlePull}>
            <VscCloudDownload size={14} /> Pull
          </button>
          <button style={styles.btn} onClick={handleDiff}>
            <VscDiff size={14} /> Diff
          </button>
        </div>
      </div>

      {/* Output */}
      {output && (
        <div style={styles.output}>
          <pre style={styles.outputPre}>{output}</pre>
        </div>
      )}

      {/* Diff view */}
      {showDiff && (
        <div style={styles.diffSection}>
          <div style={styles.diffHeader}>
            <span>Diff</span>
            <button style={styles.iconBtn} onClick={() => setShowDiff(false)}>✕</button>
          </div>
          <pre style={styles.diffPre}>{diff}</pre>
        </div>
      )}

      {/* Recent commits */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Recent Commits</div>
        {commits.length === 0 ? (
          <p style={styles.muted}>No commits yet</p>
        ) : (
          <ul style={styles.commitList}>
            {commits.map((c) => (
              <li key={c.hash} style={styles.commitItem}>
                <span style={styles.commitHash}>{c.hash.substring(0, 7)}</span>
                <span style={styles.commitMsg}>{c.message}</span>
                <span style={styles.commitDate}>{c.date}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
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
  section: { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionTitle: { fontSize: 11, textTransform: 'uppercase', color: '#888', fontWeight: 600 },
  muted: { color: '#666', fontStyle: 'italic', margin: '2px 0', fontSize: 12 },
  fileList: { listStyle: 'none', margin: 0, padding: 0, maxHeight: 150, overflowY: 'auto' },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '2px 4px',
    borderRadius: 3,
    cursor: 'default',
  },
  fileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  input: {
    background: '#2d2d2d',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#eee',
    padding: '6px 8px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  btnRow: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  btn: {
    background: '#0e639c',
    border: 'none',
    color: '#fff',
    padding: '4px 10px',
    borderRadius: 3,
    fontSize: 12,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#ccc',
    cursor: 'pointer',
    padding: 2,
    display: 'inline-flex',
  },
  output: {
    background: '#1a1a2e',
    borderRadius: 4,
    padding: 6,
    maxHeight: 80,
    overflowY: 'auto',
  },
  outputPre: { margin: 0, fontSize: 11, color: '#aaa', whiteSpace: 'pre-wrap' },
  diffSection: {
    background: '#1a1a2e',
    borderRadius: 4,
    maxHeight: 200,
    overflowY: 'auto',
  },
  diffHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 8px',
    borderBottom: '1px solid #333',
    fontSize: 12,
    fontWeight: 600,
  },
  diffPre: { margin: 0, padding: 8, fontSize: 11, color: '#aaa', whiteSpace: 'pre-wrap' },
  commitList: { listStyle: 'none', margin: 0, padding: 0, maxHeight: 150, overflowY: 'auto' },
  commitItem: {
    display: 'flex',
    gap: 8,
    padding: '3px 4px',
    borderBottom: '1px solid #2a2a2a',
    alignItems: 'baseline',
  },
  commitHash: { fontFamily: 'monospace', color: '#569cd6', fontSize: 11, flexShrink: 0 },
  commitMsg: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  commitDate: { color: '#666', fontSize: 11, flexShrink: 0 },
};
