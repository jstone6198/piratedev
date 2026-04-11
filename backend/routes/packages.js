import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

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

export default function packageRoutes(app, context = {}) {
  app.get('/api/packages/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: 'q is required' });

      if (req.query.project) {
        const projectDir = await resolveProjectDir(app, context, String(req.query.project));
        if (!projectDir) return res.status(404).json({ error: 'Project not found' });
      }

      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=10`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(response.status).json({ error: `npm registry returned ${response.status}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/packages/installed/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const packagePath = path.join(projectDir, 'package.json');
      try {
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

  app.post('/api/packages/install', async (req, res) => {
    try {
      const project = req.body?.project;
      const packageName = req.body?.package;
      if (!project || !packageName) return res.status(400).json({ error: 'project and package are required' });

      const projectDir = await resolveProjectDir(app, context, project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const args = ['install', packageName];
      if (req.body?.dev) args.push('--save-dev');
      const { stdout, stderr } = await runNpm(projectDir, args);
      res.json({ ok: true, output: (stdout + stderr).trim() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/packages/uninstall', async (req, res) => {
    try {
      const project = req.body?.project;
      const packageName = req.body?.package;
      if (!project || !packageName) return res.status(400).json({ error: 'project and package are required' });

      const projectDir = await resolveProjectDir(app, context, project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const { stdout, stderr } = await runNpm(projectDir, ['uninstall', packageName]);
      res.json({ ok: true, output: (stdout + stderr).trim() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
