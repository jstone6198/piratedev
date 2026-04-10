import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';
import { VscSearch, VscClose, VscReplaceAll, VscRegex } from 'react-icons/vsc';

function escapeSearchQuery(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchRegex(query, regexMode, global = true) {
  const source = regexMode ? query : escapeSearchQuery(query);
  return new RegExp(source, global ? 'gm' : 'm');
}

function countMatches(content, query, regexMode) {
  if (!query) return 0;

  if (!regexMode) {
    let count = 0;
    let start = 0;

    while (true) {
      const index = content.indexOf(query, start);
      if (index === -1) break;
      count += 1;
      start = index + Math.max(query.length, 1);
    }

    return count;
  }

  const matches = content.match(buildSearchRegex(query, true, true));
  return matches ? matches.length : 0;
}

function replaceAllOccurrences(content, query, replacement, regexMode) {
  if (!query) return { content, count: 0 };

  if (!regexMode) {
    const count = countMatches(content, query, false);
    if (count === 0) return { content, count: 0 };
    return { content: content.split(query).join(replacement), count };
  }

  const regex = buildSearchRegex(query, true, true);
  const matches = content.match(regex);
  const count = matches ? matches.length : 0;
  return count === 0
    ? { content, count: 0 }
    : { content: content.replace(regex, replacement), count };
}

function replaceMatchInLine(content, lineNumber, query, replacement, regexMode) {
  const newlineMatch = content.match(/\r\n|\n|\r/);
  const newline = newlineMatch ? newlineMatch[0] : '\n';
  const lines = content.split(/\r\n|\n|\r/);
  const index = lineNumber - 1;

  if (index < 0 || index >= lines.length) return { content, count: 0 };

  const line = lines[index];

  if (!regexMode) {
    const matchIndex = line.indexOf(query);
    if (matchIndex === -1) return { content, count: 0 };
    lines[index] = `${line.slice(0, matchIndex)}${replacement}${line.slice(matchIndex + query.length)}`;
    return { content: lines.join(newline), count: 1 };
  }

  const regex = buildSearchRegex(query, true, false);
  if (!regex.test(line)) return { content, count: 0 };

  lines[index] = line.replace(regex, replacement);
  return { content: lines.join(newline), count: 1 };
}

export default function SearchPanel({ project, onOpenFile }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [replaceSummary, setReplaceSummary] = useState(null);
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
      setReplaceSummary(null);
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const res = await api.get(`/search/${encodeURIComponent(project)}`, {
        params: { q: regexMode ? q.trim() : escapeSearchQuery(q.trim()) },
      });
      setResults(res.data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setResults([]);
    }
    setLoading(false);
  }, [project, regexMode]);

  useEffect(() => {
    if (!query.trim() || !project) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSearch(query);
  }, [regexMode, project]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    setReplaceSummary(null);
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

  const validateReplace = useCallback(() => {
    if (!query.trim()) {
      setError('Enter a search term first');
      return false;
    }

    if (regexMode) {
      try {
        buildSearchRegex(query.trim(), true, true);
      } catch (err) {
        setError(`Invalid regex: ${err.message}`);
        return false;
      }
    }

    return true;
  }, [query, regexMode]);

  const writeFile = useCallback(async (path, content) => {
    await api.put(`/files/${encodeURIComponent(project)}`, { path, content });
  }, [project]);

  const handleReplaceOne = useCallback(async (match) => {
    if (!project || !validateReplace()) return;

    setReplacing(true);
    setError('');

    try {
      const response = await api.get(`/files/${encodeURIComponent(project)}/content`, {
        params: { path: match.file },
      });
      const currentContent = response.data?.content ?? '';
      const next = replaceMatchInLine(currentContent, match.line, query.trim(), replacement, regexMode);

      if (next.count === 0) {
        setReplaceSummary({ replaced: 0, total: 1, files: 0 });
        return;
      }

      await writeFile(match.file, next.content);
      setReplaceSummary({ replaced: 1, total: 1, files: 1 });
      await doSearch(query);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setReplacing(false);
    }
  }, [project, validateReplace, query, replacement, regexMode, writeFile, doSearch]);

  const handleReplaceAll = useCallback(async () => {
    if (!project || !validateReplace() || results.length === 0) return;

    setReplacing(true);
    setError('');

    const files = [...new Set(results.map((result) => result.file))];
    let replaced = 0;
    let total = 0;
    let changedFiles = 0;

    try {
      for (const file of files) {
        const response = await api.get(`/files/${encodeURIComponent(project)}/content`, {
          params: { path: file },
        });
        const currentContent = response.data?.content ?? '';
        const next = replaceAllOccurrences(currentContent, query.trim(), replacement, regexMode);

        total += next.count;
        if (next.count === 0) continue;

        await writeFile(file, next.content);
        replaced += next.count;
        changedFiles += 1;
      }

      setReplaceSummary({ replaced, total, files: changedFiles });
      await doSearch(query);
    } catch (err) {
      setReplaceSummary({ replaced, total, files: changedFiles });
      setError(err.response?.data?.error || err.message);
    } finally {
      setReplacing(false);
    }
  }, [project, validateReplace, results, query, replacement, regexMode, writeFile, doSearch]);

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
        {replaceMode ? <VscReplaceAll size={14} /> : <VscSearch size={14} />}
        <span style={styles.title}>Search</span>
        <div style={styles.headerActions}>
          <button
            type="button"
            style={{ ...styles.modeBtn, ...(replaceMode ? styles.modeBtnActive : {}) }}
            onClick={() => {
              setReplaceMode((value) => !value);
              setReplaceSummary(null);
            }}
            title={replaceMode ? 'Replace mode on' : 'Search mode on'}
          >
            {replaceMode ? <VscReplaceAll size={14} /> : <VscSearch size={14} />}
          </button>
          <button
            type="button"
            style={{ ...styles.modeBtn, ...(regexMode ? styles.modeBtnActive : {}) }}
            onClick={() => {
              setRegexMode((value) => !value);
              setReplaceSummary(null);
            }}
            title={regexMode ? 'Regex enabled' : 'Regex disabled'}
          >
            <VscRegex size={14} />
          </button>
        </div>
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
            onClick={() => {
              setQuery('');
              setResults([]);
              setSearched(false);
              setReplaceSummary(null);
              inputRef.current?.focus();
            }}
            title="Clear"
          >
            <VscClose size={14} />
          </button>
        )}
      </div>

      {replaceMode && (
        <div style={styles.replaceSection}>
          <div style={styles.inputRow}>
            <input
              style={styles.input}
              placeholder="Replace with..."
              value={replacement}
              onChange={(e) => {
                setReplacement(e.target.value);
                setReplaceSummary(null);
              }}
            />
          </div>
          <button
            type="button"
            style={{
              ...styles.actionBtn,
              ...((results.length === 0 || replacing || !query.trim()) ? styles.actionBtnDisabled : {}),
            }}
            onClick={handleReplaceAll}
            disabled={results.length === 0 || replacing || !query.trim()}
          >
            {replacing ? 'Replacing...' : 'Replace All'}
          </button>
        </div>
      )}

      {loading && <p style={styles.muted}>Searching...</p>}
      {replacing && !loading && <p style={styles.muted}>Applying replacements...</p>}
      {error && <p style={styles.error}>{error}</p>}
      {replaceSummary && (
        <p style={styles.summary}>
          Replaced {replaceSummary.replaced} of {replaceSummary.total} occurrence{replaceSummary.total !== 1 ? 's' : ''} in {replaceSummary.files} file{replaceSummary.files !== 1 ? 's' : ''}
        </p>
      )}

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
                <div style={styles.resultMain}>
                  <span style={styles.lineNum}>{m.line}</span>
                  <span style={styles.lineContent}>{m.content}</span>
                </div>
                {replaceMode && (
                  <button
                    type="button"
                    style={{ ...styles.inlineBtn, ...(replacing ? styles.inlineBtnDisabled : {}) }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReplaceOne(m);
                    }}
                    disabled={replacing}
                  >
                    Replace
                  </button>
                )}
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
  headerActions: {
    marginLeft: 'auto',
    display: 'flex',
    gap: 6,
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
  modeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 4,
    border: '1px solid #444',
    background: '#252525',
    color: '#9da3ad',
    cursor: 'pointer',
  },
  modeBtnActive: {
    color: '#fff',
    borderColor: '#569cd6',
    background: '#19324a',
  },
  replaceSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  actionBtn: {
    border: '1px solid #0e639c',
    background: '#0e639c',
    color: '#fff',
    borderRadius: 4,
    fontSize: 12,
    padding: '6px 10px',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  actionBtnDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  muted: { color: '#666', fontStyle: 'italic', margin: '2px 0', fontSize: 12 },
  error: { color: '#f14c4c', fontSize: 12, margin: '2px 0' },
  summary: { color: '#89d185', fontSize: 12, margin: '2px 0' },
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
    alignItems: 'center',
    gap: 8,
    padding: '2px 4px 2px 12px',
    cursor: 'pointer',
    borderRadius: 3,
    overflow: 'hidden',
  },
  resultMain: {
    display: 'flex',
    gap: 8,
    minWidth: 0,
    flex: 1,
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
  inlineBtn: {
    border: '1px solid #444',
    background: '#2a2a2a',
    color: '#d4d4d4',
    borderRadius: 4,
    fontSize: 11,
    padding: '4px 8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  inlineBtnDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
};
