import React, { useState, useRef, useCallback, useEffect } from 'react';
import { socket } from './api';
import ProjectSelector from './components/ProjectSelector';
import FileExplorer from './components/FileExplorer';
import CodeEditor from './components/CodeEditor';
import Terminal from './components/Terminal';
import GitPanel from './components/GitPanel';
import EnvPanel from './components/EnvPanel';
import SearchPanel from './components/SearchPanel';
import AIChat from './components/AIChat';
import StatusBar from './components/StatusBar';
import Toolbar from './components/Toolbar';

export default function App() {
  const [currentProject, setCurrentProject] = useState(null);
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [bottomTab, setBottomTab] = useState('terminal');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [allFiles, setAllFiles] = useState([]);
  const [quickFilter, setQuickFilter] = useState('');
  const quickInputRef = useRef(null);

  // Resizable panel state — persisted to localStorage
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('panel-sidebar-width');
    return saved ? Number(saved) : 250;
  });
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = localStorage.getItem('panel-terminal-height');
    return saved ? Number(saved) : 200;
  });
  const isDraggingSidebar = useRef(false);
  const isDraggingTerminal = useRef(false);

  const handleSidebarMouseDown = useCallback((e) => {
    e.preventDefault();
    isDraggingSidebar.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleTerminalMouseDown = useCallback((e) => {
    e.preventDefault();
    isDraggingTerminal.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDraggingSidebar.current) {
        const newWidth = Math.max(150, Math.min(500, e.clientX));
        setSidebarWidth(newWidth);
      }
      if (isDraggingTerminal.current) {
        const newHeight = Math.max(100, Math.min(600, window.innerHeight - e.clientY));
        setTerminalHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingSidebar.current) {
        localStorage.setItem('panel-sidebar-width', String(Math.max(150, Math.min(500, sidebarWidth))));
      }
      if (isDraggingTerminal.current) {
        localStorage.setItem('panel-terminal-height', String(Math.max(100, Math.min(600, terminalHeight))));
      }
      isDraggingSidebar.current = false;
      isDraggingTerminal.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sidebarWidth, terminalHeight]);

  const handleOpenFile = useCallback((file) => {
    setOpenFiles((prev) => {
      const exists = prev.find((f) => f.path === file.path);
      if (exists) return prev;
      return [...prev, { ...file, dirty: false }];
    });
    setActiveFile(file.path);
  }, []);

  const handleCloseFile = useCallback((filePath) => {
    setOpenFiles((prev) => {
      const updated = prev.filter((f) => f.path !== filePath);
      // Update active file if the closed one was active
      setActiveFile((currentActive) => {
        if (currentActive === filePath) {
          return updated.length > 0 ? updated[updated.length - 1].path : null;
        }
        return currentActive;
      });
      return updated;
    });
  }, []);

  const handleMarkDirty = useCallback((filePath, dirty) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === filePath ? { ...f, dirty } : f))
    );
  }, []);

  // Open file at specific line (used by search results)
  const handleOpenFileAtLine = useCallback((file, line) => {
    handleOpenFile(file);
    // Store the target line so CodeEditor can scroll to it
    if (line) {
      setTimeout(() => {
        // Monaco editor global: try to reveal line
        const editors = window._monacoEditors;
        if (editors) {
          const editor = Object.values(editors).find(Boolean);
          if (editor) {
            editor.revealLineInCenter(line);
            editor.setPosition({ lineNumber: line, column: 1 });
            editor.focus();
          }
        }
      }, 300);
    }
  }, [handleOpenFile]);

  // Flatten file tree for quick open
  useEffect(() => {
    const flat = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.type === 'file') flat.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(fileTree);
    setAllFiles(flat);
  }, [fileTree]);

  // Focus quick open input when modal opens
  useEffect(() => {
    if (showQuickOpen) {
      setQuickFilter('');
      setTimeout(() => quickInputRef.current?.focus(), 50);
    }
  }, [showQuickOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      // Ctrl+S = save (prevent browser save dialog; actual save handled in CodeEditor)
      if (ctrl && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        return;
      }
      // Ctrl+Shift+F = search tab
      if (ctrl && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setBottomPanelVisible(true);
        setBottomTab('search');
        return;
      }
      // Ctrl+P = quick file open
      if (ctrl && e.key === 'p') {
        e.preventDefault();
        setShowQuickOpen((v) => !v);
        return;
      }
      // Ctrl+` = toggle bottom panel
      if (ctrl && e.key === '`') {
        e.preventDefault();
        setBottomPanelVisible((v) => !v);
        return;
      }
      // Ctrl+B = toggle sidebar
      if (ctrl && e.key === 'b') {
        e.preventDefault();
        setSidebarVisible((v) => !v);
        return;
      }
      // Ctrl+Enter = run current file
      if (ctrl && e.key === 'Enter') {
        e.preventDefault();
        if (activeFile && currentProject) {
          socket.emit('run:execute', { filePath: activeFile, project: currentProject });
          setIsRunning(true);
        }
        return;
      }
      // Ctrl+/ = show help
      if (ctrl && e.key === '/') {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFile, currentProject]);

  // Quick open filtered files
  const filteredFiles = quickFilter
    ? allFiles.filter((f) => f.path.toLowerCase().includes(quickFilter.toLowerCase()))
    : allFiles;

  return (
    <div className="app-container">
      <Toolbar
        project={currentProject}
        activeFile={activeFile}
        isRunning={isRunning}
        setIsRunning={setIsRunning}
        aiPanelOpen={aiPanelOpen}
        onToggleAI={() => setAiPanelOpen((v) => !v)}
      />
      <div className="main-content">
        {sidebarVisible && (
          <>
            <div className="sidebar" style={{ width: sidebarWidth }}>
              <ProjectSelector
                currentProject={currentProject}
                onSelectProject={setCurrentProject}
                setFileTree={setFileTree}
              />
              <FileExplorer
                project={currentProject}
                fileTree={fileTree}
                setFileTree={setFileTree}
                activeFile={activeFile}
                onOpenFile={handleOpenFile}
              />
            </div>
            <div
              className="splitter splitter-vertical"
              onMouseDown={handleSidebarMouseDown}
            />
          </>
        )}
        <div className="editor-terminal-container">
          <div
            className="editor-area"
            style={{ height: bottomPanelVisible ? `calc(100% - ${terminalHeight}px - 4px)` : '100%' }}
          >
            <CodeEditor
              project={currentProject}
              openFiles={openFiles}
              activeFile={activeFile}
              onSelectTab={setActiveFile}
              onCloseTab={handleCloseFile}
              onMarkDirty={handleMarkDirty}
            />
          </div>
          {bottomPanelVisible && (
            <>
              <div
                className="splitter splitter-horizontal"
                onMouseDown={handleTerminalMouseDown}
              />
              <div className="terminal-area" style={{ height: terminalHeight }}>
                <div className="bottom-tabs">
                  {['terminal', 'git', 'env', 'search'].map((tab) => (
                    <button
                      key={tab}
                      className={`bottom-tab ${bottomTab === tab ? 'active' : ''}`}
                      onClick={() => setBottomTab(tab)}
                    >
                      {{ terminal: 'Terminal', git: 'Git', env: 'Env', search: 'Search' }[tab]}
                    </button>
                  ))}
                </div>
                <div className="bottom-panel-content">
                  {bottomTab === 'terminal' && <Terminal project={currentProject} />}
                  {bottomTab === 'git' && <GitPanel project={currentProject} />}
                  {bottomTab === 'env' && <EnvPanel project={currentProject} />}
                  {bottomTab === 'search' && <SearchPanel project={currentProject} onOpenFile={handleOpenFileAtLine} />}
                </div>
              </div>
            </>
          )}
        </div>
        {aiPanelOpen && (
          <>
            <div className="splitter splitter-vertical" />
            <div className="ai-sidebar">
              <AIChat
                project={currentProject}
                activeFile={activeFile}
                onApplyCode={(code) => {
                  const editor = window._monacoEditors?.[activeFile];
                  if (editor) {
                    const sel = editor.getSelection();
                    if (sel && !sel.isEmpty()) {
                      editor.executeEdits('ai-apply', [{ range: sel, text: code }]);
                    } else {
                      const pos = editor.getPosition();
                      editor.executeEdits('ai-apply', [{
                        range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column },
                        text: code,
                      }]);
                    }
                    editor.focus();
                  }
                }}
              />
            </div>
          </>
        )}
      </div>
      <StatusBar
        activeFile={activeFile}
        project={currentProject}
      />

      {/* Quick Open Modal (Ctrl+P) */}
      {showQuickOpen && (
        <div className="modal-overlay" onClick={() => setShowQuickOpen(false)}>
          <div className="quick-open-modal" onClick={(e) => e.stopPropagation()}>
            <input
              ref={quickInputRef}
              className="quick-open-input"
              type="text"
              placeholder="Search files..."
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowQuickOpen(false);
                if (e.key === 'Enter' && filteredFiles.length > 0) {
                  handleOpenFile(filteredFiles[0]);
                  setShowQuickOpen(false);
                }
              }}
            />
            <div className="quick-open-list">
              {filteredFiles.slice(0, 20).map((f) => (
                <div
                  key={f.path}
                  className="quick-open-item"
                  onClick={() => { handleOpenFile(f); setShowQuickOpen(false); }}
                >
                  <span className="quick-open-name">{f.name}</span>
                  <span className="quick-open-path">{f.path}</span>
                </div>
              ))}
              {filteredFiles.length === 0 && (
                <div className="quick-open-empty">No files found</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Help Modal (Ctrl+/) */}
      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', color: 'var(--text-bright)' }}>Keyboard Shortcuts</h3>
            <div className="help-shortcuts">
              <div className="help-row"><kbd>Ctrl</kbd>+<kbd>S</kbd><span>Save current file</span></div>
              <div className="help-row"><kbd>Ctrl</kbd>+<kbd>P</kbd><span>Quick file open</span></div>
              <div className="help-row"><kbd>Ctrl</kbd>+<kbd>`</kbd><span>Toggle terminal</span></div>
              <div className="help-row"><kbd>Ctrl</kbd>+<kbd>B</kbd><span>Toggle sidebar</span></div>
              <div className="help-row"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd><span>Search in files</span></div>
              <div className="help-row"><kbd>Ctrl</kbd>+<kbd>Enter</kbd><span>Run current file</span></div>
              <div className="help-row"><kbd>Ctrl</kbd>+<kbd>/</kbd><span>Show this help</span></div>
            </div>
            <button className="help-close" onClick={() => setShowHelp(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
