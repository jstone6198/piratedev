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
import { existsSync, createReadStream } from 'fs';
import path from 'path';
import archiver from 'archiver';
import multer from 'multer';
import extractZip from 'extract-zip';
import os from 'os';

const router = Router();

// Multer: store uploaded zips in a temp directory
const upload = multer({ dest: os.tmpdir() });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitise project name — alphanumeric, dashes, underscores only */
function validName(name) {
  return /^[a-zA-Z0-9_-]+$/.test(name);
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
// POST /api/projects/:name/export — export project as zip download
// ---------------------------------------------------------------------------
router.post('/:name/export', (req, res) => {
  const ws = req.app.locals.workspaceDir;
  const projectDir = path.resolve(ws, req.params.name);

  if (path.dirname(projectDir) !== ws) {
    return res.status(400).json({ error: 'Invalid project name' });
  }
  if (!existsSync(projectDir)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('[projects] export error:', err);
    res.status(500).end();
  });
  archive.pipe(res);
  archive.directory(projectDir, false);
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

export default router;
