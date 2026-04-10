/**
 * routes/projects.js - Project management endpoints
 * Location: /home/claude-runner/projects/josh-replit/backend/routes/projects.js
 *
 * CRUD for projects (directories under workspace). Supports creating, listing,
 * deleting, exporting as zip, and importing from zip upload.
 *
 * Mounted at /api/projects by server.js.
 */

import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import archiver from 'archiver';
import multer from 'multer';
import extractZip from 'extract-zip';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const router = Router();
const execFileAsync = promisify(execFile);

// Multer: store uploaded zips in a temp directory
const upload = multer({ dest: os.tmpdir() });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitise project name — alphanumeric, dashes, underscores only */
function validName(name) {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

function resolveProjectDir(workspaceDir, projectName) {
  if (!validName(projectName)) {
    return null;
  }

  return path.join(workspaceDir, projectName);
}

function shouldExcludeFromExport(entryName) {
  const segments = entryName.split('/').filter(Boolean);
  return segments.includes('node_modules')
    || segments.includes('.git')
    || segments.includes('__pycache__');
}

function extractGithubProjectName(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (parsedUrl.hostname !== 'github.com' && parsedUrl.hostname !== 'www.github.com') {
    return null;
  }

  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const repoSegment = segments[segments.length - 1];
  const projectName = repoSegment.replace(/\.git$/i, '');

  return validName(projectName) ? projectName : null;
}

// ---------------------------------------------------------------------------
// GET /api/projects — list all projects
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const entries = await fs.readdir(ws, { withFileTypes: true });
    const projects = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '_templates') continue;
      const dirPath = path.join(ws, entry.name);
      const stat = await fs.stat(dirPath);
      projects.push({
        name: entry.name,
        created: stat.birthtime,
        modified: stat.mtime,
      });
    }

    // Sort newest-modified first
    projects.sort((a, b) => b.modified - a.modified);
    res.json(projects);
  } catch (e) {
    console.error('[projects] list error:', e);
    res.status(500).json({ error: 'Failed to list projects', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects — create project
// Body: { name }
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!validName(name)) {
      return res.status(400).json({ error: 'Invalid name — use alphanumeric, dash, underscore only' });
    }

    const projectDir = path.join(ws, name);
    if (existsSync(projectDir)) {
      return res.status(409).json({ error: 'Project already exists' });
    }

    await fs.mkdir(projectDir, { recursive: true });

    // Seed a default file
    await fs.writeFile(
      path.join(projectDir, 'index.js'),
      `// ${name}\nconsole.log("Hello from ${name}!");\n`
    );

    res.status(201).json({ ok: true, name });
  } catch (e) {
    console.error('[projects] create error:', e);
    res.status(500).json({ error: 'Failed to create project', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:name — delete project recursively
// ---------------------------------------------------------------------------
router.delete('/:name', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const projectDir = path.resolve(ws, req.params.name);

    // Safety: must be directly inside workspace
    if (path.dirname(projectDir) !== ws) {
      return res.status(400).json({ error: 'Invalid project name' });
    }
    if (!existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await fs.rm(projectDir, { recursive: true, force: true });
    res.json({ ok: true, name: req.params.name });
  } catch (e) {
    console.error('[projects] delete error:', e);
    res.status(500).json({ error: 'Failed to delete project', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:project/export — export project as zip download
// ---------------------------------------------------------------------------
router.get('/:project/export', (req, res) => {
  const ws = req.app.locals.workspaceDir;
  const projectName = req.params.project;
  const projectDir = resolveProjectDir(ws, projectName);

  if (!projectDir) {
    return res.status(400).json({ error: 'Invalid project name' });
  }
  if (!existsSync(projectDir)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${projectName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('[projects] export error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export project', message: err.message });
      return;
    }
    res.end();
  });

  archive.pipe(res);
  archive.directory(projectDir, false, (entry) => {
    if (shouldExcludeFromExport(entry.name)) {
      return false;
    }
    return entry;
  });
  archive.finalize();
});

// ---------------------------------------------------------------------------
// POST /api/projects/import — import zip as new project
// Multipart form: file (zip), name (optional — defaults to zip filename)
// ---------------------------------------------------------------------------
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ws = req.app.locals.workspaceDir;
    const rawName = req.body.name || path.parse(req.file.originalname).name;
    const name = rawName.replace(/[^a-zA-Z0-9_-]/g, '_');

    const projectDir = path.join(ws, name);
    if (existsSync(projectDir)) {
      // Clean up temp file
      await fs.unlink(req.file.path);
      return res.status(409).json({ error: 'Project already exists' });
    }

    await fs.mkdir(projectDir, { recursive: true });
    await extractZip(req.file.path, { dir: projectDir });

    // Clean up temp file
    await fs.unlink(req.file.path);

    res.status(201).json({ ok: true, name });
  } catch (e) {
    console.error('[projects] import error:', e);
    // Clean up temp file on error
    if (req.file && existsSync(req.file.path)) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to import project', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/import-github — clone GitHub repo into workspace
// Body: { url }
// ---------------------------------------------------------------------------
router.post('/import-github', async (req, res) => {
  const ws = req.app.locals.workspaceDir;
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'GitHub URL is required' });
  }

  const projectName = extractGithubProjectName(url.trim());
  if (!projectName) {
    return res.status(400).json({ error: 'Enter a valid GitHub repository URL' });
  }

  const projectDir = resolveProjectDir(ws, projectName);
  if (!projectDir) {
    return res.status(400).json({ error: 'Invalid repository name' });
  }
  if (existsSync(projectDir)) {
    return res.status(409).json({ error: 'A project with that name already exists' });
  }

  try {
    await execFileAsync('git', ['clone', '--depth', '1', url.trim(), projectDir]);

    await fs.rm(path.join(projectDir, '.git'), { recursive: true, force: true });

    return res.status(201).json({ project: projectName, status: 'imported' });
  } catch (e) {
    console.error('[projects] github import error:', e);
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});

    const detail = e.stderr?.toString().trim() || e.message;
    if (/repository .* not found/i.test(detail) || /not found/i.test(detail)) {
      return res.status(400).json({ error: 'Repository not found or not accessible' });
    }
    if (/could not resolve host/i.test(detail) || /failed to connect/i.test(detail)) {
      return res.status(502).json({ error: 'Unable to reach GitHub right now' });
    }

    return res.status(500).json({ error: 'Failed to import repository from GitHub' });
  }
});

export default router;
