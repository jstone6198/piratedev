import React, { useState, useEffect, useRef, useCallback } from 'react';
import api, { socket } from '../api';
import { VscRefresh, VscLinkExternal, VscClose, VscLoading } from 'react-icons/vsc';

const DEVICE_OPTIONS = [
  { id: 'desktop', label: 'Desktop', width: '100%' },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'mobile', label: 'Mobile', width: 375 },
];

const ZOOM_OPTIONS = [50, 75, 100, 150];

function DesktopIcon({ active }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="11" height="7.5" rx="1.25" stroke={active ? '#007acc' : '#cccccc'} strokeWidth="1.2" />
      <path d="M5.1 11.7h3.8M7 9.8v1.9" stroke={active ? '#007acc' : '#cccccc'} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function TabletIcon({ active }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="3.1" y="1.5" width="7.8" height="11" rx="1.4" stroke={active ? '#007acc' : '#cccccc'} strokeWidth="1.2" />
      <circle cx="7" cy="10.9" r="0.55" fill={active ? '#007acc' : '#cccccc'} />
    </svg>
  );
}

function MobileIcon({ active }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4.1" y="1.2" width="5.8" height="11.6" rx="1.4" stroke={active ? '#007acc' : '#cccccc'} strokeWidth="1.2" />
      <path d="M6.1 2.7h1.8" stroke={active ? '#007acc' : '#cccccc'} strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="7" cy="11.1" r="0.5" fill={active ? '#007acc' : '#cccccc'} />
    </svg>
  );
}

function DeviceIcon({ deviceId, active }) {
  if (deviceId === 'tablet') return <TabletIcon active={active} />;
  if (deviceId === 'mobile') return <MobileIcon active={active} />;
  return <DesktopIcon active={active} />;
}

export default function PreviewPane({ project, onClose, iframeRef: externalIframeRef }) {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState('desktop');
  const [zoomLevel, setZoomLevel] = useState(100);
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

  const activeDevice = DEVICE_OPTIONS.find((device) => device.id === selectedDevice) || DEVICE_OPTIONS[0];
  const isDesktop = activeDevice.id === 'desktop';
  const iframeWidth = typeof activeDevice.width === 'number' ? `${activeDevice.width}px` : activeDevice.width;
  const zoomScale = zoomLevel / 100;

  const toolbarStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    background: '#252526',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    color: '#cccccc',
    flexWrap: 'wrap',
  };

  const segmentedControlStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px',
    borderRadius: '8px',
    background: '#1e1e1e',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  };

  const controlButtonStyle = (active) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid transparent',
    background: active ? 'rgba(0, 122, 204, 0.18)' : 'transparent',
    color: active ? '#ffffff' : '#cccccc',
    cursor: 'pointer',
    fontSize: '12px',
    lineHeight: 1,
    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
    borderColor: active ? 'rgba(0, 122, 204, 0.45)' : 'transparent',
  });

  const previewContentStyle = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#1e1e1e',
  };

  const previewViewportStyle = {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: '20px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    background:
      'radial-gradient(circle at top, rgba(255, 255, 255, 0.04), transparent 40%), #1e1e1e',
  };

  const scaledFrameStyle = {
    width: iframeWidth,
    maxWidth: '100%',
    height: '100%',
    minHeight: '100%',
    transform: `scale(${zoomScale})`,
    transformOrigin: 'top center',
    transition: 'transform 0.18s ease, width 0.18s ease',
  };

  const frameStyle = {
    width: '100%',
    height: '100%',
    minHeight: 'calc(100vh - 230px)',
    background: '#252526',
    border: isDesktop ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: isDesktop ? '10px' : '22px',
    padding: isDesktop ? '0' : '14px 12px 16px',
    boxShadow: isDesktop
      ? '0 18px 40px rgba(0, 0, 0, 0.22)'
      : '0 22px 45px rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(255, 255, 255, 0.03)',
    position: 'relative',
    overflow: 'hidden',
  };

  const iframeStyle = {
    width: '100%',
    height: '100%',
    minHeight: 'calc(100vh - 230px)',
    border: 'none',
    borderRadius: isDesktop ? '10px' : '14px',
    background: '#ffffff',
    display: 'block',
  };

  return (
    <div className="preview-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e' }}>
      <div className="preview-toolbar" style={toolbarStyle}>
        <div style={segmentedControlStyle} aria-label="Preview device sizes">
          {DEVICE_OPTIONS.map((device) => {
            const active = device.id === selectedDevice;
            return (
              <button
                key={device.id}
                type="button"
                onClick={() => setSelectedDevice(device.id)}
                style={controlButtonStyle(active)}
                title={`${device.label}${typeof device.width === 'number' ? ` (${device.width}px)` : ' (100% width)'}`}
              >
                <DeviceIcon deviceId={device.id} active={active} />
                <span>{device.label}</span>
              </button>
            );
          })}
        </div>
        <div style={segmentedControlStyle} aria-label="Preview zoom levels">
          {ZOOM_OPTIONS.map((zoom) => {
            const active = zoom === zoomLevel;
            return (
              <button
                key={zoom}
                type="button"
                onClick={() => setZoomLevel(zoom)}
                style={controlButtonStyle(active)}
                title={`Zoom to ${zoom}%`}
              >
                {zoom}%
              </button>
            );
          })}
        </div>
        <form className="preview-url-bar" onSubmit={handleUrlSubmit} style={{ flex: '1 1 240px', minWidth: '220px' }}>
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
      <div className="preview-content" style={previewContentStyle}>
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
          <div style={previewViewportStyle}>
            <div style={scaledFrameStyle}>
              <div style={frameStyle}>
                {!isDesktop && (
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: '7px',
                      left: '50%',
                      width: activeDevice.id === 'mobile' ? '82px' : '112px',
                      height: '5px',
                      transform: 'translateX(-50%)',
                      borderRadius: '999px',
                      background: 'rgba(255, 255, 255, 0.14)',
                    }}
                  />
                )}
                <iframe
                  ref={iframeRef}
                  className="preview-iframe"
                  src={previewUrl}
                  title="Live Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  style={iframeStyle}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
