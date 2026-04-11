import React, { useCallback, useEffect, useState } from 'react';
import { VscChevronRight, VscGitCommit, VscHistory, VscLoading, VscRefresh } from 'react-icons/vsc';
import api from '../api';

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function FileHistory({ project, file }) {
  const [commits, setCommits] = useState([]);
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [content, setContent] = useState('');
  const [blame, setBlame] = useState([]);
  const [showBlame, setShowBlame] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const loadLog = useCallback(async () => {
    if (!project || !file) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/history/log/${encodeURIComponent(project)}`, {
        params: { path: file },
      });
      setCommits(res.data.commits || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [project, file]);

  useEffect(() => {
    setSelectedCommit(null);
    setContent('');
    setBlame([]);
    setShowBlame(false);
    loadLog();
  }, [loadLog]);

  const loadCommit = async (commit) => {
    if (!project || !file || !commit?.hash) return;
    setSelectedCommit(commit);
    setShowBlame(false);
    setDetailLoading(true);
    setError('');
    try {
      const res = await api.get(`/history/show/${encodeURIComponent(project)}`, {
        params: { path: file, commit: commit.hash },
      });
      setContent(res.data.content || '');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleBlame = async () => {
    const next = !showBlame;
    setShowBlame(next);
    if (!next || blame.length > 0 || !project || !file) return;

    setDetailLoading(true);
    setError('');
    try {
      const res = await api.get(`/history/blame/${encodeURIComponent(project)}`, {
        params: { path: file },
      });
      setBlame(res.data.blame || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  if (!project || !file) {
    return <div style={styles.panel}><p style={styles.muted}>Select a file</p></div>;
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.title}>
          <VscHistory size={15} />
          <span style={styles.path}>{file}</span>
        </div>
        <div style={styles.actions}>
          <button type="button" onClick={toggleBlame} style={showBlame ? styles.activeBtn : styles.btn}>
            Blame
          </button>
          <button type="button" onClick={loadLog} style={styles.iconBtn} disabled={loading} title="Refresh">
            {loading ? <VscLoading size={14} /> : <VscRefresh size={14} />}
          </button>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.body}>
        <div style={styles.list}>
          {loading && commits.length === 0 ? (
            <div style={styles.empty}>Loading history...</div>
          ) : commits.length === 0 ? (
            <div style={styles.empty}>No commits for this file</div>
          ) : (
            commits.map((commit) => (
              <button
                type="button"
                key={commit.hash}
                onClick={() => loadCommit(commit)}
                style={selectedCommit?.hash === commit.hash ? styles.commitRowActive : styles.commitRow}
              >
                <VscGitCommit size={13} style={styles.commitIcon} />
                <div style={styles.commitMain}>
                  <div style={styles.commitTop}>
                    <span style={styles.hash}>{commit.hash?.slice(0, 7)}</span>
                    <span style={styles.author}>{commit.author}</span>
                  </div>
                  <div style={styles.message}>{commit.subject || commit.message}</div>
                  <div style={styles.date}>{formatDate(commit.date)}</div>
                </div>
                <VscChevronRight size={14} style={styles.chevron} />
              </button>
            ))
          )}
        </div>

        <div style={styles.detail}>
          {detailLoading ? (
            <div style={styles.empty}>Loading...</div>
          ) : showBlame ? (
            <div style={styles.blameList}>
              {blame.length === 0 ? (
                <div style={styles.empty}>No blame data</div>
              ) : (
                blame.map((line, idx) => (
                  <div key={`${line.commit}-${line.finalLine}-${idx}`} style={styles.blameRow}>
                    <span style={styles.blameMeta}>
                      {line.commit?.slice(0, 7)} {line.author} {line.finalLine}
                    </span>
                    <span style={styles.blameCode}>{line.content}</span>
                  </div>
                ))
              )}
            </div>
          ) : selectedCommit ? (
            <pre style={styles.content}>{content}</pre>
          ) : (
            <div style={styles.empty}>Select a commit to view file content</div>
          )}
        </div>
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
    gap: 8,
    padding: '7px 10px',
    borderBottom: '1px solid #45475a',
    background: '#181825',
    flexShrink: 0,
  },
  title: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, color: '#89b4fa', fontWeight: 600 },
  path: { color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  btn: {
    background: '#313244',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    borderRadius: 6,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 12,
  },
  activeBtn: {
    background: '#89b4fa',
    color: '#11111b',
    border: '1px solid #89b4fa',
    borderRadius: 6,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 12,
  },
  iconBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    borderRadius: 6,
    width: 28,
    height: 26,
    cursor: 'pointer',
  },
  error: { color: '#f38ba8', padding: '6px 10px', borderBottom: '1px solid #45475a' },
  body: { display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', flex: 1, minHeight: 0 },
  list: { overflowY: 'auto', borderRight: '1px solid #45475a', minHeight: 0 },
  commitRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 7,
    width: '100%',
    padding: '7px 9px',
    background: 'transparent',
    color: '#cdd6f4',
    border: 0,
    borderBottom: '1px solid #313244',
    textAlign: 'left',
    cursor: 'pointer',
  },
  commitRowActive: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 7,
    width: '100%',
    padding: '7px 9px',
    background: '#313244',
    color: '#cdd6f4',
    border: 0,
    borderBottom: '1px solid #45475a',
    textAlign: 'left',
    cursor: 'pointer',
  },
  commitIcon: { color: '#89b4fa', marginTop: 2, flexShrink: 0 },
  commitMain: { minWidth: 0, flex: 1 },
  commitTop: { display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 },
  hash: { color: '#f9e2af', flexShrink: 0 },
  author: { color: '#a6adc8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  message: { marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  date: { marginTop: 3, color: '#6c7086', fontSize: 11 },
  chevron: { color: '#6c7086', marginTop: 2, flexShrink: 0 },
  detail: { minWidth: 0, minHeight: 0, overflow: 'auto' },
  content: { margin: 0, padding: 10, color: '#cdd6f4', fontSize: 12, lineHeight: 1.5 },
  blameList: { minWidth: 'max-content' },
  blameRow: { display: 'flex', borderBottom: '1px solid #313244', minHeight: 22 },
  blameMeta: {
    width: 250,
    flexShrink: 0,
    padding: '3px 8px',
    color: '#a6adc8',
    background: '#181825',
    borderRight: '1px solid #45475a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  blameCode: { padding: '3px 8px', whiteSpace: 'pre', color: '#cdd6f4' },
  muted: { color: '#a6adc8', margin: 10 },
  empty: { color: '#a6adc8', padding: 14, fontStyle: 'italic' },
};
