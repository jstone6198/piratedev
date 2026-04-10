import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();
const ALLOWED_ROOT = '/home/claude-runner/';

function validatePath(p) {
  if (!p) return null;
  const resolved = path.resolve(p);
  if (!resolved.startsWith(ALLOWED_ROOT)) return null;
  // Block sensitive dirs
  if (resolved.startsWith('/etc') || resolved.startsWith('/root')) return null;
  return resolved;
}

// Browse directory
router.get('/browse', async (req, res) => {
  try {
    const dirPath = validatePath(req.query.path || ALLOWED_ROOT);
    if (!dirPath) {
      return res.status(403).json({ error: 'Path not allowed' });
    }

    const stat = await fs.promises.stat(dirPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }

    const names = await fs.promises.readdir(dirPath);
    const entries = [];
    for (const name of names) {
      if (name.startsWith('.')) continue; // skip hidden
      try {
        const full = path.join(dirPath, name);
        const s = await fs.promises.stat(full);
        entries.push({
          name,
          type: s.isDirectory() ? 'dir' : 'file',
          size: s.size,
          modified: s.mtime.toISOString(),
        });
      } catch {
        // skip unreadable entries
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: dirPath, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read file
router.get('/read', async (req, res) => {
  try {
    const filePath = validatePath(req.query.path);
    if (!filePath) {
      return res.status(403).json({ error: 'Path not allowed' });
    }

    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot read a directory' });
    }
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (>2MB)' });
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    res.json({ content, size: stat.size, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
