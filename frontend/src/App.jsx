import React, { useState, useRef, useCallback, useEffect, useMemo, Suspense } from 'react';
import {
  VscCode,
  VscFiles,
  VscHubot,
  VscListFlat,
  VscOpenPreview,
  VscPlay,
  VscSave,
  VscTerminal,
} from 'react-icons/vsc';
import api, { socket } from './api';
// Core components loaded eagerly (always visible)
import ProjectSelector from './components/ProjectSelector';
import FileExplorer from './components/FileExplorer';
import CodeEditor from './components/CodeEditor';
import Terminal from './components/Terminal';
import StatusBar from './components/StatusBar';
import Toolbar from './components/Toolbar';
import LoginPage from './components/LoginPage';
import ErrorBoundary from './components/ErrorBoundary';
import OnboardingTour from './components/OnboardingTour';

// Lazy-loaded panels (loaded on demand)
const GitPanel = React.lazy(() => import('./components/GitPanel'));
const CheckpointPanel = React.lazy(() => import('./components/CheckpointPanel'));
const EnvPanel = React.lazy(() => import('./components/EnvPanel'));
const SearchPanel = React.lazy(() => import('./components/SearchPanel'));
const AIChat = React.lazy(() => import('./components/AIChat'));
const ImageGenPanel = React.lazy(() => import('./components/ImageGenPanel'));
const PreviewPane = React.lazy(() => import('./components/PreviewPane'));
const AgentPanel = React.lazy(() => import('./components/AgentPanel'));
const VPSBrowser = React.lazy(() => import('./components/VPSBrowser'));
const VaultPanel = React.lazy(() => import('./components/VaultPanel'));
const PackagePanel = React.lazy(() => import('./components/PackagePanel'));
const DebugPanel = React.lazy(() => import('./components/DebugPanel'));
const DatabasePanel = React.lazy(() => import('./components/DatabasePanel'));
const CommandPalette = React.lazy(() => import('./components/CommandPalette'));
const ElementInspector = React.lazy(() => import('./components/ElementInspector'));
const StyleEditor = React.lazy(() => import('./components/StyleEditor'));
const ConsolePanel = React.lazy(() => import('./components/ConsolePanel'));
const SharedView = React.lazy(() => import('./components/SharedView'));

// v5 new components
const DiffViewer = React.lazy(() => import('./components/DiffViewer'));
const FileHistory = React.lazy(() => import('./components/FileHistory'));
const SecretsPanel = React.lazy(() => import('./components/SecretsPanel'));

// Suspense fallback
const PanelLoader = () => (
  <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'#6c7086',fontSize:13}}>
    Loading...
  </div>
);

const MOBILE_TABS = [
  { id: 'files', label: 'Files', icon: VscFiles },
  { id: 'editor', label: 'Editor', icon: VscCode },
  { id: 'terminal', label: 'Terminal', icon: VscTerminal },
  { id: 'ai', label: 'AI', icon: VscHubot },
];
const MOBILE_PREVIEW_TAB = { id: 'preview', label: 'Preview', icon: VscOpenPreview };

function getSharedTokenFromPath(pathname) {
  const match = pathname.match(/^\/shared\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getViewportMode() {
  if (typeof window === 'undefined') return 'desktop';
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth <= 1024) return 'tablet';
  return 'desktop';
}

function applyCodeToEditor(activeFile, code) {
  const editor = window._monacoEditors?.[activeFile];
  if (!editor) return;

  const sel = editor.getSelection();
  if (sel && !sel.isEmpty()) {
    editor.executeEdits('ai-apply', [{ range: sel, text: code }]);
  } else {
    const pos = editor.getPosition();
    editor.executeEdits('ai-apply', [{
      range: {
        startLineNumber: pos.lineNumber,
        startColumn: pos.column,
        endLineNumber: pos.lineNumber,
        endColumn: pos.column,
      },
      text: code,
    }]);
  }
  editor.focus();
}

function renderAiChat(project, activeFile, fileTree) {
  return (
    <ErrorBoundary name="AI Chat">
      <AIChat
        project={project}
        activeFile={activeFile}
        fileTree={fileTree}
        onApplyCode={(code) => applyCodeToEditor(activeFile, code)}
      />
    </ErrorBoundary>
  );
}

export default function App() {
  const [sharedToken, setSharedToken] = useState(() => getSharedTokenFromPath(window.location.pathname));

  useEffect(() => {
    const syncRoute = () => {
      setSharedToken(getSharedTokenFromPath(window.location.pathname));
    };

    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  if (sharedToken) {
    return <SharedView token={sharedToken} />;
  }

  return <IdeApp />;
}

function IdeApp() {
  const [viewportMode, setViewportMode] = useState(getViewportMode);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('auth-token') || '');
  const [authChecked, setAuthChecked] = useState(Boolean(window.IDE_KEY));
  const [user, setUser] = useState(null);
  const [currentProject, setCurrentProject] = useState(null);
  const [openFiles, setOpenFiles] = useState([]);
  const [primaryActiveFile, setPrimaryActiveFile] = useState(null);
  const [secondaryActiveFile, setSecondaryActiveFile] = useState(null);
  const [splitMode, setSplitMode] = useState(false);
  const [focusedPane, setFocusedPane] = useState('primary');
  const [explorerRevealRequest, setExplorerRevealRequest] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [bottomTab, setBottomTab] = useState('terminal');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(() => localStorage.getItem('preview-open') === 'true');
  const [previewRunning, setPreviewRunning] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() => {
    const saved = localStorage.getItem('panel-preview-width');
    return saved ? Number(saved) : 400;
  });
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [vpsBrowserOpen, setVpsBrowserOpen] = useState(false);
  const [vaultPanelOpen, setVaultPanelOpen] = useState(false);
  const [diffFile, setDiffFile] = useState(null);
  const [historyFile, setHistoryFile] = useState(null);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [inspectActive, setInspectActive] = useState(false);
  const [selectedElement, setSelectedElement] = useState(null);
  const [collaborationUsers, setCollaborationUsers] = useState([]);
  const [mobileActivePanel, setMobileActivePanel] = useState('editor');
  const [mobileFilesOpen, setMobileFilesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tabletSidebarPinned, setTabletSidebarPinned] = useState(false);
  const [allFiles, setAllFiles] = useState([]);
  const [quickFilter, setQuickFilter] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('panel-sidebar-width');
    return saved ? Number(saved) : 250;
  });
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = localStorage.getItem('panel-terminal-height');
    return saved ? Number(saved) : 200;
  });
  const previewIframeRef = useRef(null);
  const quickInputRef = useRef(null);
  const isDraggingPreview = useRef(false);
  const isDraggingSidebar = useRef(false);
  const isDraggingTerminal = useRef(false);
  const mobileTouchStartRef = useRef(null);
  const hasIdeKey = Boolean(window.IDE_KEY);
  const collaborationUsername = user?.username || 'IDE';
  const isMobile = viewportMode === 'mobile';
  const isTablet = viewportMode === 'tablet';
  const mobileTabs = useMemo(() => {
    if (!previewRunning) return MOBILE_TABS;
    return [
      ...MOBILE_TABS.slice(0, 3),
      MOBILE_PREVIEW_TAB,
      MOBILE_TABS[3],
    ];
  }, [previewRunning]);
  const mobileTabOrder = useMemo(() => mobileTabs.map((tab) => tab.id), [mobileTabs]);
  const activeFile =
    splitMode && focusedPane === 'secondary'
      ? (secondaryActiveFile || primaryActiveFile)
      : primaryActiveFile;

  useEffect(() => {
    function handleOpenDiff(e) { setDiffFile(e.detail?.file || null); }
    function handleOpenHistory() { setHistoryFile(activeFile); }
    window.addEventListener('ide:open-diff', handleOpenDiff);
    window.addEventListener('ide:open-file-history', handleOpenHistory);
    return () => {
      window.removeEventListener('ide:open-diff', handleOpenDiff);
      window.removeEventListener('ide:open-file-history', handleOpenHistory);
    };
  }, [activeFile]);

  useEffect(() => {
    const handleResize = () => {
      setViewportMode(getViewportMode());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (authToken) {
      api.defaults.headers.common.Authorization = `Bearer ${authToken}`;
      return;
    }

    delete api.defaults.headers.common.Authorization;
  }, [authToken]);

  useEffect(() => {
    if (hasIdeKey) {
      setAuthChecked(true);
      return;
    }

    if (!authToken) {
      setAuthChecked(true);
      return;
    }

    let cancelled = false;
    api.get('/auth/me')
      .then(({ data }) => {
        if (!cancelled) {
          setUser(data.user || null);
        }
      })
      .catch(() => {
        localStorage.removeItem('auth-token');
        if (!cancelled) {
          setAuthToken('');
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthChecked(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, hasIdeKey]);

  useEffect(() => {
    if (!isMobile) {
      setMobileFilesOpen(false);
      setMobileMenuOpen(false);
    }
    if (!isTablet) {
      setTabletSidebarPinned(false);
    }
  }, [isMobile, isTablet]);

  useEffect(() => {
    if (!isTablet) return;
    setTerminalHeight((current) => (current > 150 ? 150 : current));
  }, [isTablet]);

  useEffect(() => {
    setPreviewRunning(false);
    setMobileActivePanel((panel) => (panel === 'preview' ? 'editor' : panel));
  }, [currentProject]);

  useEffect(() => {
    if (!currentProject) return undefined;

    let cancelled = false;
    api.get(`/preview/${encodeURIComponent(currentProject)}/status`)
      .then(({ data }) => {
        if (!cancelled) {
          setPreviewRunning(Boolean(data.running && data.responding !== false));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewRunning(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject]);

  useEffect(() => {
    const handlePreviewStarted = (payload = {}) => {
      if (payload.project !== currentProject) return;
      setPreviewRunning(true);
    };

    const handlePreviewStopped = (payload = {}) => {
      if (payload.project !== currentProject) return;
      setPreviewRunning(false);
      setMobileActivePanel((panel) => (panel === 'preview' ? 'editor' : panel));
    };

    socket.on('preview:started', handlePreviewStarted);
    socket.on('preview:stopped', handlePreviewStopped);

    return () => {
      socket.off('preview:started', handlePreviewStarted);
      socket.off('preview:stopped', handlePreviewStopped);
    };
  }, [currentProject]);

  useEffect(() => {
    if (!previewRunning) {
      setMobileActivePanel((panel) => (panel === 'preview' ? 'editor' : panel));
    }
  }, [previewRunning]);

  const handleSidebarMouseDown = useCallback((event) => {
    event.preventDefault();
    isDraggingSidebar.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleTerminalMouseDown = useCallback((event) => {
    event.preventDefault();
    isDraggingTerminal.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handlePreviewMouseDown = useCallback((event) => {
    event.preventDefault();
    isDraggingPreview.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (isDraggingSidebar.current) {
        setSidebarWidth(Math.max(150, Math.min(500, event.clientX)));
      }
      if (isDraggingTerminal.current) {
        const minHeight = isTablet ? 150 : 100;
        const maxHeight = isTablet ? 240 : 600;
        setTerminalHeight(Math.max(minHeight, Math.min(maxHeight, window.innerHeight - event.clientY)));
      }
      if (isDraggingPreview.current) {
        setPreviewWidth(Math.max(250, Math.min(800, window.innerWidth - event.clientX)));
      }
    };

    const handleMouseUp = () => {
      if (isDraggingSidebar.current) {
        localStorage.setItem('panel-sidebar-width', String(Math.max(150, Math.min(500, sidebarWidth))));
      }
      if (isDraggingTerminal.current) {
        const minHeight = isTablet ? 150 : 100;
        const maxHeight = isTablet ? 240 : 600;
        localStorage.setItem('panel-terminal-height', String(Math.max(minHeight, Math.min(maxHeight, terminalHeight))));
      }
      if (isDraggingPreview.current) {
        localStorage.setItem('panel-preview-width', String(Math.max(250, Math.min(800, previewWidth))));
      }
      isDraggingSidebar.current = false;
      isDraggingTerminal.current = false;
      isDraggingPreview.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isTablet, previewWidth, sidebarWidth, terminalHeight]);

  const getFallbackFile = useCallback((files, preferredPath) => {
    if (!files.length) return null;
    if (preferredPath && files.some((file) => file.path === preferredPath)) {
      return preferredPath;
    }
    return files[files.length - 1].path;
  }, []);

  const openMobilePanel = useCallback((panelId) => {
    const nextPanel = mobileTabOrder.includes(panelId) ? panelId : 'editor';
    setMobileMenuOpen(false);
    setMobileFilesOpen(false);
    setMobileActivePanel(nextPanel);
  }, [mobileTabOrder]);

  const handleOpenFile = useCallback((file, pane = focusedPane) => {
    setOpenFiles((prev) => {
      const exists = prev.find((entry) => entry.path === file.path);
      if (exists) return prev;
      return [...prev, { ...file, dirty: false }];
    });

    if (isMobile) {
      setMobileActivePanel('editor');
      setMobileFilesOpen(false);
    }

    if (pane === 'secondary' && splitMode) {
      setFocusedPane('secondary');
      setSecondaryActiveFile(file.path);
      return;
    }
    setFocusedPane('primary');
    setPrimaryActiveFile(file.path);
  }, [focusedPane, isMobile, splitMode]);

  const handleCloseFile = useCallback((filePath) => {
    setOpenFiles((prev) => {
      const updated = prev.filter((file) => file.path !== filePath);
      const nextPrimary =
        primaryActiveFile === filePath
          ? getFallbackFile(updated, secondaryActiveFile)
          : getFallbackFile(updated, primaryActiveFile);
      const nextSecondary =
        secondaryActiveFile === filePath
          ? getFallbackFile(updated, nextPrimary)
          : getFallbackFile(updated, secondaryActiveFile || nextPrimary);
      setPrimaryActiveFile(nextPrimary);
      setSecondaryActiveFile(nextSecondary);
      return updated;
    });
  }, [getFallbackFile, primaryActiveFile, secondaryActiveFile]);

  const handleMarkDirty = useCallback((filePath, dirty) => {
    setOpenFiles((prev) => prev.map((file) => (file.path === filePath ? { ...file, dirty } : file)));
  }, []);

  const handleOpenFileAtLine = useCallback((file, line) => {
    handleOpenFile(file);
    if (line) {
      setTimeout(() => {
        const editors = window._monacoEditors;
        if (!editors) return;
        const editor = Object.values(editors).find(Boolean);
        if (!editor) return;
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      }, 300);
    }
  }, [handleOpenFile]);

  const handleNavigateExplorer = useCallback((path) => {
    setExplorerRevealRequest({ path, nonce: Date.now() });
  }, []);

  const triggerSave = useCallback(() => {
    const saveEvent = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
    });
    window.dispatchEvent(saveEvent);
  }, []);

  const handleRunActiveFile = useCallback(() => {
    if (!activeFile || !currentProject) return;
    socket.emit('run:execute', { filePath: activeFile, project: currentProject });
    setIsRunning(true);
  }, [activeFile, currentProject]);

  useEffect(() => {
    const flat = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.type === 'file') flat.push(node);
        if (node.children) walk(node.children);
      }
    };
    walk(fileTree);
    setAllFiles(flat);
  }, [fileTree]);

  useEffect(() => {
    if (!showQuickOpen) return;
    setQuickFilter('');
    setTimeout(() => quickInputRef.current?.focus(), 50);
  }, [showQuickOpen]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && !event.shiftKey && event.key === 's') {
        event.preventDefault();
        return;
      }
      if (ctrl && event.shiftKey && event.key === 'P') {
        event.preventDefault();
        setCommandPaletteOpen((value) => !value);
        return;
      }
      if (ctrl && event.shiftKey && event.key === 'F') {
        event.preventDefault();
        setBottomPanelVisible(true);
        setBottomTab('search');
        return;
      }
      if (ctrl && event.key === 'p') {
        event.preventDefault();
        setShowQuickOpen((value) => !value);
        return;
      }
      if (ctrl && event.key === '`') {
        event.preventDefault();
        setBottomPanelVisible((value) => !value);
        return;
      }
      if (ctrl && event.key === 'b') {
        event.preventDefault();
        setSidebarVisible((value) => !value);
        return;
      }
      if (ctrl && event.key === 'Enter') {
        event.preventDefault();
        handleRunActiveFile();
        return;
      }
      if (ctrl && event.key === '\\') {
        event.preventDefault();
        setSplitMode((prev) => {
          const next = !prev;
          if (next) {
            setSecondaryActiveFile((current) => {
              if (current && openFiles.some((file) => file.path === current)) {
                return current;
              }
              return openFiles.find((file) => file.path !== primaryActiveFile)?.path || primaryActiveFile;
            });
          } else {
            setFocusedPane('primary');
          }
          return next;
        });
        return;
      }
      if (ctrl && event.key === '/') {
        event.preventDefault();
        setShowHelp((value) => !value);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRunActiveFile, openFiles, primaryActiveFile]);

  useEffect(() => {
    if (!currentProject) {
      setCollaborationUsers([]);
      return undefined;
    }

    const handlePresence = (payload = {}) => {
      if (payload.project !== currentProject) return;
      setCollaborationUsers(Array.isArray(payload.users) ? payload.users : []);
    };

    const emitJoin = () => {
      socket.emit('collab:join', {
        project: currentProject,
        username: collaborationUsername,
        file: activeFile || null,
      });
    };

    socket.on('collab:active-users', handlePresence);
    socket.on('connect', emitJoin);

    if (socket.connected) {
      emitJoin();
    }

    return () => {
      socket.off('collab:active-users', handlePresence);
      socket.off('connect', emitJoin);
      socket.emit('collab:leave', { project: currentProject });
    };
  }, [activeFile, collaborationUsername, currentProject]);

  const filteredFiles = quickFilter
    ? allFiles.filter((file) => file.path.toLowerCase().includes(quickFilter.toLowerCase()))
    : allFiles;

  const handleMobileTouchStart = useCallback((event) => {
    const touch = event.changedTouches[0];
    mobileTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleMobileTouchEnd = useCallback((event) => {
    if (!mobileTouchStartRef.current || mobileFilesOpen) {
      mobileTouchStartRef.current = null;
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - mobileTouchStartRef.current.x;
    const deltaY = touch.clientY - mobileTouchStartRef.current.y;
    mobileTouchStartRef.current = null;

    if (Math.abs(deltaX) < 70 || Math.abs(deltaY) > 50) {
      return;
    }

    const activeIndex = mobileTabOrder.indexOf(mobileActivePanel);
    const nextIndex = deltaX < 0 ? activeIndex + 1 : activeIndex - 1;
    const nextTab = mobileTabOrder[nextIndex];
    if (nextTab) {
      openMobilePanel(nextTab);
    }
  }, [mobileActivePanel, mobileFilesOpen, mobileTabOrder, openMobilePanel]);

  const renderBottomPanelContent = () => {
    switch (bottomTab) {
      case 'terminal':
        return (
          <ErrorBoundary name="Terminal">
            <Terminal project={currentProject} />
          </ErrorBoundary>
        );
      case 'git':
        return (
          <ErrorBoundary name="Git Panel">
            <GitPanel project={currentProject} />
          </ErrorBoundary>
        );
      case 'checkpoints':
        return (
          <ErrorBoundary name="Checkpoints Panel">
            <CheckpointPanel project={currentProject} />
          </ErrorBoundary>
        );
      case 'env':
        return (
          <ErrorBoundary name="Environment Panel">
            <EnvPanel project={currentProject} />
          </ErrorBoundary>
        );
      case 'database':
        return (
          <ErrorBoundary name="Database Panel">
            <DatabasePanel project={currentProject} />
          </ErrorBoundary>
        );
      case 'search':
        return (
          <ErrorBoundary name="Search Panel">
            <SearchPanel project={currentProject} onOpenFile={handleOpenFileAtLine} />
          </ErrorBoundary>
        );
      case 'packages':
        return (
          <ErrorBoundary name="Packages Panel">
            <PackagePanel project={currentProject} />
          </ErrorBoundary>
        );
      case 'debug':
        return (
          <ErrorBoundary name="Debug Panel">
            <DebugPanel project={currentProject} />
          </ErrorBoundary>
        );
      case 'console':
        return (
          <ErrorBoundary name="Console Panel">
            <ConsolePanel project={currentProject} />
          </ErrorBoundary>
        );
      default:
        return null;
    }
  };

  const renderEditor = (editorKey, file, setActiveFile, focusPane) => (
    <ErrorBoundary name={editorKey === 'pane:secondary' ? 'Secondary Editor' : 'Code Editor'}>
      <CodeEditor
        project={currentProject}
        openFiles={openFiles}
        activeFile={file}
        currentUser={collaborationUsername}
        collaborationUsers={collaborationUsers}
        onSelectTab={setActiveFile}
        onCloseTab={handleCloseFile}
        onMarkDirty={handleMarkDirty}
        onNavigate={handleNavigateExplorer}
        onFocusEditor={() => setFocusedPane(focusPane)}
        editorInstanceKey={editorKey}
      />
    </ErrorBoundary>
  );

  const renderMobilePanelContent = () => {
    switch (mobileActivePanel) {
      case 'files':
        return (
          <div className="mobile-files-panel">
            <ProjectSelector
              currentProject={currentProject}
              onSelectProject={setCurrentProject}
              setFileTree={setFileTree}
            />
            <ErrorBoundary name="File Explorer">
              <FileExplorer
                project={currentProject}
                fileTree={fileTree}
                setFileTree={setFileTree}
                activeFile={activeFile}
                onOpenFile={handleOpenFile}
                revealRequest={explorerRevealRequest}
              />
            </ErrorBoundary>
          </div>
        );
      case 'terminal':
        return (
          <ErrorBoundary name="Terminal">
            <Terminal project={currentProject} />
          </ErrorBoundary>
        );
      case 'preview':
        return currentProject ? (
          <ErrorBoundary name="Preview Pane">
            <PreviewPane
              project={currentProject}
              iframeRef={previewIframeRef}
              onClose={() => setMobileActivePanel('editor')}
            />
          </ErrorBoundary>
        ) : (
          <div className="mobile-empty-state">
            <VscOpenPreview />
            <span>Select a project to open Preview.</span>
          </div>
        );
      case 'ai':
        return renderAiChat(currentProject, activeFile, fileTree);
      case 'editor':
      default:
        return renderEditor('pane:mobile', primaryActiveFile, setPrimaryActiveFile, 'primary');
    }
  };

  if (!authChecked) {
    return <div style={{ minHeight: '100vh', backgroundColor: '#1e1e1e' }} />;
  }

  if (!hasIdeKey && !authToken) {
    return (
      <LoginPage
        onLogin={({ token, user: nextUser }) => {
          setAuthToken(token);
          setUser(nextUser);
        }}
      />
    );
  }

  const effectiveTerminalHeight = isTablet ? Math.min(terminalHeight, 150) : terminalHeight;

  return (
    <Suspense fallback={<PanelLoader />}>
    <div
      className={`app-container viewport-${viewportMode} ${tabletSidebarPinned ? 'tablet-sidebar-expanded' : ''} ${mobileFilesOpen ? 'mobile-files-open' : ''}`}
    >
      <Toolbar
        project={currentProject}
        activeFile={activeFile}
        isRunning={isRunning}
        setIsRunning={setIsRunning}
        aiPanelOpen={aiPanelOpen}
        onToggleAI={() => setAiPanelOpen((value) => !value)}
        imageGenOpen={imageGenOpen}
        onToggleImageGen={() => setImageGenOpen((value) => !value)}
        agentPanelOpen={agentPanelOpen}
        previewOpen={previewOpen}
        onTogglePreview={() => {
          setPreviewOpen((value) => {
            localStorage.setItem('preview-open', String(!value));
            return !value;
          });
        }}
        onToggleAgent={() => setAgentPanelOpen((value) => !value)}
        onToggleVPS={() => setVpsBrowserOpen((value) => !value)}
        onToggleVault={() => setVaultPanelOpen((value) => !value)}
        onToggleSecrets={() => setSecretsOpen((value) => !value)}
        secretsOpen={secretsOpen}
        inspectActive={inspectActive}
        onToggleInspect={() => {
          setInspectActive((value) => !value);
          if (inspectActive) setSelectedElement(null);
        }}
        mobileMode={isMobile}
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen((value) => !value)}
        onCloseMobileMenu={() => setMobileMenuOpen(false)}
        onOpenMobileFiles={() => openMobilePanel('files')}
        onOpenMobileAI={() => openMobilePanel('ai')}
        onShowMobilePreview={() => {
          if (previewRunning) openMobilePanel('preview');
        }}
      />

      {isMobile ? (
        <>
          <div className="main-content mobile-main-content">
            <div
              className={`mobile-panel-stage mobile-panel-${mobileActivePanel}`}
              onTouchStart={handleMobileTouchStart}
              onTouchEnd={handleMobileTouchEnd}
            >
              {renderMobilePanelContent()}
              {mobileActivePanel === 'editor' && (
                <div className="editor-fab-cluster">
                  <button
                    type="button"
                    className="editor-fab primary"
                    onClick={handleRunActiveFile}
                    disabled={!activeFile || !currentProject}
                    aria-label="Run active file"
                  >
                    <VscPlay />
                  </button>
                  <button
                    type="button"
                    className="editor-fab"
                    onClick={triggerSave}
                    disabled={!activeFile}
                    aria-label="Save active file"
                  >
                    <VscSave />
                  </button>
                  <button
                    type="button"
                    className="editor-fab"
                    onClick={() => openMobilePanel('ai')}
                    aria-label="Open AI chat"
                  >
                    <VscHubot />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className={`mobile-files-overlay ${mobileFilesOpen ? 'open' : ''}`}>
            <div className="mobile-files-sheet">
              <div className="mobile-files-header">
                <span>Workspace</span>
                <button type="button" className="mobile-close-btn" onClick={() => setMobileFilesOpen(false)}>
                  Close
                </button>
              </div>
              <div className="mobile-files-body">
                <ProjectSelector
                  currentProject={currentProject}
                  onSelectProject={setCurrentProject}
                  setFileTree={setFileTree}
                />
                <ErrorBoundary name="File Explorer">
                  <FileExplorer
                    project={currentProject}
                    fileTree={fileTree}
                    setFileTree={setFileTree}
                    activeFile={activeFile}
                    onOpenFile={handleOpenFile}
                    revealRequest={explorerRevealRequest}
                  />
                </ErrorBoundary>
              </div>
            </div>
          </div>

          <nav className="mobile-bottom-nav" aria-label="Mobile panel tabs">
            {mobileTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`mobile-nav-tab ${mobileActivePanel === id ? 'active' : ''}`}
                onClick={() => openMobilePanel(id)}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </>
      ) : (
        <div className="main-content">
          {sidebarVisible && (
            <>
              <div
                className="sidebar-shell"
                onMouseLeave={() => {
                  if (isTablet) {
                    setTabletSidebarPinned(false);
                  }
                }}
              >
                {isTablet && (
                  <button
                    type="button"
                    className="sidebar-rail-toggle"
                    onClick={() => setTabletSidebarPinned((value) => !value)}
                    aria-label="Toggle sidebar"
                  >
                    <VscListFlat />
                  </button>
                )}
                <div className="sidebar" style={{ width: isTablet ? '100%' : sidebarWidth }}>
                  <ProjectSelector
                    currentProject={currentProject}
                    onSelectProject={setCurrentProject}
                    setFileTree={setFileTree}
                  />
                  <ErrorBoundary name="File Explorer">
                    <FileExplorer
                      project={currentProject}
                      fileTree={fileTree}
                      setFileTree={setFileTree}
                      activeFile={activeFile}
                      onOpenFile={handleOpenFile}
                      revealRequest={explorerRevealRequest}
                    />
                  </ErrorBoundary>
                  {secretsOpen && (
                    <React.Suspense fallback={<div style={{ color: '#888', padding: 10 }}>Loading secrets...</div>}>
                      <SecretsPanel project={currentProject} />
                    </React.Suspense>
                  )}
                </div>
              </div>
              {!isTablet && (
                <div
                  className="splitter splitter-vertical"
                  onMouseDown={handleSidebarMouseDown}
                />
              )}
            </>
          )}

          <div className="editor-terminal-container">
            <div
              className="editor-area"
              style={{
                height: bottomPanelVisible ? `calc(100% - ${effectiveTerminalHeight}px - 4px)` : '100%',
                position: 'relative',
              }}
            >
              {diffFile ? (
                <React.Suspense fallback={<div style={{ color: '#888', padding: 20 }}>Loading diff...</div>}>
                  <DiffViewer project={currentProject} file={diffFile} onClose={() => setDiffFile(null)} />
                </React.Suspense>
              ) : historyFile ? (
                <React.Suspense fallback={<div style={{ color: '#888', padding: 20 }}>Loading history...</div>}>
                  <FileHistory project={currentProject} file={historyFile} />
                  <button onClick={() => setHistoryFile(null)} style={{ position: 'absolute', top: 8, right: 8, background: '#f38ba8', color: '#11111b', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', zIndex: 10, fontWeight: 600 }}>Close History</button>
                </React.Suspense>
              ) : splitMode ? (
                <div className="editor-split-view">
                  <div className="editor-pane">
                    {renderEditor('pane:primary', primaryActiveFile, setPrimaryActiveFile, 'primary')}
                  </div>
                  <div className="editor-pane">
                    {renderEditor('pane:secondary', secondaryActiveFile || primaryActiveFile, setSecondaryActiveFile, 'secondary')}
                  </div>
                </div>
              ) : (
                renderEditor('pane:primary', primaryActiveFile, setPrimaryActiveFile, 'primary')
              )}
            </div>

            {bottomPanelVisible && (
              <>
                <div
                  className="splitter splitter-horizontal"
                  onMouseDown={handleTerminalMouseDown}
                />
                <div className="terminal-area" style={{ height: effectiveTerminalHeight }}>
                  <div className="bottom-tabs">
                    {['terminal', 'git', 'checkpoints', 'env', 'database', 'search', 'packages', 'debug', 'console'].map((tab) => (
                      <button
                        key={tab}
                        className={`bottom-tab ${bottomTab === tab ? 'active' : ''}`}
                        onClick={() => setBottomTab(tab)}
                      >
                        {{
                          terminal: 'Terminal',
                          git: 'Git',
                          checkpoints: 'Checkpoints',
                          env: 'Env',
                          database: 'Database',
                          search: 'Search',
                          packages: 'Packages',
                          debug: 'Debug',
                          console: 'Console',
                        }[tab]}
                      </button>
                    ))}
                  </div>
                  <div className="bottom-panel-content">
                    {renderBottomPanelContent()}
                  </div>
                </div>
              </>
            )}
          </div>

          {previewOpen && currentProject && (
            <>
              <div
                className="splitter splitter-vertical"
                onMouseDown={handlePreviewMouseDown}
              />
              <div className="preview-sidebar" style={{ width: previewWidth }}>
                <ErrorBoundary name="Preview Pane">
                  <PreviewPane
                    project={currentProject}
                    iframeRef={previewIframeRef}
                    onClose={() => {
                      setPreviewOpen(false);
                      setInspectActive(false);
                      setSelectedElement(null);
                      localStorage.setItem('preview-open', 'false');
                    }}
                  />
                </ErrorBoundary>
              </div>
            </>
          )}

          {aiPanelOpen && (
            <>
              <div className="splitter splitter-vertical" />
              <div className="ai-sidebar">
                {renderAiChat(currentProject, activeFile, fileTree)}
              </div>
            </>
          )}

        </div>
      )}

      {inspectActive && previewOpen && !isMobile && (
        <div className="inspector-panel-container">
          <ElementInspector
            active={inspectActive}
            iframeRef={previewIframeRef}
            project={currentProject}
            selectedElement={selectedElement}
            onSelectElement={setSelectedElement}
          />
          {selectedElement?.elementType !== 'text' && selectedElement?.elementType !== 'image' && (
            <StyleEditor
              selectedElement={selectedElement}
              iframeRef={previewIframeRef}
              project={currentProject}
            />
          )}
        </div>
      )}

      {!isMobile && (
        <StatusBar
          activeFile={activeFile}
          project={currentProject}
          collaborationUsers={collaborationUsers}
        />
      )}

      <OnboardingTour />

      <ErrorBoundary name="Agent Panel">
        <AgentPanel
          project={currentProject}
          visible={agentPanelOpen}
          onClose={() => setAgentPanelOpen(false)}
        />
      </ErrorBoundary>

      <VPSBrowser
        visible={vpsBrowserOpen}
        onClose={() => setVpsBrowserOpen(false)}
        onOpenFile={(file) => handleOpenFile(file)}
      />

      <ImageGenPanel
        project={currentProject}
        visible={imageGenOpen}
        onClose={() => setImageGenOpen(false)}
        onImageAdded={async (entry) => {
          if (!currentProject) return;
          const response = await api.get(`/files/${encodeURIComponent(currentProject)}`);
          setFileTree(response.data);
          setExplorerRevealRequest({ path: entry.path, nonce: Date.now() });
        }}
      />

      <VaultPanel
        visible={vaultPanelOpen}
        onClose={() => setVaultPanelOpen(false)}
        project={currentProject}
      />

      <CommandPalette
        visible={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onExecute={(cmdId) => {
          switch (cmdId) {
            case 'open-file':
              setShowQuickOpen(true);
              break;
            case 'save':
              if (activeFile) triggerSave();
              break;
            case 'run':
              handleRunActiveFile();
              break;
            case 'git-commit':
              setBottomPanelVisible(true);
              setBottomTab('git');
              break;
            case 'toggle-terminal':
              setBottomPanelVisible((value) => !value);
              break;
            case 'toggle-preview':
              setPreviewOpen((value) => {
                localStorage.setItem('preview-open', String(!value));
                return !value;
              });
              break;
            case 'switch-ai':
              setAiPanelOpen((value) => !value);
              break;
            case 'toggle-sidebar':
              setSidebarVisible((value) => !value);
              break;
            case 'search-files':
              setBottomPanelVisible(true);
              setBottomTab('search');
              break;
            case 'open-vps-browser':
              setVpsBrowserOpen(true);
              break;
            default:
              break;
          }
        }}
      />

      {showQuickOpen && (
        <div className="modal-overlay" onClick={() => setShowQuickOpen(false)}>
          <div className="quick-open-modal" onClick={(event) => event.stopPropagation()}>
            <input
              ref={quickInputRef}
              className="quick-open-input"
              type="text"
              placeholder="Search files..."
              value={quickFilter}
              onChange={(event) => setQuickFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setShowQuickOpen(false);
                if (event.key === 'Enter' && filteredFiles.length > 0) {
                  handleOpenFile(filteredFiles[0]);
                  setShowQuickOpen(false);
                }
              }}
            />
            <div className="quick-open-list">
              {filteredFiles.slice(0, 20).map((file) => (
                <div
                  key={file.path}
                  className="quick-open-item"
                  onClick={() => {
                    handleOpenFile(file);
                    setShowQuickOpen(false);
                  }}
                >
                  <span className="quick-open-name">{file.name}</span>
                  <span className="quick-open-path">{file.path}</span>
                </div>
              ))}
              {filteredFiles.length === 0 && (
                <div className="quick-open-empty">No files found</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={(event) => event.stopPropagation()}>
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
    </Suspense>
  );
}
