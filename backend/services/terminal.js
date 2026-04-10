/**
 * services/terminal.js - Socket.io terminal service using node-pty
 * Location: /home/claude-runner/projects/josh-replit/backend/services/terminal.js
 *
 * Spawns a PTY (pseudo-terminal) per WebSocket connection, forwarding input/output
 * between the browser and a real bash shell. Supports resize, cwd changes, and
 * clean disconnect handling.
 *
 * Used by: server.js passes the Socket.io instance and workspace path.
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
    let term = null;
    let inputBuffer = '';  // Buffer to accumulate terminal input for command checking

    // -----------------------------------------------------------------------
    // terminal:start — spawn a new PTY
    // Payload (optional): { project, cols, rows }
    // -----------------------------------------------------------------------
    socket.on('terminal:start', (opts = {}) => {
      // Kill any existing terminal for this socket
      if (term) {
        term.kill();
        term = null;
      }

      const cols = opts.cols || 120;
      const rows = opts.rows || 30;

      // Determine initial working directory
      let cwd = workspaceDir;
      if (opts.project) {
        const projectDir = path.resolve(workspaceDir, opts.project);
        if (projectDir.startsWith(workspaceDir) && existsSync(projectDir)) {
          cwd = projectDir;
        }
      }

      term = pty.spawn('bash', [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      term.onData((data) => {
        socket.emit('terminal:output', data);
      });

      term.onExit(({ exitCode }) => {
        socket.emit('terminal:exit', exitCode);
        term = null;
      });
    });

    // -----------------------------------------------------------------------
    // terminal:input — write data to PTY stdin (with command blacklist)
    // -----------------------------------------------------------------------
    socket.on('terminal:input', (data) => {
      if (!term) return;

      // Buffer input and check on Enter (CR or LF)
      inputBuffer += data;

      if (data.includes('\r') || data.includes('\n')) {
        const command = inputBuffer.trim();
        inputBuffer = '';

        if (command) {
          const check = isCommandBlocked(command);
          if (check.blocked) {
            auditLog('blocked', `Command rejected: ${command}`, socket.id);
            socket.emit('terminal:output', '\r\n\x1b[31m⛔ Command blocked by sandbox policy.\x1b[0m\r\n');
            // Write just a newline so the shell prints a fresh prompt
            term.write('\r');
            return;
          }
          auditLog('terminal', command, socket.id);
        }
      }

      term.write(data);
    });

    // -----------------------------------------------------------------------
    // terminal:resize — resize the PTY
    // -----------------------------------------------------------------------
    socket.on('terminal:resize', ({ cols, rows }) => {
      if (term && cols > 0 && rows > 0) {
        try {
          term.resize(cols, rows);
        } catch (e) {
          console.error('[terminal] resize error:', e.message);
        }
      }
    });

    // -----------------------------------------------------------------------
    // terminal:cwd — change the terminal working directory
    // -----------------------------------------------------------------------
    socket.on('terminal:cwd', (dir) => {
      if (!term) return;
      // Validate the path stays within workspace
      const resolved = path.resolve(workspaceDir, dir);
      if (resolved.startsWith(workspaceDir) && existsSync(resolved)) {
        term.write(`cd "${resolved}"\r`);
      }
    });

    // -----------------------------------------------------------------------
    // run:execute — run a file and stream output to the client
    // Payload: { project, filePath }
    // -----------------------------------------------------------------------
    let runProc = null;

    socket.on('run:execute', (opts = {}) => {
      const { project, filePath } = opts;
      if (!project || !filePath) return;

      // Kill existing run process
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
    // disconnect — clean up PTY and run process
    // -----------------------------------------------------------------------
    socket.on('disconnect', () => {
      console.log(`[terminal] Client disconnected: ${socket.id}`);
      if (term) {
        term.kill();
        term = null;
      }
      if (runProc && !runProc.killed) {
        runProc.kill('SIGTERM');
        runProc = null;
      }
    });
  });
}
