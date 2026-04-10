import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import api, { socket } from '../api';
import { VscClose } from 'react-icons/vsc';
import { useSettings } from '../settings';
import {
  getCollaboratorColor,
  getCollaboratorInitials,
  getCollaboratorName,
  getStoredCollaborationUsername,
} from '../utils/collaboration';

const EXT_TO_LANGUAGE = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  md: 'markdown',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  txt: 'plaintext',
  env: 'plaintext',
  gitignore: 'plaintext',
  dockerfile: 'dockerfile',
};

function getLanguage(filename) {
  if (!filename) return 'plaintext';
  const ext = filename.split('.').pop().toLowerCase();
  return EXT_TO_LANGUAGE[ext] || 'plaintext';
}

function createRemoteCursorWidget(monaco, user, state) {
  const color = getCollaboratorColor(user.socketId || user.username);
  const domNode = document.createElement('div');
  domNode.className = 'collab-remote-cursor-widget';
  domNode.style.pointerEvents = 'none';

  const label = document.createElement('div');
  label.className = 'collab-remote-cursor-label';
  label.style.background = color;
  label.textContent = getCollaboratorName(user);

  const caret = document.createElement('div');
  caret.className = 'collab-remote-cursor-caret';
  caret.style.background = color;

  domNode.append(label, caret);

  return {
    allowEditorOverflow: true,
    getId: () => `remote-cursor-${user.socketId}`,
    getDomNode: () => domNode,
    getPosition: () => ({
      position: new monaco.Position(state.cursor.line, state.cursor.column),
      preference: [
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
        monaco.editor.ContentWidgetPositionPreference.BELOW,
      ],
    }),
  };
}

export default function CodeEditor({
  project,
  openFiles,
  activeFile,
  currentUser,
  onSelectTab,
  onCloseTab,
  onMarkDirty,
  onNavigate,
  onFocusEditor,
  editorInstanceKey,
}) {
  const settings = useSettings();
  const [fileContents, setFileContents] = useState({});
  const [loadingFile, setLoadingFile] = useState(null);
  const [activeUsers, setActiveUsers] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [saveNotification, setSaveNotification] = useState(null);
  const saveTimerRef = useRef({});
  const inlineTimerRef = useRef(null);
  const inlineRequestIdRef = useRef(0);
  const inlineCompletionRef = useRef(null);
  const inlineQueryRef = useRef(null);
  const activeFileRef = useRef(activeFile);
  const projectRef = useRef(project);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const inlineProviderRef = useRef(null);
  const inlineChangeListenerRef = useRef(null);
  const inlineEditorRef = useRef(null);
  const cursorListenerRef = useRef(null);
  const focusListenerRef = useRef(null);
  const remoteCursorWidgetsRef = useRef(new Map());
  const notificationTimerRef = useRef(null);
  const cursorThrottleRef = useRef({ lastSentAt: 0, pending: null, timer: null });
  const lastJoinedFileRef = useRef(undefined);
  const effectiveUser = currentUser || getStoredCollaborationUsername();

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    if (!project) {
      setActiveUsers([]);
      return undefined;
    }

    const handlePresence = (payload = {}) => {
      if (payload.project !== project) return;
      setActiveUsers(Array.isArray(payload.users) ? payload.users : []);
    };

    const emitJoin = (file = activeFileRef.current) => {
      lastJoinedFileRef.current = file || null;
      socket.emit('collab:join', {
        project,
        file: file || null,
        username: effectiveUser,
      });
    };

    socket.on('collab:active-users', handlePresence);
    socket.on('connect', emitJoin);

    if (socket.connected) {
      emitJoin();
    }

    return () => {
      lastJoinedFileRef.current = undefined;
      socket.off('collab:active-users', handlePresence);
      socket.off('connect', emitJoin);
      socket.emit('collab:leave', { project });
    };
  }, [effectiveUser, project]);

  useEffect(() => {
    if (lastJoinedFileRef.current === (activeFile || null)) return;
    if (!project || !socket.connected) return;
    lastJoinedFileRef.current = activeFile || null;
    socket.emit('collab:join', {
      project,
      file: activeFile || null,
      username: effectiveUser,
    });
  }, [activeFile, effectiveUser, project]);

  useEffect(() => () => {
    if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
    if (cursorThrottleRef.current.timer) clearTimeout(cursorThrottleRef.current.timer);
  }, []);

  // Load file content when a new file is opened
  useEffect(() => {
    if (!activeFile || !project) return;
    if (fileContents[activeFile] !== undefined) return;

    const loadContent = async () => {
      setLoadingFile(activeFile);
      try {
        const res = await api.get(
          `/files/${encodeURIComponent(project)}/content`,
          { params: { path: activeFile } }
        );
        setFileContents((prev) => ({ ...prev, [activeFile]: res.data.content }));
      } catch (err) {
        console.error('Failed to load file:', err);
        setFileContents((prev) => ({
          ...prev,
          [activeFile]: `// Error loading file: ${err.message}`,
        }));
      } finally {
        setLoadingFile(null);
      }
    };
    loadContent();
  }, [activeFile, project, fileContents]);

  // Clean up file contents when tab is closed
  useEffect(() => {
    const openPaths = new Set(openFiles.map((f) => f.path));
    setFileContents((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (!openPaths.has(key)) delete next[key];
      }
      return next;
    });
  }, [openFiles]);

  useEffect(() => () => {
    if (inlineTimerRef.current) clearTimeout(inlineTimerRef.current);
  }, []);

  // Auto-save with debounce
  const saveFile = useCallback(
    async (filePath, content) => {
      if (!project || !filePath) return;
      try {
        await api.put(`/files/${encodeURIComponent(project)}`, {
          path: filePath,
          content,
        });
        onMarkDirty(filePath, false);
        socket.emit('collab:save', {
          project,
          file: filePath,
          content,
          username: effectiveUser,
        });
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    },
    [effectiveUser, onMarkDirty, project]
  );

  const handleEditorChange = useCallback(
    (value) => {
      if (!activeFile) return;
      setFileContents((prev) => ({ ...prev, [activeFile]: value }));
      onMarkDirty(activeFile, true);

      // Debounced auto-save (2 seconds)
      if (saveTimerRef.current[activeFile]) {
        clearTimeout(saveTimerRef.current[activeFile]);
      }
      saveTimerRef.current[activeFile] = setTimeout(() => {
        saveFile(activeFile, value);
      }, 2000);
    },
    [activeFile, onMarkDirty, saveFile]
  );

  const clearInlineCompletion = useCallback((editor = inlineEditorRef.current) => {
    inlineCompletionRef.current = null;
    inlineQueryRef.current = null;
    if (inlineTimerRef.current) clearTimeout(inlineTimerRef.current);
    inlineRequestIdRef.current += 1;
    if (editor) {
      editor.trigger('inline-completion', 'editor.action.inlineSuggest.hide', {});
    }
  }, []);

  const scheduleInlineCompletion = useCallback((editor) => {
    const monaco = monacoRef.current;
    if (!settings.ai.autoComplete || !editor || !monaco || !activeFileRef.current || !projectRef.current) return;

    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) return;

    const lineContent = model.getLineContent(position.lineNumber);
    if (!lineContent.trim()) {
      clearInlineCompletion(editor);
      return;
    }

    if (inlineTimerRef.current) clearTimeout(inlineTimerRef.current);
    inlineTimerRef.current = setTimeout(async () => {
      const latestModel = editor.getModel();
      const latestPosition = editor.getPosition();
      if (!latestModel || !latestPosition) return;

      const latestLineContent = latestModel.getLineContent(latestPosition.lineNumber);
      if (!latestLineContent.trim()) {
        clearInlineCompletion(editor);
        return;
      }

      const latestQueryKey = [
        activeFileRef.current,
        latestModel.getVersionId(),
        latestPosition.lineNumber,
        latestPosition.column,
      ].join(':');

      if (inlineQueryRef.current === latestQueryKey) {
        editor.trigger('inline-completion', 'editor.action.inlineSuggest.trigger', {});
        return;
      }

      const requestId = inlineRequestIdRef.current + 1;
      inlineRequestIdRef.current = requestId;

      try {
        const response = await api.post('/ai/complete', {
          code: latestModel.getValue(),
          cursorLine: latestPosition.lineNumber,
          cursorColumn: latestPosition.column,
          filePath: activeFileRef.current,
          project: projectRef.current,
        });

        if (inlineRequestIdRef.current !== requestId) return;

        const completion = typeof response.data?.completion === 'string'
          ? response.data.completion
          : '';

        inlineQueryRef.current = latestQueryKey;
        inlineCompletionRef.current = completion
          ? {
              filePath: activeFileRef.current,
              lineNumber: latestPosition.lineNumber,
              column: latestPosition.column,
              text: completion,
            }
          : null;

        if (inlineCompletionRef.current) {
          editor.trigger('inline-completion', 'editor.action.inlineSuggest.trigger', {});
        } else {
          editor.trigger('inline-completion', 'editor.action.inlineSuggest.hide', {});
        }
      } catch (err) {
        if (inlineRequestIdRef.current === requestId) {
          inlineCompletionRef.current = null;
          inlineQueryRef.current = null;
        }
        console.error('Inline completion failed:', err);
      }
    }, settings.ai.debounceDelay);
  }, [clearInlineCompletion, settings.ai.autoComplete, settings.ai.debounceDelay]);

  const handleEditorWillMount = useCallback((monaco) => {
    monacoRef.current = monaco;

    if (inlineProviderRef.current) {
      inlineProviderRef.current.dispose();
    }

    inlineProviderRef.current = monaco.languages.registerInlineCompletionsProvider(
      '*',
      {
        provideInlineCompletions(model, position) {
          const completion = inlineCompletionRef.current;
          const filePath = activeFileRef.current;
          const editor = inlineEditorRef.current;

          if (
            !completion ||
            !completion.text ||
            !editor ||
            model !== editor.getModel() ||
            completion.filePath !== filePath ||
            completion.lineNumber !== position.lineNumber ||
            completion.column !== position.column
          ) {
            return { items: [] };
          }

          return {
            items: [
              {
                insertText: completion.text,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column
                ),
              },
            ],
          };
        },
        freeInlineCompletions() {},
      }
    );
  }, []);

  const broadcastCursor = useCallback((position) => {
    const nextLine = Number(position?.lineNumber);
    const nextColumn = Number(position?.column);
    if (!projectRef.current || !activeFileRef.current || !Number.isFinite(nextLine) || !Number.isFinite(nextColumn)) {
      return;
    }

    const send = (line, column) => {
      cursorThrottleRef.current.lastSentAt = Date.now();
      socket.emit('collab:cursor', {
        project: projectRef.current,
        file: activeFileRef.current,
        line,
        column,
        username: effectiveUser,
      });
    };

    const now = Date.now();
    const elapsed = now - cursorThrottleRef.current.lastSentAt;

    if (elapsed >= 100) {
      if (cursorThrottleRef.current.timer) {
        clearTimeout(cursorThrottleRef.current.timer);
        cursorThrottleRef.current.timer = null;
      }
      cursorThrottleRef.current.pending = null;
      send(nextLine, nextColumn);
      return;
    }

    cursorThrottleRef.current.pending = { line: nextLine, column: nextColumn };
    if (!cursorThrottleRef.current.timer) {
      cursorThrottleRef.current.timer = setTimeout(() => {
        const pending = cursorThrottleRef.current.pending;
        cursorThrottleRef.current.timer = null;
        cursorThrottleRef.current.pending = null;
        if (pending) {
          send(pending.line, pending.column);
        }
      }, Math.max(0, 100 - elapsed));
    }
  }, [effectiveUser]);

  const syncRemoteCursorWidgets = useCallback((users = []) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const activeIds = new Set();

    users.forEach((entry) => {
      if (!entry?.socketId || !entry.cursor || entry.socketId === socket.id) return;

      activeIds.add(entry.socketId);
      const existing = remoteCursorWidgetsRef.current.get(entry.socketId);

      if (existing) {
        existing.cursor = entry.cursor;
        editor.layoutContentWidget(existing.widget);
        return;
      }

      const widgetEntry = { cursor: entry.cursor };
      widgetEntry.widget = createRemoteCursorWidget(monaco, entry, widgetEntry);
      remoteCursorWidgetsRef.current.set(entry.socketId, widgetEntry);
      editor.addContentWidget(widgetEntry.widget);
    });

    for (const [socketId, entry] of remoteCursorWidgetsRef.current.entries()) {
      if (activeIds.has(socketId)) continue;
      editor.removeContentWidget(entry.widget);
      remoteCursorWidgetsRef.current.delete(socketId);
    }
  }, []);

  // Ctrl+S to save immediately
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFile && fileContents[activeFile] !== undefined) {
          // Clear debounce timer and save immediately
          if (saveTimerRef.current[activeFile]) {
            clearTimeout(saveTimerRef.current[activeFile]);
          }
          saveFile(activeFile, fileContents[activeFile]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFile, fileContents, saveFile]);

  useEffect(() => {
    const handleCollabEvent = (payload = {}) => {
      if (payload.project !== projectRef.current || !payload.file) return;

      if (payload.action === 'saved') {
        setFileContents((prev) => ({
          ...prev,
          [payload.file]: typeof payload.content === 'string' ? payload.content : prev[payload.file] ?? '',
        }));
        onMarkDirty(payload.file, false);
        setSaveNotification(`${getCollaboratorName(payload.user)} saved ${payload.file.split('/').pop()}`);
        if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
        notificationTimerRef.current = setTimeout(() => setSaveNotification(null), 2500);
        return;
      }

      if (payload.action === 'opened' && payload.file === activeFileRef.current) {
        setSaveNotification(`${getCollaboratorName(payload.user)} opened ${payload.file.split('/').pop()}`);
        if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
        notificationTimerRef.current = setTimeout(() => setSaveNotification(null), 1800);
      }
    };

    const handleRemoteCursor = (payload = {}) => {
      if (
        payload.project !== projectRef.current ||
        payload.file !== activeFileRef.current ||
        !payload.user?.socketId ||
        payload.user.socketId === socket.id
      ) {
        return;
      }

      setRemoteCursors((prev) => ({
        ...prev,
        [payload.user.socketId]: {
          user: payload.user,
          cursor: {
            file: payload.file,
            line: payload.line,
            column: payload.column,
          },
        },
      }));
    };

    socket.on('collab:event', handleCollabEvent);
    socket.on('collab:cursor', handleRemoteCursor);

    return () => {
      socket.off('collab:event', handleCollabEvent);
      socket.off('collab:cursor', handleRemoteCursor);
    };
  }, [onMarkDirty]);

  const handleEditorMount = (editor) => {
    editorRef.current = editor;
    inlineEditorRef.current = editor;
    // Expose editor globally for search navigation
    if (!window._monacoEditors) window._monacoEditors = {};
    if (editorInstanceKey) {
      window._monacoEditors[editorInstanceKey] = editor;
    }
    if (activeFile) {
      window._monacoEditors[activeFile] = editor;
    }
    focusListenerRef.current?.dispose();
    focusListenerRef.current = editor.onDidFocusEditorText(() => {
      onFocusEditor?.();
      if (!window._monacoEditors) window._monacoEditors = {};
      if (editorInstanceKey) {
        window._monacoEditors[editorInstanceKey] = editor;
      }
      if (activeFile) {
        window._monacoEditors[activeFile] = editor;
      }
    });

    inlineChangeListenerRef.current?.dispose();
    inlineChangeListenerRef.current = editor.onDidChangeModelContent(() => {
      scheduleInlineCompletion(editor);
    });

    cursorListenerRef.current?.dispose();
    cursorListenerRef.current = editor.onDidChangeCursorPosition((event) => {
      broadcastCursor(event.position);
    });

    editor.addAction({
      id: 'accept-inline-completion',
      label: 'Accept Inline Completion',
      keybindings: [monacoRef.current.KeyCode.Tab],
      precondition: 'inlineSuggestionVisible',
      run: () => {
        editor.trigger('inline-completion', 'editor.action.inlineSuggest.commit', {});
      },
    });

    editor.addAction({
      id: 'dismiss-inline-completion',
      label: 'Dismiss Inline Completion',
      keybindings: [monacoRef.current.KeyCode.Escape],
      precondition: 'inlineSuggestionVisible',
      run: () => {
        clearInlineCompletion(editor);
      },
    });

    const position = editor.getPosition();
    if (position) {
      broadcastCursor(position);
    }
  };

  useEffect(() => {
    clearInlineCompletion();
  }, [activeFile, clearInlineCompletion]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();

    editor.updateOptions({
      fontSize: settings.editor.fontSize,
      wordWrap: settings.editor.wordWrap ? 'on' : 'off',
      minimap: { enabled: settings.editor.minimap },
      lineNumbers: settings.editor.lineNumbers ? 'on' : 'off',
      inlineSuggest: {
        enabled: settings.ai.autoComplete,
      },
    });

    model?.updateOptions({
      tabSize: settings.editor.tabSize,
      insertSpaces: true,
    });

    if (!settings.ai.autoComplete) {
      clearInlineCompletion(editor);
    }
  }, [clearInlineCompletion, settings]);

  useEffect(() => () => {
    cursorListenerRef.current?.dispose();
    focusListenerRef.current?.dispose();
    inlineChangeListenerRef.current?.dispose();
    inlineProviderRef.current?.dispose();
    const editor = editorRef.current;
    if (editor) {
      for (const entry of remoteCursorWidgetsRef.current.values()) {
        editor.removeContentWidget(entry.widget);
      }
    }
    remoteCursorWidgetsRef.current.clear();
  }, []);

  useEffect(() => {
    setRemoteCursors((prev) => {
      const next = {};
      Object.values(prev).forEach((entry) => {
        if (entry?.cursor?.file === activeFile) {
          next[entry.user.socketId] = entry;
        }
      });
      return next;
    });
  }, [activeFile]);

  const activeCollaborators = activeUsers.filter((user) => user.activeFile === activeFile);
  const remoteCollaborators = activeCollaborators.filter((user) => user.socketId !== socket.id);
  const remoteCursorUsers = remoteCollaborators
    .map((user) => ({
      ...user,
      cursor: remoteCursors[user.socketId]?.cursor || user.cursor,
    }))
    .filter((user) => user.cursor?.file === activeFile);

  useEffect(() => {
    syncRemoteCursorWidgets(remoteCursorUsers);
  }, [remoteCursorUsers, syncRemoteCursorWidgets]);

  const activeContent = activeFile ? fileContents[activeFile] : undefined;
  const activeFileName = activeFile ? activeFile.split('/').pop() : '';
  const breadcrumbSegments = activeFile ? activeFile.split('/') : [];

  return (
    <div className="code-editor" data-testid="code-editor">
      {/* Tab bar */}
      <div className="tab-bar">
        {openFiles.map((file) => {
          const fileName = file.path.split('/').pop();
          const isActive = file.path === activeFile;
          return (
            <div
              key={file.path}
              className={`tab ${isActive ? 'active' : ''}`}
              onClick={() => {
                onFocusEditor?.();
                onSelectTab(file.path);
              }}
              title={file.path}
            >
              {file.dirty && <span className="tab-dirty-dot" />}
              <span className="tab-name">{fileName}</span>
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(file.path);
                }}
                title="Close"
              >
                <VscClose />
              </button>
            </div>
          );
        })}
      </div>

      {/* Breadcrumb bar */}
      {activeFile && (
        <div className="breadcrumb-bar">
          {breadcrumbSegments.map((segment, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="breadcrumb-separator">&gt;</span>}
              <span
                className="breadcrumb-segment"
                onClick={() => onNavigate?.(breadcrumbSegments.slice(0, i + 1).join('/'))}
              >
                {segment}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {activeFile && (
        <div className="collab-editor-bar">
          <div className="collab-editor-summary">
            <span className="collab-editor-count">
              {activeCollaborators.length} {activeCollaborators.length === 1 ? 'user' : 'users'} editing
            </span>
            <div className="collab-editor-avatars">
              {activeCollaborators.map((user) => (
                <div
                  key={user.socketId}
                  className="collab-editor-avatar"
                  style={{ borderColor: getCollaboratorColor(user.socketId || getCollaboratorName(user)) }}
                  title={getCollaboratorName(user)}
                >
                  <span
                    className="collab-editor-avatar-fill"
                    style={{ background: getCollaboratorColor(user.socketId || getCollaboratorName(user)) }}
                  >
                    {getCollaboratorInitials(user)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {saveNotification && (
            <div className="collab-editor-notice">{saveNotification}</div>
          )}
        </div>
      )}

      {/* Editor area */}
      <div className="editor-content">
        {openFiles.length === 0 ? (
          <div className="editor-welcome">
            <div className="welcome-text">
              <h2>Josh IDE</h2>
              <p>Open a file from the explorer to start editing</p>
              <div className="welcome-shortcuts">
                <div><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</div>
                <div><kbd>Ctrl</kbd>+<kbd>Enter</kbd> Run</div>
              </div>
            </div>
          </div>
        ) : loadingFile === activeFile ? (
          <div className="editor-loading">Loading...</div>
        ) : (
          <Editor
            key={activeFile}
            height="100%"
            language={getLanguage(activeFileName)}
            value={activeContent ?? ''}
            theme="vs-dark"
            beforeMount={handleEditorWillMount}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            options={{
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontSize: settings.editor.fontSize,
              lineHeight: 22,
              minimap: { enabled: settings.editor.minimap },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              autoClosingBrackets: 'always',
              autoClosingQuotes: 'always',
              formatOnPaste: true,
              tabSize: settings.editor.tabSize,
              lineNumbers: settings.editor.lineNumbers ? 'on' : 'off',
              wordWrap: settings.editor.wordWrap ? 'on' : 'off',
              padding: { top: 8 },
              inlineSuggest: {
                enabled: settings.ai.autoComplete,
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
