import React, { useState, useRef, useEffect, useCallback } from 'react';
import { loader } from '@monaco-editor/react';
import api from '../api';

const ENGINES = [
  { id: 'codex', label: 'Codex (GPT-5.4)' },
  { id: 'claude', label: 'Claude Code (Sonnet)' },
];

const MAX_STORED_MESSAGES = 50;
const HISTORY_KEY = (projectName) => `ide-chat-${projectName || 'default'}`;
const ENGINE_KEY = 'ide-ai-engine';

function normalizeMessages(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.slice(-MAX_STORED_MESSAGES);
}

function readStoredMessages(projectName) {
  try {
    const saved = localStorage.getItem(HISTORY_KEY(projectName));
    if (!saved) {
      return [];
    }

    return normalizeMessages(JSON.parse(saved));
  } catch {
    return [];
  }
}

function writeStoredMessages(projectName, nextMessages) {
  const normalized = normalizeMessages(nextMessages);

  if (normalized.length === 0) {
    localStorage.removeItem(HISTORY_KEY(projectName));
    return normalized;
  }

  localStorage.setItem(HISTORY_KEY(projectName), JSON.stringify(normalized));
  return normalized;
}

function flattenFileTree(nodes) {
  const paths = [];

  const walk = (entries) => {
    for (const entry of entries || []) {
      if (entry.type === 'file') {
        paths.push(entry.path);
      }
      if (entry.children?.length) {
        walk(entry.children);
      }
    }
  };

  walk(nodes);
  return paths;
}

function getEditorContext(activeFilePath) {
  const editor = window._monacoEditors?.[activeFilePath];
  if (!editor) {
    return {
      line: 1,
      selection: '',
    };
  }

  const position = editor.getPosition();
  const selection = editor.getSelection();
  const selectedText = selection && !selection.isEmpty()
    ? editor.getModel()?.getValueInRange(selection) || ''
    : '';

  return {
    line: position?.lineNumber || 1,
    selection: selectedText,
  };
}

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

function getLanguageFromPath(filePath, fallback = 'plaintext') {
  if (!filePath) return fallback;
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1]?.toLowerCase() || '';
  if (filename === 'dockerfile') return 'dockerfile';
  if (filename === '.gitignore') return 'plaintext';
  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  return EXT_TO_LANGUAGE[ext] || fallback;
}

function basename(path) {
  return path?.split('/').pop() || path || '';
}

export default function AIChat({ project, activeFile, fileTree, onApplyCode }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [engine, setEngine] = useState(() => localStorage.getItem(ENGINE_KEY) || 'codex');
  const [previewState, setPreviewState] = useState({
    open: false,
    loading: false,
    suggestions: [],
    activeIndex: 0,
  });
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const skipNextPersistRef = useRef(false);

  // Load history from localStorage on mount and project change
  useEffect(() => {
    skipNextPersistRef.current = true;
    setMessages(readStoredMessages(project));
  }, [project]);

  // Persist the currently loaded project's messages, capped to the latest 50
  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    const normalized = normalizeMessages(messages);

    if (normalized.length !== messages.length) {
      setMessages(normalized);
      return;
    }

    writeStoredMessages(project, normalized);
  }, [messages, project]);

  // Persist engine selection
  useEffect(() => {
    localStorage.setItem(ENGINE_KEY, engine);
  }, [engine]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY(project));
  }, [project]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    const updated = normalizeMessages([...messages, userMsg]);
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      let outboundMessage = text;

      if (includeContext && project && activeFile) {
        const [{ data }, editorContext] = await Promise.all([
          api.get(`/files/${encodeURIComponent(project)}/content`, {
            params: { path: activeFile },
          }),
          Promise.resolve(getEditorContext(activeFile)),
        ]);
        const fileList = flattenFileTree(fileTree).join(', ');
        const fileContent = data?.content || '';
        const selectedText = editorContext.selection || '';
        const line = editorContext.line || 1;
        const contextMessage = `Context: Currently editing ${activeFile} (line ${line}). Project files: ${fileList}. File content: ${fileContent}. Selected text: ${selectedText}`;
        outboundMessage = `${contextMessage}\n\n${text}`;
      }

      const body = { message: outboundMessage, engine, project };
      // Send last 10 messages as history
      const history = updated.slice(-10).map(m => ({ role: m.role, content: m.content }));
      body.history = history;

      const res = await api.post('/ai/chat', body);
      const replyEngine = res.data.engine || engine;
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply, engine: replyEngine }]);
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || 'Request failed';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${errMsg}`, engine }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [activeFile, engine, fileTree, includeContext, input, loading, messages, project]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleCreateFile = async (code, lang) => {
    if (!project) return;
    const name = prompt('File name:', lang ? `untitled.${lang}` : 'untitled.txt');
    if (!name) return;
    try {
      // Create file then write content
      await api.post(`/files/${encodeURIComponent(project)}`, { name, type: 'file' });
      await api.put(`/files/${encodeURIComponent(project)}`, { path: name, content: code });
    } catch (err) {
      console.error('Create file failed:', err);
    }
  };

  const handleCopy = (code) => {
    navigator.clipboard.writeText(code).catch(() => {});
  };

  const loadFileContent = useCallback(async (path) => {
    if (!path) return '';

    const editor = window._monacoEditors?.[path];
    const modelValue = editor?.getModel?.()?.getValue?.();
    if (typeof modelValue === 'string') {
      return modelValue;
    }

    if (!project) return '';

    try {
      const { data } = await api.get(`/files/${encodeURIComponent(project)}/content`, {
        params: { path },
      });
      return data?.content || '';
    } catch (err) {
      if (err.response?.status === 404) {
        return '';
      }
      throw err;
    }
  }, [project]);

  const handleOpenPreview = useCallback(async (suggestions) => {
    if (!suggestions?.length) return;

    setPreviewState({
      open: true,
      loading: true,
      suggestions: [],
      activeIndex: 0,
    });

    try {
      const hydratedSuggestions = await Promise.all(
        suggestions.map(async (suggestion, index) => {
          const targetPath = suggestion.filePath || activeFile || '';
          const originalContent = await loadFileContent(targetPath);
          return {
            ...suggestion,
            id: `${targetPath || 'current-file'}:${index}`,
            targetPath,
            originalContent,
            label: targetPath ? basename(targetPath) : `Block ${index + 1}`,
            description: targetPath || activeFile || 'Current file',
            language: getLanguageFromPath(targetPath, suggestion.lang || 'plaintext'),
          };
        })
      );

      setPreviewState({
        open: true,
        loading: false,
        suggestions: hydratedSuggestions,
        activeIndex: 0,
      });
    } catch (err) {
      console.error('Preview load failed:', err);
      setPreviewState({
        open: false,
        loading: false,
        suggestions: [],
        activeIndex: 0,
      });
    }
  }, [activeFile, loadFileContent]);

  const handleDismissPreview = useCallback(() => {
    setPreviewState({
      open: false,
      loading: false,
      suggestions: [],
      activeIndex: 0,
    });
  }, []);

  const handleApplyPreview = useCallback(async () => {
    if (!previewState.suggestions.length) return;

    try {
      await Promise.all(
        previewState.suggestions.map(async (suggestion) => {
          if (suggestion.targetPath && project) {
            const editor = window._monacoEditors?.[suggestion.targetPath];
            const model = editor?.getModel?.();
            if (model) {
              model.setValue(suggestion.value);
            }

            await api.put(`/files/${encodeURIComponent(project)}`, {
              path: suggestion.targetPath,
              content: suggestion.value,
            });
            return;
          }

          if (onApplyCode) {
            onApplyCode(suggestion.value);
          }
        })
      );

      handleDismissPreview();
    } catch (err) {
      console.error('Apply preview failed:', err);
    }
  }, [handleDismissPreview, onApplyCode, previewState.suggestions, project]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>AI CHAT</span>
        <div style={styles.headerRight}>
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
            style={styles.engineSelect}
          >
            {ENGINES.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
          {includeContext && (
            <span style={styles.contextBadge}>CTX</span>
          )}
          <button onClick={clearHistory} style={styles.clearBtn} title="Clear Chat">
            Clear Chat
          </button>
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
              style={styles.checkbox}
            />
            <span style={styles.toggleLabel}>
              Include context
            </span>
          </label>
        </div>
      </div>

      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.empty}>Ask a question about your code...</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={msg.role === 'user' ? styles.userMsg : styles.assistantMsg}>
            <div style={styles.msgHeader}>
              <span style={styles.msgRole}>{msg.role === 'user' ? 'You' : 'AI'}</span>
              {msg.role === 'assistant' && msg.engine && (
                <span style={{
                  ...styles.engineBadge,
                  background: msg.engine === 'claude' ? '#7c3aed' : '#007acc',
                }}>
                  {msg.engine === 'claude' ? 'Claude' : 'Codex'}
                </span>
              )}
            </div>
            <div style={styles.msgContent}>
              <MessageContent
                content={msg.content}
                activeFile={activeFile}
                onPreview={handleOpenPreview}
                onCreate={handleCreateFile}
                onCopy={handleCopy}
              />
            </div>
          </div>
        ))}
        {loading && (
          <div style={styles.assistantMsg}>
            <div style={styles.msgHeader}>
              <span style={styles.msgRole}>AI</span>
              <span style={{
                ...styles.engineBadge,
                background: engine === 'claude' ? '#7c3aed' : '#007acc',
              }}>
                {engine === 'claude' ? 'Claude' : 'Codex'}
              </span>
            </div>
            <div style={styles.typing}>
              <span style={styles.dot}>.</span>
              <span style={{ ...styles.dot, animationDelay: '0.2s' }}>.</span>
              <span style={{ ...styles.dot, animationDelay: '0.4s' }}>.</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputArea}>
        <textarea
          ref={inputRef}
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your code... (Enter to send)"
          rows={2}
          disabled={loading}
        />
        <button
          style={{ ...styles.sendBtn, opacity: loading || !input.trim() ? 0.5 : 1 }}
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>

      {previewState.open && (
        <DiffPreviewModal
          loading={previewState.loading}
          suggestions={previewState.suggestions}
          activeIndex={previewState.activeIndex}
          onSelectTab={(index) => setPreviewState((prev) => ({ ...prev, activeIndex: index }))}
          onApply={handleApplyPreview}
          onDismiss={handleDismissPreview}
        />
      )}
    </div>
  );
}

const CODE_BLOCK_RE = /```([^\n]*)\n([\s\S]*?)```/g;
const KNOWN_LANGS = new Set([
  'javascript',
  'js',
  'jsx',
  'typescript',
  'ts',
  'tsx',
  'python',
  'py',
  'ruby',
  'rb',
  'go',
  'rust',
  'rs',
  'c',
  'cpp',
  'java',
  'html',
  'css',
  'scss',
  'less',
  'json',
  'markdown',
  'md',
  'shell',
  'sh',
  'bash',
  'yaml',
  'yml',
  'xml',
  'sql',
  'plaintext',
  'text',
  'txt',
  'dockerfile',
]);

function parseFenceInfo(info = '') {
  const trimmed = info.trim();
  if (!trimmed) {
    return { lang: '', filePath: '' };
  }

  const tokens = trimmed.split(/\s+/);
  let lang = '';
  let filePath = '';

  for (const token of tokens) {
    if (!lang && KNOWN_LANGS.has(token.toLowerCase())) {
      lang = token.toLowerCase();
      continue;
    }

    if (!filePath) {
      const normalized = token
        .replace(/^path[:=]/i, '')
        .replace(/^file(?:name)?[:=]/i, '')
        .replace(/^["']|["']$/g, '');

      if (/[/.]/.test(normalized)) {
        filePath = normalized;
      }
    }
  }

  return { lang, filePath };
}

function detectFilePath(code = '') {
  const firstLine = code.split('\n')[0]?.trim() || '';
  const match = firstLine.match(/(?:file|path)\s*[:=]\s*([^\s]+)/i);
  return match?.[1] || '';
}

function parseMessageContent(content) {
  const parts = [];
  const suggestions = [];
  let lastIndex = 0;
  let blockIndex = 0;

  for (const match of content.matchAll(CODE_BLOCK_RE)) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }

    const info = parseFenceInfo(match[1]);
    const value = match[2];
    const filePath = info.filePath || detectFilePath(value);
    const suggestion = {
      type: 'code',
      lang: info.lang,
      value,
      filePath,
      index: blockIndex,
    };

    parts.push(suggestion);
    suggestions.push(suggestion);
    blockIndex += 1;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }

  return { parts, suggestions };
}

function MessageContent({ content, activeFile, onPreview, onCreate, onCopy }) {
  const { parts, suggestions } = parseMessageContent(content);
  const hasCode = suggestions.length > 0;

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'code') {
          return (
            <div key={i}>
              <pre style={styles.codeBlock}>
                {part.lang && <div style={styles.codeLang}>{part.lang}</div>}
                <code>{part.value}</code>
              </pre>
              <div style={styles.codeActions}>
                <button style={styles.actionBtn} onClick={() => onCreate(part.value, part.lang)} title="Create new file">
                  + File
                </button>
                <button style={styles.actionBtn} onClick={() => onCopy(part.value)} title="Copy to clipboard">
                  ⎘ Copy
                </button>
              </div>
            </div>
          );
        }
        // Render inline code in text parts
        const inlineParts = part.value.split(/(`[^`]+`)/g);
        return (
          <span key={i}>
            {inlineParts.map((ip, j) => {
              if (ip.startsWith('`') && ip.endsWith('`')) {
                return <code key={j} style={styles.inlineCode}>{ip.slice(1, -1)}</code>;
              }
              return ip;
            })}
          </span>
        );
      })}
      {hasCode && (
        <div style={styles.previewActions}>
          <button
            style={styles.previewBtn}
            onClick={() => onPreview(suggestions)}
            title={activeFile ? `Preview against ${activeFile}` : 'Preview suggested changes'}
          >
            Preview Changes
          </button>
        </div>
      )}
    </>
  );
}

function DiffPreviewModal({
  loading,
  suggestions,
  activeIndex,
  onSelectTab,
  onApply,
  onDismiss,
}) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const originalModelRef = useRef(null);
  const modifiedModelRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    const init = async () => {
      const monaco = await loader.init();
      if (disposed || !containerRef.current) return;

      monacoRef.current = monaco;

      monaco.editor.defineTheme('ai-chat-diff-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#1e1e1e',
          'diffEditor.insertedLineBackground': '#1f4d2f66',
          'diffEditor.insertedTextBackground': '#2ea04355',
          'diffEditor.removedLineBackground': '#5a1d1d66',
          'diffEditor.removedTextBackground': '#f8514955',
          'editor.lineHighlightBackground': '#2a2d2e',
          'editorGutter.background': '#1e1e1e',
        },
      });

      originalModelRef.current = monaco.editor.createModel('', 'plaintext');
      modifiedModelRef.current = monaco.editor.createModel('', 'plaintext');

      editorRef.current = monaco.editor.createDiffEditor(containerRef.current, {
        theme: 'ai-chat-diff-dark',
        automaticLayout: true,
        renderSideBySide: true,
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
      });

      editorRef.current.setModel({
        original: originalModelRef.current,
        modified: modifiedModelRef.current,
      });
    };

    init();

    return () => {
      disposed = true;
      editorRef.current?.dispose();
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      editorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const monaco = monacoRef.current;
    const current = suggestions[activeIndex];
    if (!monaco || !current || !originalModelRef.current || !modifiedModelRef.current) return;

    monaco.editor.setTheme('ai-chat-diff-dark');
    originalModelRef.current.setValue(current.originalContent || '');
    modifiedModelRef.current.setValue(current.value || '');
    monaco.editor.setModelLanguage(originalModelRef.current, current.language || 'plaintext');
    monaco.editor.setModelLanguage(modifiedModelRef.current, current.language || 'plaintext');
  }, [activeIndex, suggestions]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  const activeSuggestion = suggestions[activeIndex];

  return (
    <div style={styles.modalOverlay} onClick={onDismiss}>
      <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div>
            <div style={styles.modalTitle}>Preview Changes</div>
            <div style={styles.modalSubtitle}>
              {activeSuggestion?.description || 'Suggested update'}
            </div>
          </div>
          <button style={styles.modalCloseBtn} onClick={onDismiss} title="Dismiss">
            ✕
          </button>
        </div>

        {suggestions.length > 1 && (
          <div style={styles.tabBar}>
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                style={{
                  ...styles.tabBtn,
                  ...(index === activeIndex ? styles.tabBtnActive : {}),
                }}
                onClick={() => onSelectTab(index)}
                title={suggestion.description}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        )}

        <div style={styles.diffHeader}>
          <span style={styles.diffPaneLabel}>Current</span>
          <span style={styles.diffPaneLabel}>Proposed</span>
        </div>

        <div style={styles.diffContainer}>
          {loading && <div style={styles.modalLoading}>Loading diff...</div>}
          <div
            ref={containerRef}
            style={{
              ...styles.diffEditor,
              opacity: loading ? 0.2 : 1,
            }}
          />
        </div>

        <div style={styles.modalActions}>
          <button style={styles.dismissBtn} onClick={onDismiss}>
            Dismiss
          </button>
          <button style={styles.applyBtn} onClick={onApply} disabled={loading || suggestions.length === 0}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg-primary, #1e1e2e)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px',
    borderBottom: '1px solid var(--border-color, #45475a)',
    background: 'var(--bg-secondary, #181825)',
    minHeight: '32px',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: '4px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  title: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.5px',
    color: 'var(--text-secondary, #a6adc8)',
  },
  engineSelect: {
    background: '#1e1e1e',
    color: '#cccccc',
    border: '1px solid #45475a',
    borderRadius: '4px',
    fontSize: '11px',
    padding: '2px 4px',
    cursor: 'pointer',
    outline: 'none',
  },
  clearBtn: {
    background: 'transparent',
    border: '1px solid #45475a',
    borderRadius: '4px',
    color: '#a6adc8',
    fontSize: '11px',
    padding: '2px 6px',
    cursor: 'pointer',
    lineHeight: 1,
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: 'var(--accent-blue, #89b4fa)',
  },
  toggleLabel: {
    fontSize: '11px',
    color: 'var(--text-secondary, #a6adc8)',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  empty: {
    color: 'var(--text-secondary, #a6adc8)',
    fontSize: '13px',
    textAlign: 'center',
    marginTop: '20px',
  },
  userMsg: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    background: 'var(--accent-blue, #89b4fa)',
    color: 'var(--bg-primary, #1e1e2e)',
    borderRadius: '10px 10px 2px 10px',
    padding: '6px 10px',
  },
  assistantMsg: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    background: 'var(--bg-tertiary, #313244)',
    color: 'var(--text-primary, #cdd6f4)',
    borderRadius: '10px 10px 10px 2px',
    padding: '6px 10px',
  },
  msgHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '2px',
  },
  msgRole: {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    opacity: 0.7,
  },
  engineBadge: {
    fontSize: '9px',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: '3px',
    color: '#fff',
    letterSpacing: '0.3px',
  },
  contextBadge: {
    fontSize: '9px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '999px',
    color: '#d1fae5',
    background: 'rgba(16, 185, 129, 0.18)',
    border: '1px solid rgba(16, 185, 129, 0.45)',
    letterSpacing: '0.4px',
  },
  msgContent: {
    fontSize: '13px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  typing: {
    display: 'flex',
    gap: '2px',
    fontSize: '20px',
    lineHeight: 1,
  },
  dot: {
    animation: 'blink 1s infinite',
  },
  codeBlock: {
    background: 'var(--bg-primary, #1e1e2e)',
    borderRadius: '6px',
    padding: '8px',
    margin: '6px 0 2px 0',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    overflow: 'auto',
    whiteSpace: 'pre',
    border: '1px solid var(--border-color, #45475a)',
  },
  codeLang: {
    fontSize: '10px',
    color: 'var(--text-secondary, #a6adc8)',
    marginBottom: '4px',
    fontFamily: 'system-ui, sans-serif',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  codeActions: {
    display: 'flex',
    gap: '4px',
    marginBottom: '6px',
  },
  previewActions: {
    display: 'flex',
    justifyContent: 'flex-start',
    marginTop: '4px',
  },
  actionBtn: {
    background: '#1e1e1e',
    color: '#007acc',
    border: '1px solid #333',
    borderRadius: '4px',
    fontSize: '11px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  previewBtn: {
    background: '#007acc',
    color: '#ffffff',
    border: '1px solid #0e639c',
    borderRadius: '4px',
    fontSize: '11px',
    padding: '4px 10px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  inlineCode: {
    background: 'var(--bg-primary, #1e1e2e)',
    padding: '1px 4px',
    borderRadius: '3px',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  },
  inputArea: {
    display: 'flex',
    gap: '6px',
    padding: '6px 8px',
    borderTop: '1px solid var(--border-color, #45475a)',
    background: 'var(--bg-secondary, #181825)',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'var(--bg-primary, #1e1e2e)',
    border: '1px solid var(--border-color, #45475a)',
    borderRadius: '6px',
    color: 'var(--text-primary, #cdd6f4)',
    padding: '6px 10px',
    fontSize: '13px',
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
  },
  sendBtn: {
    background: 'var(--accent-blue, #89b4fa)',
    color: 'var(--bg-primary, #1e1e2e)',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-end',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.72)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    zIndex: 2000,
  },
  modal: {
    width: 'min(1100px, 100%)',
    height: 'min(80vh, 760px)',
    background: '#1e1e1e',
    border: '1px solid #333333',
    borderRadius: '10px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 80px rgba(0, 0, 0, 0.45)',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid #333333',
  },
  modalTitle: {
    color: '#f3f4f6',
    fontSize: '15px',
    fontWeight: 700,
  },
  modalSubtitle: {
    color: '#9ca3af',
    fontSize: '12px',
    marginTop: '2px',
  },
  modalCloseBtn: {
    background: 'transparent',
    color: '#9ca3af',
    border: '1px solid #3f3f46',
    borderRadius: '6px',
    width: '30px',
    height: '30px',
    cursor: 'pointer',
  },
  tabBar: {
    display: 'flex',
    gap: '8px',
    padding: '10px 16px 0',
    borderBottom: '1px solid #2a2a2a',
    overflowX: 'auto',
  },
  tabBtn: {
    background: '#252526',
    color: '#c5c5c5',
    border: '1px solid #333333',
    borderBottom: 'none',
    borderRadius: '8px 8px 0 0',
    padding: '8px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  tabBtnActive: {
    background: '#1e1e1e',
    color: '#ffffff',
    borderColor: '#4b5563',
  },
  diffHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    padding: '12px 16px 8px',
    color: '#9ca3af',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  diffPaneLabel: {
    display: 'block',
  },
  diffContainer: {
    position: 'relative',
    flex: 1,
    padding: '0 16px 16px',
    minHeight: 0,
  },
  diffEditor: {
    width: '100%',
    height: '100%',
    border: '1px solid #333333',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  modalLoading: {
    position: 'absolute',
    inset: '0 16px 16px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#d1d5db',
    fontSize: '14px',
    zIndex: 1,
    pointerEvents: 'none',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    padding: '0 16px 16px',
  },
  dismissBtn: {
    background: 'transparent',
    color: '#d1d5db',
    border: '1px solid #4b5563',
    borderRadius: '6px',
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
  },
  applyBtn: {
    background: '#007acc',
    color: '#ffffff',
    border: '1px solid #0e639c',
    borderRadius: '6px',
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 700,
  },
};
