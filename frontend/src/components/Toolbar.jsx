import React, { useCallback, useEffect, useState } from 'react';
import api, { socket, API_BASE } from '../api';
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
} from 'react-icons/vsc';

const EXT_LANG_LABEL = {
  js: 'JavaScript', mjs: 'JavaScript', jsx: 'React JSX', ts: 'TypeScript', tsx: 'React TSX',
  py: 'Python', sh: 'Shell', go: 'Go', rb: 'Ruby', c: 'C', cpp: 'C++', rs: 'Rust',
  html: 'HTML', css: 'CSS', json: 'JSON', md: 'Markdown', yml: 'YAML', yaml: 'YAML',
};

function getLanguageLabel(file) {
  if (!file) return null;
  const ext = file.split('.').pop().toLowerCase();
  return EXT_LANG_LABEL[ext] || ext.toUpperCase();
}

export default function Toolbar({ project, activeFile, isRunning, setIsRunning, aiPanelOpen, onToggleAI, agentPanelOpen, previewOpen, onTogglePreview, onToggleAgent, onToggleVPS, onToggleVault, inspectActive, onToggleInspect }) {
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployInfo, setDeployInfo] = useState(null);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployRefreshing, setDeployRefreshing] = useState(false);
  const [deployError, setDeployError] = useState('');

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

  const handleDownload = useCallback(() => {
    if (!project) return;

    const ideKey = window.IDE_KEY || '';
    const url = `${API_BASE}/api/files/${encodeURIComponent(project)}/download`;
    fetch(url, { headers: { 'x-ide-key': ideKey } })
      .then((res) => {
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${project}.zip`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => alert('Download failed: ' + err.message));
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
        estimatedUrl: response.data.url || current?.estimatedUrl,
      }));
      await refreshDeployStatus();
    } catch (err) {
      setDeployError(err.response?.data?.message || err.message || 'Deployment failed');
    } finally {
      setDeployLoading(false);
    }
  }, [project, refreshDeployStatus]);

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
    }
  }, [project]);

  const detectedType = deployInfo?.type || (deployRefreshing ? 'Detecting...' : 'Unknown');
  const estimatedUrl = deployInfo?.estimatedUrl || (project ? `https://${project}.callcommand.ai` : '');
  const liveUrl = deployInfo?.url;
  const isDeployed = deployInfo?.status === 'deployed';

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
      <div className="toolbar-right">
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
          disabled={!project}
          title="Download Project as ZIP"
        >
          <VscCloudDownload />
          <span>Download</span>
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
                <div className="deploy-success-label">Live URL</div>
                <a className="deploy-live-link" href={liveUrl} target="_blank" rel="noreferrer">
                  {liveUrl}
                </a>
                <button className="deploy-open-btn" onClick={() => window.open(liveUrl, '_blank', 'noopener,noreferrer')}>
                  <VscLinkExternal />
                  <span>Open</span>
                </button>
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
    </div>
  );
}
