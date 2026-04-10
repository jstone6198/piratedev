import { execFile } from 'child_process';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', 'workspace', '_templates');

const TEMPLATE_DEFINITIONS = {
  'react-app': {
    name: 'react-app',
    title: 'React App',
    description: 'React + Vite starter with a minimal app shell.',
    icon: 'react',
  },
  'node-api': {
    name: 'node-api',
    title: 'Node API',
    description: 'Express API starter with route wiring and a server entrypoint.',
    icon: 'server',
  },
  'static-site': {
    name: 'static-site',
    title: 'Static Site',
    description: 'Vanilla HTML, CSS, and JavaScript for a fast static project.',
    icon: 'globe',
  },
  'python-flask': {
    name: 'python-flask',
    title: 'Python Flask',
    description: 'Flask starter with a rendered template and app bootstrap.',
    icon: 'flask',
  },
};

const router = Router();

router.get('/', async (req, res) => {
  try {
    const templatesDir = path.join(req.app.locals.workspaceDir, '_templates');

    if (!fs.existsSync(templatesDir)) {
      return res.json({ templates: [] });
    }

    const entries = await fs.promises.readdir(templatesDir, { withFileTypes: true });
    const templates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => TEMPLATE_DEFINITIONS[entry.name] || {
        name: entry.name,
        title: formatTitle(entry.name),
        description: 'Custom starter template.',
        icon: 'folder',
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:templateName/create', async (req, res) => {
  try {
    const { templateName } = req.params;
    const { projectName } = req.body ?? {};

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const sanitizedProjectName = sanitizeProjectName(projectName);
    if (!sanitizedProjectName) {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    const workspaceDir = req.app.locals.workspaceDir;
    const templatesDir = path.join(workspaceDir, '_templates');
    const templateDir = path.resolve(templatesDir, templateName);

    if (path.dirname(templateDir) !== templatesDir || !fs.existsSync(templateDir)) {
      return res.status(404).json({ error: `Template "${templateName}" not found` });
    }

    const destinationDir = path.resolve(workspaceDir, sanitizedProjectName);
    if (path.dirname(destinationDir) !== workspaceDir) {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    if (fs.existsSync(destinationDir)) {
      return res.status(409).json({ error: 'Project already exists' });
    }

    await copyDir(templateDir, destinationDir);
    await initializeGitRepo(destinationDir);

    res.status(201).json({
      ok: true,
      name: sanitizedProjectName,
      template: templateName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeProjectName(name) {
  const trimmed = String(name).trim();
  if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return '';
  }
  return trimmed;
}

function formatTitle(name) {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
      continue;
    }

    await fs.promises.copyFile(srcPath, destPath);
  }
}

async function initializeGitRepo(projectDir) {
  try {
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: projectDir });
  } catch {
    await execFileAsync('git', ['init'], { cwd: projectDir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: projectDir });
  }
}

export default router;
