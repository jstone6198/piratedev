/**
 * routes/preview.js - Live preview server management
 * Spawns/stops dev servers for projects and tracks them.
 * Ports 3400-3499, bash -c spawning, structured log capture.
 */

import { Router } from 'express';
import { spawn, execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';

function findChromiumPath() {
  for (const p of ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']) {
    try { execSync(`test -f ${p}`); return p; } catch {}
  }
  return null;
}

const router = Router();

// Track running preview processes: Map<project, { proc, pid, port, command, logs, startedAt, io }>
const previewProcesses = new Map();

const PORT_MIN = 3400;
const PORT_MAX = 3499;
const MAX_LOG_LINES = 200;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function allocatePort() {
  // Collect ports already in use by our previews
  const usedPorts = new Set();
  for (const entry of previewProcesses.values()) {
    usedPorts.add(entry.port);
  }

  // Try random ports in range
  const candidates = [];
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!usedPorts.has(p)) candidates.push(p);
  }

  // Shuffle for randomness
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  for (const port of candidates) {
    if (await isPortAvailable(port)) return port;
  }

  throw new Error('No available ports in range 3400-3499');
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

function appendLog(entry, line) {
  entry.logs.push(line);
  if (entry.logs.length > MAX_LOG_LINES) {
    entry.logs.splice(0, entry.logs.length - MAX_LOG_LINES);
  }
}

function listProjectFiles(projectDir, extensions, limit = 80) {
  const results = [];
  const ignoredDirs = new Set(['.git', 'node_modules', 'vendor', 'target', '__pycache__', '.venv', 'venv']);

  function walk(dir) {
    if (results.length >= limit) return;

    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) return;
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) walk(entryPath);
        continue;
      }

      if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
        results.push(entryPath);
      }
    }
  }

  walk(projectDir);
  return results;
}

function fileIncludes(filePath, needle) {
  try {
    return readFileSync(filePath, 'utf-8').includes(needle);
  } catch {
    return false;
  }
}

function detectPythonWeb(projectDir) {
  if (existsSync(path.join(projectDir, 'manage.py'))) {
    return {
      type: 'python-django',
      command: 'python3 manage.py runserver 0.0.0.0:$PORT',
    };
  }

  const pythonFiles = listProjectFiles(projectDir, ['.py']);
  const fastApiFile = pythonFiles.find((file) => fileIncludes(file, 'from fastapi'));
  if (fastApiFile) {
    const moduleName = path.basename(fastApiFile, '.py') || 'main';
    const appModule = existsSync(path.join(projectDir, 'main.py')) ? 'main' : moduleName;
    return {
      type: 'python-fastapi',
      command: `uvicorn ${appModule}:app --host 0.0.0.0 --port $PORT`,
    };
  }

  const flaskFile = pythonFiles.find((file) => fileIncludes(file, 'from flask'));
  if (flaskFile) {
    const entry = existsSync(path.join(projectDir, 'app.py'))
      ? 'app.py'
      : path.relative(projectDir, flaskFile);
    return {
      type: 'python-flask',
      command: `python3 ${entry}`,
    };
  }

  return null;
}

function detectGoWeb(projectDir) {
  const goFile = listProjectFiles(projectDir, ['.go']).find((file) => fileIncludes(file, 'net/http'));
  if (!goFile) return null;

  const entry = path.relative(projectDir, goFile);
  return {
    type: 'go',
    command: `go run ${entry}`,
  };
}

function detectPhpWeb(projectDir) {
  const hasPhpEntry = existsSync(path.join(projectDir, 'index.php')) || listProjectFiles(projectDir, ['.php'], 1).length > 0;
  if (!hasPhpEntry) return null;

  return {
    type: 'php',
    command: 'php -S 0.0.0.0:$PORT -t .',
  };
}

/**
 * Detect project type and return a shell command to run it.
 * Checks package.json scripts for 'dev' then 'start', then common entry points.
 */
function detectProjectCommand(projectDir) {
  const pkgPath = path.join(projectDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};

      // Prefer 'dev' script, then 'start'
      if (scripts.dev) {
        return { type: 'node', command: 'npm run dev' };
      }
      if (scripts.start) {
        return { type: 'node', command: 'npm start' };
      }
    } catch {
      // invalid package.json, fall through
    }

    // Check common entry files
    if (existsSync(path.join(projectDir, 'index.js'))) {
      return { type: 'node', command: 'node index.js' };
    }
    if (existsSync(path.join(projectDir, 'server.js'))) {
      return { type: 'node', command: 'node server.js' };
    }
    if (existsSync(path.join(projectDir, 'app.js'))) {
      return { type: 'node', command: 'node app.js' };
    }
    if (existsSync(path.join(projectDir, 'main.js'))) {
      return { type: 'node', command: 'node main.js' };
    }

    return { type: 'node', command: 'npm start' };
  }

  const pythonWeb = detectPythonWeb(projectDir);
  if (pythonWeb) return pythonWeb;

  const goWeb = detectGoWeb(projectDir);
  if (goWeb) return goWeb;

  const phpWeb = detectPhpWeb(projectDir);
  if (phpWeb) return phpWeb;

  if (existsSync(path.join(projectDir, 'app.py'))) {
    return { type: 'python', command: 'python3 app.py' };
  }
  if (existsSync(path.join(projectDir, 'main.py'))) {
    return { type: 'python', command: 'python3 main.py' };
  }
  if (existsSync(path.join(projectDir, 'server.js'))) {
    return { type: 'node', command: 'node server.js' };
  }

  return { type: 'static', command: 'python3 -m http.server $PORT' };
}

async function emitPreviewStartedWhenReady(io, project, port, entry) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (previewProcesses.get(project) !== entry) return;
    if (await checkPreviewResponding(port, 500)) {
      if (previewProcesses.get(project) === entry) {
        emitPreviewStarted(io, project, port);
      }
      return;
    }
    await delay(300);
  }
}

export function stopPreviewProcess(project) {
  const existing = previewProcesses.get(project);
  if (!existing) return false;

  try { existing.proc.kill('SIGTERM'); } catch {}
  // Kill process group in case bash spawned children
  try { process.kill(-existing.proc.pid, 'SIGTERM'); } catch {}
  previewProcesses.delete(project);
  emitPreviewStopped(existing.io, project);
  return true;
}

export async function startPreviewProcess(project, workspaceDir, io = null, customCommand = null) {
  const projectDir = path.resolve(workspaceDir, project);
  const normalizedWorkspaceDir = path.resolve(workspaceDir);
  if (!projectDir.startsWith(normalizedWorkspaceDir)) {
    throw new Error('Invalid project');
  }
  if (!existsSync(projectDir)) {
    throw new Error('Project not found');
  }

  // If already running for this project, stop old one first
  stopPreviewProcess(project);

  const port = await allocatePort();
  const detected = detectProjectCommand(projectDir);
  const command = customCommand || detected.command;

  // Spawn via bash -c so the command string is interpreted properly
  const proc = spawn('bash', ['-c', command], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) },
    detached: true,
  });

  const entry = {
    proc,
    pid: proc.pid,
    port,
    command,
    type: detected.type,
    logs: [],
    startedAt: Date.now(),
    io,
  };

  // Capture stdout/stderr into logs array (last 200 lines)
  proc.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l) => l.length > 0);
    for (const line of lines) appendLog(entry, line);
  });

  proc.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l) => l.length > 0);
    for (const line of lines) appendLog(entry, line);
  });

  proc.on('exit', (code) => {
    console.log(`[preview] ${project} exited with code ${code}`);
    if (previewProcesses.get(project) === entry) {
      previewProcesses.delete(project);
      emitPreviewStopped(io, project);
    }
  });

  previewProcesses.set(project, entry);

  emitPreviewStartedWhenReady(io, project, port, entry).catch((err) => {
    console.error(`[preview] failed to emit start for ${project}:`, err);
  });

  const previewUrl = `http://${process.env.HOSTNAME || 'localhost'}/preview/${port}/`;
  return { running: true, port, pid: proc.pid, url: `/preview/${port}/`, command, type: detected.type };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /api/preview/start — body: { project, command? }
router.post('/start', async (req, res) => {
  const { project, command } = req.body || {};
  if (!project) return res.status(400).json({ error: 'project is required' });

  const ws = req.app.locals.workspaceDir;
  try {
    const preview = await startPreviewProcess(project, ws, req.app.locals.io, command || null);
    res.json(preview);
  } catch (err) {
    if (err.message === 'Invalid project') return res.status(403).json({ error: err.message });
    if (err.message === 'Project not found') return res.status(404).json({ error: err.message });
    return res.status(500).json({ error: 'Failed to spawn preview server', message: err.message });
  }
});

// POST /api/preview/:project/start — backward-compatible route
router.post('/:project/start', async (req, res) => {
  const project = req.params.project;
  const ws = req.app.locals.workspaceDir;

  try {
    const preview = await startPreviewProcess(project, ws, req.app.locals.io);
    res.json(preview);
  } catch (err) {
    if (err.message === 'Invalid project') return res.status(403).json({ error: err.message });
    if (err.message === 'Project not found') return res.status(404).json({ error: err.message });
    return res.status(500).json({ error: 'Failed to spawn preview server', message: err.message });
  }
});

// GET /api/preview/status/:project
router.get('/status/:project', async (req, res) => {
  const project = req.params.project;
  const entry = previewProcesses.get(project);

  if (!entry) return res.json({ running: false });

  // Check if process is still alive
  try {
    process.kill(entry.proc.pid, 0);
  } catch {
    previewProcesses.delete(project);
    emitPreviewStopped(entry.io, project);
    return res.json({ running: false });
  }

  const responding = await checkPreviewResponding(entry.port);

  res.json({
    running: true,
    responding,
    port: entry.port,
    pid: entry.pid,
    url: `/preview/${entry.port}/`,
    type: entry.type,
    command: entry.command,
    uptime: Math.round((Date.now() - entry.startedAt) / 1000),
    logs: entry.logs.slice(-20),
  });
});

// GET /api/preview/:project/status — backward-compatible
router.get('/:project/status', async (req, res) => {
  const project = req.params.project;
  const entry = previewProcesses.get(project);

  if (!entry) return res.json({ running: false });

  try {
    process.kill(entry.proc.pid, 0);
  } catch {
    previewProcesses.delete(project);
    emitPreviewStopped(entry.io, project);
    return res.json({ running: false });
  }

  const responding = await checkPreviewResponding(entry.port);

  res.json({
    running: true,
    responding,
    port: entry.port,
    pid: entry.pid,
    url: `/preview/${entry.port}/`,
    type: entry.type,
    command: entry.command,
    uptime: Math.round((Date.now() - entry.startedAt) / 1000),
    logs: entry.logs.slice(-20),
  });
});

// POST /api/preview/stop/:project
router.post('/stop/:project', (req, res) => {
  const project = req.params.project;
  if (!previewProcesses.has(project)) {
    return res.json({ stopped: true, message: 'No preview running' });
  }
  stopPreviewProcess(project);
  res.json({ stopped: true });
});

// POST /api/preview/:project/stop — backward-compatible
router.post('/:project/stop', (req, res) => {
  const project = req.params.project;
  if (!previewProcesses.has(project)) {
    return res.json({ running: false, stopped: true, message: 'No preview running' });
  }
  stopPreviewProcess(project);
  res.json({ running: false, stopped: true });
});

// GET /api/preview/logs/:project
router.get('/logs/:project', (req, res) => {
  const project = req.params.project;
  const entry = previewProcesses.get(project);

  if (!entry) {
    return res.json({ logs: [], running: false });
  }

  res.json({ logs: entry.logs.slice(-100), running: true });
});

// GET /api/preview/:project/screenshot — capture a screenshot of the running preview
router.get('/:project/screenshot', async (req, res) => {
  const { project } = req.params;
  const entry = previewProcesses.get(project);
  if (!entry || !entry.port) {
    return res.status(404).json({ error: 'No running preview for this project' });
  }

  let browser;
  try {
    const puppeteer = (await import('puppeteer-core')).default;
    const chromiumPath = findChromiumPath();
    if (!chromiumPath) {
      return res.status(500).json({ error: 'Chromium not found on system' });
    }
    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--headless'],
      headless: true,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`http://127.0.0.1:${entry.port}`, { waitUntil: 'networkidle2', timeout: 10000 });
    const screenshot = await page.screenshot({ type: 'png', encoding: 'base64' });
    await browser.close();
    browser = null;
    res.json({ screenshot, port: entry.port });
  } catch (err) {
    if (browser) try { await browser.close(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

export default router;
