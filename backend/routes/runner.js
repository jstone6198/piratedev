import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

const runningProcesses = new Map();
let nextPort = 4100;

function getWorkspace(app, context = {}) {
  return path.resolve(context.workspace || context.workspaceDir || app.locals.workspaceDir);
}

async function resolveProjectDir(app, context, project) {
  if (!project || project.includes('..') || path.isAbsolute(project)) return null;
  const workspace = getWorkspace(app, context);
  const projectDir = path.resolve(workspace, project);
  if (!projectDir.startsWith(workspace + path.sep) && projectDir !== workspace) return null;

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

async function detectProjectType(projectDir) {
  if (await fileExists(path.join(projectDir, 'package.json'))) return 'node';
  if (await fileExists(path.join(projectDir, 'requirements.txt'))) return 'python';
  if (await fileExists(path.join(projectDir, 'go.mod'))) return 'go';
  if (await fileExists(path.join(projectDir, 'index.html'))) return 'static';
  return 'unknown';
}

function commandForType(type, port) {
  if (type === 'node') return { command: 'node', args: ['index.js'] };
  if (type === 'python') return { command: 'python', args: ['main.py'] };
  if (type === 'go') return { command: 'go', args: ['run', '.'] };
  if (type === 'static') return { command: 'python', args: ['-m', 'http.server', String(port)] };
  return null;
}

function allocatePort() {
  const used = new Set([...runningProcesses.values()].map((entry) => entry.port));
  while (used.has(nextPort)) nextPort += 1;
  return nextPort++;
}

function emitOutput(app, context, payload) {
  const io = context?.io || app.locals.io;
  if (io) io.emit('runner:output', payload);
}

function stopProcess(project) {
  const entry = runningProcesses.get(project);
  if (!entry) return false;

  if (entry.process && !entry.process.killed) {
    entry.process.kill('SIGTERM');
    setTimeout(() => {
      if (!entry.process.killed) entry.process.kill('SIGKILL');
    }, 2000);
  }

  runningProcesses.delete(project);
  return true;
}

export default function runnerRoutes(app, context = {}) {
  app.post('/api/runner/detect/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const type = await detectProjectType(projectDir);
      res.json({ project: req.params.project, type });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/runner/start/:project', async (req, res) => {
    try {
      const { project } = req.params;
      const projectDir = await resolveProjectDir(app, context, project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const type = await detectProjectType(projectDir);
      const port = allocatePort();
      const config = commandForType(type, port);
      if (!config) return res.status(400).json({ error: 'Unsupported project type', type });

      stopProcess(project);

      const child = spawn(config.command, config.args, {
        cwd: projectDir,
        env: { ...process.env, PORT: String(port) },
      });

      const entry = {
        process: child,
        pid: child.pid,
        port,
        type,
        command: [config.command, ...config.args].join(' '),
        startedAt: new Date().toISOString(),
      };
      runningProcesses.set(project, entry);

      child.stdout.on('data', (data) => {
        emitOutput(app, context, {
          project,
          pid: child.pid,
          stream: 'stdout',
          data: data.toString(),
        });
      });

      child.stderr.on('data', (data) => {
        emitOutput(app, context, {
          project,
          pid: child.pid,
          stream: 'stderr',
          data: data.toString(),
        });
      });

      child.on('close', (code, signal) => {
        const current = runningProcesses.get(project);
        if (current?.process === child) runningProcesses.delete(project);
        emitOutput(app, context, {
          project,
          pid: child.pid,
          stream: 'system',
          data: `Process exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}\n`,
        });
      });

      child.on('error', (error) => {
        const current = runningProcesses.get(project);
        if (current?.process === child) runningProcesses.delete(project);
        emitOutput(app, context, {
          project,
          pid: child.pid,
          stream: 'stderr',
          data: `${error.message}\n`,
        });
      });

      res.json({
        ok: true,
        project,
        type,
        pid: child.pid,
        port,
        command: entry.command,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/runner/stop/:project', async (req, res) => {
    try {
      const stopped = stopProcess(req.params.project);
      res.json({ ok: true, project: req.params.project, stopped });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/runner/status/:project', async (req, res) => {
    try {
      const entry = runningProcesses.get(req.params.project);
      res.json({
        project: req.params.project,
        running: !!entry,
        pid: entry?.pid || null,
        port: entry?.port || null,
        type: entry?.type || null,
        command: entry?.command || null,
        startedAt: entry?.startedAt || null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
