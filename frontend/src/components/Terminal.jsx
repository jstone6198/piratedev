import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { socket } from '../api';
import 'xterm/css/xterm.css';

export default function Terminal({ project }) {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!termRef.current || xtermRef.current) return;

    const term = new XTerm({
      theme: {
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
      },
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

    // Delay initial fit to ensure container has dimensions
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // container may not be visible yet
      }
    });

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Socket.io terminal events
    socket.emit('terminal:start', { project });

    socket.on('terminal:output', (data) => {
      term.write(data);
    });

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      term.write('\r\n\x1b[31m[Disconnected from server]\x1b[0m\r\n');
    });

    // Send terminal input to server
    term.onData((data) => {
      socket.emit('terminal:input', data);
    });

    // Send resize events to server
    term.onResize(({ cols, rows }) => {
      socket.emit('terminal:resize', { cols, rows });
    });

    // Handle run:output and run:exit for the output panel
    socket.on('run:output', (data) => {
      term.write(data);
    });

    socket.on('run:exit', (code) => {
      term.write(`\r\n\x1b[90m--- Process exited with code ${code} ---\x1b[0m\r\n`);
    });

    // Resize observer to refit on container resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore errors during cleanup
      }
    });
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      socket.off('terminal:output');
      socket.off('run:output');
      socket.off('run:exit');
      socket.off('connect');
      socket.off('disconnect');
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Refit when project changes
  useEffect(() => {
    if (fitAddonRef.current) {
      try {
        fitAddonRef.current.fit();
      } catch {
        // ignore
      }
    }
  }, [project]);

  return (
    <div className="terminal-container" data-testid="terminal">
      <div className="terminal-header">
        <span className="terminal-title">TERMINAL</span>
        <span className={`terminal-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div className="terminal-body" ref={termRef} />
    </div>
  );
}
