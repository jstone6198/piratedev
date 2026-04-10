import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import api from '../api';
import { VscClose } from 'react-icons/vsc';
import { useSettings } from '../settings';

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

export default function CodeEditor({
  project,
  openFiles,
  activeFile,
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

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

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
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    },
    [project, onMarkDirty]
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
    editor.onDidFocusEditorText(() => {
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
    inlineChangeListenerRef.current?.dispose();
    inlineProviderRef.current?.dispose();
  }, []);

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
