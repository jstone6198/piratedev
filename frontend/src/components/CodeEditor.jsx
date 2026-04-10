import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import api from '../api';
import { VscClose } from 'react-icons/vsc';

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
  const [fileContents, setFileContents] = useState({});
  const [loadingFile, setLoadingFile] = useState(null);
  const saveTimerRef = useRef({});
  const editorRef = useRef(null);

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
  };

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
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            options={{
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontSize: 14,
              lineHeight: 22,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              autoClosingBrackets: 'always',
              autoClosingQuotes: 'always',
              formatOnPaste: true,
              tabSize: 2,
              wordWrap: 'on',
              padding: { top: 8 },
            }}
          />
        )}
      </div>
    </div>
  );
}
