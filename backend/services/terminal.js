/**
 * services/terminal.js - Socket.io terminal service using node-pty
 * Location: /home/claude-runner/projects/josh-replit/backend/services/terminal.js
 *
 * Supports multiple PTY sessions per WebSocket connection. Each terminal
 * is identified by a numeric ID and communicates via namespaced events:
 *   terminal:create       → spawn a new PTY
 *   terminal:data:{id}    → output from PTY
 *   terminal:input:{id}   → input to PTY
 *   terminal:resize:{id}  → resize PTY
 *   terminal:close:{id}   → kill PTY
 *
 * Also supports legacy single-terminal events for backward compatibility.
 */

import pty from 'node-pty';
import { spawn } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import { isCommandBlocked, auditLog } from '../lib/sandbox.js';

const MAX_SCROLLBACK_LINES = 1000;
const DEFAULT_PROJECT_KEY = '__workspace__';

// Project name -> { terminals: Map<terminalId, terminalEntry> }
const projectTerminalSessions = new Map();

// Project name -> Map<terminalId, { lines: string[], partial: string }>
const projectScrollback = new Map();

// Language configuration keyed by file extension
const LANG_MAP = {
  '.js':  { cmd: 'node', args: [] },
  '.mjs': { cmd: 'node', args: [] },
  '.py':  { cmd: 'python3', args: [] },
  '.ts':  { cmd: 'npx', args: ['tsx'] },
  '.sh':  { cmd: 'bash', args: [] },
  '.rb':  { cmd: 'ruby', args: [] },
  '.go':  { cmd: 'go', args: ['run'] },
  '.rs':  { compile: true, compiler: 'rustc' },
  '.c':   { compile: true, compiler: 'gcc' },
  '.cpp': { compile: true, compiler: 'g++' },
};

function getProjectKey(project) {
  return project || DEFAULT_PROJECT_KEY;
}

function getOrCreateProjectSession(project) {
  const projectKey = getProjectKey(project);
  if (!projectTerminalSessions.has(projectKey)) {
    projectTerminalSessions.set(projectKey, { terminals: new Map() });
  }
  return projectTerminalSessions.get(projectKey);
}

function getOrCreateProjectScrollback(project) {
  const projectKey = getProjectKey(project);
  if (!projectScrollback.has(projectKey)) {
    projectScrollback.set(projectKey, new Map());
  }
  return projectScrollback.get(projectKey);
}

function appendToScrollback(project, terminalId, chunk) {
  if (!chunk) return;

  const scrollbackByTerminal = getOrCreateProjectScrollback(project);
  if (!scrollbackByTerminal.has(terminalId)) {
    scrollbackByTerminal.set(terminalId, { lines: [], partial: '' });
  }

  const state = scrollbackByTerminal.get(terminalId);
  const combined = `${state.partial}${chunk}`;
  const parts = combined.split(/\r\n|\n|\r/);
  const separators = combined.match(/\r\n|\n|\r/g) || [];

  for (let i = 0; i < separators.length; i += 1) {
    state.lines.push(`${parts[i] || ''}${separators[i]}`);
  }

  state.partial = parts[parts.length - 1] || '';

  if (state.lines.length > MAX_SCROLLBACK_LINES) {
    state.lines = state.lines.slice(-MAX_SCROLLBACK_LINES);
  }
}

function getScrollbackText(project, terminalId) {
  const scrollbackByTerminal = projectScrollback.get(getProjectKey(project));
  const state = scrollbackByTerminal?.get(terminalId);
  if (!state) return '';
  return `${state.lines.join('')}${state.partial}`;
}

function clearScrollback(project, terminalId) {
  const projectKey = getProjectKey(project);
  const scrollbackByTerminal = projectScrollback.get(projectKey);
  if (!scrollbackByTerminal) return;

  scrollbackByTerminal.delete(terminalId);
  if (scrollbackByTerminal.size === 0) {
    projectScrollback.delete(projectKey);
  }
}

/**
 * Attach terminal handling to a Socket.io server.
 * @param {import('socket.io').Server} io
 * @param {string} workspaceDir - Absolute path to workspace root
 */
export function setupTerminal(io, workspaceDir) {
  io.on('connection', (socket) => {
    console.log(`[terminal] Client connected: ${socket.id}`);

    // Map of terminal ID -> { project, projectKey, handlers }
    const attachedTerminals = new Map();

    // Helper: resolve project cwd safely
    function resolveProjectCwd(project) {
      let cwd = workspaceDir;
      if (project) {
        const projectDir = path.resolve(workspaceDir, project);
        if (projectDir.startsWith(workspaceDir) && existsSync(projectDir)) {
          cwd = projectDir;
        }
      }
      return cwd;
    }

    function getAttachedTerminalEntry(id) {
      const attached = attachedTerminals.get(id);
      if (!attached) return null;

      const session = projectTerminalSessions.get(attached.projectKey);
      if (!session) return null;

      return session.terminals.get(id) || null;
    }

    function detachTerminal(id) {
      const attached = attachedTerminals.get(id);
      if (!attached) return;

      socket.off(`terminal:input:${id}`, attached.handlers.inputHandler);
      socket.off(`terminal:resize:${id}`, attached.handlers.resizeHandler);
      socket.off(`terminal:close:${id}`, attached.handlers.closeHandler);

      const session = projectTerminalSessions.get(attached.projectKey);
      const entry = session?.terminals.get(id);
      if (entry) {
        entry.clients.delete(socket);
      }

      attachedTerminals.delete(id);
    }

    function destroyTerminal(project, id) {
      const projectKey = getProjectKey(project);
      const session = projectTerminalSessions.get(projectKey);
      const entry = session?.terminals.get(id);
      if (!entry) return;

      session.terminals.delete(id);
      clearScrollback(project, id);

      try { entry.pty.kill(); } catch {}

      if (session.terminals.size === 0) {
        projectTerminalSessions.delete(projectKey);
      }
    }

    // Helper: create a PTY and wire up events for a given terminal ID
    function createTerminal(id, opts = {}) {
      const project = opts.project;
      const projectKey = getProjectKey(project);

      if (attachedTerminals.has(id)) {
        detachTerminal(id);
      }

      const session = getOrCreateProjectSession(project);
      let entry = session.terminals.get(id);

      if (!entry) {
        const cols = opts.cols || 120;
        const rows = opts.rows || 30;
        const cwd = resolveProjectCwd(project);
        const term = pty.spawn('bash', [], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: { ...process.env, TERM: 'xterm-256color' },
        });

        entry = {
          pty: term,
          inputBuffer: '',
          project,
          projectKey,
          clients: new Set(),
        };
        session.terminals.set(id, entry);

        term.onData((data) => {
          appendToScrollback(project, id, data);
          for (const client of entry.clients) {
            client.emit(`terminal:data:${id}`, data);
          }
        });

        term.onExit(({ exitCode }) => {
          for (const client of entry.clients) {
            client.emit(`terminal:exit:${id}`, exitCode);
          }

          session.terminals.delete(id);
          clearScrollback(project, id);

          if (session.terminals.size === 0) {
            projectTerminalSessions.delete(projectKey);
          }
        });
      }

      socket.emit(`terminal:history:${id}`, getScrollbackText(project, id));
      entry.clients.add(socket);

      const inputHandler = (data) => {
        const terminal = getAttachedTerminalEntry(id);
        if (!terminal) return;

        terminal.inputBuffer += data;

        if (data.includes('\r') || data.includes('\n')) {
          const command = terminal.inputBuffer.trim();
          terminal.inputBuffer = '';

          if (command) {
            const check = isCommandBlocked(command);
            if (check.blocked) {
              auditLog('blocked', `Command rejected: ${command}`, socket.id);
              socket.emit(`terminal:data:${id}`, '\r\n\x1b[31m⛔ Command blocked by sandbox policy.\x1b[0m\r\n');
              terminal.pty.write('\r');
              return;
            }
            auditLog('terminal', command, socket.id);
          }
        }

        terminal.pty.write(data);
      };

      const resizeHandler = ({ cols, rows }) => {
        const terminal = getAttachedTerminalEntry(id);
        if (terminal && cols > 0 && rows > 0) {
          try { terminal.pty.resize(cols, rows); } catch (e) {
            console.error(`[terminal] resize error (${id}):`, e.message);
          }
        }
      };

      const closeHandler = () => {
        const attached = attachedTerminals.get(id);
        if (!attached) return;

        detachTerminal(id);
        destroyTerminal(attached.project, id);
      };

      socket.on(`terminal:input:${id}`, inputHandler);
      socket.on(`terminal:resize:${id}`, resizeHandler);
      socket.on(`terminal:close:${id}`, closeHandler);

      attachedTerminals.set(id, {
        project,
        projectKey,
        handlers: { inputHandler, resizeHandler, closeHandler },
      });
    }

    // -----------------------------------------------------------------------
    // terminal:create — spawn or attach to a PTY with a given ID
    // Payload: { id, project, cols, rows }
    // -----------------------------------------------------------------------
    socket.on('terminal:create', (opts = {}) => {
      const id = opts.id || 1;
      createTerminal(id, opts);
    });

    // -----------------------------------------------------------------------
    // Legacy: terminal:start — maps to creating terminal ID 1
    // -----------------------------------------------------------------------
    socket.on('terminal:start', (opts = {}) => {
      createTerminal(1, opts);

      const legacyOutput = (data) => socket.emit('terminal:output', data);

      socket.on('terminal:input', (data) => {
        const terminal = getAttachedTerminalEntry(1);
        if (!terminal) return;

        terminal.inputBuffer += data;
        if (data.includes('\r') || data.includes('\n')) {
          const command = terminal.inputBuffer.trim();
          terminal.inputBuffer = '';

          if (command) {
            const check = isCommandBlocked(command);
            if (check.blocked) {
              auditLog('blocked', `Command rejected: ${command}`, socket.id);
              socket.emit('terminal:output', '\r\n\x1b[31m⛔ Command blocked by sandbox policy.\x1b[0m\r\n');
              terminal.pty.write('\r');
              return;
            }
            auditLog('terminal', command, socket.id);
          }
        }

        terminal.pty.write(data);
      });

      socket.on('terminal:resize', ({ cols, rows }) => {
        const terminal = getAttachedTerminalEntry(1);
        if (terminal && cols > 0 && rows > 0) {
          try { terminal.pty.resize(cols, rows); } catch {}
        }
      });

      const terminal = getAttachedTerminalEntry(1);
      if (terminal) {
        terminal.pty.onData(legacyOutput);
      }
    });

    // -----------------------------------------------------------------------
    // terminal:cwd — change the terminal working directory (legacy, term 1)
    // -----------------------------------------------------------------------
    socket.on('terminal:cwd', (dir) => {
      const terminal = getAttachedTerminalEntry(1);
      if (!terminal) return;

      const resolved = path.resolve(workspaceDir, dir);
      if (resolved.startsWith(workspaceDir) && existsSync(resolved)) {
        terminal.pty.write(`cd "${resolved}"\r`);
      }
    });

    // -----------------------------------------------------------------------
    // run:execute — run a file and stream output to the client
    // -----------------------------------------------------------------------
    let runProc = null;

    socket.on('run:execute', (opts = {}) => {
      const { project, filePath } = opts;
      if (!project || !filePath) return;

      if (runProc && !runProc.killed) {
        runProc.kill('SIGTERM');
      }

      const projectDir = path.resolve(workspaceDir, project);
      if (!projectDir.startsWith(workspaceDir) || !existsSync(projectDir)) return;

      const fullPath = path.resolve(projectDir, filePath);
      if (!fullPath.startsWith(projectDir) || !existsSync(fullPath)) {
        socket.emit('run:output', `\r\nFile not found: ${filePath}\r\n`);
        socket.emit('run:exit', 1);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const lang = LANG_MAP[ext];
      if (!lang) {
        socket.emit('run:output', `\r\nUnsupported file type: ${ext}\r\n`);
        socket.emit('run:exit', 1);
        return;
      }

      socket.emit('run:output', `\r\n\x1b[36m--- Running ${filePath} ---\x1b[0m\r\n`);

      if (lang.compile) {
        const outBin = fullPath.replace(/\.[^.]+$/, '');
        const compileCmd = `${lang.compiler} "${fullPath}" -o "${outBin}" && "${outBin}"`;
        runProc = spawn('bash', ['-c', compileCmd], { cwd: projectDir, env: { ...process.env } });
      } else {
        runProc = spawn(lang.cmd, [...lang.args, fullPath], { cwd: projectDir, env: { ...process.env } });
      }

      runProc.stdout.on('data', (data) => {
        socket.emit('run:output', data.toString().replace(/\n/g, '\r\n'));
      });
      runProc.stderr.on('data', (data) => {
        socket.emit('run:output', `\x1b[31m${data.toString().replace(/\n/g, '\r\n')}\x1b[0m`);
      });
      runProc.on('close', (code) => {
        socket.emit('run:exit', code);
        runProc = null;
      });
      runProc.on('error', (err) => {
        socket.emit('run:output', `\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n`);
        socket.emit('run:exit', 1);
        runProc = null;
      });
    });

    // -----------------------------------------------------------------------
    // run:kill — stop the running process
    // -----------------------------------------------------------------------
    socket.on('run:kill', () => {
      if (runProc && !runProc.killed) {
        runProc.kill('SIGTERM');
        setTimeout(() => {
          if (runProc && !runProc.killed) runProc.kill('SIGKILL');
        }, 2000);
      }
    });

    // -----------------------------------------------------------------------
    // disconnect — detach from PTY sessions and clean up run process
    // -----------------------------------------------------------------------
    socket.on('disconnect', () => {
      console.log(`[terminal] Client disconnected: ${socket.id}`);

      for (const id of [...attachedTerminals.keys()]) {
        detachTerminal(id);
      }

      if (runProc && !runProc.killed) {
        runProc.kill('SIGTERM');
        runProc = null;
      }
    });
  });
}
