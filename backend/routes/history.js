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
  return path.relative(projectDir, filePath).replaceAll(path.sep, '/');
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

function parseLog(stdout) {
  return stdout
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, author, date, ...subjectParts] = entry.split('\x1f');
      return {
        hash,
        author,
        date,
        subject: subjectParts.join('\x1f'),
      };
    });
}

function parseBlame(stdout) {
  const lines = [];
  let current = null;

  for (const line of stdout.split('\n')) {
    const header = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (header) {
      current = {
        commit: header[1],
        originalLine: Number(header[2]),
        finalLine: Number(header[3]),
        groupSize: Number(header[4]),
      };
      continue;
    }

    if (!current) continue;
    if (line.startsWith('author ')) current.author = line.slice('author '.length);
    if (line.startsWith('author-time ')) current.authorTime = Number(line.slice('author-time '.length));
    if (line.startsWith('summary ')) current.summary = line.slice('summary '.length);
    if (line.startsWith('filename ')) current.filename = line.slice('filename '.length);
    if (line.startsWith('\t')) {
      lines.push({ ...current, content: line.slice(1) });
      current = null;
    }
  }

  return lines;
}

export default function historyRoutes(app, context = {}) {
  app.get('/api/history/log/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const relativePath = resolveProjectFile(projectDir, String(req.query.path || ''));
      if (!relativePath) return res.status(400).json({ error: 'path is required' });

      const requestedLimit = Number.parseInt(String(req.query.limit || '20'), 10);
      const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
      const format = '%x1e%H%x1f%an%x1f%aI%x1f%s';
      const { stdout } = await runGit(projectDir, ['log', `--max-count=${limit}`, `--format=${format}`, '--', relativePath], { allowError: true });

      res.json({ commits: parseLog(stdout) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/history/blame/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const relativePath = resolveProjectFile(projectDir, String(req.query.path || ''));
      if (!relativePath) return res.status(400).json({ error: 'path is required' });

      const { stdout } = await runGit(projectDir, ['blame', '--porcelain', '--', relativePath], { allowError: true });
      res.json({ blame: parseBlame(stdout), raw: stdout });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/history/show/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const relativePath = resolveProjectFile(projectDir, String(req.query.path || ''));
      const commit = String(req.query.commit || '').trim();
      if (!relativePath || !commit) return res.status(400).json({ error: 'path and commit are required' });
      if (commit.startsWith('-')) return res.status(400).json({ error: 'Invalid commit' });

      const { stdout } = await runGit(projectDir, ['show', `${commit}:${relativePath}`], { allowError: true });
      res.json({ content: stdout });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
