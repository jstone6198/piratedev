import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const AUTO_INTERVAL_MS = 30000;

function formatTimestamp(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatRelativeTime(value) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(date.getTime())) return '';
  if (diffMs < 60000) return 'just now';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function getStatusIcon(status) {
  if (status === 'added') return '+';
  if (status === 'deleted') return '-';
  return '~';
}

function getStatusStyle(status) {
  if (status === 'added') return styles.statusAdded;
  if (status === 'deleted') return styles.statusDeleted;
  return styles.statusModified;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'x-ide-key': window.IDE_KEY || '',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error || response.statusText || 'Request failed');
  }

  return data;
}

function matchesFileSave(url, method, encodedProject) {
  if (!url || !encodedProject) return false;

  try {
    const parsed = new URL(url, window.location.origin);
    const normalizedMethod = String(method || '').toUpperCase();
    return (
      (normalizedMethod === 'PUT' || normalizedMethod === 'POST') &&
      parsed.pathname === `/api/files/${encodedProject}`
    );
  } catch {
    return false;
  }
}

export default function CheckpointPanel({ project }) {
  const [checkpoints, setCheckpoints] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [expandedHash, setExpandedHash] = useState(null);
  const [preview, setPreview] = useState(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [initialized, setInitialized] = useState(true);
  const [message, setMessage] = useState('');
  const [fileDiff, setFileDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState([]);
  const [compareDiff, setCompareDiff] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [sliderIndex, setSliderIndex] = useState(0);
  const [autoEnabled, setAutoEnabled] = useState(false);

  const autoEnabledRef = useRef(false);
  const lastAutoRef = useRef(0);
  const pendingAutoTimerRef = useRef(null);

  const encodedProject = useMemo(() => encodeURIComponent(project || ''), [project]);
  const oldestFirstTimeline = useMemo(() => [...timeline].reverse(), [timeline]);

  const selectedCheckpoint = useMemo(
    () => checkpoints.find((checkpoint) => checkpoint.id === selectedId) || null,
    [checkpoints, selectedId],
  );

  const selectedTimelineItem = useMemo(
    () => timeline.find((item) => item.hash === selectedId) || null,
    [timeline, selectedId],
  );

  const selectedDisplayCheckpoint = useMemo(() => {
    if (selectedCheckpoint) {
      return selectedCheckpoint;
    }

    if (!selectedTimelineItem) {
      return null;
    }

    return {
      id: selectedTimelineItem.hash,
      shortId: selectedTimelineItem.hash.slice(0, 7),
      label: selectedTimelineItem.message,
      timestamp: selectedTimelineItem.timestamp,
    };
  }, [selectedCheckpoint, selectedTimelineItem]);

  const sliderCheckpoint = oldestFirstTimeline[sliderIndex] || null;
  const headHash = timeline[0]?.hash || null;
  const sliderAtHead = !sliderCheckpoint || sliderCheckpoint.hash === headHash;

  const loadTimeline = useCallback(async (preferredHash) => {
    if (!project) return;

    try {
      const data = await fetchJson(`/checkpoints/${encodedProject}/timeline`);
      const nextTimeline = data.timeline || [];
      setTimeline(nextTimeline);
      setInitialized(data.initialized !== false);

      const oldestFirst = [...nextTimeline].reverse();
      const nextHash =
        preferredHash && nextTimeline.some((item) => item.hash === preferredHash)
          ? preferredHash
          : nextTimeline[0]?.hash || null;

      const nextIndex = Math.max(0, oldestFirst.findIndex((item) => item.hash === (nextHash || nextTimeline[0]?.hash)));
      setSliderIndex(nextIndex === -1 ? Math.max(0, oldestFirst.length - 1) : nextIndex);
    } catch (error) {
      setTimeline([]);
      setMessage(error.message);
    }
  }, [encodedProject, project]);

  const loadCheckpoints = useCallback(async (preferredId) => {
    if (!project) {
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const data = await fetchJson(`/checkpoints/${encodedProject}`);
      const nextCheckpoints = data.checkpoints || [];
      setCheckpoints(nextCheckpoints);
      setInitialized(data.initialized !== false);

      const nextSelectedId =
        preferredId && nextCheckpoints.some((checkpoint) => checkpoint.id === preferredId)
          ? preferredId
          : nextCheckpoints[0]?.id || null;

      setSelectedId(nextSelectedId);
      if (!nextSelectedId) {
        setPreview(null);
      }

      await loadTimeline(nextSelectedId);
    } catch (error) {
      setCheckpoints([]);
      setTimeline([]);
      setPreview(null);
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, [encodedProject, loadTimeline, project]);

  const loadPreview = useCallback(async (commitId) => {
    if (!project || !commitId) {
      return;
    }

    setPreviewLoading(true);
    setMessage('');

    try {
      const data = await fetchJson(`/checkpoints/${encodedProject}/preview/${commitId}`, { method: 'POST' });
      setPreview(data);
      setSelectedId(commitId);
    } catch (error) {
      setPreview(null);
      setMessage(error.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [encodedProject, project]);

  const runAutoCheckpoint = useCallback(async () => {
    if (!project || !autoEnabledRef.current) return;

    try {
      const data = await fetchJson(`/checkpoints/${encodedProject}/auto-checkpoint`, { method: 'POST' });
      lastAutoRef.current = Date.now();
      if (data.created && data.id) {
        setMessage(`Auto-checkpoint ${data.id.slice(0, 7)} created`);
        await loadCheckpoints(data.id);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }, [encodedProject, loadCheckpoints, project]);

  const scheduleAutoCheckpoint = useCallback(() => {
    if (!autoEnabledRef.current) return;

    const elapsed = Date.now() - lastAutoRef.current;
    const delay = Math.max(0, AUTO_INTERVAL_MS - elapsed);
    if (pendingAutoTimerRef.current) {
      clearTimeout(pendingAutoTimerRef.current);
    }

    pendingAutoTimerRef.current = setTimeout(() => {
      pendingAutoTimerRef.current = null;
      runAutoCheckpoint();
    }, delay);
  }, [runAutoCheckpoint]);

  useEffect(() => {
    setCheckpoints([]);
    setTimeline([]);
    setSelectedId(null);
    setExpandedHash(null);
    setPreview(null);
    setLabel('');
    setMessage('');
    setFileDiff(null);
    setCompareSelection([]);
    setCompareDiff('');
    setCompareMode(false);
    setSliderIndex(0);

    if (project) {
      setAutoEnabled(localStorage.getItem(`checkpoints:auto:${project}`) === 'true');
      loadCheckpoints();
    }
  }, [project, loadCheckpoints]);

  useEffect(() => {
    autoEnabledRef.current = autoEnabled;
    if (project) {
      localStorage.setItem(`checkpoints:auto:${project}`, autoEnabled ? 'true' : 'false');
    }
  }, [autoEnabled, project]);

  useEffect(() => {
    if (selectedId) {
      loadPreview(selectedId);
    }
  }, [selectedId, loadPreview]);

  useEffect(() => {
    if (!autoEnabled || !project || !encodedProject) return undefined;

    const originalFetch = window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    window.fetch = async (...args) => {
      const request = args[0];
      const options = args[1] || {};
      const url = typeof request === 'string' ? request : request?.url;
      const method = options.method || request?.method || 'GET';
      const response = await originalFetch(...args);
      if (response.ok && matchesFileSave(url, method, encodedProject)) {
        scheduleAutoCheckpoint();
      }
      return response;
    };

    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__checkpointMethod = method;
      this.__checkpointUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function patchedSend(...args) {
      const handleLoadEnd = () => {
        if (this.status >= 200 && this.status < 300 && matchesFileSave(this.__checkpointUrl, this.__checkpointMethod, encodedProject)) {
          scheduleAutoCheckpoint();
        }
      };
      this.addEventListener('loadend', handleLoadEnd, { once: true });
      return originalSend.apply(this, args);
    };

    return () => {
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;
      if (pendingAutoTimerRef.current) {
        clearTimeout(pendingAutoTimerRef.current);
        pendingAutoTimerRef.current = null;
      }
    };
  }, [autoEnabled, encodedProject, project, scheduleAutoCheckpoint]);

  const handleCreate = async () => {
    const trimmedLabel = label.trim();
    if (!project || !trimmedLabel) {
      return;
    }

    setCreating(true);
    setMessage('');

    try {
      const data = await fetchJson(`/checkpoints/${encodedProject}/create`, {
        method: 'POST',
        body: JSON.stringify({ label: trimmedLabel }),
      });
      setLabel('');
      setMessage(`Created checkpoint ${data.id.slice(0, 7)}`);
      await loadCheckpoints(data.id);
      await loadPreview(data.id);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (commitId) => {
    if (!project || !commitId) {
      return;
    }

    setRestoring(true);
    setMessage('');

    try {
      const data = await fetchJson(`/checkpoints/${encodedProject}/restore/${commitId}`, { method: 'POST' });
      const restoredId = data.commitHash || data.id || commitId;
      setMessage(`Restored ${restoredId.slice(0, 7)} on ${data.branch || 'restore branch'}`);
      await loadCheckpoints(restoredId);
      await loadPreview(restoredId);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRestoring(false);
    }
  };

  const handleTimelineClick = (item) => {
    if (compareMode) {
      setCompareDiff('');
      setCompareSelection((previous) => {
        if (previous.includes(item.hash)) {
          return previous.filter((hash) => hash !== item.hash);
        }
        return [...previous.slice(-1), item.hash];
      });
      return;
    }

    setSelectedId(item.hash);
    setExpandedHash((current) => (current === item.hash ? null : item.hash));
    setFileDiff(null);
  };

  const handleFileDiff = async (item, file) => {
    const index = timeline.findIndex((entry) => entry.hash === item.hash);
    const previousHash = timeline[index + 1]?.hash;
    if (!previousHash) {
      setFileDiff({ title: file.path, diff: 'No parent commit available for this file.' });
      return;
    }

    setDiffLoading(true);
    setMessage('');

    try {
      const data = await fetchJson(`/checkpoints/${encodedProject}/diff/${previousHash}/${item.hash}?path=${encodeURIComponent(file.path)}`);
      setFileDiff({ title: file.path, diff: data.diff || 'No diff output.' });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setDiffLoading(false);
    }
  };

  const handleCompare = async () => {
    if (compareSelection.length !== 2) return;

    setCompareLoading(true);
    setMessage('');

    try {
      const oldestFirst = [...compareSelection].sort((a, b) => {
        const indexA = oldestFirstTimeline.findIndex((item) => item.hash === a);
        const indexB = oldestFirstTimeline.findIndex((item) => item.hash === b);
        return indexA - indexB;
      });
      const data = await fetchJson(`/checkpoints/${encodedProject}/diff/${oldestFirst[0]}/${oldestFirst[1]}`);
      setCompareDiff(data.diff || 'No diff output.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setCompareLoading(false);
    }
  };

  const handleSliderChange = (event) => {
    const nextIndex = Number(event.target.value);
    setSliderIndex(nextIndex);
    const item = oldestFirstTimeline[nextIndex];
    if (item) {
      setSelectedId(item.hash);
      setExpandedHash(item.hash);
      setFileDiff(null);
    }
  };

  if (!project) {
    return <div style={styles.empty}>Select a project</div>;
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Checkpoints</div>
          <div style={styles.subtitle}>Time-travel snapshots for {project}</div>
        </div>
        <div style={styles.headerActions}>
          <label style={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(event) => setAutoEnabled(event.target.checked)}
              style={styles.checkbox}
            />
            Auto-checkpoint
          </label>
          <button type="button" style={styles.secondaryButton} onClick={() => loadCheckpoints(selectedId)} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <div style={styles.createRow}>
        <input
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleCreate();
            }
          }}
          placeholder="Checkpoint label"
          style={styles.input}
        />
        <button type="button" style={styles.primaryButton} onClick={handleCreate} disabled={creating || !label.trim()}>
          {creating ? 'Creating...' : 'Create Checkpoint'}
        </button>
      </div>

      {message ? <div style={styles.message}>{message}</div> : null}

      <div style={styles.content}>
        <div style={styles.leftPane}>
          <div style={styles.sectionHeader}>
            <span>Timeline</span>
            <button
              type="button"
              style={{ ...styles.secondaryButton, ...(compareMode ? styles.buttonActive : {}) }}
              onClick={() => {
                setCompareMode((value) => !value);
                setCompareSelection([]);
                setCompareDiff('');
              }}
            >
              Compare
            </button>
          </div>

          <div style={styles.timeline}>
            {!initialized ? <div style={styles.empty}>Git repository will be created on first checkpoint.</div> : null}
            {loading ? <div style={styles.empty}>Loading checkpoints...</div> : null}
            {!loading && timeline.length === 0 ? <div style={styles.empty}>No checkpoints yet.</div> : null}

            {timeline.map((item) => {
              const active = item.hash === selectedId;
              const expanded = item.hash === expandedHash;
              const compareSelected = compareSelection.includes(item.hash);

              return (
                <div key={item.hash} style={styles.timelineEntry}>
                  <button
                    type="button"
                    onClick={() => handleTimelineClick(item)}
                    style={{
                      ...styles.timelineItem,
                      ...(active ? styles.timelineItemActive : {}),
                      ...(compareSelected ? styles.timelineItemCompare : {}),
                    }}
                  >
                    <div style={styles.timelineRail}>
                      <div style={styles.timelineLine} />
                      <div style={styles.timelineDot} />
                    </div>
                    <div style={styles.timelineText}>
                      <div style={styles.timelineTopLine}>
                        <span style={styles.timelineTime}>{formatRelativeTime(item.timestamp)}</span>
                        <span style={styles.fileCountBadge}>{item.changedFiles.length}</span>
                      </div>
                      <div style={styles.timelineLabel}>{item.message}</div>
                      <div style={styles.timelineMeta}>{item.hash.slice(0, 7)} - {item.diffSummary}</div>
                    </div>
                  </button>

                  {expanded ? (
                    <div style={styles.changedFiles}>
                      {item.changedFiles.length ? item.changedFiles.map((file) => (
                        <button key={`${item.hash}-${file.path}`} type="button" style={styles.changedFileButton} onClick={() => handleFileDiff(item, file)}>
                          <span style={{ ...styles.statusIcon, ...getStatusStyle(file.status) }}>{getStatusIcon(file.status)}</span>
                          <span style={styles.changedFilePath}>{file.path}</span>
                        </button>
                      )) : <div style={styles.empty}>No file-level changes in this checkpoint.</div>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div style={styles.legacyList}>
            <div style={styles.sectionTitle}>Checkpoint List</div>
            {checkpoints.map((checkpoint) => (
              <button
                key={checkpoint.id}
                type="button"
                onClick={() => setSelectedId(checkpoint.id)}
                style={{
                  ...styles.checkpointButton,
                  ...(checkpoint.id === selectedId ? styles.timelineItemActive : {}),
                }}
              >
                <span>{checkpoint.label}</span>
                <span style={styles.timelineMeta}>{checkpoint.shortId} - {formatTimestamp(checkpoint.timestamp)}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={styles.previewPane}>
          {compareMode ? (
            <>
              <div style={styles.previewHeader}>
                <div>
                  <div style={styles.previewTitle}>Compare Checkpoints</div>
                  <div style={styles.previewMeta}>
                    {compareSelection.length === 2 ? compareSelection.map((hash) => hash.slice(0, 7)).join(' to ') : 'Select two timeline dots'}
                  </div>
                </div>
                <button type="button" style={styles.primaryButton} onClick={handleCompare} disabled={compareSelection.length !== 2 || compareLoading}>
                  {compareLoading ? 'Comparing...' : 'Show Diff'}
                </button>
              </div>
              <pre style={styles.previewOutput}>{compareDiff || 'No compare diff loaded.'}</pre>
            </>
          ) : (
            <>
              {!selectedDisplayCheckpoint ? <div style={styles.empty}>Select a checkpoint to preview.</div> : null}

              {selectedDisplayCheckpoint ? (
                <>
                  <div style={styles.previewHeader}>
                    <div>
                      <div style={styles.previewTitle}>{selectedDisplayCheckpoint.label}</div>
                      <div style={styles.previewMeta}>
                        {selectedDisplayCheckpoint.shortId} - {formatTimestamp(selectedDisplayCheckpoint.timestamp)}
                      </div>
                    </div>
                    <button
                      type="button"
                      style={styles.restoreButton}
                      onClick={() => handleRestore(selectedDisplayCheckpoint.id)}
                      disabled={restoring}
                    >
                      {restoring ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>

                  {selectedTimelineItem ? (
                    <div style={styles.timelineDetails}>
                      <div style={styles.sectionTitle}>Timeline Files</div>
                      {selectedTimelineItem.changedFiles.map((file) => (
                        <div key={`${selectedTimelineItem.hash}-${file.path}-detail`} style={styles.fileItem}>
                          <span style={{ ...styles.statusIcon, ...getStatusStyle(file.status) }}>{getStatusIcon(file.status)}</span>
                          {file.path}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {diffLoading ? <div style={styles.empty}>Loading diff...</div> : null}
                  {fileDiff ? (
                    <>
                      <div style={styles.sectionTitle}>File Diff: {fileDiff.title}</div>
                      <pre style={styles.previewOutput}>{fileDiff.diff}</pre>
                    </>
                  ) : null}

                  {previewLoading ? <div style={styles.empty}>Loading preview...</div> : null}

                  {!previewLoading && preview ? (
                    <>
                      <div style={styles.sectionTitle}>Changed Files</div>
                      {preview.files?.length ? (
                        <div style={styles.fileList}>
                          {preview.files.map((file) => (
                            <div key={file} style={styles.fileItem}>{file}</div>
                          ))}
                        </div>
                      ) : (
                        <div style={styles.empty}>No file-level changes in this checkpoint.</div>
                      )}

                      <div style={styles.sectionTitle}>Git Show --stat</div>
                      <pre style={styles.previewOutput}>{preview.preview}</pre>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div style={styles.sliderBar}>
        <input
          type="range"
          min="0"
          max={Math.max(0, oldestFirstTimeline.length - 1)}
          value={Math.min(sliderIndex, Math.max(0, oldestFirstTimeline.length - 1))}
          onChange={handleSliderChange}
          disabled={oldestFirstTimeline.length === 0}
          style={styles.slider}
        />
        <div style={styles.sliderLabel}>
          {sliderCheckpoint ? `${formatTimestamp(sliderCheckpoint.timestamp)} - ${sliderCheckpoint.message}` : 'No checkpoints'}
        </div>
        {!sliderAtHead ? (
          <button type="button" style={styles.restoreButton} onClick={() => handleRestore(sliderCheckpoint.hash)} disabled={restoring}>
            Restore to here
          </button>
        ) : null}
      </div>
    </div>
  );
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: 12,
    gap: 12,
    background: '#1e1e1e',
    color: '#f0f0f0',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: '#f0f0f0',
  },
  subtitle: {
    fontSize: 12,
    color: '#b8b8b8',
    marginTop: 2,
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#f0f0f0',
  },
  checkbox: {
    accentColor: '#0e639c',
  },
  createRow: {
    display: 'flex',
    gap: 10,
  },
  input: {
    flex: 1,
    minWidth: 0,
    background: '#252526',
    color: '#f0f0f0',
    border: '1px solid #333333',
    borderRadius: 6,
    padding: '10px 12px',
    outline: 'none',
  },
  primaryButton: {
    background: '#0e639c',
    color: '#ffffff',
    border: '1px solid #1177bb',
    borderRadius: 6,
    padding: '10px 14px',
    cursor: 'pointer',
  },
  secondaryButton: {
    background: '#252526',
    color: '#f0f0f0',
    border: '1px solid #333333',
    borderRadius: 6,
    padding: '8px 12px',
    cursor: 'pointer',
  },
  buttonActive: {
    background: '#333333',
    borderColor: '#5a5a5a',
  },
  restoreButton: {
    background: '#c26b2e',
    color: '#ffffff',
    border: '1px solid #d17a3b',
    borderRadius: 6,
    padding: '9px 14px',
    cursor: 'pointer',
  },
  message: {
    background: '#232323',
    border: '1px solid #333333',
    color: '#f0f0f0',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 12,
  },
  content: {
    display: 'grid',
    gridTemplateColumns: '360px minmax(0, 1fr)',
    gap: 12,
    minHeight: 0,
    flex: 1,
  },
  leftPane: {
    minHeight: 0,
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
    gap: 10,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 12,
    fontWeight: 700,
  },
  timeline: {
    minHeight: 0,
    overflowY: 'auto',
    border: '1px solid #333333',
    borderRadius: 8,
    background: '#181818',
    padding: 10,
  },
  timelineEntry: {
    position: 'relative',
  },
  timelineItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'stretch',
    gap: 10,
    textAlign: 'left',
    background: 'transparent',
    color: '#f0f0f0',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '8px',
    cursor: 'pointer',
    marginBottom: 4,
  },
  timelineItemActive: {
    background: '#252526',
    borderColor: '#333333',
  },
  timelineItemCompare: {
    borderColor: '#0e639c',
  },
  timelineRail: {
    position: 'relative',
    width: 16,
    flexShrink: 0,
  },
  timelineLine: {
    position: 'absolute',
    top: 0,
    bottom: -14,
    left: 7,
    width: 2,
    background: '#333333',
  },
  timelineDot: {
    position: 'relative',
    width: 12,
    height: 12,
    borderRadius: '50%',
    background: '#0e639c',
    border: '2px solid #1e1e1e',
    marginTop: 7,
    zIndex: 1,
  },
  timelineText: {
    minWidth: 0,
    flex: 1,
  },
  timelineTopLine: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timelineTime: {
    fontSize: 11,
    color: '#b8b8b8',
  },
  fileCountBadge: {
    minWidth: 22,
    textAlign: 'center',
    background: '#333333',
    color: '#f0f0f0',
    borderRadius: 6,
    padding: '2px 6px',
    fontSize: 11,
  },
  timelineLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#f0f0f0',
    wordBreak: 'break-word',
    marginTop: 4,
  },
  timelineMeta: {
    fontSize: 11,
    color: '#b8b8b8',
    marginTop: 4,
  },
  changedFiles: {
    display: 'grid',
    gap: 4,
    margin: '2px 0 10px 34px',
  },
  changedFileButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    textAlign: 'left',
    background: '#202020',
    color: '#f0f0f0',
    border: '1px solid #333333',
    borderRadius: 6,
    padding: '6px 8px',
    cursor: 'pointer',
  },
  changedFilePath: {
    minWidth: 0,
    wordBreak: 'break-word',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
  },
  statusIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: 6,
    fontWeight: 700,
    flexShrink: 0,
  },
  statusAdded: {
    color: '#5fd46d',
    background: '#17351d',
  },
  statusModified: {
    color: '#f0c64c',
    background: '#3b3215',
  },
  statusDeleted: {
    color: '#ff6b6b',
    background: '#3d1919',
  },
  legacyList: {
    maxHeight: 150,
    overflowY: 'auto',
    border: '1px solid #333333',
    borderRadius: 8,
    background: '#181818',
    padding: 10,
  },
  checkpointButton: {
    width: '100%',
    display: 'grid',
    gap: 2,
    textAlign: 'left',
    background: 'transparent',
    color: '#f0f0f0',
    border: '1px solid transparent',
    borderRadius: 6,
    padding: '8px',
    cursor: 'pointer',
  },
  previewPane: {
    minHeight: 0,
    overflowY: 'auto',
    border: '1px solid #333333',
    borderRadius: 8,
    background: '#181818',
    padding: 14,
  },
  previewHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#f0f0f0',
  },
  previewMeta: {
    fontSize: 12,
    color: '#b8b8b8',
    marginTop: 4,
  },
  timelineDetails: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#b8b8b8',
    marginBottom: 8,
    marginTop: 14,
  },
  fileList: {
    display: 'grid',
    gap: 6,
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    color: '#f0f0f0',
    background: '#202020',
    border: '1px solid #333333',
    borderRadius: 6,
    padding: '8px 10px',
    wordBreak: 'break-word',
  },
  previewOutput: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.5,
    color: '#f0f0f0',
    background: '#111111',
    border: '1px solid #333333',
    borderRadius: 8,
    padding: 12,
  },
  sliderBar: {
    display: 'grid',
    gridTemplateColumns: 'minmax(160px, 1fr) minmax(0, 2fr) auto',
    alignItems: 'center',
    gap: 12,
    border: '1px solid #333333',
    borderRadius: 8,
    background: '#181818',
    padding: 10,
  },
  slider: {
    width: '100%',
    accentColor: '#0e639c',
  },
  sliderLabel: {
    minWidth: 0,
    color: '#f0f0f0',
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: {
    color: '#b8b8b8',
    fontSize: 12,
    padding: '8px 2px',
  },
};
