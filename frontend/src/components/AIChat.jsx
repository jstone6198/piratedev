import React, { useState, useRef, useEffect, useCallback } from 'react';
import api from '../api';

const ENGINES = [
  { id: 'codex', label: 'Codex (GPT-5.4)' },
  { id: 'claude', label: 'Claude Code (Sonnet)' },
];

const HISTORY_KEY = (project) => `ide-chat-history-${project || 'default'}`;
const ENGINE_KEY = 'ide-ai-engine';

export default function AIChat({ project, activeFile, onApplyCode }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendWithFile, setSendWithFile] = useState(false);
  const [fileContent, setFileContent] = useState(null);
  const [engine, setEngine] = useState(() => localStorage.getItem(ENGINE_KEY) || 'codex');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load history from localStorage on project change
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY(project));
      if (saved) setMessages(JSON.parse(saved));
      else setMessages([]);
    } catch { setMessages([]); }
  }, [project]);

  // Save history to localStorage on change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(HISTORY_KEY(project), JSON.stringify(messages));
    }
  }, [messages, project]);

  // Persist engine selection
  useEffect(() => {
    localStorage.setItem(ENGINE_KEY, engine);
  }, [engine]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load active file content when toggle is on
  useEffect(() => {
    if (!sendWithFile || !activeFile || !project) {
      setFileContent(null);
      return;
    }
    api.get(`/files/read?project=${encodeURIComponent(project)}&path=${encodeURIComponent(activeFile)}`)
      .then((res) => setFileContent(res.data.content || ''))
      .catch(() => setFileContent(null));
  }, [sendWithFile, activeFile, project]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY(project));
  }, [project]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      const body = { message: text, engine };
      if (sendWithFile && fileContent != null) {
        body.fileContent = fileContent;
        body.fileName = activeFile;
      }
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
  }, [input, loading, sendWithFile, fileContent, activeFile, engine, messages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleApplyCode = (code) => {
    if (onApplyCode) onApplyCode(code);
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
          <button onClick={clearHistory} style={styles.clearBtn} title="Clear History">✕</button>
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={sendWithFile}
              onChange={(e) => setSendWithFile(e.target.checked)}
              style={styles.checkbox}
            />
            <span style={styles.toggleLabel}>
              File{activeFile ? ` (${activeFile.split('/').pop()})` : ''}
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
                onApply={handleApplyCode}
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
    </div>
  );
}

const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;

function MessageContent({ content, onApply, onCreate, onCopy }) {
  const parts = [];
  let lastIndex = 0;

  for (const match of content.matchAll(CODE_BLOCK_RE)) {
    // Text before this code block
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', lang: match[1], value: match[2] });
    lastIndex = match.index + match[0].length;
  }
  // Remaining text
  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }

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
                <button style={styles.actionBtn} onClick={() => onApply(part.value)} title="Apply to editor selection">
                  ▶ Apply
                </button>
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
    </>
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
};
