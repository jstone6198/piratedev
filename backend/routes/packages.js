import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

const DEFAULT_VERSION = '1.0.0';

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

async function ensurePackageJson(projectDir, project) {
  const packagePath = path.join(projectDir, 'package.json');

  try {
    await fs.access(packagePath);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const defaultPackage = {
    name: project,
    version: DEFAULT_VERSION,
    type: 'module',
  };

  await fs.writeFile(packagePath, `${JSON.stringify(defaultPackage, null, 2)}\n`, 'utf-8');
}

function runNpm(projectDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd: projectDir, env: process.env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || stdout || `npm exited with code ${code}`));
      resolve({ stdout, stderr });
    });
  });
}

async function searchRegistry(q, res) {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=10`;
  const response = await fetch(url);
  if (!response.ok) {
    return res.status(response.status).json({ error: `npm registry returned ${response.status}` });
  }

  const data = await response.json();
  return res.json(data);
}

async function handleSearch(req, res, app, context, project) {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q is required' });

    if (project) {
      const projectDir = await resolveProjectDir(app, context, project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });
      await ensurePackageJson(projectDir, project);
    }

    return searchRegistry(q, res);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleInstall(req, res, app, context, projectFromPath) {
  try {
    const project = projectFromPath || req.body?.project;
    const packageName = req.body?.name || req.body?.package;
    if (!project || !packageName) return res.status(400).json({ error: 'project and package name are required' });

    const projectDir = await resolveProjectDir(app, context, project);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    await ensurePackageJson(projectDir, project);
    const args = ['install', packageName];
    if (req.body?.dev) args.push('--save-dev');
    const { stdout, stderr } = await runNpm(projectDir, args);
    return res.json({ ok: true, output: (stdout + stderr).trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleUninstall(req, res, app, context, projectFromPath) {
  try {
    const project = projectFromPath || req.body?.project;
    const packageName = req.body?.name || req.body?.package;
    if (!project || !packageName) return res.status(400).json({ error: 'project and package name are required' });

    const projectDir = await resolveProjectDir(app, context, project);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    await ensurePackageJson(projectDir, project);
    const { stdout, stderr } = await runNpm(projectDir, ['uninstall', packageName]);
    return res.json({ ok: true, output: (stdout + stderr).trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default function packageRoutes(app, context = {}) {
  app.get('/api/packages/:project/search', (req, res) => {
    handleSearch(req, res, app, context, req.params.project);
  });

  app.get('/api/packages/search', async (req, res) => {
    handleSearch(req, res, app, context, req.query.project ? String(req.query.project) : null);
  });

  app.get('/api/packages/installed/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const packagePath = path.join(projectDir, 'package.json');
      try {
        await ensurePackageJson(projectDir, req.params.project);
        const data = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
        res.json({
          dependencies: data.dependencies || {},
          devDependencies: data.devDependencies || {},
        });
      } catch (error) {
        if (error.code === 'ENOENT') return res.json({ dependencies: {}, devDependencies: {} });
        throw error;
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/packages/:project/install', (req, res) => {
    handleInstall(req, res, app, context, req.params.project);
  });

  app.post('/api/packages/install', async (req, res) => {
    handleInstall(req, res, app, context, null);
  });

  app.post('/api/packages/:project/uninstall', (req, res) => {
    handleUninstall(req, res, app, context, req.params.project);
  });

  app.post('/api/packages/uninstall', async (req, res) => {
    handleUninstall(req, res, app, context, null);
  });
}
