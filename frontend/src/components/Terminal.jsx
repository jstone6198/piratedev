import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { socket } from '../api';
import 'xterm/css/xterm.css';

const XTERM_THEME = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#f5f5f5',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#1e1e1e',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#dcdcaa',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#f44747',
  brightGreen: '#6a9955',
  brightYellow: '#dcdcaa',
  brightBlue: '#569cd6',
  brightMagenta: '#c586c0',
  brightCyan: '#4ec9b0',
  brightWhite: '#ffffff',
};

let nextTermId = 1;

function TerminalInstance({ termId, project, active }) {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    if (!termRef.current || xtermRef.current) return;

    const term = new XTerm({
      theme: XTERM_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const onOutput = (data) => term.write(data);
    const onHistory = (history) => {
      term.reset();
      if (history) {
        term.write(history);
      }
    };
    const onExit = (code) => {
      term.write(`\r\n\x1b[90m--- Terminal exited (${code}) ---\x1b[0m\r\n`);
    };

    const createTerminalSession = ({ reset = false } = {}) => {
      if (reset) {
        term.reset();
      }

      socket.emit('terminal:create', {
        id: termId,
        project,
        cols: term.cols,
        rows: term.rows,
      });
    };

    socket.on(`terminal:data:${termId}`, onOutput);
    socket.on(`terminal:history:${termId}`, onHistory);
    socket.on(`terminal:exit:${termId}`, onExit);

    const onConnect = () => {
      createTerminalSession({ reset: true });
    };

    socket.on('connect', onConnect);

    // Also listen for legacy run:output/run:exit on the first terminal
    let onRunExit = null;
    if (termId === 1) {
      socket.on('run:output', onOutput);
      onRunExit = (code) => {
        term.write(`\r\n\x1b[90m--- Process exited with code ${code} ---\x1b[0m\r\n`);
      };
      socket.on('run:exit', onRunExit);
    }

    // Send input
    term.onData((data) => {
      socket.emit(`terminal:input:${termId}`, data);
    });

    // Send resize
    term.onResize(({ cols, rows }) => {
      socket.emit(`terminal:resize:${termId}`, { cols, rows });
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(termRef.current);

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
      if (socket.connected) {
        createTerminalSession();
      }
    });

    return () => {
      resizeObserver.disconnect();
      socket.off(`terminal:data:${termId}`, onOutput);
      socket.off(`terminal:history:${termId}`, onHistory);
      socket.off(`terminal:exit:${termId}`, onExit);
      socket.off('connect', onConnect);
      if (termId === 1) {
        socket.off('run:output', onOutput);
        socket.off('run:exit', onRunExit);
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [project, termId]);

  // Refit when becoming active
  useEffect(() => {
    if (active && fitAddonRef.current) {
      requestAnimationFrame(() => {
        try { fitAddonRef.current.fit(); } catch {}
      });
    }
  }, [active]);

  return (
    <div
      ref={termRef}
      style={{
        width: '100%',
        height: '100%',
        display: active ? 'block' : 'none',
      }}
    />
  );
}

export default function Terminal({ project }) {
  const [terminals, setTerminals] = useState(() => [{ id: nextTermId++ }]);
  const [activeTerminal, setActiveTerminal] = useState(1);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) setConnected(true);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const addTerminal = useCallback(() => {
    const id = nextTermId++;
    setTerminals((prev) => [...prev, { id }]);
    setActiveTerminal(id);
  }, []);

  const closeTerminal = useCallback((id) => {
    socket.emit(`terminal:close:${id}`);
    setTerminals((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        // Always keep at least one
        const newId = nextTermId++;
        setActiveTerminal(newId);
        return [{ id: newId }];
      }
      setActiveTerminal((curr) =>
        curr === id ? next[next.length - 1].id : curr
      );
      return next;
    });
  }, []);

  return (
    <div className="terminal-container" data-testid="terminal" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div style={styles.tabBar}>
        {terminals.map((t) => (
          <div
            key={t.id}
            style={{
              ...styles.tab,
              ...(t.id === activeTerminal ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTerminal(t.id)}
          >
            <span>Terminal {t.id}</span>
            {terminals.length > 1 && (
              <span
                style={styles.closeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(t.id);
                }}
              >
                ×
              </span>
            )}
          </div>
        ))}
        <div style={styles.addBtn} onClick={addTerminal} title="New Terminal">
          +
        </div>
        <div style={{ flex: 1 }} />
        <span
          style={{
            ...styles.status,
            color: connected ? '#6a9955' : '#f44747',
          }}
        >
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {/* Terminal instances */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {terminals.map((t) => (
          <TerminalInstance
            key={`${project || 'workspace'}:${t.id}`}
            termId={t.id}
            project={project}
            active={t.id === activeTerminal}
          />
        ))}
      </div>
    </div>
  );
}

const styles = {
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    background: '#252526',
    borderBottom: '1px solid #333',
    height: 28,
    flexShrink: 0,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 10px',
    height: '100%',
    cursor: 'pointer',
    color: '#999',
    borderRight: '1px solid #333',
    userSelect: 'none',
  },
  tabActive: {
    background: '#1e1e1e',
    color: '#cccccc',
  },
  closeBtn: {
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: '14px',
    color: '#888',
    padding: '0 2px',
    borderRadius: 3,
  },
  addBtn: {
    padding: '0 10px',
    cursor: 'pointer',
    color: '#888',
    fontSize: 16,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    userSelect: 'none',
  },
  status: {
    padding: '0 10px',
    fontSize: 11,
  },
};
