import pty from 'node-pty';
import { spawn } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import { isCommandBlocked, auditLog } from '../lib/sandbox.js';

const MAX_SCROLLBACK_LINES = 1000;
const DEFAULT_PROJECT_KEY = '__workspace__';

let nextTerminalId = 1;

const projectTerminalSessions = new Map();
const projectScrollback = new Map();

const LANG_MAP = {
  '.js': { cmd: 'node', args: [] },
  '.mjs': { cmd: 'node', args: [] },
  '.py': { cmd: 'python3', args: [] },
  '.ts': { cmd: 'npx', args: ['tsx'] },
  '.sh': { cmd: 'bash', args: [] },
  '.rb': { cmd: 'ruby', args: [] },
  '.go': { cmd: 'go', args: ['run'] },
  '.rs': { compile: true, compiler: 'rustc' },
  '.c': { compile: true, compiler: 'gcc' },
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

function emitTerminalEvent(target, eventName, terminalId, payload = {}) {
  target.emit(eventName, { terminalId, ...payload });
}

export function setupTerminal(io, workspaceDir) {
  io.on('connection', (socket) => {
    console.log(`[terminal] Client connected: ${socket.id}`);

    const attachedTerminals = new Map();
    let runProc = null;

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

    function getAttachedTerminalEntry(terminalId) {
      const attached = attachedTerminals.get(terminalId);
      if (!attached) return null;

      const session = projectTerminalSessions.get(attached.projectKey);
      if (!session) return null;

      return session.terminals.get(terminalId) || null;
    }

    function detachTerminal(terminalId) {
      const attached = attachedTerminals.get(terminalId);
      if (!attached) return;

      const session = projectTerminalSessions.get(attached.projectKey);
      const entry = session?.terminals.get(terminalId);
      if (entry) {
        entry.clients.delete(socket);
      }

      attachedTerminals.delete(terminalId);
    }

    function destroyTerminal(project, terminalId) {
      const projectKey = getProjectKey(project);
      const session = projectTerminalSessions.get(projectKey);
      const entry = session?.terminals.get(terminalId);
      if (!entry) return;

      session.terminals.delete(terminalId);
      clearScrollback(project, terminalId);

      try {
        entry.pty.kill();
      } catch {}

      if (session.terminals.size === 0) {
        projectTerminalSessions.delete(projectKey);
      }
    }

    function createOrAttachTerminal(terminalId, opts = {}) {
      const project = opts.project;
      const projectKey = getProjectKey(project);

      if (attachedTerminals.has(terminalId)) {
        detachTerminal(terminalId);
      }

      const session = getOrCreateProjectSession(project);
      let entry = session.terminals.get(terminalId);

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

        session.terminals.set(terminalId, entry);

        term.onData((data) => {
          appendToScrollback(project, terminalId, data);
          for (const client of entry.clients) {
            emitTerminalEvent(client, 'terminal:output', terminalId, { data });
          }
        });

        term.onExit(({ exitCode }) => {
          for (const client of entry.clients) {
            emitTerminalEvent(client, 'terminal:exit', terminalId, {
              code: exitCode,
            });
          }

          session.terminals.delete(terminalId);
          clearScrollback(project, terminalId);

          if (session.terminals.size === 0) {
            projectTerminalSessions.delete(projectKey);
          }
        });
      }

      entry.clients.add(socket);
      attachedTerminals.set(terminalId, { project, projectKey });

      emitTerminalEvent(socket, 'terminal:history', terminalId, {
        history: getScrollbackText(project, terminalId),
      });

      return terminalId;
    }

    socket.on('terminal:create', (opts = {}, ack) => {
      const terminalId = opts.terminalId ?? nextTerminalId++;
      const attachedTerminalId = createOrAttachTerminal(terminalId, opts);

      if (typeof ack === 'function') {
        ack({ terminalId: attachedTerminalId });
      }
    });

    socket.on('terminal:input', (payload = {}) => {
      const terminalId =
        typeof payload === 'string' ? 1 : payload.terminalId;
      const data = typeof payload === 'string' ? payload : payload.data;

      if (!terminalId || typeof data !== 'string') return;

      const terminal = getAttachedTerminalEntry(terminalId);
      if (!terminal) return;

      terminal.inputBuffer += data;

      if (data.includes('\r') || data.includes('\n')) {
        const command = terminal.inputBuffer.trim();
        terminal.inputBuffer = '';

        if (command) {
          const check = isCommandBlocked(command);
          if (check.blocked) {
            auditLog('blocked', `Command rejected: ${command}`, socket.id);
            emitTerminalEvent(socket, 'terminal:output', terminalId, {
              data: '\r\n\x1b[31m⛔ Command blocked by sandbox policy.\x1b[0m\r\n',
            });
            terminal.pty.write('\r');
            return;
          }

          auditLog('terminal', command, socket.id);
        }
      }

      terminal.pty.write(data);
    });

    socket.on('terminal:resize', (payload = {}) => {
      const terminalId =
        payload && typeof payload === 'object' && 'terminalId' in payload
          ? payload.terminalId
          : 1;
      const cols = payload?.cols;
      const rows = payload?.rows;

      if (!terminalId || cols <= 0 || rows <= 0) return;

      const terminal = getAttachedTerminalEntry(terminalId);
      if (!terminal) return;

      try {
        terminal.pty.resize(cols, rows);
      } catch (error) {
        console.error(`[terminal] resize error (${terminalId}):`, error.message);
      }
    });

    socket.on('terminal:close', ({ terminalId } = {}) => {
      if (!terminalId) return;

      const attached = attachedTerminals.get(terminalId);
      if (!attached) return;

      detachTerminal(terminalId);
      destroyTerminal(attached.project, terminalId);
    });

    socket.on('terminal:start', (opts = {}) => {
      createOrAttachTerminal(1, opts);
    });

    socket.on('terminal:cwd', (dir) => {
      const terminal = getAttachedTerminalEntry(1);
      if (!terminal) return;

      const resolved = path.resolve(workspaceDir, dir);
      if (resolved.startsWith(workspaceDir) && existsSync(resolved)) {
        terminal.pty.write(`cd "${resolved}"\r`);
      }
    });

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
        runProc = spawn('bash', ['-c', compileCmd], {
          cwd: projectDir,
          env: { ...process.env },
        });
      } else {
        runProc = spawn(lang.cmd, [...lang.args, fullPath], {
          cwd: projectDir,
          env: { ...process.env },
        });
      }

      runProc.stdout.on('data', (data) => {
        socket.emit('run:output', data.toString().replace(/\n/g, '\r\n'));
      });

      runProc.stderr.on('data', (data) => {
        socket.emit(
          'run:output',
          `\x1b[31m${data.toString().replace(/\n/g, '\r\n')}\x1b[0m`
        );
      });

      runProc.on('close', (code) => {
        socket.emit('run:exit', code);
        runProc = null;
      });

      runProc.on('error', (error) => {
        socket.emit('run:output', `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`);
        socket.emit('run:exit', 1);
        runProc = null;
      });
    });

    socket.on('run:kill', () => {
      if (runProc && !runProc.killed) {
        runProc.kill('SIGTERM');
        setTimeout(() => {
          if (runProc && !runProc.killed) {
            runProc.kill('SIGKILL');
          }
        }, 2000);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[terminal] Client disconnected: ${socket.id}`);

      for (const terminalId of [...attachedTerminals.keys()]) {
        detachTerminal(terminalId);
      }

      if (runProc && !runProc.killed) {
        runProc.kill('SIGTERM');
        runProc = null;
      }
    });
  });
}
