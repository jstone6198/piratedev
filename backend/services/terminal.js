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

// Language configuration keyed by file extension
const LANG_MAP = {
  '.js':  { cmd: 'node',    args: [] },
  '.mjs': { cmd: 'node',    args: [] },
  '.py':  { cmd: 'python3', args: [] },
  '.ts':  { cmd: 'npx',     args: ['tsx'] },
  '.sh':  { cmd: 'bash',    args: [] },
  '.rb':  { cmd: 'ruby',    args: [] },
  '.go':  { cmd: 'go',      args: ['run'] },
  '.rs':  { compile: true, compiler: 'rustc' },
  '.c':   { compile: true, compiler: 'gcc' },
  '.cpp': { compile: true, compiler: 'g++' },
};

/**
 * Attach terminal handling to a Socket.io server.
 * @param {import('socket.io').Server} io
 * @param {string} workspaceDir - Absolute path to workspace root
 */
export function setupTerminal(io, workspaceDir) {
  io.on('connection', (socket) => {
    console.log(`[terminal] Client connected: ${socket.id}`);

    // Map of terminal ID → { pty, inputBuffer }
    const terminals = new Map();

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

    // Helper: create a PTY and wire up events for a given terminal ID
    function createTerminal(id, opts = {}) {
      // Kill existing terminal with this ID
      if (terminals.has(id)) {
        try { terminals.get(id).pty.kill(); } catch {}
        cleanupTerminalListeners(id);
        terminals.delete(id);
      }

      const cols = opts.cols || 120;
      const rows = opts.rows || 30;
      const cwd = resolveProjectCwd(opts.project);

      const term = pty.spawn('bash', [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      const entry = { pty: term, inputBuffer: '' };
      terminals.set(id, entry);

      term.onData((data) => {
        socket.emit(`terminal:data:${id}`, data);
      });

      term.onExit(({ exitCode }) => {
        socket.emit(`terminal:exit:${id}`, exitCode);
        terminals.delete(id);
      });

      // Input handler for this terminal
      const inputHandler = (data) => {
        const t = terminals.get(id);
        if (!t) return;

        t.inputBuffer += data;

        if (data.includes('\r') || data.includes('\n')) {
          const command = t.inputBuffer.trim();
          t.inputBuffer = '';

          if (command) {
            const check = isCommandBlocked(command);
            if (check.blocked) {
              auditLog('blocked', `Command rejected: ${command}`, socket.id);
              socket.emit(`terminal:data:${id}`, '\r\n\x1b[31m⛔ Command blocked by sandbox policy.\x1b[0m\r\n');
              t.pty.write('\r');
              return;
            }
            auditLog('terminal', command, socket.id);
          }
        }

        t.pty.write(data);
      };

      // Resize handler
      const resizeHandler = ({ cols, rows }) => {
        const t = terminals.get(id);
        if (t && cols > 0 && rows > 0) {
          try { t.pty.resize(cols, rows); } catch (e) {
            console.error(`[terminal] resize error (${id}):`, e.message);
          }
        }
      };

      // Close handler
      const closeHandler = () => {
        const t = terminals.get(id);
        if (t) {
          try { t.pty.kill(); } catch {}
          terminals.delete(id);
        }
        cleanupTerminalListeners(id);
      };

      socket.on(`terminal:input:${id}`, inputHandler);
      socket.on(`terminal:resize:${id}`, resizeHandler);
      socket.on(`terminal:close:${id}`, closeHandler);

      // Store handlers for cleanup
      entry._handlers = { inputHandler, resizeHandler, closeHandler };
    }

    function cleanupTerminalListeners(id) {
      const entry = terminals.get(id);
      if (entry && entry._handlers) {
        socket.off(`terminal:input:${id}`, entry._handlers.inputHandler);
        socket.off(`terminal:resize:${id}`, entry._handlers.resizeHandler);
        socket.off(`terminal:close:${id}`, entry._handlers.closeHandler);
      }
    }

    // -----------------------------------------------------------------------
    // terminal:create — spawn a new PTY with a given ID
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

      // Legacy listeners for backward compatibility
      const legacyOutput = (data) => socket.emit('terminal:output', data);
      const legacyExit = (code) => socket.emit('terminal:exit', code);

      socket.on('terminal:input', (data) => {
        const t = terminals.get(1);
        if (!t) return;

        t.inputBuffer += data;
        if (data.includes('\r') || data.includes('\n')) {
          const command = t.inputBuffer.trim();
          t.inputBuffer = '';
          if (command) {
            const check = isCommandBlocked(command);
            if (check.blocked) {
              auditLog('blocked', `Command rejected: ${command}`, socket.id);
              socket.emit('terminal:output', '\r\n\x1b[31m⛔ Command blocked by sandbox policy.\x1b[0m\r\n');
              t.pty.write('\r');
              return;
            }
            auditLog('terminal', command, socket.id);
          }
        }
        t.pty.write(data);
      });

      socket.on('terminal:resize', ({ cols, rows }) => {
        const t = terminals.get(1);
        if (t && cols > 0 && rows > 0) {
          try { t.pty.resize(cols, rows); } catch {}
        }
      });

      // Bridge: also emit on legacy channel
      const t1 = terminals.get(1);
      if (t1) {
        t1.pty.onData(legacyOutput);
      }
    });

    // -----------------------------------------------------------------------
    // terminal:cwd — change the terminal working directory (legacy, term 1)
    // -----------------------------------------------------------------------
    socket.on('terminal:cwd', (dir) => {
      const t = terminals.get(1);
      if (!t) return;
      const resolved = path.resolve(workspaceDir, dir);
      if (resolved.startsWith(workspaceDir) && existsSync(resolved)) {
        t.pty.write(`cd "${resolved}"\r`);
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
    // disconnect — clean up all PTY sessions and run process
    // -----------------------------------------------------------------------
    socket.on('disconnect', () => {
      console.log(`[terminal] Client disconnected: ${socket.id}`);
      for (const [id, entry] of terminals) {
        try { entry.pty.kill(); } catch {}
      }
      terminals.clear();
      if (runProc && !runProc.killed) {
        runProc.kill('SIGTERM');
        runProc = null;
      }
    });
  });
}
