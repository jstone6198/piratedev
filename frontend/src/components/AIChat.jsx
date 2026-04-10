import React, { useState, useRef, useEffect, useCallback } from 'react';
import api from '../api';

export default function AIChat({ project, activeFile }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendWithFile, setSendWithFile] = useState(false);
  const [fileContent, setFileContent] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const body = { message: text };
      if (sendWithFile && fileContent != null) {
        body.fileContent = fileContent;
        body.fileName = activeFile;
      }
      const res = await api.post('/ai/chat', body);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || 'Request failed';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${errMsg}` }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, sendWithFile, fileContent, activeFile]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>AI CHAT</span>
        <label style={styles.toggle}>
          <input
            type="checkbox"
            checked={sendWithFile}
            onChange={(e) => setSendWithFile(e.target.checked)}
            style={styles.checkbox}
          />
          <span style={styles.toggleLabel}>
            Send with file{activeFile ? ` (${activeFile.split('/').pop()})` : ''}
          </span>
        </label>
      </div>

      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.empty}>Ask a question about your code...</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={msg.role === 'user' ? styles.userMsg : styles.assistantMsg}>
            <div style={styles.msgRole}>{msg.role === 'user' ? 'You' : 'AI'}</div>
            <div style={styles.msgContent}>
              <MessageContent content={msg.content} />
            </div>
          </div>
        ))}
        {loading && (
          <div style={styles.assistantMsg}>
            <div style={styles.msgRole}>AI</div>
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

// Simple markdown renderer for code blocks
function MessageContent({ content }) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0].trim();
          const code = (lang && !lang.includes(' ') ? lines.slice(1) : lines).join('\n');
          return (
            <pre key={i} style={styles.codeBlock}>
              {lang && !lang.includes(' ') && (
                <div style={styles.codeLang}>{lang}</div>
              )}
              <code>{code}</code>
            </pre>
          );
        }
        // Render inline code
        const inlineParts = part.split(/(`[^`]+`)/g);
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
    padding: '4px 12px',
    borderBottom: '1px solid var(--border-color, #45475a)',
    background: 'var(--bg-secondary, #181825)',
    height: '28px',
    flexShrink: 0,
  },
  title: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.5px',
    color: 'var(--text-secondary, #a6adc8)',
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
  msgRole: {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '2px',
    opacity: 0.7,
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
    margin: '6px 0',
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
