import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { socket } from '../api';
import 'xterm/css/xterm.css';

const MAX_TERMINALS = 5;

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

function createTerminalName(index) {
  return `Terminal ${index}`;
}

function TerminalInstance({ terminalId, project, active }) {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    if (!termRef.current || xtermRef.current || !terminalId) return;

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

    const attachTerminal = ({ reset = false } = {}) => {
      if (reset) {
        term.reset();
      }

      socket.emit('terminal:create', {
        terminalId,
        project,
        cols: term.cols,
        rows: term.rows,
      });
    };

    const onOutput = ({ terminalId: outputTerminalId, data }) => {
      if (outputTerminalId !== terminalId || !data) return;
      term.write(data);
    };

    const onHistory = ({ terminalId: historyTerminalId, history }) => {
      if (historyTerminalId !== terminalId) return;
      term.reset();
      if (history) {
        term.write(history);
      }
    };

    const onExit = ({ terminalId: exitTerminalId, code }) => {
      if (exitTerminalId !== terminalId) return;
      term.write(`\r\n\x1b[90m--- Terminal exited (${code}) ---\x1b[0m\r\n`);
    };

    const onConnect = () => {
      attachTerminal({ reset: true });
    };

    socket.on('terminal:output', onOutput);
    socket.on('terminal:history', onHistory);
    socket.on('terminal:exit', onExit);
    socket.on('connect', onConnect);

    if (terminalId === 1) {
      const onRunOutput = (data) => term.write(data);
      const onRunExit = (code) => {
        term.write(`\r\n\x1b[90m--- Process exited with code ${code} ---\x1b[0m\r\n`);
      };

      socket.on('run:output', onRunOutput);
      socket.on('run:exit', onRunExit);

      termRef.current._runListeners = { onRunOutput, onRunExit };
    }

    term.onData((data) => {
      socket.emit('terminal:input', { terminalId, data });
    });

    term.onResize(({ cols, rows }) => {
      socket.emit('terminal:resize', { terminalId, cols, rows });
    });

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(termRef.current);

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
      if (socket.connected) {
        attachTerminal();
      }
    });

    return () => {
      const runListeners = termRef.current?._runListeners;

      resizeObserver.disconnect();
      socket.off('terminal:output', onOutput);
      socket.off('terminal:history', onHistory);
      socket.off('terminal:exit', onExit);
      socket.off('connect', onConnect);

      if (runListeners) {
        socket.off('run:output', runListeners.onRunOutput);
        socket.off('run:exit', runListeners.onRunExit);
      }

      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [project, terminalId]);

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
  const [terminals, setTerminals] = useState([]);
  const [connected, setConnected] = useState(false);
  const nextTerminalNumberRef = useRef(1);
  const pendingCreatesRef = useRef(0);
  const previousProjectRef = useRef(project);
  const currentProjectRef = useRef(project);

  const setActiveTerminal = useCallback((terminalId) => {
    setTerminals((prev) =>
      prev.map((terminal) => ({
        ...terminal,
        active: terminal.id === terminalId,
      }))
    );
  }, []);

  const createTerminalTab = useCallback(() => {
    if (terminals.length + pendingCreatesRef.current >= MAX_TERMINALS) return;

    const requestProject = project;
    const nextName = createTerminalName(nextTerminalNumberRef.current);
    nextTerminalNumberRef.current += 1;
    pendingCreatesRef.current += 1;

    socket.emit(
      'terminal:create',
      { project: requestProject },
      ({ terminalId } = {}) => {
        pendingCreatesRef.current = Math.max(0, pendingCreatesRef.current - 1);

        if (!terminalId) return;
        if (currentProjectRef.current !== requestProject) {
          socket.emit('terminal:close', { terminalId });
          return;
        }

        setTerminals((prev) => {
          if (prev.some((terminal) => terminal.id === terminalId)) {
            return prev.map((terminal) => ({
              ...terminal,
              active: terminal.id === terminalId,
            }));
          }

          return [
            ...prev.map((terminal) => ({ ...terminal, active: false })),
            { id: terminalId, name: nextName, active: true },
          ];
        });
      }
    );
  }, [project, terminals.length]);

  useEffect(() => {
    currentProjectRef.current = project;
  }, [project]);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    if (socket.connected) {
      setConnected(true);
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (previousProjectRef.current === project) {
      return;
    }

    previousProjectRef.current = project;

    for (const terminal of terminals) {
      socket.emit('terminal:close', { terminalId: terminal.id });
    }

    pendingCreatesRef.current = 0;
    nextTerminalNumberRef.current = 1;
    setTerminals([]);
  }, [project, terminals]);

  useEffect(() => {
    if (connected && terminals.length === 0) {
      createTerminalTab();
    }
  }, [connected, createTerminalTab, terminals.length]);

  const closeTerminal = useCallback((terminalId) => {
    socket.emit('terminal:close', { terminalId });

    setTerminals((prev) => {
      const next = prev.filter((terminal) => terminal.id !== terminalId);

      if (next.length === 0) {
        return prev;
      }

      const removedActive = prev.some(
        (terminal) => terminal.id === terminalId && terminal.active
      );

      if (!removedActive) {
        return next;
      }

      const fallbackTerminalId = next[Math.max(0, next.length - 1)].id;
      return next.map((terminal) => ({
        ...terminal,
        active: terminal.id === fallbackTerminalId,
      }));
    });
  }, []);

  const activeTerminalId =
    terminals.find((terminal) => terminal.active)?.id ?? null;

  return (
    <div
      className="terminal-container"
      data-testid="terminal"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div style={styles.tabBar}>
        {terminals.map((terminal) => (
          <button
            key={terminal.id}
            type="button"
            style={{
              ...styles.tab,
              ...(terminal.active ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTerminal(terminal.id)}
          >
            <span>{terminal.name}</span>
            {terminals.length > 1 && (
              <span
                style={styles.closeBtn}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTerminal(terminal.id);
                }}
              >
                x
              </span>
            )}
          </button>
        ))}

        <button
          type="button"
          style={{
            ...styles.addBtn,
            ...(terminals.length + pendingCreatesRef.current >= MAX_TERMINALS
              ? styles.addBtnDisabled
              : {}),
          }}
          onClick={createTerminalTab}
          title={
            terminals.length + pendingCreatesRef.current >= MAX_TERMINALS
              ? 'Maximum of 5 terminals'
              : 'New Terminal'
          }
          disabled={terminals.length + pendingCreatesRef.current >= MAX_TERMINALS}
        >
          +
        </button>

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

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {terminals.map((terminal) => (
          <TerminalInstance
            key={`${project || 'workspace'}:${terminal.id}`}
            terminalId={terminal.id}
            project={project}
            active={terminal.id === activeTerminalId}
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
    height: 32,
    flexShrink: 0,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    height: '100%',
    cursor: 'pointer',
    color: '#999',
    border: 0,
    borderRight: '1px solid #333',
    background: '#252526',
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
    padding: '0 12px',
    cursor: 'pointer',
    color: '#888',
    fontSize: 16,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    userSelect: 'none',
    background: '#252526',
    border: 0,
    borderRight: '1px solid #333',
  },
  addBtnDisabled: {
    cursor: 'not-allowed',
    color: '#555',
  },
  status: {
    padding: '0 10px',
    fontSize: 11,
  },
};
