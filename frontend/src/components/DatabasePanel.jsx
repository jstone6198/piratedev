import React, { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { VscDatabase, VscPlay, VscRefresh } from 'react-icons/vsc';

const DEFAULT_SQL = 'SELECT name FROM sqlite_master WHERE type = "table" ORDER BY name;';

async function upsertDatabaseUrl(project, connectionString) {
  const envRes = await api.get(`/env/${project}`);
  const existingVars = Array.isArray(envRes.data?.vars) ? envRes.data.vars : [];
  const nextVars = existingVars
    .filter((entry) => entry.key !== 'DATABASE_URL')
    .map((entry) => ({ key: entry.key, value: entry.value || '' }));

  nextVars.push({ key: 'DATABASE_URL', value: connectionString });
  await api.put(`/env/${project}`, { vars: nextVars });
}

function renderCell(value) {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function DatabasePanel({ project }) {
  const [database, setDatabase] = useState(null);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [queryResult, setQueryResult] = useState({ columns: [], rows: [] });
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    if (!project) {
      setDatabase(null);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/database/${project}/status`);
      setDatabase(res.data || null);
      if (!res.data) {
        setQueryResult({ columns: [], rows: [] });
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    setStatus('');
    setError('');
    setSql(DEFAULT_SQL);
    setQueryResult({ columns: [], rows: [] });
    loadStatus();
  }, [loadStatus]);

  const handleCreateDatabase = async () => {
    if (!project) return;

    setLoading(true);
    setStatus('');
    setError('');

    try {
      const res = await api.post(`/database/${project}/create`, { type: 'sqlite' });
      setDatabase(res.data);
      await upsertDatabaseUrl(project, res.data.connectionString);
      setStatus('Database created and DATABASE_URL added to .env');
      setSql('SELECT name FROM sqlite_master WHERE type = "table" ORDER BY name;');
      setQueryResult({ columns: [], rows: [] });
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRunQuery = async () => {
    if (!project || !database || !sql.trim()) return;

    setQuerying(true);
    setStatus('');
    setError('');

    try {
      const res = await api.post(`/database/${project}/query`, { sql });
      setQueryResult({
        columns: Array.isArray(res.data?.columns) ? res.data.columns : [],
        rows: Array.isArray(res.data?.rows) ? res.data.rows : [],
      });
      await loadStatus();
      setStatus(`Query returned ${Array.isArray(res.data?.rows) ? res.data.rows.length : 0} row(s)`);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message);
    } finally {
      setQuerying(false);
    }
  };

  if (!project) {
    return <div style={styles.panel}><p style={styles.muted}>Select a project</p></div>;
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.title}>
          <VscDatabase size={15} />
          <span>Database</span>
        </div>
        <button
          type="button"
          style={styles.iconButton}
          onClick={loadStatus}
          disabled={loading}
          title="Refresh"
        >
          <VscRefresh size={14} />
        </button>
      </div>

      {status && <div style={styles.status}>{status}</div>}
      {error && <div style={styles.error}>{error}</div>}

      {!database ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyTitle}>No database provisioned for this project.</p>
          <button
            type="button"
            style={styles.primaryButton}
            onClick={handleCreateDatabase}
            disabled={loading}
          >
            Create Database
          </button>
        </div>
      ) : (
        <>
          <div style={styles.metaCard}>
            <div style={styles.metaRow}>
              <span style={styles.label}>Type</span>
              <span style={styles.value}>{database.type}</span>
            </div>
            <div style={styles.metaBlock}>
              <span style={styles.label}>Connection String</span>
              <code style={styles.code}>{database.connectionString}</code>
            </div>
            <div style={styles.metaBlock}>
              <span style={styles.label}>Tables</span>
              {database.tables?.length ? (
                <div style={styles.tableChips}>
                  {database.tables.map((tableName) => (
                    <span key={tableName} style={styles.chip}>{tableName}</span>
                  ))}
                </div>
              ) : (
                <span style={styles.muted}>No user tables yet</span>
              )}
            </div>
          </div>

          <div style={styles.queryCard}>
            <div style={styles.queryHeader}>
              <span style={styles.sectionTitle}>SQL Runner</span>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={handleRunQuery}
                disabled={querying || !sql.trim()}
              >
                <VscPlay size={14} />
                Run Query
              </button>
            </div>

            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              style={styles.textarea}
              placeholder="SELECT * FROM your_table;"
            />

            <div style={styles.resultsWrap}>
              {queryResult.columns.length > 0 ? (
                <div style={styles.resultsTableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        {queryResult.columns.map((column) => (
                          <th key={column} style={styles.th}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.rows.length > 0 ? (
                        queryResult.rows.map((row, rowIndex) => (
                          <tr key={`row-${rowIndex}`}>
                            {queryResult.columns.map((column) => (
                              <td key={`${rowIndex}-${column}`} style={styles.td}>
                                {renderCell(row[column])}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td style={styles.td} colSpan={queryResult.columns.length}>No rows returned</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={styles.muted}>Run a query to inspect results.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    height: '100%',
    minHeight: 0,
    padding: 10,
    overflowY: 'auto',
    background: '#1e1e1e',
    color: '#d4d4d4',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
    borderBottom: '1px solid #333',
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontWeight: 600,
    fontSize: 14,
  },
  sectionTitle: {
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#9cdcfe',
  },
  iconButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid #3a3a3a',
    color: '#d4d4d4',
    borderRadius: 4,
    padding: 6,
    cursor: 'pointer',
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#0e639c',
    border: 'none',
    color: '#fff',
    borderRadius: 4,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  status: {
    padding: '8px 10px',
    border: '1px solid #294436',
    background: '#1f2d24',
    color: '#89d185',
    borderRadius: 6,
  },
  error: {
    padding: '8px 10px',
    border: '1px solid #5c2b2b',
    background: '#2d1f1f',
    color: '#f48771',
    borderRadius: 6,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    border: '1px solid #333',
    borderRadius: 8,
    background: '#252526',
  },
  emptyTitle: {
    margin: 0,
    color: '#d4d4d4',
  },
  metaCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 12,
    border: '1px solid #333',
    borderRadius: 8,
    background: '#252526',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  metaBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    color: '#808080',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  value: {
    color: '#dcdcaa',
  },
  code: {
    display: 'block',
    padding: '8px 10px',
    borderRadius: 6,
    background: '#1a1a1a',
    color: '#ce9178',
    wordBreak: 'break-all',
  },
  tableChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    padding: '4px 8px',
    borderRadius: 999,
    border: '1px solid #3a3a3a',
    background: '#1e1e1e',
    color: '#4fc1ff',
    fontSize: 12,
  },
  queryCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minHeight: 0,
    padding: 12,
    border: '1px solid #333',
    borderRadius: 8,
    background: '#252526',
  },
  queryHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  textarea: {
    width: '100%',
    minHeight: 120,
    resize: 'vertical',
    boxSizing: 'border-box',
    border: '1px solid #3a3a3a',
    borderRadius: 6,
    background: '#1a1a1a',
    color: '#d4d4d4',
    padding: 10,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    outline: 'none',
  },
  resultsWrap: {
    minHeight: 0,
    flex: 1,
  },
  resultsTableWrap: {
    overflow: 'auto',
    border: '1px solid #333',
    borderRadius: 6,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  th: {
    position: 'sticky',
    top: 0,
    background: '#1f1f1f',
    color: '#9cdcfe',
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '1px solid #333',
  },
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid #2d2d2d',
    color: '#d4d4d4',
    verticalAlign: 'top',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  muted: {
    color: '#808080',
    fontStyle: 'italic',
    margin: 0,
  },
};
