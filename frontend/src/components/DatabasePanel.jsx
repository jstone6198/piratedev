import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  VscAdd,
  VscCloudDownload,
  VscCloudUpload,
  VscDatabase,
  VscPlay,
  VscRefresh,
  VscTrash,
} from 'react-icons/vsc';

const DEFAULT_SQL = {
  sqlite: 'SELECT name FROM sqlite_master WHERE type = "table" ORDER BY name;',
  postgres: 'SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' ORDER BY table_name;',
};

const PAGE_LIMIT = 50;
const HISTORY_LIMIT = 20;

function authHeaders(extra = {}) {
  return { 'x-ide-key': window.IDE_KEY || '', ...extra };
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === 'object' ? body.message || body.error : body;
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return body;
}

async function fetchJson(url, options = {}) {
  const headers = options.body instanceof FormData
    ? authHeaders(options.headers)
    : authHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) });

  const response = await fetch(url, { ...options, headers });
  return parseResponse(response);
}

function cellText(value) {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function rowsToObjects(columns, rows) {
  return rows.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

function historyKey(project) {
  return `database-query-history:${project || 'none'}`;
}

export default function DatabasePanel({ project }) {
  const restoreInputRef = useRef(null);
  const [databaseType, setDatabaseType] = useState('sqlite');
  const [hasDatabase, setHasDatabase] = useState(false);
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [activeTab, setActiveTab] = useState('data');
  const [sql, setSql] = useState(DEFAULT_SQL.sqlite);
  const [history, setHistory] = useState([]);
  const [queryResult, setQueryResult] = useState({ columns: [], rows: [] });
  const [querySort, setQuerySort] = useState({ column: '', direction: 'asc' });
  const [tableData, setTableData] = useState({ columns: [], rows: [], page: 1, totalPages: 1, total: 0, primaryKey: null });
  const [tablePage, setTablePage] = useState(1);
  const [draftRow, setDraftRow] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const selectedSchema = useMemo(
    () => tables.find((table) => table.name === selectedTable) || null,
    [selectedTable, tables],
  );

  const tableRows = useMemo(
    () => rowsToObjects(tableData.columns, tableData.rows),
    [tableData.columns, tableData.rows],
  );

  const sortedQueryRows = useMemo(() => {
    if (!querySort.column) return queryResult.rows;
    const columnIndex = queryResult.columns.indexOf(querySort.column);
    if (columnIndex === -1) return queryResult.rows;

    return [...queryResult.rows].sort((a, b) => {
      const left = a[columnIndex];
      const right = b[columnIndex];
      if (left === right) return 0;
      if (left === null || left === undefined) return querySort.direction === 'asc' ? -1 : 1;
      if (right === null || right === undefined) return querySort.direction === 'asc' ? 1 : -1;
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * (querySort.direction === 'asc' ? 1 : -1);
    });
  }, [queryResult, querySort]);

  const loadHistory = useCallback(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(historyKey(project)) || '[]');
      setHistory(Array.isArray(stored) ? stored.slice(0, HISTORY_LIMIT) : []);
    } catch {
      setHistory([]);
    }
  }, [project]);

  const saveHistory = useCallback((statement) => {
    const next = [statement, ...history.filter((entry) => entry !== statement)].slice(0, HISTORY_LIMIT);
    setHistory(next);
    localStorage.setItem(historyKey(project), JSON.stringify(next));
  }, [history, project]);

  const loadTables = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError('');

    try {
      const data = await fetchJson(`/api/database/${encodeURIComponent(project)}/tables`);
      const nextTables = Array.isArray(data.tables) ? data.tables : [];
      setHasDatabase(true);
      setDatabaseType(data.type || databaseType);
      setTables(nextTables);
      setSelectedTable((current) => (nextTables.some((table) => table.name === current) ? current : nextTables[0]?.name || ''));
    } catch (err) {
      if (/not found/i.test(err.message)) {
        setHasDatabase(false);
        setTables([]);
        setSelectedTable('');
        setTableData({ columns: [], rows: [], page: 1, totalPages: 1, total: 0, primaryKey: null });
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [databaseType, project]);

  const loadTableRows = useCallback(async () => {
    if (!project || !hasDatabase || !selectedTable) return;
    setError('');

    try {
      const data = await fetchJson(
        `/api/database/${encodeURIComponent(project)}/table/${encodeURIComponent(selectedTable)}?page=${tablePage}&limit=${PAGE_LIMIT}`,
      );
      setTableData({
        columns: Array.isArray(data.columns) ? data.columns : [],
        rows: Array.isArray(data.rows) ? data.rows : [],
        page: data.page || tablePage,
        totalPages: data.totalPages || 1,
        total: data.total || 0,
        primaryKey: data.primaryKey || selectedSchema?.primaryKey || null,
      });
    } catch (err) {
      setError(err.message);
    }
  }, [hasDatabase, project, selectedSchema?.primaryKey, selectedTable, tablePage]);

  useEffect(() => {
    setStatus('');
    setError('');
    setHasDatabase(false);
    setTables([]);
    setSelectedTable('');
    setTablePage(1);
    setQueryResult({ columns: [], rows: [] });
    setSql(DEFAULT_SQL[databaseType]);
    loadHistory();
    loadTables();
  }, [project]);

  useEffect(() => {
    setSql(DEFAULT_SQL[databaseType]);
  }, [databaseType]);

  useEffect(() => {
    setTablePage(1);
    setDraftRow(null);
    setEditingCell(null);
  }, [selectedTable]);

  useEffect(() => {
    loadTableRows();
  }, [loadTableRows]);

  const provisionDatabase = async () => {
    if (!project) return;
    setLoading(true);
    setStatus('');
    setError('');

    try {
      const data = await fetchJson(`/api/database/${encodeURIComponent(project)}/provision`, {
        method: 'POST',
        body: JSON.stringify({ type: databaseType }),
      });
      setHasDatabase(true);
      setDatabaseType(data.type || databaseType);
      setStatus(`${data.type || databaseType} database provisioned`);
      await loadTables();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runQuery = async () => {
    if (!project || !hasDatabase || !sql.trim()) return;
    setQuerying(true);
    setStatus('');
    setError('');

    try {
      const data = await fetchJson(`/api/database/${encodeURIComponent(project)}/query`, {
        method: 'POST',
        body: JSON.stringify({ sql }),
      });
      setQueryResult({
        columns: Array.isArray(data.columns) ? data.columns : [],
        rows: Array.isArray(data.rows) ? data.rows : [],
      });
      setQuerySort({ column: '', direction: 'asc' });
      saveHistory(sql.trim());
      setStatus(`Query returned ${Array.isArray(data.rows) ? data.rows.length : 0} row(s)`);
      await loadTables();
      await loadTableRows();
    } catch (err) {
      setError(err.message);
    } finally {
      setQuerying(false);
    }
  };

  const startEdit = (rowIndex, row, column) => {
    const primaryKey = tableData.primaryKey;
    const keyValue = primaryKey ? row[primaryKey] : rowIndex;
    setEditingCell({ rowIndex, rowKey: keyValue, column, isDraft: row.__draft === true });
    setEditValue(row[column] ?? '');
  };

  const finishEdit = async () => {
    if (!editingCell || !selectedTable) return;

    const { rowIndex, rowKey, column, isDraft } = editingCell;
    setEditingCell(null);
    setSaving(true);
    setStatus('');
    setError('');

    try {
      if (isDraft) {
        const nextDraft = { ...(draftRow || {}), [column]: editValue };
        const values = Object.fromEntries(Object.entries(nextDraft).filter(([key, value]) => key !== '__draft' && value !== ''));
        await fetchJson(`/api/database/${encodeURIComponent(project)}/table/${encodeURIComponent(selectedTable)}/row`, {
          method: 'POST',
          body: JSON.stringify({ values }),
        });
        setDraftRow(null);
        setStatus('Row added');
      } else {
        await fetchJson(`/api/database/${encodeURIComponent(project)}/table/${encodeURIComponent(selectedTable)}/row`, {
          method: 'PUT',
          body: JSON.stringify({
            primaryKey: { column: tableData.primaryKey, value: rowKey },
            column,
            value: editValue,
          }),
        });
        setStatus('Cell saved');
      }

      await loadTableRows();
    } catch (err) {
      setError(err.message);
      if (isDraft) setDraftRow((current) => ({ ...(current || {}), [column]: editValue }));
      else setTableData((current) => {
        const nextRows = [...current.rows];
        const columnIndex = current.columns.indexOf(column);
        if (nextRows[rowIndex] && columnIndex >= 0) nextRows[rowIndex] = [...nextRows[rowIndex]];
        return { ...current, rows: nextRows };
      });
    } finally {
      setSaving(false);
    }
  };

  const addDraftRow = () => {
    const draft = Object.fromEntries(tableData.columns.filter((column) => column !== '__rowid__').map((column) => [column, '']));
    setDraftRow({ __draft: true, ...draft });
    setActiveTab('data');
  };

  const deleteRow = async (row) => {
    const primaryKey = tableData.primaryKey;
    if (!primaryKey || row[primaryKey] === undefined) {
      setError('This table needs a primary key to delete rows');
      return;
    }

    if (!window.confirm(`Delete row where ${primaryKey} = ${cellText(row[primaryKey])}?`)) return;
    setSaving(true);
    setStatus('');
    setError('');

    try {
      await fetchJson(`/api/database/${encodeURIComponent(project)}/table/${encodeURIComponent(selectedTable)}/row`, {
        method: 'DELETE',
        body: JSON.stringify({ primaryKey, value: row[primaryKey] }),
      });
      setStatus('Row deleted');
      await loadTableRows();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const downloadBackup = async () => {
    if (!project || !hasDatabase) return;
    setError('');

    try {
      const response = await fetch(`/api/database/${encodeURIComponent(project)}/backup`, {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || 'Backup failed');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `${project}-${databaseType}-backup.sql`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus('Backup downloaded');
    } catch (err) {
      setError(err.message);
    }
  };

  const restoreBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !project || !hasDatabase) return;

    const form = new FormData();
    form.append('file', file);
    setLoading(true);
    setStatus('');
    setError('');

    try {
      await fetchJson(`/api/database/${encodeURIComponent(project)}/restore`, {
        method: 'POST',
        body: form,
      });
      setStatus('Backup restored');
      await loadTables();
      await loadTableRows();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderEditableCell = (row, rowIndex, column) => {
    if (column === '__rowid__') {
      return <span>{cellText(row[column])}</span>;
    }

    const isEditing = editingCell
      && editingCell.rowIndex === rowIndex
      && editingCell.column === column
      && editingCell.isDraft === (row.__draft === true);

    if (isEditing) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          onBlur={finishEdit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setEditingCell(null);
          }}
          style={styles.cellInput}
        />
      );
    }

    return (
      <button type="button" style={styles.cellButton} onClick={() => startEdit(rowIndex, row, column)}>
        {cellText(row[column])}
      </button>
    );
  };

  if (!project) {
    return <div style={styles.panel}><p style={styles.muted}>Select a project</p></div>;
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.title}>
          <VscDatabase size={16} />
          <span>Database</span>
        </div>
        <div style={styles.headerActions}>
          <select value={databaseType} onChange={(event) => setDatabaseType(event.target.value)} style={styles.select} disabled={hasDatabase}>
            <option value="sqlite">SQLite</option>
            <option value="postgres">PostgreSQL</option>
          </select>
          <button type="button" style={styles.button} onClick={downloadBackup} disabled={!hasDatabase}>
            <VscCloudDownload size={14} /> Backup
          </button>
          <button type="button" style={styles.button} onClick={() => restoreInputRef.current?.click()} disabled={!hasDatabase || loading}>
            <VscCloudUpload size={14} /> Restore
          </button>
          <button type="button" style={styles.iconButton} onClick={loadTables} disabled={loading} title="Refresh">
            <VscRefresh size={14} />
          </button>
          <input ref={restoreInputRef} type="file" accept=".sql,text/sql,text/plain" onChange={restoreBackup} style={styles.hiddenInput} />
        </div>
      </div>

      {status && <div style={styles.status}>{status}</div>}
      {error && <div style={styles.error}>{error}</div>}

      {!hasDatabase ? (
        <div style={styles.emptyState}>
          <div>
            <h3 style={styles.emptyTitle}>No database provisioned</h3>
            <p style={styles.muted}>Choose SQLite or PostgreSQL, then create the project database.</p>
          </div>
          <button type="button" style={styles.primaryButton} onClick={provisionDatabase} disabled={loading}>
            Provision {databaseType === 'postgres' ? 'PostgreSQL' : 'SQLite'}
          </button>
        </div>
      ) : (
        <>
          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionTitle}>SQL Runner</span>
              <div style={styles.rowActions}>
                <select
                  value=""
                  onChange={(event) => event.target.value && setSql(event.target.value)}
                  style={styles.select}
                  title="Query history"
                >
                  <option value="">History</option>
                  {history.map((entry) => (
                    <option key={entry} value={entry}>{entry.slice(0, 90)}</option>
                  ))}
                </select>
                <button type="button" style={styles.primaryButton} onClick={runQuery} disabled={querying || !sql.trim()}>
                  <VscPlay size={14} /> Run
                </button>
              </div>
            </div>
            <textarea value={sql} onChange={(event) => setSql(event.target.value)} style={styles.textarea} spellCheck={false} />

            <div style={styles.tableWrap}>
              {queryResult.columns.length ? (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {queryResult.columns.map((column) => (
                        <th key={column} style={styles.th}>
                          <button
                            type="button"
                            style={styles.sortButton}
                            onClick={() => setQuerySort((current) => ({
                              column,
                              direction: current.column === column && current.direction === 'asc' ? 'desc' : 'asc',
                            }))}
                          >
                            {column}{querySort.column === column ? ` ${querySort.direction === 'asc' ? 'asc' : 'desc'}` : ''}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedQueryRows.length ? sortedQueryRows.map((row, rowIndex) => (
                      <tr key={`query-${rowIndex}`}>
                        {queryResult.columns.map((column, columnIndex) => (
                          <td key={`${rowIndex}-${column}`} style={styles.td}>{cellText(row[columnIndex])}</td>
                        ))}
                      </tr>
                    )) : (
                      <tr><td style={styles.td} colSpan={queryResult.columns.length}>No rows returned</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <div style={styles.placeholder}>Run a query to see results.</div>
              )}
            </div>
          </section>

          <section style={styles.browser}>
            <aside style={styles.sidebar}>
              <div style={styles.sidebarTitle}>Tables</div>
              {tables.length ? tables.map((table) => (
                <button
                  key={table.name}
                  type="button"
                  onClick={() => setSelectedTable(table.name)}
                  style={selectedTable === table.name ? styles.tableNavActive : styles.tableNav}
                >
                  {table.name}
                </button>
              )) : <div style={styles.placeholder}>No tables</div>}
            </aside>

            <main style={styles.browserMain}>
              <div style={styles.browserHeader}>
                <div style={styles.tabs}>
                  <button type="button" onClick={() => setActiveTab('data')} style={activeTab === 'data' ? styles.tabActive : styles.tab}>Data</button>
                  <button type="button" onClick={() => setActiveTab('schema')} style={activeTab === 'schema' ? styles.tabActive : styles.tab}>Schema</button>
                </div>
                <div style={styles.rowActions}>
                  <span style={styles.muted}>{selectedTable || 'No table selected'}</span>
                  <button type="button" style={styles.button} onClick={addDraftRow} disabled={!selectedTable || !tableData.columns.length || saving}>
                    <VscAdd size={14} /> Add Row
                  </button>
                </div>
              </div>

              {activeTab === 'schema' ? (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Column</th>
                        <th style={styles.th}>Type</th>
                        <th style={styles.th}>Nullable</th>
                        <th style={styles.th}>Default</th>
                        <th style={styles.th}>Primary Key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedSchema?.columns || []).map((column) => (
                        <tr key={column.name}>
                          <td style={styles.td}>{column.name}</td>
                          <td style={styles.td}>{column.type || '-'}</td>
                          <td style={styles.td}>{column.nullable ? 'Yes' : 'No'}</td>
                          <td style={styles.td}>{cellText(column.default)}</td>
                          <td style={styles.td}>{column.primaryKey ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Actions</th>
                          {tableData.columns.map((column) => <th key={column} style={styles.th}>{column}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {draftRow && (
                          <tr>
                            <td style={styles.td}><span style={styles.muted}>New</span></td>
                            {tableData.columns.map((column) => (
                              <td key={`draft-${column}`} style={styles.td}>{renderEditableCell(draftRow, -1, column)}</td>
                            ))}
                          </tr>
                        )}
                        {tableRows.length ? tableRows.map((row, rowIndex) => (
                          <tr key={`table-${rowIndex}-${row[tableData.primaryKey] ?? rowIndex}`}>
                            <td style={styles.td}>
                              <button type="button" style={styles.dangerButton} onClick={() => deleteRow(row)} disabled={saving}>
                                <VscTrash size={13} /> Delete
                              </button>
                            </td>
                            {tableData.columns.map((column) => (
                              <td key={`${rowIndex}-${column}`} style={styles.td}>{renderEditableCell(row, rowIndex, column)}</td>
                            ))}
                          </tr>
                        )) : (
                          <tr><td style={styles.td} colSpan={tableData.columns.length + 1}>No rows</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={styles.pagination}>
                    <button type="button" style={styles.button} onClick={() => setTablePage((page) => Math.max(1, page - 1))} disabled={tablePage <= 1}>Prev</button>
                    <span>Page {tableData.page} of {tableData.totalPages} - {tableData.total} row(s)</span>
                    <button type="button" style={styles.button} onClick={() => setTablePage((page) => Math.min(tableData.totalPages, page + 1))} disabled={tablePage >= tableData.totalPages}>Next</button>
                  </div>
                </>
              )}
            </main>
          </section>
        </>
      )}
    </div>
  );
}

const buttonBase = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: 4,
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: "'JetBrains Mono', monospace",
};

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    height: '100%',
    minHeight: 0,
    padding: 10,
    overflow: 'hidden',
    background: '#1e1e1e',
    color: '#f0f0f0',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 8,
    borderBottom: '1px solid #333',
  },
  title: { display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowActions: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  iconButton: { ...buttonBase, border: '1px solid #333', background: '#1e1e1e', color: '#f0f0f0', padding: 7 },
  button: { ...buttonBase, border: '1px solid #333', background: '#252526', color: '#f0f0f0' },
  primaryButton: { ...buttonBase, border: '1px solid #333', background: '#0e639c', color: '#f0f0f0' },
  dangerButton: { ...buttonBase, border: '1px solid #333', background: '#1e1e1e', color: '#f0f0f0', padding: '5px 8px' },
  select: {
    border: '1px solid #333',
    background: '#1e1e1e',
    color: '#f0f0f0',
    borderRadius: 4,
    padding: '7px 8px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
  },
  hiddenInput: { display: 'none' },
  status: { padding: '8px 10px', border: '1px solid #333', background: '#1e1e1e', color: '#f0f0f0', borderRadius: 6 },
  error: { padding: '8px 10px', border: '1px solid #333', background: '#1e1e1e', color: '#f0f0f0', borderRadius: 6 },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    padding: 14,
    border: '1px solid #333',
    borderRadius: 8,
    background: '#1e1e1e',
  },
  emptyTitle: { margin: '0 0 6px', color: '#f0f0f0', fontSize: 14 },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minHeight: 220,
    padding: 12,
    border: '1px solid #333',
    borderRadius: 8,
    background: '#1e1e1e',
  },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#f0f0f0' },
  textarea: {
    width: '100%',
    minHeight: 110,
    resize: 'vertical',
    boxSizing: 'border-box',
    border: '1px solid #333',
    borderRadius: 6,
    background: '#1e1e1e',
    color: '#f0f0f0',
    padding: 10,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    outline: 'none',
  },
  browser: {
    display: 'grid',
    gridTemplateColumns: '190px minmax(0, 1fr)',
    gap: 10,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  sidebar: { overflow: 'auto', border: '1px solid #333', borderRadius: 8, background: '#1e1e1e', padding: 8 },
  sidebarTitle: { color: '#f0f0f0', fontWeight: 700, fontSize: 12, marginBottom: 8, textTransform: 'uppercase' },
  tableNav: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    border: '1px solid transparent',
    background: 'transparent',
    color: '#f0f0f0',
    borderRadius: 4,
    padding: '7px 8px',
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
  },
  tableNavActive: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    border: '1px solid #333',
    background: '#1e1e1e',
    color: '#f0f0f0',
    borderRadius: 4,
    padding: '7px 8px',
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
  },
  browserMain: { display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, border: '1px solid #333', borderRadius: 8, background: '#1e1e1e', padding: 10, gap: 10 },
  browserHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  tabs: { display: 'flex', gap: 6 },
  tab: { ...buttonBase, border: '1px solid #333', background: '#1e1e1e', color: '#f0f0f0' },
  tabActive: { ...buttonBase, border: '1px solid #333', background: '#0e639c', color: '#f0f0f0' },
  tableWrap: { flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid #333', borderRadius: 6, background: '#1e1e1e' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { position: 'sticky', top: 0, zIndex: 1, background: '#1e1e1e', color: '#f0f0f0', textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #333', borderRight: '1px solid #333' },
  td: { padding: '7px 10px', borderBottom: '1px solid #333', borderRight: '1px solid #333', color: '#f0f0f0', verticalAlign: 'top', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  sortButton: { border: 0, background: 'transparent', color: '#f0f0f0', padding: 0, cursor: 'pointer', font: 'inherit' },
  cellButton: { width: '100%', minHeight: 24, border: 0, background: 'transparent', color: '#f0f0f0', textAlign: 'left', padding: 0, cursor: 'text', font: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  cellInput: { width: '100%', minWidth: 120, boxSizing: 'border-box', border: '1px solid #333', background: '#1e1e1e', color: '#f0f0f0', borderRadius: 4, padding: 5, font: 'inherit', outline: 'none' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, color: '#f0f0f0' },
  placeholder: { padding: 12, color: '#f0f0f0', fontStyle: 'italic' },
  muted: { color: '#f0f0f0', margin: 0 },
};
