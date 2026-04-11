import React, { useCallback, useEffect, useMemo, useState } from 'react';

const IDE_KEY = window.IDE_KEY || '';

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-ide-key': IDE_KEY,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}`);
  }

  return data;
}

export default function ConnectorPanel({ project }) {
  const [available, setAvailable] = useState([]);
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState({});
  const [status, setStatus] = useState('');
  const [setupResult, setSetupResult] = useState(null);
  const [testResults, setTestResults] = useState({});

  const activeIds = useMemo(() => new Set(active.map((connector) => connector.id)), [active]);

  const loadAvailable = useCallback(async () => {
    const data = await request('/api/connectors/available');
    setAvailable(Array.isArray(data) ? data : data.connectors || []);
  }, []);

  const loadActive = useCallback(async () => {
    if (!project) {
      setActive([]);
      return;
    }

    const data = await request(`/api/connectors/${encodeURIComponent(project)}/active`);
    setActive(Array.isArray(data) ? data : data.connectors || []);
  }, [project]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus('');
    try {
      await Promise.all([loadAvailable(), loadActive()]);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }, [loadAvailable, loadActive]);

  useEffect(() => {
    setSetupResult(null);
    setTestResults({});
    refresh();
  }, [refresh]);

  const setPendingState = (connectorId, value) => {
    setPending((prev) => {
      const next = { ...prev };
      if (value) {
        next[connectorId] = value;
      } else {
        delete next[connectorId];
      }
      return next;
    });
  };

  const addConnector = async (connectorId) => {
    if (!project) return;

    setPendingState(connectorId, 'adding');
    setStatus('');
    setSetupResult(null);
    try {
      const data = await request(`/api/connectors/${encodeURIComponent(project)}/add`, {
        method: 'POST',
        body: JSON.stringify({ connectorId }),
      });
      setSetupResult({ connectorId, files: data.files || [], instructions: data.instructions || '' });
      await loadActive();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setPendingState(connectorId, null);
    }
  };

  const removeConnector = async (connectorId) => {
    if (!project) return;

    setPendingState(connectorId, 'removing');
    setStatus('');
    try {
      await request(`/api/connectors/${encodeURIComponent(project)}/${encodeURIComponent(connectorId)}`, {
        method: 'DELETE',
      });
      setSetupResult(null);
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[connectorId];
        return next;
      });
      await loadActive();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setPendingState(connectorId, null);
    }
  };

  const testConnector = async (connectorId) => {
    if (!project) return;

    setPendingState(connectorId, 'testing');
    setTestResults((prev) => ({ ...prev, [connectorId]: null }));
    try {
      const data = await request(`/api/connectors/${encodeURIComponent(project)}/${encodeURIComponent(connectorId)}/test`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setTestResults((prev) => ({
        ...prev,
        [connectorId]: { success: true, message: data.message || 'Connection verified' },
      }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [connectorId]: { success: false, message: error.message },
      }));
    } finally {
      setPendingState(connectorId, null);
    }
  };

  if (!project) {
    return (
      <div style={styles.panel}>
        <div style={styles.empty}>Select a project</div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <style>{'@keyframes connector-spin { to { transform: rotate(360deg); } }'}</style>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>External Connectors</div>
          <div style={styles.subtitle}>Add connectors to integrate external services</div>
        </div>
        <button type="button" style={styles.secondaryButton} onClick={refresh} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {status && <div style={styles.error}>{status}</div>}

      <section style={styles.section}>
        <div style={styles.sectionTitle}>Active Connectors</div>
        {active.length === 0 ? (
          <div style={styles.empty}>Add connectors to integrate external services</div>
        ) : (
          <div style={styles.activeList}>
            {active.map((connector) => {
              const result = testResults[connector.id];
              return (
                <div key={connector.id} style={styles.activeRow}>
                  <div style={styles.activeMain}>
                    <div style={styles.activeName}>{connector.name}</div>
                    <div style={styles.activeMeta}>{connector.npmPackage}</div>
                    {result && (
                      <div style={result.success ? styles.successText : styles.errorText}>
                        {result.success ? '✓' : '✕'} {result.message}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={() => testConnector(connector.id)}
                    disabled={Boolean(pending[connector.id])}
                  >
                    {pending[connector.id] === 'testing' ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    type="button"
                    style={styles.removeButton}
                    onClick={() => removeConnector(connector.id)}
                    disabled={Boolean(pending[connector.id])}
                  >
                    {pending[connector.id] === 'removing' ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {setupResult && (
        <section style={styles.resultBox}>
          <div style={styles.sectionTitle}>Setup Complete</div>
          <div style={styles.resultLabel}>Created files</div>
          <ul style={styles.fileList}>
            {setupResult.files.map((file) => (
              <li key={file} style={styles.fileItem}>{file}</li>
            ))}
          </ul>
          <div style={styles.resultLabel}>Instructions</div>
          <div style={styles.instructions}>{setupResult.instructions}</div>
        </section>
      )}

      <section style={styles.section}>
        <div style={styles.sectionTitle}>Available Connectors</div>
        <div style={styles.grid}>
          {available.map((connector) => {
            const isActive = activeIds.has(connector.id);
            const isPending = Boolean(pending[connector.id]);
            return (
              <div key={connector.id} style={styles.card}>
                <div style={styles.cardTop}>
                  <div style={styles.icon}>{connector.icon}</div>
                  {isActive && <span style={styles.badge}>Added</span>}
                </div>
                <div style={styles.cardName}>{connector.name}</div>
                <div style={styles.description}>{connector.description}</div>
                <div style={styles.packageName}>{connector.npmPackage}</div>
                <div style={styles.envVars}>
                  {(connector.envVars || []).map((envVar) => (
                    <span key={envVar.key} style={styles.envVar}>{envVar.key}</span>
                  ))}
                </div>
                <button
                  type="button"
                  style={isActive ? styles.disabledButton : styles.addButton}
                  onClick={() => addConnector(connector.id)}
                  disabled={isActive || isPending}
                >
                  {isPending ? <span style={styles.spinner} /> : null}
                  {isPending ? 'Adding...' : isActive ? 'Added' : 'Add'}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const buttonBase = {
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    height: '100%',
    minHeight: 0,
    overflowY: 'auto',
    background: '#1e1e1e',
    color: '#f0f0f0',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    padding: 12,
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottom: '1px solid #333',
    paddingBottom: 10,
  },
  title: { fontSize: 15, fontWeight: 700, color: '#f0f0f0' },
  subtitle: { color: '#aaa', marginTop: 3 },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionTitle: {
    color: '#f0f0f0',
    fontWeight: 700,
    fontSize: 13,
  },
  activeList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  activeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #333',
    borderRadius: 6,
    background: '#252525',
    padding: 10,
  },
  activeMain: { flex: 1, minWidth: 0 },
  activeName: { color: '#f0f0f0', fontWeight: 700 },
  activeMeta: { color: '#aaa', marginTop: 3 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minHeight: 190,
    border: '1px solid #333',
    borderRadius: 8,
    background: '#252525',
    padding: 12,
    boxSizing: 'border-box',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  icon: { fontSize: 28, lineHeight: 1 },
  badge: {
    border: '1px solid #2f7d46',
    color: '#7ee787',
    borderRadius: 6,
    padding: '2px 6px',
    fontSize: 11,
  },
  cardName: { fontSize: 14, fontWeight: 700, color: '#f0f0f0' },
  description: { color: '#c8c8c8', lineHeight: 1.45, flex: 1 },
  packageName: { color: '#8ab4f8' },
  envVars: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  envVar: {
    border: '1px solid #333',
    background: '#1e1e1e',
    color: '#d6d6d6',
    borderRadius: 6,
    padding: '2px 5px',
    fontSize: 10,
  },
  addButton: {
    ...buttonBase,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: '#0e639c',
    border: '1px solid #1177bb',
    color: '#fff',
    fontWeight: 700,
  },
  disabledButton: {
    ...buttonBase,
    background: '#333',
    border: '1px solid #444',
    color: '#aaa',
    cursor: 'default',
  },
  secondaryButton: {
    ...buttonBase,
    background: '#2b2b2b',
    border: '1px solid #333',
    color: '#f0f0f0',
    whiteSpace: 'nowrap',
  },
  removeButton: {
    ...buttonBase,
    background: '#3a2020',
    border: '1px solid #7a3434',
    color: '#ffb3b3',
    whiteSpace: 'nowrap',
  },
  resultBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    border: '1px solid #2f7d46',
    borderRadius: 8,
    background: '#202820',
    padding: 10,
  },
  resultLabel: { color: '#aaa', fontSize: 11, textTransform: 'uppercase' },
  fileList: { margin: 0, paddingLeft: 18, color: '#f0f0f0' },
  fileItem: { margin: '2px 0' },
  instructions: { color: '#d6d6d6', lineHeight: 1.45 },
  successText: { color: '#7ee787', marginTop: 5, overflowWrap: 'anywhere' },
  errorText: { color: '#ff7b72', marginTop: 5, overflowWrap: 'anywhere' },
  error: {
    border: '1px solid #7a3434',
    background: '#3a2020',
    color: '#ffb3b3',
    borderRadius: 6,
    padding: 8,
  },
  empty: {
    border: '1px dashed #333',
    borderRadius: 6,
    color: '#aaa',
    padding: 12,
    fontStyle: 'italic',
  },
  spinner: {
    width: 12,
    height: 12,
    border: '2px solid rgba(255, 255, 255, 0.4)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'connector-spin 800ms linear infinite',
  },
};
