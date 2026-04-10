/**
 * routes/preview.js - Live preview server management
 * Spawns/stops dev servers for projects and tracks them.
 */

import { Router } from 'express';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import http from 'http';

const router = Router();

// Track running preview processes: Map<project, { proc, port, type }>
const previews = new Map();

// Port allocation — start at 4000, increment
let nextPort = 4000;

function allocatePort() {
  return nextPort++;
}

function emitPreviewStarted(io, project, port) {
  io?.emit('preview:started', { project, port });
}

function emitPreviewStopped(io, project) {
  io?.emit('preview:stopped', { project });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkPreviewResponding(port, timeout = 800) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        timeout,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function emitPreviewStartedWhenReady(io, project, port, entry) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (previews.get(project) !== entry) return;
    if (await checkPreviewResponding(port, 500)) {
      if (previews.get(project) === entry) {
        emitPreviewStarted(io, project, port);
      }
      return;
    }
    await delay(300);
  }
}

/**
 * Detect project type based on files present.
 * Returns { type: 'static'|'node'|'python', entry? }
 */
function detectProjectType(projectDir) {
  if (existsSync(path.join(projectDir, 'package.json'))) {
    // Check for common entry points
    if (existsSync(path.join(projectDir, 'server.js'))) return { type: 'node', entry: 'server.js' };
    if (existsSync(path.join(projectDir, 'index.js'))) return { type: 'node', entry: 'index.js' };
    if (existsSync(path.join(projectDir, 'app.js'))) return { type: 'node', entry: 'app.js' };
    if (existsSync(path.join(projectDir, 'main.js'))) return { type: 'node', entry: 'main.js' };
    return { type: 'node', entry: null }; // will use npm start
  }
  if (existsSync(path.join(projectDir, 'main.py')) || existsSync(path.join(projectDir, 'app.py'))) {
    const entry = existsSync(path.join(projectDir, 'main.py')) ? 'main.py' : 'app.py';
    return { type: 'python', entry };
  }
  return { type: 'static' };
}

export function stopPreviewProcess(project) {
  const existing = previews.get(project);
  if (!existing) {
    return false;
  }
  try { existing.proc.kill('SIGTERM'); } catch {}
  previews.delete(project);
  emitPreviewStopped(existing.io, project);
  return true;
}

export function startPreviewProcess(project, workspaceDir, io = null) {
  const projectDir = path.resolve(workspaceDir, project);
  const normalizedWorkspaceDir = path.resolve(workspaceDir);
  if (!projectDir.startsWith(normalizedWorkspaceDir)) {
    throw new Error('Invalid project');
  }
  if (!existsSync(projectDir)) {
    throw new Error('Project not found');
  }

  stopPreviewProcess(project);

  const port = allocatePort();
  const info = detectProjectType(projectDir);
  let proc;

  if (info.type === 'static') {
    proc = spawn('python3', ['-m', 'http.server', String(port)], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else if (info.type === 'node') {
    if (info.entry) {
      proc = spawn('node', [info.entry], {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(port) },
      });
    } else {
      proc = spawn('npm', ['start'], {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(port) },
        shell: true,
      });
    }
  } else if (info.type === 'python') {
    proc = spawn('python3', [info.entry], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port) },
    });
  }

  // Collect stdout/stderr for debugging
  const entry = { proc, port, type: info.type, startedAt: Date.now(), output: '', io };
  proc.stdout?.on('data', (d) => { entry.output += d.toString(); });
  proc.stderr?.on('data', (d) => { entry.output += d.toString(); });

  proc.on('exit', (code) => {
    console.log(`[preview] ${project} exited with code ${code}`);
    if (previews.get(project) === entry) {
      previews.delete(project);
      emitPreviewStopped(io, project);
    }
  });

  previews.set(project, entry);
  emitPreviewStartedWhenReady(io, project, port, entry).catch((err) => {
    console.error(`[preview] failed to emit start for ${project}:`, err);
  });

  // Give the server a moment to start
  const previewUrl = `/preview/${port}/`;
  return { running: true, port, url: previewUrl, type: info.type };
}

// POST /api/preview/:project/start
router.post('/:project/start', async (req, res) => {
  const project = req.params.project;
  const ws = req.app.locals.workspaceDir;

  try {
    const preview = startPreviewProcess(project, ws, req.app.locals.io);
    res.json(preview);
  } catch (err) {
    if (err.message === 'Invalid project') {
      return res.status(403).json({ error: err.message });
    }
    if (err.message === 'Project not found') {
      return res.status(404).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to spawn preview server', message: err.message });
  }
});

// POST /api/preview/:project/stop
router.post('/:project/stop', (req, res) => {
  const project = req.params.project;
  if (!previews.has(project)) {
    return res.json({ running: false, message: 'No preview running' });
  }

  stopPreviewProcess(project);
  res.json({ running: false, message: 'Preview stopped' });
});

// GET /api/preview/:project/status
router.get('/:project/status', async (req, res) => {
  const project = req.params.project;
  const entry = previews.get(project);

  if (!entry) {
    return res.json({ running: false });
  }

  // Check if process is still alive
  try {
    process.kill(entry.proc.pid, 0); // signal 0 = check existence
  } catch {
    previews.delete(project);
    emitPreviewStopped(entry.io, project);
    return res.json({ running: false });
  }

  const responding = await checkPreviewResponding(entry.port);

  res.json({
    running: true,
    responding,
    port: entry.port,
    url: `/preview/${entry.port}/`,
    type: entry.type,
    uptime: Math.round((Date.now() - entry.startedAt) / 1000),
  });
});

export default router;
