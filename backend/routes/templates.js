import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', 'templates');

const router = Router();

// List templates
router.get('/', async (_req, res) => {
  try {
    if (!fs.existsSync(TEMPLATES_DIR)) {
      return res.json({ templates: [] });
    }
    const dirs = await fs.promises.readdir(TEMPLATES_DIR, { withFileTypes: true });
    const templates = dirs.filter(d => d.isDirectory()).map(d => d.name);
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create project from template
router.post('/create', async (req, res) => {
  try {
    const { name, template } = req.body;
    if (!name || !template) {
      return res.status(400).json({ error: 'name and template required' });
    }

    const sanitized = name.trim().replace(/[^a-zA-Z0-9_\-. ]/g, '');
    if (!sanitized) {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    const templateDir = path.join(TEMPLATES_DIR, template);
    if (!fs.existsSync(templateDir)) {
      return res.status(404).json({ error: `Template "${template}" not found` });
    }

    const workspaceDir = req.app.locals.workspaceDir;
    const destDir = path.join(workspaceDir, sanitized);
    if (fs.existsSync(destDir)) {
      return res.status(409).json({ error: 'Project already exists' });
    }

    await copyDir(templateDir, destDir);
    res.json({ success: true, name: sanitized, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

export default router;
