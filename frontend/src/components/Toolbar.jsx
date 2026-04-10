import React, { useCallback } from 'react';
import api, { socket, API_BASE } from '../api';
import { VscPlay, VscDebugStop, VscSymbolMisc, VscCloudDownload, VscHubot } from 'react-icons/vsc';

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

export default function Toolbar({ project, activeFile, isRunning, setIsRunning, aiPanelOpen, onToggleAI }) {
  const handleRun = useCallback(async () => {
    if (!activeFile || !project) return;

    setIsRunning(true);
    try {
      // Use socket to run, the backend will stream output
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
    // Build the download URL with auth key as query param for direct browser download
    const ideKey = window.IDE_KEY || '';
    const url = `${API_BASE}/api/files/${encodeURIComponent(project)}/download`;
    // Use fetch with auth header, then trigger download from blob
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

  // Listen for process exit
  React.useEffect(() => {
    const handleExit = () => setIsRunning(false);
    socket.on('run:exit', handleExit);
    return () => socket.off('run:exit', handleExit);
  }, [setIsRunning]);

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
          className="toolbar-btn"
          onClick={handleDownload}
          disabled={!project}
          title="Download Project as ZIP"
        >
          <VscCloudDownload />
          <span>Download</span>
        </button>
        <button
          className={`toolbar-btn ${aiPanelOpen ? 'ai-active' : ''}`}
          onClick={onToggleAI}
          title="Toggle AI Chat"
        >
          <VscHubot />
          <span>AI</span>
        </button>
        <span className={`status-indicator ${isRunning ? 'running' : 'stopped'}`}>
          <span className="status-dot" />
          {isRunning ? 'Running' : 'Ready'}
        </span>
      </div>
    </div>
  );
}
