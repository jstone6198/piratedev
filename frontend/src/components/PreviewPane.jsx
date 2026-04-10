import React, { useState, useEffect, useRef, useCallback } from 'react';
import api, { socket } from '../api';
import { VscRefresh, VscLinkExternal, VscClose, VscLoading } from 'react-icons/vsc';

export default function PreviewPane({ project, onClose, iframeRef: externalIframeRef }) {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState(null);
  const internalRef = useRef(null);
  const iframeRef = externalIframeRef || internalRef;

  // Start preview server
  const startPreview = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post(`/preview/${encodeURIComponent(project)}/start`);
      if (data.running) {
        const url = data.url;
        setPreviewUrl(url);
        setUrlInput(url);
        setRunning(true);
        // Give server a moment to bind the port
        setTimeout(() => {
          setLoading(false);
          if (iframeRef.current) {
            iframeRef.current.src = url;
          }
        }, 1000);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setLoading(false);
    }
  }, [project]);

  // Stop preview server
  const stopPreview = useCallback(async () => {
    if (!project) return;
    try {
      await api.post(`/preview/${encodeURIComponent(project)}/stop`);
    } catch {}
    setRunning(false);
    setPreviewUrl('');
    setUrlInput('');
  }, [project]);

  // Check status on mount / project change
  useEffect(() => {
    if (!project) return;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.get(`/preview/${encodeURIComponent(project)}/status`);
        if (cancelled) return;
        if (data.running) {
          setPreviewUrl(data.url);
          setUrlInput(data.url);
          setRunning(true);
        } else {
          // Auto-start preview when pane opens
          startPreview();
        }
      } catch {
        if (!cancelled) startPreview();
      }
    })();

    return () => { cancelled = true; };
  }, [project, startPreview]);

  // Stop on unmount
  useEffect(() => {
    return () => {
      if (project && running) {
        api.post(`/preview/${encodeURIComponent(project)}/stop`).catch(() => {});
      }
    };
  }, [project, running]);

  // Auto-reload on file:changed
  useEffect(() => {
    const handleFileChanged = (data) => {
      if (data.project === project && iframeRef.current && running) {
        // Small debounce to let the server pick up the new file
        setTimeout(() => {
          try {
            iframeRef.current.src = iframeRef.current.src;
          } catch {
            iframeRef.current.src = previewUrl;
          }
        }, 300);
      }
    };

    socket.on('file:changed', handleFileChanged);
    return () => socket.off('file:changed', handleFileChanged);
  }, [project, running, previewUrl]);

  const handleRefresh = () => {
    if (iframeRef.current) {
      try {
        iframeRef.current.src = iframeRef.current.src;
      } catch {
        iframeRef.current.src = previewUrl;
      }
    }
  };

  const handleUrlSubmit = (e) => {
    e.preventDefault();
    if (iframeRef.current && urlInput) {
      iframeRef.current.src = urlInput;
    }
  };

  const handleOpenExternal = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  };

  return (
    <div className="preview-pane">
      <div className="preview-toolbar">
        <form className="preview-url-bar" onSubmit={handleUrlSubmit}>
          <input
            type="text"
            className="preview-url-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Preview URL..."
            spellCheck={false}
          />
        </form>
        <button className="preview-btn" onClick={handleRefresh} title="Refresh">
          <VscRefresh />
        </button>
        <button className="preview-btn" onClick={handleOpenExternal} title="Open in new tab">
          <VscLinkExternal />
        </button>
        <button className="preview-btn preview-btn-close" onClick={onClose} title="Close preview">
          <VscClose />
        </button>
      </div>
      <div className="preview-content">
        {loading && (
          <div className="preview-loading">
            <VscLoading className="preview-spinner" />
            <span>Starting preview server...</span>
          </div>
        )}
        {error && (
          <div className="preview-error">
            <span>{error}</span>
            <button className="preview-retry-btn" onClick={startPreview}>Retry</button>
          </div>
        )}
        {!loading && !error && (
          <iframe
            ref={iframeRef}
            className="preview-iframe"
            src={previewUrl}
            title="Live Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </div>
    </div>
  );
}
