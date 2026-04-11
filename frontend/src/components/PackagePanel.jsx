import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { VscLoading, VscPackage, VscRefresh, VscSearch, VscTrash } from 'react-icons/vsc';
import api from '../api';

function normalizeInstalled(data = {}) {
  const dependencies = Object.entries(data.dependencies || {}).map(([name, version]) => ({
    name,
    version,
    type: 'dependency',
  }));
  const devDependencies = Object.entries(data.devDependencies || {}).map(([name, version]) => ({
    name,
    version,
    type: 'devDependency',
  }));
  return [...dependencies, ...devDependencies];
}

function normalizeSearchResult(item) {
  const pkg = item.package || item;
  return {
    name: pkg.name || item.name || '',
    version: pkg.version || item.version || '',
    description: pkg.description || item.description || '',
    weeklyDownloads: item.downloads?.weekly || pkg.downloads?.weekly || item.weeklyDownloads || null,
  };
}

function formatDownloads(value) {
  if (!value) return 'downloads unavailable';
  return `${Number(value).toLocaleString()} weekly`;
}

export default function PackagePanel({ project }) {
  const [installed, setInstalled] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [installName, setInstallName] = useState('');
  const [results, setResults] = useState([]);
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState({});
  const [status, setStatus] = useState('');

  const loadInstalled = useCallback(async () => {
    if (!project) return;
    setLoadingInstalled(true);
    setStatus('');
    try {
      const res = await api.get(`/packages/installed/${encodeURIComponent(project)}`);
      setInstalled(normalizeInstalled(res.data));
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
      setInstalled([]);
    } finally {
      setLoadingInstalled(false);
    }
  }, [project]);

  useEffect(() => {
    setInstalled([]);
    setResults([]);
    setSearchTerm('');
    setInstallName('');
    loadInstalled();
  }, [loadInstalled]);

  const installedNames = useMemo(() => new Set(installed.map((pkg) => pkg.name)), [installed]);

  const searchPackages = async () => {
    const term = searchTerm.trim();
    if (!term || !project) return;
    setSearching(true);
    setStatus('');
    try {
      const res = await api.get('/packages/search', {
        params: { q: term, project },
      });
      setResults((res.data.objects || res.data.results || []).map(normalizeSearchResult));
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const installPackage = async (packageName) => {
    if (!project || !packageName) return;
    setPending((prev) => ({ ...prev, [packageName]: 'installing' }));
    setStatus('');
    try {
      await api.post('/packages/install', { project, package: packageName });
      setStatus(`Installed ${packageName}`);
      await loadInstalled();
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[packageName];
        return next;
      });
    }
  };

  const uninstallPackage = async (packageName) => {
    if (!project || !packageName) return;
    setPending((prev) => ({ ...prev, [packageName]: 'uninstalling' }));
    setStatus('');
    try {
      await api.post('/packages/uninstall', { project, package: packageName });
      setStatus(`Uninstalled ${packageName}`);
      await loadInstalled();
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[packageName];
        return next;
      });
    }
  };

  const handleManualInstall = () => {
    const name = installName.trim();
    if (!name) return;
    installPackage(name);
    setInstallName('');
  };

  if (!project) {
    return <div style={styles.container}><div style={styles.empty}>Select a project</div></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>
          <VscPackage size={15} />
          <span>Packages</span>
        </div>
        <button type="button" onClick={loadInstalled} style={styles.iconBtn} disabled={loadingInstalled} title="Refresh">
          {loadingInstalled ? <VscLoading size={14} /> : <VscRefresh size={14} />}
        </button>
      </div>

      <div style={styles.searchBox}>
        <div style={styles.searchRow}>
          <VscSearch size={14} style={styles.searchIcon} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchPackages()}
            placeholder="Search npm packages..."
            style={styles.searchInput}
          />
          <button type="button" onClick={searchPackages} style={styles.searchBtn} disabled={searching || !searchTerm.trim()}>
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>
        <div style={styles.installRow}>
          <input
            type="text"
            value={installName}
            onChange={(e) => setInstallName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualInstall()}
            placeholder="Install by package name..."
            style={styles.manualInput}
          />
          <button type="button" onClick={handleManualInstall} style={styles.installBtn} disabled={!installName.trim()}>
            Install
          </button>
        </div>
      </div>

      {status && <div style={styles.status}>{status}</div>}

      <div style={styles.content}>
        <section style={styles.section}>
          <div style={styles.sectionHeader}>Search Results</div>
          <div style={styles.list}>
            {searching && results.length === 0 ? (
              <div style={styles.empty}>Searching npm...</div>
            ) : results.length === 0 ? (
              <div style={styles.empty}>Search for a package to install</div>
            ) : (
              results.map((pkg) => (
                <div key={`${pkg.name}@${pkg.version}`} style={styles.resultRow}>
                  <div style={styles.resultMain}>
                    <div style={styles.nameLine}>
                      <span style={styles.pkgName}>{pkg.name}</span>
                      <span style={styles.pkgVersion}>{pkg.version}</span>
                    </div>
                    <div style={styles.description}>{pkg.description || 'No description'}</div>
                    <div style={styles.downloads}>{formatDownloads(pkg.weeklyDownloads)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => installPackage(pkg.name)}
                    style={styles.installBtn}
                    disabled={Boolean(pending[pkg.name]) || installedNames.has(pkg.name)}
                  >
                    {pending[pkg.name] === 'installing' ? 'Installing...' : installedNames.has(pkg.name) ? 'Installed' : 'Install'}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>Installed Packages</div>
          <div style={styles.list}>
            {loadingInstalled && installed.length === 0 ? (
              <div style={styles.empty}>Loading installed packages...</div>
            ) : installed.length === 0 ? (
              <div style={styles.empty}>No npm packages installed</div>
            ) : (
              installed.map((pkg) => (
                <div key={`${pkg.type}:${pkg.name}`} style={styles.installedRow}>
                  <div style={styles.installedMain}>
                    <span style={styles.pkgName}>{pkg.name}</span>
                    <span style={styles.pkgVersion}>{pkg.version}</span>
                    <span style={styles.typeBadge}>{pkg.type}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => uninstallPackage(pkg.name)}
                    style={styles.removeBtn}
                    title={`Uninstall ${pkg.name}`}
                    disabled={Boolean(pending[pkg.name])}
                  >
                    {pending[pkg.name] === 'uninstalling' ? <VscLoading size={14} /> : <VscTrash size={14} />}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
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
  searchBox: { padding: 10, borderBottom: '1px solid #45475a', display: 'flex', flexDirection: 'column', gap: 7, flexShrink: 0 },
  searchRow: { display: 'flex', alignItems: 'center', gap: 6 },
  installRow: { display: 'flex', alignItems: 'center', gap: 6 },
  searchIcon: { color: '#89b4fa', flexShrink: 0 },
  searchInput: {
    flex: 1,
    minWidth: 0,
    background: '#313244',
    border: '1px solid #45475a',
    color: '#cdd6f4',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
  },
  manualInput: {
    flex: 1,
    minWidth: 0,
    background: '#313244',
    border: '1px solid #45475a',
    color: '#cdd6f4',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
  },
  searchBtn: {
    background: '#313244',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    borderRadius: 6,
    padding: '6px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  installBtn: {
    background: '#89b4fa',
    color: '#11111b',
    border: '1px solid #89b4fa',
    borderRadius: 6,
    padding: '6px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontWeight: 600,
  },
  status: { padding: '6px 10px', color: '#a6e3a1', borderBottom: '1px solid #45475a', flexShrink: 0 },
  content: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 38%)', minHeight: 0, flex: 1 },
  section: { display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid #45475a' },
  sectionHeader: {
    padding: '7px 10px',
    color: '#a6adc8',
    background: '#181825',
    borderBottom: '1px solid #45475a',
    textTransform: 'uppercase',
    fontSize: 11,
    flexShrink: 0,
  },
  list: { overflowY: 'auto', minHeight: 0 },
  resultRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 10px',
    borderBottom: '1px solid #313244',
  },
  resultMain: { minWidth: 0, flex: 1 },
  nameLine: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 },
  pkgName: { color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 },
  pkgVersion: { color: '#f9e2af', fontSize: 11, flexShrink: 0 },
  description: { color: '#a6adc8', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  downloads: { color: '#6c7086', marginTop: 3, fontSize: 11 },
  installedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    borderBottom: '1px solid #313244',
  },
  installedMain: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 },
  typeBadge: {
    color: '#a6adc8',
    border: '1px solid #45475a',
    background: '#313244',
    borderRadius: 6,
    padding: '2px 5px',
    fontSize: 10,
    flexShrink: 0,
  },
  removeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: '#f38ba8',
    cursor: 'pointer',
    padding: 3,
    flexShrink: 0,
  },
  empty: { padding: 14, color: '#a6adc8', fontStyle: 'italic' },
};
