import { Router } from 'express';
import fs from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import multer from 'multer';

const router = Router();
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const INLINE_MIME_PREFIXES = ['image/'];
const INLINE_MIME_TYPES = new Set(['application/pdf']);

const MIME_TYPES = {
  '.aac': 'audio/aac',
  '.avi': 'video/x-msvideo',
  '.avif': 'image/avif',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

function getProjectDir(req) {
  const workspaceDir = path.resolve(req.app.locals.workspaceDir || path.resolve(process.cwd(), '..', 'workspace'));
  const project = req.params.project;

  if (!project || project.includes('/') || project.includes('\\') || project.includes('..') || path.isAbsolute(project)) {
    return null;
  }

  const projectDir = path.resolve(workspaceDir, project);
  const relativeProjectDir = path.relative(workspaceDir, projectDir);
  if (relativeProjectDir.startsWith('..') || path.isAbsolute(relativeProjectDir) || !existsSync(projectDir)) {
    return null;
  }

  return projectDir;
}

function getStorageDir(projectDir) {
  return path.join(projectDir, '.storage');
}

function getSafeFilename(filename) {
  const baseName = path.basename(filename || '');
  if (!baseName || baseName === '.' || baseName === '..') {
    return null;
  }
  return baseName;
}

function getMimeType(filename, fallback = 'application/octet-stream') {
  return MIME_TYPES[path.extname(filename).toLowerCase()] || fallback;
}

function getFileUrl(req, filename) {
  return `/api/storage/${encodeURIComponent(req.params.project)}/file/${encodeURIComponent(filename)}`;
}

function isInlineMimeType(mimetype) {
  return INLINE_MIME_TYPES.has(mimetype) || INLINE_MIME_PREFIXES.some((prefix) => mimetype.startsWith(prefix));
}

function uniqueSuffix() {
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

function getFilePath(projectDir, filename) {
  const storageDir = getStorageDir(projectDir);
  const filePath = path.resolve(storageDir, filename);
  const relativeFilePath = path.relative(storageDir, filePath);

  if (relativeFilePath.startsWith('..') || path.isAbsolute(relativeFilePath)) {
    return null;
  }

  return filePath;
}

const upload = multer({
  limits: { fileSize: MAX_FILE_SIZE },
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const projectDir = getProjectDir(req);
        if (!projectDir) {
          cb(new Error('Project not found'));
          return;
        }

        const storageDir = getStorageDir(projectDir);
        await fs.mkdir(storageDir, { recursive: true });
        cb(null, storageDir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const originalName = getSafeFilename(file.originalname);
      if (!originalName) {
        cb(new Error('Invalid filename'));
        return;
      }

      const ext = path.extname(originalName).toLowerCase();
      const name = path.basename(originalName, ext).replace(/[^\w.-]+/g, '_') || 'file';
      cb(null, `${name}-${uniqueSuffix()}${ext}`);
    },
  }),
});

async function listStorageFiles(storageDir) {
  if (!existsSync(storageDir)) {
    return [];
  }

  const entries = await fs.readdir(storageDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(storageDir, entry.name);
        const stat = await fs.stat(filePath);
        return {
          name: entry.name,
          size: stat.size,
          mimetype: getMimeType(entry.name),
          created: stat.birthtime.toISOString(),
        };
      }),
  );

  return files.sort((a, b) => new Date(b.created) - new Date(a.created));
}

router.post('/:project/upload', (req, res) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: error.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    return res.status(201).json({
      filename: req.file.filename,
      size: req.file.size,
      url: getFileUrl(req, req.file.filename),
      mimetype: getMimeType(req.file.filename, req.file.mimetype),
    });
  });
});

router.get('/:project/files', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const storageDir = getStorageDir(projectDir);
    return res.json(await listStorageFiles(storageDir));
  } catch (error) {
    console.error('[storage] list error:', error);
    return res.status(500).json({ error: 'Failed to list files', message: error.message });
  }
});

router.get('/:project/file/:filename', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    const filename = getSafeFilename(req.params.filename);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (!filename) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = getFilePath(projectDir, filename);
    if (!filePath || !existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const mimetype = getMimeType(filename);
    res.setHeader('Content-Type', mimetype);
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Content-Disposition',
      `${isInlineMimeType(mimetype) ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename)}"`,
    );

    return createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('[storage] serve error:', error);
    return res.status(500).json({ error: 'Failed to serve file', message: error.message });
  }
});

router.delete('/:project/file/:filename', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    const filename = getSafeFilename(req.params.filename);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (!filename) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = getFilePath(projectDir, filename);
    if (!filePath || !existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    await fs.rm(filePath, { force: true });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[storage] delete error:', error);
    return res.status(500).json({ error: 'Failed to delete file', message: error.message });
  }
});

router.get('/:project/usage', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const files = await listStorageFiles(getStorageDir(projectDir));
    return res.json({
      totalSize: files.reduce((sum, file) => sum + file.size, 0),
      fileCount: files.length,
      files: files.map((file) => ({ name: file.name, size: file.size })),
    });
  } catch (error) {
    console.error('[storage] usage error:', error);
    return res.status(500).json({ error: 'Failed to load usage', message: error.message });
  }
});

export default router;
