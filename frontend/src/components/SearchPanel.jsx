import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';
import { VscSearch, VscClose } from 'react-icons/vsc';

export default function SearchPanel({ project, onOpenFile }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q) => {
    if (!project || !q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const res = await api.get(`/search/${encodeURIComponent(project)}`, {
        params: { q: q.trim() },
      });
      setResults(res.data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setResults([]);
    }
    setLoading(false);
  }, [project]);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 400);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      doSearch(query);
    }
  };

  const handleResultClick = (file, line) => {
    if (onOpenFile) {
      onOpenFile({ path: file, name: file.split('/').pop() }, line);
    }
  };

  // Group results by file
  const grouped = {};
  for (const r of results) {
    if (!grouped[r.file]) grouped[r.file] = [];
    grouped[r.file].push(r);
  }

  if (!project) {
    return (
      <div style={styles.panel}>
        <p style={styles.muted}>Select a project</p>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <VscSearch size={14} />
        <span style={styles.title}>Search</span>
      </div>

      <div style={styles.inputRow}>
        <input
          ref={inputRef}
          style={styles.input}
          placeholder="Search in project..."
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button
            style={styles.clearBtn}
            onClick={() => { setQuery(''); setResults([]); setSearched(false); inputRef.current?.focus(); }}
            title="Clear"
          >
            <VscClose size={14} />
          </button>
        )}
      </div>

      {loading && <p style={styles.muted}>Searching...</p>}
      {error && <p style={styles.error}>{error}</p>}

      {!loading && searched && results.length === 0 && !error && (
        <p style={styles.muted}>No results found</p>
      )}

      {results.length > 0 && (
        <div style={styles.resultCount}>
          {results.length} result{results.length !== 1 ? 's' : ''} in {Object.keys(grouped).length} file{Object.keys(grouped).length !== 1 ? 's' : ''}
        </div>
      )}

      <div style={styles.resultsList}>
        {Object.entries(grouped).map(([file, matches]) => (
          <div key={file} style={styles.fileGroup}>
            <div style={styles.fileHeader}>{file}</div>
            {matches.map((m, i) => (
              <div
                key={i}
                style={styles.resultItem}
                onClick={() => handleResultClick(m.file, m.line)}
                title={`${m.file}:${m.line}`}
              >
                <span style={styles.lineNum}>{m.line}</span>
                <span style={styles.lineContent}>{m.content}</span>
              </div>
            ))}
          </div>
        ))}
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
    alignItems: 'center',
    gap: 6,
    fontWeight: 600,
    fontSize: 14,
    borderBottom: '1px solid #333',
    paddingBottom: 6,
  },
  title: { fontSize: 14, fontWeight: 600 },
  inputRow: { position: 'relative', display: 'flex', alignItems: 'center' },
  input: {
    background: '#2d2d2d',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#eee',
    padding: '6px 28px 6px 8px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  clearBtn: {
    position: 'absolute',
    right: 4,
    background: 'none',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    padding: 2,
    display: 'inline-flex',
  },
  muted: { color: '#666', fontStyle: 'italic', margin: '2px 0', fontSize: 12 },
  error: { color: '#f14c4c', fontSize: 12, margin: '2px 0' },
  resultCount: { fontSize: 11, color: '#888' },
  resultsList: { display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 },
  fileGroup: { marginBottom: 4 },
  fileHeader: {
    fontSize: 12,
    fontWeight: 600,
    color: '#569cd6',
    padding: '4px 4px 2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  resultItem: {
    display: 'flex',
    gap: 8,
    padding: '2px 4px 2px 12px',
    cursor: 'pointer',
    borderRadius: 3,
    overflow: 'hidden',
  },
  lineNum: {
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 11,
    flexShrink: 0,
    minWidth: 32,
    textAlign: 'right',
  },
  lineContent: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontFamily: 'monospace',
  },
};
