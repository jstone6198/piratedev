/**
 * routes/files.js - File operation endpoints for the IDE
 * Location: /home/claude-runner/projects/josh-replit/backend/routes/files.js
 *
 * Provides CRUD operations on files and folders within a project workspace.
 * Every user-supplied path is validated against directory traversal attacks.
 *
 * Mounted at /api/files by server.js.
 */

import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import path from 'path';
import multer from 'multer';
import archiver from 'archiver';
import { auditLog } from '../lib/sandbox.js';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a user-supplied relative path inside a project dir.
 * Returns null if traversal is detected.
 */
function safePath(workspaceDir, project, relativePath) {
  const projectDir = path.resolve(workspaceDir, project);
  const resolved = relativePath
    ? path.resolve(projectDir, relativePath)
    : projectDir;
  if (!resolved.startsWith(projectDir)) return null;
  return resolved;
}

/**
 * Build a recursive tree for a directory.
 * Node shape: { name, type: 'file'|'directory', path, children? }
 */
async function buildTree(dir, projectDir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const tree = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(projectDir, fullPath);

    if (entry.isDirectory()) {
      tree.push({
        name: entry.name,
        type: 'directory',
        path: relPath,
        children: await buildTree(fullPath, projectDir),
      });
    } else {
      tree.push({ name: entry.name, type: 'file', path: relPath });
    }
  }
  return tree;
}

// ---------------------------------------------------------------------------
// GET /api/files/:project — list files as recursive tree
// ---------------------------------------------------------------------------
router.get('/:project', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const projectDir = safePath(ws, req.params.project, '');
    if (!projectDir) return res.status(400).json({ error: 'Invalid project name' });
    if (!existsSync(projectDir)) return res.status(404).json({ error: 'Project not found' });

    res.json(await buildTree(projectDir, projectDir));
  } catch (e) {
    console.error('[files] list error:', e);
    res.status(500).json({ error: 'Failed to list files', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/files/:project/content?path=xxx — read file content
// ---------------------------------------------------------------------------
router.get('/:project/content', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const fp = safePath(ws, req.params.project, req.query.path);
    if (!fp) {
      auditLog('blocked', `Path traversal rejected: ${req.query.path} (project: ${req.params.project})`, req.ip);
      return res.status(403).json({ error: 'Path traversal blocked' });
    }
    if (!existsSync(fp)) return res.status(404).json({ error: 'File not found' });

    const stat = await fs.stat(fp);
    if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });

    auditLog('file', `READ ${req.query.path} (project: ${req.params.project})`, req.ip);
    const content = await fs.readFile(fp, 'utf-8');
    res.json({ path: req.query.path, content });
  } catch (e) {
    console.error('[files] read error:', e);
    res.status(500).json({ error: 'Failed to read file', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/files/:project — create file or folder
// Body: { name, type: 'file'|'folder', path? }
// ---------------------------------------------------------------------------
router.post('/:project', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const { name, type: kind, path: parentPath } = req.body;

    if (!name || !kind) return res.status(400).json({ error: 'name and type are required' });
    if (!['file', 'folder'].includes(kind)) return res.status(400).json({ error: 'type must be file or folder' });

    const parentDir = safePath(ws, req.params.project, parentPath || '');
    if (!parentDir) return res.status(403).json({ error: 'Path traversal blocked' });

    const target = path.join(parentDir, name);
    const projectDir = path.resolve(ws, req.params.project);
    if (!target.startsWith(projectDir)) return res.status(403).json({ error: 'Path traversal blocked' });
    if (existsSync(target)) return res.status(409).json({ error: 'Already exists' });

    if (kind === 'folder') {
      await fs.mkdir(target, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, '');
    }

    res.status(201).json({ ok: true, path: path.relative(projectDir, target) });
  } catch (e) {
    console.error('[files] create error:', e);
    res.status(500).json({ error: 'Failed to create', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/files/:project — update file content
// Body: { path, content }
// ---------------------------------------------------------------------------
router.put('/:project', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const { path: filePath, content } = req.body;

    if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content required' });

    const fp = safePath(ws, req.params.project, filePath);
    if (!fp) return res.status(403).json({ error: 'Path traversal blocked' });
    if (!existsSync(fp)) return res.status(404).json({ error: 'File not found' });

    await fs.writeFile(fp, content, 'utf-8');
    res.json({ ok: true, path: filePath });
  } catch (e) {
    console.error('[files] update error:', e);
    res.status(500).json({ error: 'Failed to update', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/files/:project — delete file or folder
// Body: { path }
// ---------------------------------------------------------------------------
router.delete('/:project', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const { path: targetPath } = req.body;
    if (!targetPath) return res.status(400).json({ error: 'path is required' });

    const fp = safePath(ws, req.params.project, targetPath);
    if (!fp) return res.status(403).json({ error: 'Path traversal blocked' });

    const projectDir = path.resolve(ws, req.params.project);
    if (fp === projectDir) return res.status(400).json({ error: 'Cannot delete project root here' });
    if (!existsSync(fp)) return res.status(404).json({ error: 'Not found' });

    await fs.rm(fp, { recursive: true, force: true });
    res.json({ ok: true, path: targetPath });
  } catch (e) {
    console.error('[files] delete error:', e);
    res.status(500).json({ error: 'Failed to delete', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/files/:project/rename — rename / move
// Body: { oldPath, newPath }
// ---------------------------------------------------------------------------
router.post('/:project/rename', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath required' });

    const absOld = safePath(ws, req.params.project, oldPath);
    const absNew = safePath(ws, req.params.project, newPath);
    if (!absOld || !absNew) return res.status(403).json({ error: 'Path traversal blocked' });
    if (!existsSync(absOld)) return res.status(404).json({ error: 'Source not found' });
    if (existsSync(absNew)) return res.status(409).json({ error: 'Destination already exists' });

    await fs.mkdir(path.dirname(absNew), { recursive: true });
    await fs.rename(absOld, absNew);
    res.json({ ok: true, oldPath, newPath });
  } catch (e) {
    console.error('[files] rename error:', e);
    res.status(500).json({ error: 'Failed to rename', message: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/files/:project/upload — upload files (multer multipart)
// Supports optional query param ?path=subdir to upload into a subfolder
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const ws = req.app.locals.workspaceDir;
      const subdir = req.query.path || '';
      const dest = safePath(ws, req.params.project, subdir);
      if (!dest) return cb(new Error('Path traversal blocked'));
      // Ensure destination exists
      fs.mkdir(dest, { recursive: true }).then(() => cb(null, dest)).catch(cb);
    },
    filename(_req, file, cb) {
      // Preserve original filename; reject path separators
      const name = path.basename(file.originalname);
      if (!name) return cb(new Error('Invalid filename'));
      cb(null, name);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
});

router.post('/:project/upload', upload.array('files', 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  const ws = req.app.locals.workspaceDir;
  const projectDir = path.resolve(ws, req.params.project);
  const uploaded = req.files.map((f) => path.relative(projectDir, f.path));
  auditLog('file', `UPLOAD ${uploaded.length} file(s) to ${req.params.project}: ${uploaded.join(', ')}`, req.ip);
  res.json({ ok: true, files: uploaded });
});

// ---------------------------------------------------------------------------
// GET /api/files/:project/download — download entire project as zip
// ---------------------------------------------------------------------------
router.get('/:project/download', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const projectDir = safePath(ws, req.params.project, '');
    if (!projectDir) return res.status(400).json({ error: 'Invalid project name' });
    if (!existsSync(projectDir)) return res.status(404).json({ error: 'Project not found' });

    const projectName = req.params.project;
    auditLog('file', `DOWNLOAD project ${projectName}`, req.ip);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${projectName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('[files] archive error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
    });
    archive.pipe(res);
    archive.directory(projectDir, projectName);
    await archive.finalize();
  } catch (e) {
    console.error('[files] download error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to download', message: e.message });
  }
});

export default router;
