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
  VscHistory,
  VscSync,
  VscLink,
  VscCopy,
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
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [mergeBranch, setMergeBranch] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [diff, setDiff] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [initialized, setInitialized] = useState(true);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneToken, setCloneToken] = useState(() => localStorage.getItem('piratedev_github_token') || '');
  const [cloneLoading, setCloneLoading] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [syncConfig, setSyncConfig] = useState({ enabled: false, webhookSecret: '', lastSync: null, autoSync: false });
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remotes, setRemotes] = useState([]);
  const [syncCopied, setSyncCopied] = useState(false);

  const syncBranch = useCallback((branchName) => {
    setCurrentBranch(branchName || '');
    window.dispatchEvent(new CustomEvent('git:branch-changed', {
      detail: { project, branch: branchName || '' },
    }));
  }, [project]);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const [statusRes, logRes, branchesRes] = await Promise.all([
        api.get(`/git/${project}/status`),
        api.get(`/git/${project}/log`).catch(() => ({ data: { commits: [] } })),
        api.get(`/git/${project}/branches`).catch(() => ({ data: { branches: [], currentBranch: '' } })),
      ]);
      const data = statusRes.data;
      const branchName = branchesRes.data.currentBranch || data.branch || '';

      setFiles(data.files || []);
      setInitialized(data.initialized !== false);
      setCommits(logRes.data.commits || []);
      setBranches(branchesRes.data.branches || []);
      syncBranch(branchName);
      setMergeBranch((prev) => {
        const availableBranches = (branchesRes.data.branches || []).filter((branch) => branch.name !== branchName);
        if (availableBranches.some((branch) => branch.name === prev)) return prev;
        return availableBranches[0]?.name || '';
      });
    } catch (err) {
      console.error('Git refresh error:', err);
    }
    setLoading(false);
  }, [project, syncBranch]);

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

  const handleClone = async () => {
    if (!cloneUrl.trim()) return;
    setCloneLoading(true);
    try {
      if (cloneToken) localStorage.setItem('piratedev_github_token', cloneToken);
      const res = await api.post(`/git/${project}/clone`, { repoUrl: cloneUrl, token: cloneToken || undefined });
      setOutput(res.data.message || 'Cloned successfully');
      setInitialized(true);
      refresh();
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    } finally {
      setCloneLoading(false);
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

  const handleOpenDiff = (file) => {
    window.dispatchEvent(new CustomEvent('ide:open-diff', { detail: { file } }));
  };

  const handleOpenHistory = () => {
    window.dispatchEvent(new CustomEvent('ide:open-file-history'));
  };

  const loadSyncConfig = useCallback(async () => {
    if (!project) return;
    try {
      const [syncRes, remoteRes] = await Promise.all([
        api.get(`/git/${project}/sync-config`).catch(() => ({ data: {} })),
        api.get(`/git/${project}/remote`).catch(() => ({ data: { remotes: [] } })),
      ]);
      setSyncConfig(syncRes.data || {});
      setRemotes(remoteRes.data.remotes || []);
      const origin = (remoteRes.data.remotes || []).find(r => r.name === 'origin' && r.type === 'fetch');
      if (origin) setRemoteUrl(origin.url);
    } catch {}
  }, [project]);

  useEffect(() => { if (showSync) loadSyncConfig(); }, [showSync, loadSyncConfig]);

  const handleToggleSync = async (field, value) => {
    try {
      const res = await api.post(`/git/${project}/sync-config`, { [field]: value });
      setSyncConfig(res.data);
      setOutput(`GitHub sync ${field}: ${value ? 'enabled' : 'disabled'}`);
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    }
  };

  const handleSetRemote = async () => {
    if (!remoteUrl.trim()) return;
    try {
      const token = cloneToken || localStorage.getItem('piratedev_github_token') || '';
      const res = await api.post(`/git/${project}/remote`, { url: remoteUrl, token: token || undefined });
      setOutput(res.data.message || 'Remote set');
      loadSyncConfig();
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    }
  };

  const getWebhookUrl = () => {
    const base = window.location.origin.replace(/:\d+$/, ':3000');
    return `${base}/api/git/webhook/${project}`;
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(getWebhookUrl());
    setSyncCopied(true);
    setTimeout(() => setSyncCopied(false), 2000);
  };

  const handleCreateBranch = async () => {
    const name = window.prompt('New branch name');
    if (!name?.trim()) return;

    try {
      const branchName = name.trim();
      const res = await api.post(`/git/${project}/branch`, { name: branchName });
      setOutput(res.data.output || `Created branch ${branchName}`);
      syncBranch(res.data.branch || branchName);
      refresh();
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    }
  };

  const handleCheckout = async (branch) => {
    if (!branch || branch === currentBranch) return;

    try {
      const res = await api.post(`/git/${project}/checkout`, { branch });
      setOutput(res.data.output || `Switched to ${branch}`);
      syncBranch(res.data.branch || branch);
      refresh();
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    }
  };

  const handleMerge = async () => {
    if (!mergeBranch) return;

    try {
      const res = await api.post(`/git/${project}/merge`, { branch: mergeBranch });
      setOutput(res.data.output || `Merged ${mergeBranch} into ${currentBranch}`);
      syncBranch(res.data.branch || currentBranch);
      refresh();
    } catch (err) {
      setOutput(err.response?.data?.error || err.message);
    }
  };

  const mergeOptions = branches.filter((branch) => branch.name !== currentBranch);

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
        <div style={{ marginTop: 8, borderTop: '1px solid #333', paddingTop: 8 }}>
          <p style={{ ...styles.muted, marginBottom: 6 }}>Or clone from GitHub:</p>
          <input
            style={styles.input}
            placeholder="https://github.com/user/repo.git"
            value={cloneUrl}
            onChange={(e) => setCloneUrl(e.target.value)}
          />
          <input
            style={{ ...styles.input, marginTop: 4 }}
            placeholder="GitHub token (optional)"
            type="password"
            value={cloneToken}
            onChange={(e) => setCloneToken(e.target.value)}
          />
          <button
            style={{ ...styles.btn, marginTop: 4 }}
            onClick={handleClone}
            disabled={!cloneUrl.trim() || cloneLoading}
          >
            <VscGitPullRequest size={14} /> {cloneLoading ? 'Cloning...' : 'Clone Repo'}
          </button>
        </div>
        {output && (
          <div style={styles.output}>
            <pre style={styles.outputPre}>{output}</pre>
          </div>
        )}
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

      <div style={styles.branchCard}>
        <div style={styles.branchMeta}>
          <span style={styles.sectionTitle}>Current Branch</span>
          <span style={styles.branchName}>{currentBranch || 'No branch'}</span>
        </div>
        <div style={styles.branchActions}>
          <select
            style={styles.select}
            value={currentBranch}
            onChange={(e) => handleCheckout(e.target.value)}
            disabled={loading || branches.length === 0}
          >
            {branches.length === 0 ? (
              <option value="">No branches</option>
            ) : (
              branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.current ? `Current: ${branch.name}` : branch.name}
                </option>
              ))
            )}
          </select>
          <button style={styles.btn} onClick={handleCreateBranch}>
            <VscAdd size={14} /> New Branch
          </button>
        </div>
        <div style={styles.branchActions}>
          <select
            style={styles.select}
            value={mergeBranch}
            onChange={(e) => setMergeBranch(e.target.value)}
            disabled={loading || mergeOptions.length === 0}
          >
            {mergeOptions.length === 0 ? (
              <option value="">No branches to merge</option>
            ) : (
              mergeOptions.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))
            )}
          </select>
          <button style={styles.btn} onClick={handleMerge} disabled={!mergeBranch}>
            <VscGitPullRequest size={14} /> Merge
          </button>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Changes ({files.length})</div>
        {files.length === 0 ? (
          <p style={styles.muted}>No changes</p>
        ) : (
          <ul style={styles.fileList}>
            {files.map((f, i) => (
              <li
                key={i}
                style={styles.fileItem}
                onClick={() => handleOpenDiff(f.file)}
                onMouseEnter={(event) => { event.currentTarget.style.background = '#2a2d2e'; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleOpenDiff(f.file);
                  }
                }}
              >
                <StatusIcon status={f.status} />
                <span style={styles.fileName}>{f.file}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
          <button style={styles.btn} onClick={handleOpenHistory}>
            <VscHistory size={14} /> History
          </button>
          <button
            style={{ ...styles.btn, background: showSync ? '#1b7a3a' : '#0e639c' }}
            onClick={() => setShowSync(!showSync)}
          >
            <VscSync size={14} /> Sync
          </button>
        </div>
      </div>

      {showSync && (
        <div style={styles.syncCard}>
          <div style={styles.sectionTitle}>GitHub Bidirectional Sync</div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
            <VscLink size={14} />
            <input
              style={{ ...styles.input, flex: 1 }}
              placeholder="https://github.com/user/repo.git"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
            />
            <button style={styles.btn} onClick={handleSetRemote}>Set</button>
          </div>
          {remotes.length > 0 && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              {remotes.filter(r => r.type === 'fetch').map(r => (
                <div key={r.name}>{r.name}: {r.url}</div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <label style={styles.toggle}>
              <input
                type="checkbox"
                checked={syncConfig.enabled}
                onChange={(e) => handleToggleSync('enabled', e.target.checked)}
              />
              <span>Enable webhook</span>
            </label>
            <label style={styles.toggle}>
              <input
                type="checkbox"
                checked={syncConfig.autoSync}
                onChange={(e) => handleToggleSync('autoSync', e.target.checked)}
              />
              <span>Auto-pull on push</span>
            </label>
          </div>

          {syncConfig.enabled && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                Add this URL as a webhook in your GitHub repo settings:
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <code style={styles.webhookUrl}>{getWebhookUrl()}</code>
                <button style={styles.iconBtn} onClick={copyWebhookUrl} title="Copy webhook URL">
                  <VscCopy size={14} />
                </button>
                {syncCopied && <span style={{ fontSize: 11, color: '#73c991' }}>Copied!</span>}
              </div>
              {syncConfig.webhookSecret && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  Secret: <code style={{ color: '#569cd6' }}>{syncConfig.webhookSecret.substring(0, 8)}...</code>
                  <button
                    style={{ ...styles.iconBtn, marginLeft: 4 }}
                    onClick={() => { navigator.clipboard.writeText(syncConfig.webhookSecret); setOutput('Secret copied'); }}
                    title="Copy full secret"
                  >
                    <VscCopy size={12} />
                  </button>
                </div>
              )}
              {syncConfig.lastSync && (
                <div style={{ fontSize: 11, color: '#73c991', marginTop: 4 }}>
                  Last sync: {new Date(syncConfig.lastSync).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {output && (
        <div style={styles.output}>
          <pre style={styles.outputPre}>{output}</pre>
        </div>
      )}

      {showDiff && (
        <div style={styles.diffSection}>
          <div style={styles.diffHeader}>
            <span>Diff</span>
            <button style={styles.iconBtn} onClick={() => setShowDiff(false)}>X</button>
          </div>
          <pre style={styles.diffPre}>{diff}</pre>
        </div>
      )}

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
  branchCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 10,
    borderRadius: 6,
    background: '#252526',
    border: '1px solid #333',
  },
  branchMeta: { display: 'flex', flexDirection: 'column', gap: 4 },
  branchName: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1.2,
    wordBreak: 'break-word',
  },
  branchActions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
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
    cursor: 'pointer',
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
  select: {
    background: '#2d2d2d',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#eee',
    padding: '6px 8px',
    fontSize: 13,
    outline: 'none',
    flex: 1,
    minWidth: 0,
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
  syncCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 10,
    borderRadius: 6,
    background: '#252526',
    border: '1px solid #1b7a3a',
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    color: '#ccc',
    cursor: 'pointer',
  },
  webhookUrl: {
    fontSize: 11,
    background: '#1a1a2e',
    padding: '4px 8px',
    borderRadius: 3,
    color: '#dcdcaa',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
  },
};
