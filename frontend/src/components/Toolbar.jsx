import React, { useCallback, useEffect, useRef, useState } from 'react';
import api, { socket, API_BASE } from '../api';
import SettingsPanel from './SettingsPanel';
import UsageDashboard from './UsageDashboard';
import { FaImage, FaShareAlt, FaSpinner } from 'react-icons/fa';
import {
  VscPlay,
  VscDebugStop,
  VscSymbolMisc,
  VscCloudDownload,
  VscCloudUpload,
  VscHubot,
  VscOpenPreview,
  VscRocket,
  VscServer,
  VscKey,
  VscInspect,
  VscLinkExternal,
  VscMenu,
  VscSettingsGear,
  VscListFlat,
  VscClearAll,
  VscGraph,
} from 'react-icons/vsc';

const EXT_LANG_LABEL = {
  js: 'JavaScript', mjs: 'JavaScript', jsx: 'React JSX', ts: 'TypeScript', tsx: 'React TSX',
  py: 'Python', sh: 'Shell', go: 'Go', rb: 'Ruby', c: 'C', cpp: 'C++', rs: 'Rust',
  html: 'HTML', css: 'CSS', json: 'JSON', md: 'Markdown', yml: 'YAML', yaml: 'YAML',
};

const DEPLOY_TYPE_LABEL = {
  static: 'Static HTML',
  node: 'Node.js',
  python: 'Python',
};

function getLanguageLabel(file) {
  if (!file) return null;
  const ext = file.split('.').pop().toLowerCase();
  return EXT_LANG_LABEL[ext] || ext.toUpperCase();
}

function getDeployTypeLabel(type, loading) {
  if (!type) return loading ? 'Detecting...' : 'Unknown';
  return DEPLOY_TYPE_LABEL[type] || type;
}

function appendLogEntries(current, incoming) {
  return [...current, ...incoming].slice(-500);
}

export default function Toolbar({
  project,
  activeFile,
  isRunning,
  setIsRunning,
  aiPanelOpen,
  onToggleAI,
  imageGenOpen,
  onToggleImageGen,
  agentPanelOpen,
  previewOpen,
  onTogglePreview,
  onToggleAgent,
  onToggleVPS,
  onToggleVault,
  inspectActive,
  onToggleInspect,
  mobileMode = false,
  mobileMenuOpen = false,
  onToggleMobileMenu,
  onCloseMobileMenu,
  onOpenMobileFiles,
  onOpenMobileAI,
  onShowMobilePreview,
}) {
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareData, setShareData] = useState(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [deployInfo, setDeployInfo] = useState(null);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployRefreshing, setDeployRefreshing] = useState(false);
  const [deployError, setDeployError] = useState('');
  const [logsOpen, setLogsOpen] = useState(false);
  const [logEntries, setLogEntries] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [streamConnected, setStreamConnected] = useState(false);
  const logViewportRef = useRef(null);
  const streamAbortRef = useRef(null);
  const detectedType = getDeployTypeLabel(deployInfo?.type, deployRefreshing);
  const estimatedUrl = deployInfo?.estimatedUrl || (project ? `https://${project}.callcommand.ai` : '');
  const liveUrl = deployInfo?.url;
  const isDeployed = deployInfo?.status === 'deployed';
  const deployState = deployInfo?.status === 'deployed'
    ? 'Live'
    : deployInfo?.status === 'stopped'
      ? 'Stopped'
      : deployRefreshing
        ? 'Checking'
        : 'Not deployed';

  const handleRun = useCallback(async () => {
    if (!activeFile || !project) return;

    setIsRunning(true);
    try {
      socket.emit('run:execute', {
        filePath: activeFile,
        project,
      });
    } catch (err) {
      console.error('Failed to start execution:', err);
      setIsRunning(false);
    }
  }, [activeFile, project, setIsRunning]);

  const handleStop = useCallback(() => {
    socket.emit('run:kill');
    setIsRunning(false);
  }, [setIsRunning]);

  const handleDownload = useCallback(async () => {
    if (!project) return;

    const ideKey = window.IDE_KEY || '';
    const url = `${API_BASE}/api/projects/${encodeURIComponent(project)}/export`;

    setExportLoading(true);
    try {
      const res = await fetch(url, { headers: { 'x-ide-key': ideKey } });
      if (!res.ok) {
        let message = 'Export failed';
        try {
          const data = await res.json();
          message = data.error || data.message || message;
        } catch {}
        throw new Error(message);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${project}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      alert('Export failed: ' + err.message);
    } finally {
      setExportLoading(false);
    }
  }, [project]);

  const handleOpenShareModal = useCallback(async () => {
    if (!project) return;

    setShareModalOpen(true);
    setShareLoading(true);
    setShareError('');
    setShareCopied(false);

    try {
      const response = await api.post(`/projects/${encodeURIComponent(project)}/share`);
      setShareData(response.data);
    } catch (err) {
      setShareData(null);
      setShareError(err.response?.data?.error || err.message || 'Failed to create share link');
    } finally {
      setShareLoading(false);
    }
  }, [project]);

  const handleCloseShareModal = useCallback(() => {
    if (shareLoading) return;
    setShareModalOpen(false);
    setShareError('');
    setShareCopied(false);
  }, [shareLoading]);

  const handleCopyShareUrl = useCallback(async () => {
    if (!shareData?.shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareData.shareUrl);
      setShareCopied(true);
    } catch (_error) {
      window.prompt('Copy share URL:', shareData.shareUrl);
    }
  }, [shareData]);

  const handleRevokeShare = useCallback(async () => {
    if (!project) return;

    setShareLoading(true);
    setShareError('');
    setShareCopied(false);

    try {
      await api.delete(`/projects/${encodeURIComponent(project)}/share`);
      setShareData(null);
    } catch (err) {
      setShareError(err.response?.data?.error || err.message || 'Failed to revoke share link');
    } finally {
      setShareLoading(false);
    }
  }, [project]);

  const refreshDeployStatus = useCallback(async () => {
    if (!project) return;

    setDeployRefreshing(true);
    setDeployError('');
    try {
      const response = await api.get(`/deploy/${encodeURIComponent(project)}/status`);
      setDeployInfo(response.data);
    } catch (err) {
      setDeployError(err.response?.data?.message || err.message || 'Failed to load deployment status');
      setDeployInfo(null);
    } finally {
      setDeployRefreshing(false);
    }
  }, [project]);

  const handleOpenDeployModal = useCallback(() => {
    if (!project) return;
    setDeployModalOpen(true);
  }, [project]);

  const handleCloseDeployModal = useCallback(() => {
    if (deployLoading) return;
    setDeployModalOpen(false);
    setDeployError('');
    setLogsOpen(false);
    setLogsError('');
    setStreamConnected(false);
  }, [deployLoading]);

  const handleDeploy = useCallback(async () => {
    if (!project) return;

    setDeployLoading(true);
    setDeployError('');
    try {
      const response = await api.post(`/deploy/${encodeURIComponent(project)}`);
      setDeployInfo((current) => ({
        ...(current || {}),
        ...response.data,
        deployed: true,
        estimatedUrl: current?.estimatedUrl || response.data.url,
      }));
      await refreshDeployStatus();
    } catch (err) {
      setDeployError(err.response?.data?.message || err.message || 'Deployment failed');
    } finally {
      setDeployLoading(false);
    }
  }, [project, refreshDeployStatus]);

  const fetchDeployLogs = useCallback(async () => {
    if (!project) return;

    setLogsLoading(true);
    setLogsError('');
    try {
      const response = await api.get(`/deploy/${encodeURIComponent(project)}/logs`);
      setLogEntries(response.data?.lines || []);
    } catch (err) {
      setLogsError(err.response?.data?.message || err.message || 'Failed to load deployment logs');
      setLogEntries([]);
    } finally {
      setLogsLoading(false);
    }
  }, [project]);

  const handleOpenLogs = useCallback(async () => {
    setLogsOpen(true);
    await fetchDeployLogs();
  }, [fetchDeployLogs]);

  const handleClearLogs = useCallback(() => {
    setLogEntries([]);
    setLogsError('');
  }, []);

  useEffect(() => {
    const handleExit = () => setIsRunning(false);
    socket.on('run:exit', handleExit);
    return () => socket.off('run:exit', handleExit);
  }, [setIsRunning]);

  useEffect(() => {
    if (deployModalOpen && project) {
      refreshDeployStatus();
    }
  }, [deployModalOpen, project, refreshDeployStatus]);

  useEffect(() => {
    if (!project) {
      setDeployModalOpen(false);
      setDeployInfo(null);
      setDeployError('');
      setLogsOpen(false);
      setLogEntries([]);
      setLogsError('');
      setStreamConnected(false);
      setShareModalOpen(false);
      setShareData(null);
      setShareError('');
      setShareCopied(false);
    }
  }, [project]);

  useEffect(() => {
    const node = logViewportRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [logEntries]);

  useEffect(() => {
    if (!deployModalOpen || !logsOpen || !isDeployed || !project) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      fetchDeployLogs();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [deployModalOpen, logsOpen, isDeployed, project, fetchDeployLogs]);

  useEffect(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }

    if (!deployModalOpen || !logsOpen || !isDeployed || !project) {
      setStreamConnected(false);
      return undefined;
    }

    const controller = new AbortController();
    const decoder = new TextDecoder();
    const ideKey = window.IDE_KEY || '';
    let buffer = '';
    let disposed = false;

    streamAbortRef.current = controller;
    setStreamConnected(false);

    fetch(`${API_BASE}/api/deploy/${encodeURIComponent(project)}/logs/stream`, {
      headers: { 'x-ide-key': ideKey },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Log stream failed with status ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Log stream is unavailable');
        }

        setStreamConnected(true);
        const reader = response.body.getReader();

        while (!disposed) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || '';

          for (const message of messages) {
            const dataLine = message
              .split('\n')
              .find((line) => line.startsWith('data: '));

            if (!dataLine) continue;

            try {
              const entry = JSON.parse(dataLine.slice(6));
              setLogEntries((current) => appendLogEntries(current, [entry]));
            } catch {}
          }
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setLogsError((current) => current || error.message || 'Failed to stream deployment logs');
        setStreamConnected(false);
      });

    return () => {
      disposed = true;
      setStreamConnected(false);
      controller.abort();
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null;
      }
    };
  }, [deployModalOpen, logsOpen, isDeployed, project]);

  const openPreview = mobileMode ? onShowMobilePreview || onTogglePreview : onTogglePreview;
  const openAI = mobileMode ? onOpenMobileAI || onToggleAI : onToggleAI;
  const closeMobileMenu = () => {
    onCloseMobileMenu?.();
  };

  return (
    <div className="toolbar" data-testid="toolbar">
      <div className="toolbar-left">
        <VscSymbolMisc className="toolbar-logo" />
        <span className="toolbar-project-name">{project || 'Josh IDE'}</span>
        {activeFile && (
          <span className="toolbar-file-path">
            / {activeFile}
          </span>
        )}
      </div>
      {!mobileMode && (
      <div className="toolbar-center">
        {activeFile && getLanguageLabel(activeFile) && (
          <span className="toolbar-lang-badge">{getLanguageLabel(activeFile)}</span>
        )}
        <button
          className={`toolbar-btn run-btn ${isRunning ? 'disabled' : ''}`}
          onClick={handleRun}
          disabled={isRunning || !activeFile}
          title="Run (Ctrl+Enter)"
        >
          <VscPlay />
          <span>Run</span>
        </button>
        <button
          className={`toolbar-btn stop-btn ${!isRunning ? 'disabled' : ''}`}
          onClick={handleStop}
          disabled={!isRunning}
          title="Stop"
        >
          <VscDebugStop />
          <span>Stop</span>
        </button>
      </div>
      )}
      {!mobileMode && (
      <div className="toolbar-right">
        <button
          className={`toolbar-btn ${settingsOpen ? 'settings-active' : ''}`}
          onClick={() => setSettingsOpen(true)}
          title="Settings"
        >
          <VscSettingsGear />
          <span>Settings</span>
        </button>
        <button
          className={`toolbar-btn ${previewOpen ? 'preview-active' : ''}`}
          onClick={onTogglePreview}
          disabled={!project}
          title="Toggle Live Preview"
        >
          <VscOpenPreview />
          <span>Preview</span>
        </button>
        <button
          className={`toolbar-btn ${inspectActive ? 'inspect-active' : ''}`}
          onClick={onToggleInspect}
          disabled={!previewOpen}
          title="Toggle Element Inspector (Inspect Mode)"
        >
          <VscInspect />
          <span>Inspect</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleDownload}
          disabled={!project || exportLoading}
          title="Export Project as ZIP"
          aria-busy={exportLoading}
        >
          {exportLoading ? <FaSpinner className="toolbar-spinner" /> : <VscCloudDownload />}
          <span>{exportLoading ? 'Exporting...' : 'Export'}</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleOpenShareModal}
          disabled={!project || shareLoading}
          title="Create Share Link"
        >
          {shareLoading && shareModalOpen ? <FaSpinner className="toolbar-spinner" /> : <FaShareAlt />}
          <span>{shareLoading && shareModalOpen ? 'Sharing...' : 'Share'}</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={onToggleVPS}
          title="Browse VPS Files"
        >
          <VscServer />
          <span>VPS</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={onToggleVault}
          title="API Key Vault"
        >
          <VscKey />
          <span>Vault</span>
        </button>
        <button
          className={`toolbar-btn ${usageOpen ? 'usage-active' : ''}`}
          onClick={() => setUsageOpen(true)}
          title="Usage Dashboard"
        >
          <VscGraph />
          <span>Usage</span>
        </button>
        <button
          className={`toolbar-btn ${imageGenOpen ? 'imagegen-active' : ''}`}
          onClick={onToggleImageGen}
          disabled={!project}
          title="Generate image assets"
        >
          <FaImage />
          <span>Image</span>
        </button>
        <button
          className={`toolbar-btn agent-btn-toolbar ${agentPanelOpen ? 'agent-active' : ''}`}
          onClick={onToggleAgent}
          title="Agent Mode — Build from prompt"
        >
          <VscRocket />
          <span>Agent</span>
        </button>
        <button
          className={`toolbar-btn ${aiPanelOpen ? 'ai-active' : ''}`}
          onClick={onToggleAI}
          title="Toggle AI Chat"
        >
          <VscHubot />
          <span>AI</span>
        </button>
        <button
          className={`toolbar-btn deploy-btn ${isDeployed ? 'deploy-active' : ''}`}
          onClick={handleOpenDeployModal}
          disabled={!project}
          title="Deploy Project"
        >
          <VscCloudUpload />
          <span>Deploy</span>
        </button>
        <span className={`status-indicator ${isRunning ? 'running' : 'stopped'}`}>
          <span className="status-dot" />
          {isRunning ? 'Running' : 'Ready'}
        </span>
      </div>
      )}
      {mobileMode && (
        <div className="toolbar-mobile-actions">
          {activeFile && getLanguageLabel(activeFile) && (
            <span className="toolbar-lang-badge">{getLanguageLabel(activeFile)}</span>
          )}
          <button
            type="button"
            className="toolbar-menu-btn"
            onClick={onToggleMobileMenu}
            aria-label="Open toolbar menu"
            aria-expanded={mobileMenuOpen}
          >
            <VscMenu />
          </button>
        </div>
      )}

      {mobileMode && mobileMenuOpen && (
        <div className="toolbar-mobile-menu-overlay" onClick={onCloseMobileMenu}>
          <div className="toolbar-mobile-menu" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                onOpenMobileFiles?.();
              }}
            >
              <VscListFlat />
              <span>Files</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                setSettingsOpen(true);
              }}
            >
              <VscSettingsGear />
              <span>Settings</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                openPreview();
              }}
              disabled={!project}
            >
              <VscOpenPreview />
              <span>Preview</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                onToggleInspect();
              }}
              disabled={!previewOpen && !mobileMode}
            >
              <VscInspect />
              <span>Inspect</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                handleDownload();
              }}
              disabled={!project || exportLoading}
            >
              {exportLoading ? <FaSpinner className="toolbar-spinner" /> : <VscCloudDownload />}
              <span>{exportLoading ? 'Exporting...' : 'Export'}</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                handleOpenShareModal();
              }}
              disabled={!project || shareLoading}
            >
              {shareLoading && shareModalOpen ? <FaSpinner className="toolbar-spinner" /> : <FaShareAlt />}
              <span>{shareLoading && shareModalOpen ? 'Sharing...' : 'Share'}</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                onToggleVPS();
              }}
            >
              <VscServer />
              <span>VPS</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                onToggleVault();
              }}
            >
              <VscKey />
              <span>Vault</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                onToggleImageGen();
              }}
              disabled={!project}
            >
              <FaImage />
              <span>Image</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                onToggleAgent();
              }}
            >
              <VscRocket />
              <span>Agent</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                openAI();
              }}
            >
              <VscHubot />
              <span>AI</span>
            </button>
            <button
              type="button"
              className="toolbar-mobile-menu-btn"
              onClick={() => {
                closeMobileMenu();
                handleOpenDeployModal();
              }}
              disabled={!project}
            >
              <VscCloudUpload />
              <span>Deploy</span>
            </button>
          </div>
        </div>
      )}

      {deployModalOpen && (
        <div className="modal-overlay" onClick={handleCloseDeployModal}>
          <div className="deploy-modal" onClick={(event) => event.stopPropagation()}>
            <div className="deploy-modal-header">
              <div>
                <div className="deploy-modal-title">Deploy Project</div>
                <div className="deploy-modal-subtitle">{project}</div>
              </div>
              <button className="deploy-close-btn" onClick={handleCloseDeployModal} disabled={deployLoading}>
                Close
              </button>
            </div>

            <div className="deploy-details-grid">
              <div className="deploy-detail-card">
                <span className="deploy-detail-label">Project</span>
                <span className="deploy-detail-value">{project}</span>
              </div>
              <div className="deploy-detail-card">
                <span className="deploy-detail-label">Detected Type</span>
                <span className="deploy-detail-value">{detectedType}</span>
              </div>
              <div className="deploy-detail-card">
                <span className="deploy-detail-label">Deploy State</span>
                <span className="deploy-detail-value">{deployState}</span>
              </div>
              <div className="deploy-detail-card deploy-detail-card-wide">
                <span className="deploy-detail-label">Estimated URL</span>
                <span className="deploy-detail-value deploy-url">{estimatedUrl}</span>
              </div>
            </div>

            {(deployLoading || deployRefreshing) && (
              <div className="deploy-progress-card">
                <div className="deploy-progress-row">
                  <span>{deployLoading ? 'Deploying to VPS' : 'Refreshing deploy status'}</span>
                  <span>{deployLoading ? 'In progress' : 'Checking'}</span>
                </div>
                <div className="deploy-progress-track">
                  <div className="deploy-progress-fill" />
                </div>
              </div>
            )}

            {deployError && (
              <div className="deploy-error">
                {deployError}
              </div>
            )}

            {isDeployed && liveUrl && (
              <div className="deploy-success-card">
                <div className="deploy-success-header">
                  <div>
                    <div className="deploy-success-label">Live URL</div>
                    <a className="deploy-live-link" href={liveUrl} target="_blank" rel="noreferrer">
                      {liveUrl}
                    </a>
                  </div>
                  <div className="deploy-success-actions">
                    <button className="deploy-open-btn deploy-logs-btn" onClick={handleOpenLogs}>
                      <VscListFlat />
                      <span>{logsOpen ? 'Logs Open' : 'View Logs'}</span>
                    </button>
                    <button className="deploy-open-btn" onClick={() => window.open(liveUrl, '_blank', 'noopener,noreferrer')}>
                      <VscLinkExternal />
                      <span>Open</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isDeployed && logsOpen && (
              <div className="deploy-logs-card">
                <div className="deploy-logs-header">
                  <div>
                    <div className="deploy-success-label">PM2 Logs</div>
                    <div className="deploy-logs-status">
                      {streamConnected ? 'Streaming live' : 'Polling every 5s'}
                    </div>
                  </div>
                  <div className="deploy-logs-actions">
                    <button className="deploy-open-btn deploy-clear-btn" onClick={handleClearLogs}>
                      <VscClearAll />
                      <span>Clear Logs</span>
                    </button>
                  </div>
                </div>
                {logsLoading && <div className="deploy-logs-meta">Loading recent logs...</div>}
                {logsError && <div className="deploy-logs-meta deploy-logs-meta-error">{logsError}</div>}
                <div className="deploy-logs-viewer" ref={logViewportRef}>
                  {logEntries.length === 0 ? (
                    <div className="deploy-log-line deploy-log-line-empty">No logs yet.</div>
                  ) : (
                    logEntries.map((entry, index) => (
                      <div
                        key={`${index}-${entry.text}`}
                        className={`deploy-log-line ${entry.stream === 'stderr' ? 'deploy-log-line-stderr' : 'deploy-log-line-stdout'}`}
                      >
                        {entry.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="deploy-actions">
              <button className="toolbar-btn" onClick={handleCloseDeployModal} disabled={deployLoading}>
                Cancel
              </button>
              <button className="toolbar-btn deploy-confirm-btn" onClick={handleDeploy} disabled={deployLoading || !project}>
                <VscCloudUpload />
                <span>{isDeployed ? 'Redeploy' : 'Deploy Now'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {shareModalOpen && (
        <div className="modal-overlay" onClick={handleCloseShareModal}>
          <div className="share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="deploy-modal-header">
              <div>
                <div className="deploy-modal-title">Share Project</div>
                <div className="deploy-modal-subtitle">{project}</div>
              </div>
              <button className="deploy-close-btn" onClick={handleCloseShareModal} disabled={shareLoading}>
                Close
              </button>
            </div>

            <div className="share-modal-body">
              <div className="share-modal-banner">
                Create a public, read-only link for this project.
              </div>

              {shareError ? <div className="deploy-error">{shareError}</div> : null}

              <label className="share-modal-label" htmlFor="share-url">
                Share URL
              </label>
              <input
                id="share-url"
                className="share-url-input"
                type="text"
                readOnly
                value={shareData?.shareUrl || (shareLoading ? 'Generating share link...' : '')}
                onFocus={(event) => event.target.select()}
              />

              <div className="share-modal-actions">
                <button
                  className="toolbar-btn deploy-confirm-btn"
                  onClick={handleCopyShareUrl}
                  disabled={!shareData?.shareUrl}
                >
                  {shareCopied ? 'Copied' : 'Copy URL'}
                </button>
                <button
                  className="toolbar-btn"
                  onClick={handleOpenShareModal}
                  disabled={shareLoading || !project}
                >
                  Regenerate
                </button>
                <button
                  className="toolbar-btn"
                  onClick={handleRevokeShare}
                  disabled={shareLoading || !shareData?.shareUrl}
                >
                  Revoke
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <UsageDashboard isOpen={usageOpen} onClose={() => setUsageOpen(false)} project={project} />
      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
