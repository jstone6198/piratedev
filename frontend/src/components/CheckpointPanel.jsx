import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api';

function formatTimestamp(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export default function CheckpointPanel({ project }) {
  const [checkpoints, setCheckpoints] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [initialized, setInitialized] = useState(true);
  const [message, setMessage] = useState('');

  const selectedCheckpoint = useMemo(
    () => checkpoints.find((checkpoint) => checkpoint.id === selectedId) || null,
    [checkpoints, selectedId],
  );

  const loadCheckpoints = useCallback(async (preferredId) => {
    if (!project) {
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const response = await api.get(`/checkpoints/${project}`);
      const nextCheckpoints = response.data?.checkpoints || [];
      setCheckpoints(nextCheckpoints);
      setInitialized(response.data?.initialized !== false);

      const nextSelectedId =
        preferredId && nextCheckpoints.some((checkpoint) => checkpoint.id === preferredId)
          ? preferredId
          : nextCheckpoints[0]?.id || null;

      setSelectedId(nextSelectedId);
      if (!nextSelectedId) {
        setPreview(null);
      }
    } catch (error) {
      setCheckpoints([]);
      setPreview(null);
      setMessage(error.response?.data?.error || error.message);
    } finally {
      setLoading(false);
    }
  }, [project]);

  const loadPreview = useCallback(async (commitId) => {
    if (!project || !commitId) {
      return;
    }

    setPreviewLoading(true);
    setMessage('');

    try {
      const response = await api.post(`/checkpoints/${project}/preview/${commitId}`);
      setPreview(response.data);
      setSelectedId(commitId);
    } catch (error) {
      setPreview(null);
      setMessage(error.response?.data?.error || error.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [project]);

  useEffect(() => {
    setCheckpoints([]);
    setSelectedId(null);
    setPreview(null);
    setLabel('');
    setMessage('');

    if (project) {
      loadCheckpoints();
    }
  }, [project, loadCheckpoints]);

  useEffect(() => {
    if (selectedId) {
      loadPreview(selectedId);
    }
  }, [selectedId, loadPreview]);

  const handleCreate = async () => {
    const trimmedLabel = label.trim();
    if (!project || !trimmedLabel) {
      return;
    }

    setCreating(true);
    setMessage('');

    try {
      const response = await api.post(`/checkpoints/${project}/create`, { label: trimmedLabel });
      setLabel('');
      setMessage(`Created checkpoint ${response.data.id.slice(0, 7)}`);
      await loadCheckpoints(response.data.id);
      await loadPreview(response.data.id);
    } catch (error) {
      setMessage(error.response?.data?.error || error.message);
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
      const response = await api.post(`/checkpoints/${project}/restore/${commitId}`);
      setMessage(`Restored ${response.data.id.slice(0, 7)} in detached HEAD state`);
      await loadCheckpoints(response.data.id);
      await loadPreview(response.data.id);
    } catch (error) {
      setMessage(error.response?.data?.error || error.message);
    } finally {
      setRestoring(false);
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
        <button type="button" style={styles.secondaryButton} onClick={() => loadCheckpoints(selectedId)} disabled={loading}>
          Refresh
        </button>
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
        <div style={styles.timeline}>
          {!initialized ? <div style={styles.empty}>Git repository will be created on first checkpoint.</div> : null}
          {loading ? <div style={styles.empty}>Loading checkpoints...</div> : null}
          {!loading && checkpoints.length === 0 ? <div style={styles.empty}>No checkpoints yet.</div> : null}

          {checkpoints.map((checkpoint) => {
            const active = checkpoint.id === selectedCheckpoint?.id;

            return (
              <button
                key={checkpoint.id}
                type="button"
                onClick={() => setSelectedId(checkpoint.id)}
                style={{
                  ...styles.timelineItem,
                  ...(active ? styles.timelineItemActive : {}),
                }}
              >
                <div style={styles.timelineDot} />
                <div style={styles.timelineText}>
                  <div style={styles.timelineLabel}>{checkpoint.label}</div>
                  <div style={styles.timelineMeta}>
                    <span>{checkpoint.shortId}</span>
                    <span>{formatTimestamp(checkpoint.timestamp)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div style={styles.previewPane}>
          {!selectedCheckpoint ? <div style={styles.empty}>Select a checkpoint to preview.</div> : null}

          {selectedCheckpoint ? (
            <>
              <div style={styles.previewHeader}>
                <div>
                  <div style={styles.previewTitle}>{selectedCheckpoint.label}</div>
                  <div style={styles.previewMeta}>
                    {selectedCheckpoint.shortId} {' - '} {formatTimestamp(selectedCheckpoint.timestamp)}
                  </div>
                </div>
                <button
                  type="button"
                  style={styles.restoreButton}
                  onClick={() => handleRestore(selectedCheckpoint.id)}
                  disabled={restoring}
                >
                  {restoring ? 'Restoring...' : 'Restore'}
                </button>
              </div>

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
    padding: 12,
    gap: 12,
    background: '#1e1e1e',
    color: '#d4d4d4',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: '#f3f3f3',
  },
  subtitle: {
    fontSize: 12,
    color: '#8f8f8f',
    marginTop: 2,
  },
  createRow: {
    display: 'flex',
    gap: 10,
  },
  input: {
    flex: 1,
    minWidth: 0,
    background: '#252526',
    color: '#f3f3f3',
    border: '1px solid #3c3c3c',
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
    color: '#d4d4d4',
    border: '1px solid #3c3c3c',
    borderRadius: 6,
    padding: '8px 12px',
    cursor: 'pointer',
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
    color: '#c5c5c5',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 12,
  },
  content: {
    display: 'grid',
    gridTemplateColumns: '320px minmax(0, 1fr)',
    gap: 12,
    minHeight: 0,
    flex: 1,
  },
  timeline: {
    minHeight: 0,
    overflowY: 'auto',
    border: '1px solid #2d2d2d',
    borderRadius: 8,
    background: '#181818',
    padding: 10,
  },
  timelineItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    textAlign: 'left',
    background: 'transparent',
    color: '#d4d4d4',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '10px 8px',
    cursor: 'pointer',
    marginBottom: 8,
  },
  timelineItemActive: {
    background: '#252526',
    borderColor: '#3c3c3c',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#0e639c',
    marginTop: 6,
    flexShrink: 0,
  },
  timelineText: {
    minWidth: 0,
    flex: 1,
  },
  timelineLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#f0f0f0',
    wordBreak: 'break-word',
  },
  timelineMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: 11,
    color: '#8f8f8f',
    marginTop: 4,
  },
  previewPane: {
    minHeight: 0,
    overflowY: 'auto',
    border: '1px solid #2d2d2d',
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
    color: '#f3f3f3',
  },
  previewMeta: {
    fontSize: 12,
    color: '#8f8f8f',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#8f8f8f',
    marginBottom: 8,
    marginTop: 14,
  },
  fileList: {
    display: 'grid',
    gap: 6,
  },
  fileItem: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    color: '#c5c5c5',
    background: '#202020',
    border: '1px solid #2f2f2f',
    borderRadius: 6,
    padding: '8px 10px',
  },
  previewOutput: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.5,
    color: '#d4d4d4',
    background: '#111111',
    border: '1px solid #2d2d2d',
    borderRadius: 8,
    padding: 12,
  },
  empty: {
    color: '#8f8f8f',
    fontSize: 12,
    padding: '8px 2px',
  },
};
