import { useEffect, useRef, useState } from 'react';

const COLORS = {
  background: '#1e1e1e',
  panel: '#252526',
  border: 'rgba(255, 255, 255, 0.08)',
  text: '#d4d4d4',
  muted: '#808080',
  accent: '#3a3d41',
  log: '#999999',
  warn: '#e5c07b',
  error: '#e06c75',
};

const FILTERS = ['all', 'log', 'warn', 'error'];
const MAX_ENTRIES = 500;
const MESSAGE_SOURCE = 'console-panel-bridge';

const BRIDGE_SCRIPT = `
(() => {
  if (window.__consolePanelBridgeInstalled) return;
  window.__consolePanelBridgeInstalled = true;

  const levels = ['log', 'warn', 'error'];
  const originalConsole = {};

  const serialize = (value, seen = new WeakSet()) => {
    if (value === null) return null;
    if (value === undefined) return undefined;

    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return value.toString() + 'n';
    if (type === 'function') return '[Function ' + (value.name || 'anonymous') + ']';

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack || '',
      };
    }

    if (type !== 'object') {
      try {
        return String(value);
      } catch (error) {
        return '[Unserializable]';
      }
    }

    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => serialize(item, seen));
    }

    if (typeof Node !== 'undefined' && value instanceof Node) {
      return '<' + String(value.nodeName || 'node').toLowerCase() + '>';
    }

    if (typeof Window !== 'undefined' && value instanceof Window) {
      return '[Window]';
    }

    const result = {};
    for (const key of Object.keys(value).slice(0, 50)) {
      try {
        result[key] = serialize(value[key], seen);
      } catch (error) {
        result[key] = '[Unreadable]';
      }
    }
    return result;
  };

  const postEntry = (level, args) => {
    try {
      window.parent.postMessage(
        {
          source: '${MESSAGE_SOURCE}',
          type: 'console-entry',
          payload: {
            level,
            args: Array.from(args || []).map((arg) => serialize(arg)),
            timestamp: Date.now(),
          },
        },
        '*'
      );
    } catch (error) {}
  };

  for (const level of levels) {
    if (typeof console[level] !== 'function') continue;
    originalConsole[level] = console[level];
    console[level] = (...args) => {
      postEntry(level, args);
      return originalConsole[level].apply(console, args);
    };
  }
})();
`;

function stringifyArg(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (
    typeof value === 'object' &&
    value &&
    'name' in value &&
    'message' in value &&
    Object.keys(value).every((key) => ['name', 'message', 'stack'].includes(key))
  ) {
    return [value.name, value.message].filter(Boolean).join(': ');
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function formatEntry(entry) {
  return (entry.args || []).map(stringifyArg).join(' ');
}

function buttonStyle(active) {
  return {
    border: `1px solid ${active ? '#5a5d61' : COLORS.border}`,
    background: active ? COLORS.accent : COLORS.background,
    color: active ? '#ffffff' : COLORS.text,
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    lineHeight: 1,
    cursor: 'pointer',
  };
}

export default function ConsolePanel({ project }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('all');
  const iframeRef = useRef(null);

  useEffect(() => {
    setEntries([]);
  }, [project]);

  useEffect(() => {
    const appendEntry = (payload) => {
      const nextEntry = {
        id: `${payload.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        level: ['log', 'warn', 'error'].includes(payload.level) ? payload.level : 'log',
        args: Array.isArray(payload.args) ? payload.args : [],
        timestamp: payload.timestamp || Date.now(),
      };

      setEntries((current) => {
        const next = [...current, nextEntry];
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
      });
    };

    const handleMessage = (event) => {
      if (event?.data?.source !== MESSAGE_SOURCE || event.data.type !== 'console-entry') return;
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) return;
      appendEntry(event.data.payload || {});
    };

    const injectBridge = () => {
      const iframe = document.querySelector('.preview-iframe');
      iframeRef.current = iframe || null;
      if (!iframe?.contentWindow) return;

      try {
        iframe.contentWindow.eval(BRIDGE_SCRIPT);
      } catch (error) {}
    };

    const bindIframe = () => {
      const iframe = document.querySelector('.preview-iframe');
      if (!iframe) return;

      if (iframeRef.current && iframeRef.current !== iframe) {
        iframeRef.current.removeEventListener('load', injectBridge);
      }

      iframeRef.current = iframe;
      iframe.addEventListener('load', injectBridge);
      injectBridge();
    };

    const observer = new MutationObserver(bindIframe);
    observer.observe(document.body, { childList: true, subtree: true });

    bindIframe();
    window.addEventListener('message', handleMessage);

    return () => {
      observer.disconnect();
      window.removeEventListener('message', handleMessage);
      if (iframeRef.current) {
        iframeRef.current.removeEventListener('load', injectBridge);
      }
    };
  }, []);

  const visibleEntries =
    filter === 'all' ? entries : entries.filter((entry) => entry.level === filter);

  const counts = {
    log: entries.filter((entry) => entry.level === 'log').length,
    warn: entries.filter((entry) => entry.level === 'warn').length,
    error: entries.filter((entry) => entry.level === 'error').length,
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: COLORS.background,
        color: COLORS.text,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '10px 12px',
          background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Console
        </div>
        {FILTERS.map((level) => {
          const label =
            level === 'all'
              ? `All (${entries.length})`
              : `${level} (${counts[level]})`;

          return (
            <button
              key={level}
              type="button"
              onClick={() => setFilter(level)}
              style={buttonStyle(filter === level)}
            >
              {label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setEntries([])} style={buttonStyle(false)}>
          Clear
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {visibleEntries.length === 0 ? (
          <div
            style={{
              padding: '16px 12px',
              color: COLORS.muted,
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {project
              ? 'No preview console output yet.'
              : 'Select a project to capture preview console output.'}
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: '10px 12px',
                borderBottom: `1px solid ${COLORS.border}`,
                color: COLORS[entry.level],
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  marginBottom: 4,
                  color: COLORS.muted,
                }}
              >
                <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span style={{ color: COLORS[entry.level], textTransform: 'uppercase' }}>
                  {entry.level}
                </span>
              </div>
              <pre
                style={{
                  margin: 0,
                  color: COLORS[entry.level],
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'inherit',
                }}
              >
                {formatEntry(entry)}
              </pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
