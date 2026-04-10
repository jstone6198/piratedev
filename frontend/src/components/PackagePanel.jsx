import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { VscRefresh, VscTrash, VscPackage, VscSearch } from 'react-icons/vsc';

export default function PackagePanel({ project }) {
  const [packages, setPackages] = useState([]);
  const [manager, setManager] = useState(null); // 'npm' or 'pip'
  const [searchTerm, setSearchTerm] = useState('');
  const [installName, setInstallName] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const detectManager = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setStatus('');
    try {
      // Try package.json first
      const res = await api.get(`/files/${encodeURIComponent(project)}/content`, {
        params: { path: 'package.json' },
      });
      const pkg = JSON.parse(res.data.content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      setPackages(
        Object.entries(deps).map(([name, version]) => ({ name, version }))
      );
      setManager('npm');
    } catch {
      // Try requirements.txt
      try {
        const res = await api.get(`/files/${encodeURIComponent(project)}/content`, {
          params: { path: 'requirements.txt' },
        });
        const lines = res.data.content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
        setPackages(
          lines.map((l) => {
            const [name, version] = l.split('==');
            return { name: name.trim(), version: version?.trim() || '*' };
          })
        );
        setManager('pip');
      } catch {
        setPackages([]);
        setManager(null);
        setStatus('No package.json or requirements.txt found');
      }
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    detectManager();
  }, [detectManager]);

  const runCommand = async (cmd) => {
    setLoading(true);
    setStatus(`Running: ${cmd}`);
    try {
      await api.post('/execute', { command: cmd, project });
      setStatus(`Done: ${cmd}`);
      // Refresh package list
      setTimeout(() => detectManager(), 1000);
    } catch (err) {
      setStatus(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = () => {
    if (!installName.trim() || !manager) return;
    const cmd = manager === 'npm'
      ? `npm install ${installName.trim()}`
      : `pip install ${installName.trim()}`;
    runCommand(cmd);
    setInstallName('');
  };

  const handleRemove = (pkgName) => {
    if (!manager) return;
    const cmd = manager === 'npm'
      ? `npm uninstall ${pkgName}`
      : `pip uninstall -y ${pkgName}`;
    runCommand(cmd);
  };

  const filtered = searchTerm
    ? packages.filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : packages;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <VscPackage style={{ marginRight: 6 }} />
        <span style={styles.title}>
          {manager ? `Packages (${manager})` : 'Packages'}
        </span>
        <button onClick={detectManager} style={styles.iconBtn} title="Refresh">
          <VscRefresh />
        </button>
      </div>

      {/* Install row */}
      <div style={styles.installRow}>
        <input
          type="text"
          value={installName}
          onChange={(e) => setInstallName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleInstall()}
          placeholder={manager === 'pip' ? 'pip install ...' : 'npm install ...'}
          style={styles.input}
          disabled={!manager || loading}
        />
        <button
          onClick={handleInstall}
          style={styles.installBtn}
          disabled={!manager || loading || !installName.trim()}
        >
          Install
        </button>
      </div>

      {/* Search filter */}
      <div style={styles.searchRow}>
        <VscSearch style={{ marginRight: 4, flexShrink: 0, color: '#888' }} />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter packages..."
          style={styles.filterInput}
        />
      </div>

      {/* Status */}
      {status && <div style={styles.status}>{status}</div>}

      {/* Package list */}
      <div style={styles.list}>
        {loading && packages.length === 0 && (
          <div style={styles.empty}>Loading...</div>
        )}
        {!loading && packages.length === 0 && !status && (
          <div style={styles.empty}>No packages found</div>
        )}
        {filtered.map((pkg) => (
          <div key={pkg.name} style={styles.pkgRow}>
            <span style={styles.pkgName}>{pkg.name}</span>
            <span style={styles.pkgVersion}>{pkg.version}</span>
            <button
              onClick={() => handleRemove(pkg.name)}
              style={styles.removeBtn}
              title={`Remove ${pkg.name}`}
              disabled={loading}
            >
              <VscTrash />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1e1e1e',
    color: '#cccccc',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    borderBottom: '1px solid #333',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#999',
  },
  title: { flex: 1 },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#999',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: 14,
  },
  installRow: {
    display: 'flex',
    gap: 4,
    padding: '6px 10px',
    borderBottom: '1px solid #333',
  },
  input: {
    flex: 1,
    background: '#2d2d2d',
    border: '1px solid #444',
    color: '#ccc',
    padding: '4px 8px',
    borderRadius: 3,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    outline: 'none',
  },
  installBtn: {
    background: '#007acc',
    color: '#fff',
    border: 'none',
    padding: '4px 12px',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderBottom: '1px solid #333',
  },
  filterInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: '#ccc',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    outline: 'none',
  },
  status: {
    padding: '4px 10px',
    fontSize: 11,
    color: '#888',
    borderBottom: '1px solid #333',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
  },
  empty: {
    padding: '20px 10px',
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
  },
  pkgRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderBottom: '1px solid #2a2a2a',
    gap: 8,
  },
  pkgName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pkgVersion: {
    color: '#888',
    fontSize: 11,
    flexShrink: 0,
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: 13,
    flexShrink: 0,
  },
};
