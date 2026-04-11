import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

const debugProcesses = new Map();
const DEBUG_HOST = '0.0.0.0';
const DEBUG_PORT = 9229;
const ENTRY_FILES = ['index.js', 'server.js', 'main.js', 'app.js'];

function getWorkspace(app, context = {}) {
  return path.resolve(context.workspace || context.workspaceDir || app.locals.workspaceDir);
}

async function resolveProjectDir(app, context, project) {
  if (!project || project.includes('..') || path.isAbsolute(project)) return null;
  const workspace = getWorkspace(app, context);
  const projectDir = path.resolve(workspace, project);
  if (projectDir !== workspace && !projectDir.startsWith(`${workspace}${path.sep}`)) return null;

  try {
    const stat = await fs.stat(projectDir);
    return stat.isDirectory() ? projectDir : null;
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function ensurePackageJson(projectDir, project) {
  const packagePath = path.join(projectDir, 'package.json');
  if (await fileExists(packagePath)) return;

  await fs.writeFile(
    packagePath,
    `${JSON.stringify({ name: project, version: '1.0.0', type: 'module' }, null, 2)}\n`,
    'utf-8'
  );
}

async function readPackageMain(projectDir) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf-8'));
    return typeof data.main === 'string' && data.main.trim() ? data.main.trim() : null;
  } catch {
    return null;
  }
}

async function findMainFile(projectDir) {
  const packageMain = await readPackageMain(projectDir);
  if (packageMain && await fileExists(path.resolve(projectDir, packageMain))) {
    return packageMain;
  }

  for (const file of ENTRY_FILES) {
    if (await fileExists(path.join(projectDir, file))) return file;
  }

  return null;
}

function stopProject(project) {
  const entry = debugProcesses.get(project);
  if (!entry) return false;

  if (entry.process && !entry.process.killed) {
    entry.process.kill('SIGTERM');
    setTimeout(() => {
      if (!entry.process.killed) entry.process.kill('SIGKILL');
    }, 2000);
  }

  debugProcesses.delete(project);
  return true;
}

function stopAllDebuggers() {
  for (const project of debugProcesses.keys()) {
    stopProject(project);
  }
}

function waitForInspectorUrl(child) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(`ws://localhost:${DEBUG_PORT}`);
    }, 1200);

    child.stderr.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/Debugger listening on (ws:\/\/[^\s]+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(match[1].replace(`ws://${DEBUG_HOST}:`, 'ws://localhost:'));
    });
  });
}

export default function debuggerRoutes(app, context = {}) {
  app.post('/api/debugger/:project/start', async (req, res) => {
    try {
      const { project } = req.params;
      const projectDir = await resolveProjectDir(app, context, project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      await ensurePackageJson(projectDir, project);
      const mainFile = await findMainFile(projectDir);
      if (!mainFile) return res.status(400).json({ error: 'No Node entry file found' });

      stopAllDebuggers();

      const child = spawn('node', [`--inspect=${DEBUG_HOST}:${DEBUG_PORT}`, mainFile], {
        cwd: projectDir,
        env: process.env,
      });

      const fallbackUrl = `ws://localhost:${DEBUG_PORT}`;
      const entry = {
        process: child,
        pid: child.pid,
        url: fallbackUrl,
        mainFile,
        startedAt: new Date().toISOString(),
      };
      debugProcesses.set(project, entry);

      child.on('close', () => {
        const current = debugProcesses.get(project);
        if (current?.process === child) debugProcesses.delete(project);
      });
      child.on('error', () => {
        const current = debugProcesses.get(project);
        if (current?.process === child) debugProcesses.delete(project);
      });

      entry.url = await waitForInspectorUrl(child);

      return res.json({
        ok: true,
        running: true,
        project,
        pid: child.pid,
        url: entry.url,
        devtools: 'chrome://inspect',
        mainFile,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/debugger/:project/stop', async (req, res) => {
    try {
      const stopped = stopProject(req.params.project);
      return res.json({ ok: true, running: false, stopped, url: '' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/debugger/:project/status', async (req, res) => {
    try {
      const entry = debugProcesses.get(req.params.project);
      return res.json({
        running: Boolean(entry),
        url: entry?.url || '',
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
}
