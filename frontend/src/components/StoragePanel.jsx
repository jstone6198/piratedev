import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.py',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const STORAGE_LIMIT = 500 * 1024 * 1024;

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function storageUrl(project, suffix) {
  return `/api/storage/${encodeURIComponent(project)}${suffix}`;
}

function fileUrl(project, filename) {
  return storageUrl(project, `/file/${encodeURIComponent(filename)}`);
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(filename = '') {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : '';
}

function isImage(file) {
  return file?.mimetype?.startsWith('image/');
}

function isPdf(file) {
  return file?.mimetype === 'application/pdf' || fileExtension(file?.name) === '.pdf';
}

function isText(file) {
  return file?.mimetype?.startsWith('text/') || TEXT_EXTENSIONS.has(fileExtension(file?.name));
}

function fileIcon(file) {
  const ext = fileExtension(file.name);
  if (isPdf(file)) return 'PDF';
  if (['.zip', '.tar', '.gz', '.rar', '.7z'].includes(ext)) return 'ZIP';
  if (['.mp3', '.wav', '.aac', '.flac'].includes(ext)) return 'AUD';
  if (['.mp4', '.mov', '.webm', '.avi'].includes(ext)) return 'VID';
  if (isText(file)) return 'DOC';
  return 'FILE';
}

function useAuthenticatedObjectUrl(project, file) {
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    if (!project || !file) {
      setObjectUrl('');
      return undefined;
    }

    let cancelled = false;
    let localUrl = '';

    async function loadFile() {
      try {
        const response = await fetch(fileUrl(project, file.name), { headers: authHeaders() });
        if (!response.ok) throw new Error('Failed to load file');

        const blob = await response.blob();
        if (cancelled) return;

        localUrl = URL.createObjectURL(blob);
        setObjectUrl(localUrl);
      } catch {
        if (!cancelled) setObjectUrl('');
      }
    }

    loadFile();

    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [project, file]);

  return objectUrl;
}

function Thumbnail({ project, file }) {
  const objectUrl = useAuthenticatedObjectUrl(project, isImage(file) ? file : null);

  if (isImage(file)) {
    return objectUrl ? (
      <img src={objectUrl} alt={file.name} style={styles.thumbnailImage} />
    ) : (
      <div style={styles.thumbnailIcon}>IMG</div>
    );
  }

  return <div style={styles.thumbnailIcon}>{fileIcon(file)}</div>;
}

export default function StoragePanel({ project }) {
  const [files, setFiles] = useState([]);
  const [usage, setUsage] = useState({ totalSize: 0, fileCount: 0, files: [] });
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const previewUrlRef = useRef('');

  const usagePercent = Math.min(100, (usage.totalSize / STORAGE_LIMIT) * 100);

  const releasePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
    }
    setPreviewUrl('');
  }, []);

  const loadFiles = useCallback(async () => {
    if (!project) {
      setFiles([]);
      setUsage({ totalSize: 0, fileCount: 0, files: [] });
      return;
    }

    setError('');

    try {
      const [filesResponse, usageResponse] = await Promise.all([
        fetch(storageUrl(project, '/files'), { headers: authHeaders() }),
        fetch(storageUrl(project, '/usage'), { headers: authHeaders() }),
      ]);

      if (!filesResponse.ok) throw new Error('Failed to load files');
      if (!usageResponse.ok) throw new Error('Failed to load usage');

      setFiles(await filesResponse.json());
      setUsage(await usageResponse.json());
    } catch (err) {
      setError(err.message);
    }
  }, [project]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = '';
      }
    };
  }, []);

  const uploadFiles = useCallback((selectedFiles) => {
    if (!project || selectedFiles.length === 0) return;

    const [file] = selectedFiles;
    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    setUploadProgress(0);
    setStatus('');
    setError('');

    const request = new XMLHttpRequest();
    request.open('POST', storageUrl(project, '/upload'));

    Object.entries(authHeaders()).forEach(([header, value]) => {
      request.setRequestHeader(header, value);
    });

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = async () => {
      setUploading(false);

      let body = {};
      try {
        body = JSON.parse(request.responseText || '{}');
      } catch {
        body = {};
      }

      if (request.status < 200 || request.status >= 300) {
        setError(body.error || 'Upload failed');
        return;
      }

      setUploadProgress(100);
      setStatus('Upload complete');
      if (inputRef.current) inputRef.current.value = '';
      await loadFiles();
    };

    request.onerror = () => {
      setUploading(false);
      setError('Upload failed');
    };

    request.send(formData);
  }, [loadFiles, project]);

  const openPreview = async (file) => {
    releasePreviewUrl();
    setPreview(file);
    setPreviewContent('');
    setStatus('');
    setError('');

    try {
      const response = await fetch(fileUrl(project, file.name), { headers: authHeaders() });
      if (!response.ok) throw new Error('Failed to load preview');

      if (isText(file)) {
        setPreviewContent(await response.text());
        return;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      previewUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
    } catch (err) {
      setError(err.message);
    }
  };

  const closePreview = () => {
    setPreview(null);
    setPreviewContent('');
    releasePreviewUrl();
  };

  const copyUrl = async (event, file) => {
    event.stopPropagation();
    const url = fileUrl(project, file.name);
    await navigator.clipboard.writeText(url);
    setStatus('URL copied');
  };

  const deleteFile = async (event, file) => {
    event.stopPropagation();
    if (!window.confirm(`Delete ${file.name}?`)) return;

    setStatus('');
    setError('');

    try {
      const response = await fetch(fileUrl(project, file.name), {
        method: 'DELETE',
        headers: authHeaders(),
      });

      if (!response.ok) throw new Error('Delete failed');

      setStatus('File deleted');
      if (preview?.name === file.name) closePreview();
      await loadFiles();
    } catch (err) {
      setError(err.message);
    }
  };

  const previewBody = useMemo(() => {
    if (!preview) return null;

    if (isImage(preview)) {
      return previewUrl ? <img src={previewUrl} alt={preview.name} style={styles.previewImage} /> : <div>Loading...</div>;
    }

    if (isPdf(preview)) {
      return previewUrl ? <iframe title={preview.name} src={previewUrl} style={styles.previewFrame} /> : <div>Loading...</div>;
    }

    if (isText(preview)) {
      return <pre style={styles.previewPre}>{previewContent || 'Loading...'}</pre>;
    }

    return previewUrl ? (
      <a href={previewUrl} style={styles.downloadLink} download={preview.name}>
        Download {preview.name}
      </a>
    ) : (
      <div>Loading...</div>
    );
  }, [preview, previewContent, previewUrl]);

  if (!project) {
    return (
      <div style={styles.panel}>
        <p style={styles.muted}>Select a project</p>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div
        style={{ ...styles.dropZone, ...(dragging ? styles.dropZoneActive : {}) }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          uploadFiles(Array.from(event.dataTransfer.files || []));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          style={styles.hiddenInput}
          onChange={(event) => uploadFiles(Array.from(event.target.files || []))}
        />
        <div style={styles.dropTitle}>Drop a file here</div>
        <div style={styles.muted}>or click to upload up to 50 MB</div>
        {uploading && (
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${uploadProgress}%` }} />
          </div>
        )}
      </div>

      {status && <div style={styles.status}>{status}</div>}
      {error && <div style={styles.error}>{error}</div>}

      {files.length === 0 ? (
        <div style={styles.emptyState}>No files yet. Drag files here or click to upload.</div>
      ) : (
        <div style={styles.grid}>
          {files.map((file) => (
            <div
              key={file.name}
              style={styles.card}
              onClick={() => openPreview(file)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') openPreview(file);
              }}
              role="button"
              tabIndex={0}
            >
              <Thumbnail project={project} file={file} />
              <div style={styles.fileName} title={file.name}>{file.name}</div>
              <div style={styles.fileMeta}>{formatBytes(file.size)}</div>
              <div style={styles.fileMeta}>{new Date(file.created).toLocaleDateString()}</div>
              <div style={styles.actions}>
                <button type="button" style={styles.smallButton} onClick={(event) => copyUrl(event, file)}>
                  Copy URL
                </button>
                <button type="button" style={styles.dangerButton} onClick={(event) => deleteFile(event, file)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.usage}>
        <div style={styles.usageText}>
          <span>{formatBytes(usage.totalSize)} used</span>
          <span>{usage.fileCount} file{usage.fileCount === 1 ? '' : 's'}</span>
        </div>
        <div style={styles.usageTrack}>
          <div style={{ ...styles.usageFill, width: `${usagePercent}%` }} />
        </div>
      </div>

      {preview && (
        <div style={styles.modalBackdrop} onClick={closePreview}>
          <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>{preview.name}</div>
              <button type="button" style={styles.closeButton} onClick={closePreview}>Close</button>
            </div>
            <div style={styles.modalBody}>{previewBody}</div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    minHeight: '100%',
    boxSizing: 'border-box',
    padding: 16,
    background: '#1e1e1e',
    color: '#f0f0f0',
  },
  dropZone: {
    border: '2px dashed #333',
    borderRadius: 8,
    padding: 22,
    textAlign: 'center',
    cursor: 'pointer',
    background: '#242424',
    color: '#f0f0f0',
  },
  dropZoneActive: {
    borderColor: '#6aa6ff',
    background: '#2a2a2a',
  },
  dropTitle: {
    marginBottom: 6,
    fontSize: 16,
    fontWeight: 700,
  },
  hiddenInput: {
    display: 'none',
  },
  progressTrack: {
    height: 8,
    marginTop: 14,
    overflow: 'hidden',
    border: '1px solid #333',
    borderRadius: 8,
    background: '#1e1e1e',
  },
  progressFill: {
    height: '100%',
    background: '#6aa6ff',
    transition: 'width 120ms linear',
  },
  status: {
    color: '#9be29b',
    fontSize: 13,
  },
  error: {
    color: '#ff8a8a',
    fontSize: 13,
  },
  muted: {
    color: '#aaa',
    fontSize: 13,
  },
  emptyState: {
    padding: 28,
    border: '1px solid #333',
    borderRadius: 8,
    background: '#242424',
    color: '#aaa',
    textAlign: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: 12,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    minWidth: 0,
    padding: 10,
    border: '1px solid #333',
    borderRadius: 8,
    background: '#242424',
    color: '#f0f0f0',
    textAlign: 'left',
    cursor: 'pointer',
  },
  thumbnailImage: {
    width: '100%',
    aspectRatio: '4 / 3',
    objectFit: 'cover',
    border: '1px solid #333',
    borderRadius: 6,
    background: '#1e1e1e',
  },
  thumbnailIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    aspectRatio: '4 / 3',
    border: '1px solid #333',
    borderRadius: 6,
    background: '#1e1e1e',
    color: '#f0f0f0',
    fontWeight: 700,
  },
  fileName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 700,
  },
  fileMeta: {
    color: '#aaa',
    fontSize: 12,
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
  smallButton: {
    flex: 1,
    padding: '6px 8px',
    border: '1px solid #333',
    borderRadius: 6,
    background: '#1e1e1e',
    color: '#f0f0f0',
    cursor: 'pointer',
  },
  dangerButton: {
    flex: 1,
    padding: '6px 8px',
    border: '1px solid #5f2b2b',
    borderRadius: 6,
    background: '#331f1f',
    color: '#ffb0b0',
    cursor: 'pointer',
  },
  usage: {
    marginTop: 'auto',
    paddingTop: 12,
    borderTop: '1px solid #333',
  },
  usageText: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 8,
    color: '#aaa',
    fontSize: 12,
  },
  usageTrack: {
    height: 8,
    overflow: 'hidden',
    border: '1px solid #333',
    borderRadius: 8,
    background: '#242424',
  },
  usageFill: {
    height: '100%',
    background: '#9be29b',
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: 'rgba(0, 0, 0, 0.72)',
  },
  modal: {
    display: 'flex',
    flexDirection: 'column',
    width: 'min(980px, 96vw)',
    maxHeight: '92vh',
    overflow: 'hidden',
    border: '1px solid #333',
    borderRadius: 8,
    background: '#1e1e1e',
    color: '#f0f0f0',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderBottom: '1px solid #333',
  },
  modalTitle: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 700,
  },
  closeButton: {
    padding: '7px 10px',
    border: '1px solid #333',
    borderRadius: 6,
    background: '#242424',
    color: '#f0f0f0',
    cursor: 'pointer',
  },
  modalBody: {
    padding: 12,
    overflow: 'auto',
  },
  previewImage: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '76vh',
    margin: '0 auto',
    objectFit: 'contain',
  },
  previewFrame: {
    width: '100%',
    height: '76vh',
    border: '1px solid #333',
    borderRadius: 6,
    background: '#f0f0f0',
  },
  previewPre: {
    margin: 0,
    color: '#f0f0f0',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  downloadLink: {
    color: '#6aa6ff',
  },
};
