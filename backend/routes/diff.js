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

function resolveProjectFile(projectDir, requestedPath) {
  if (!requestedPath || path.isAbsolute(requestedPath)) return null;
  const filePath = path.resolve(projectDir, requestedPath);
  if (!filePath.startsWith(projectDir + path.sep) && filePath !== projectDir) return null;
  return {
    absolute: filePath,
    relative: path.relative(projectDir, filePath).replaceAll(path.sep, '/'),
  };
}

function runGit(projectDir, args, options = {}) {
  const { allowError = false } = options;
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: projectDir });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !allowError) return reject(new Error(stderr || stdout || `git exited with code ${code}`));
      resolve({ stdout, stderr, code });
    });
  });
}

async function gitShow(projectDir, spec) {
  const { stdout, code } = await runGit(projectDir, ['show', spec], { allowError: true });
  return code === 0 ? stdout : '';
}

async function readWorkingFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export default function diffRoutes(app, context = {}) {
  app.get('/api/diff/status/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const { stdout } = await runGit(projectDir, ['status', '--porcelain']);
      const files = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => ({
          status: line.slice(0, 2),
          path: line.slice(3),
        }));

      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/diff/file/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const target = resolveProjectFile(projectDir, String(req.query.path || ''));
      if (!target) return res.status(400).json({ error: 'path is required' });

      const [original, modified, diffResult] = await Promise.all([
        gitShow(projectDir, `HEAD:${target.relative}`),
        readWorkingFile(target.absolute),
        runGit(projectDir, ['diff', '--', target.relative], { allowError: true }),
      ]);

      res.json({ original, modified, diff: diffResult.stdout });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/diff/staged/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const requestedPath = String(req.query.path || '').trim();
      if (!requestedPath) {
        const { stdout } = await runGit(projectDir, ['diff', '--cached'], { allowError: true });
        return res.json({ diff: stdout });
      }

      const target = resolveProjectFile(projectDir, requestedPath);
      if (!target) return res.status(400).json({ error: 'Invalid path' });

      const [original, modified, diffResult] = await Promise.all([
        gitShow(projectDir, `HEAD:${target.relative}`),
        gitShow(projectDir, `:${target.relative}`),
        runGit(projectDir, ['diff', '--cached', '--', target.relative], { allowError: true }),
      ]);

      res.json({ original, modified, diff: diffResult.stdout });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
