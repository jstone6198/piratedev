import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

const KEY_FILES = [
  { name: 'llm-keys', path: '/home/claude-runner/config/llm-keys.json' },
  { name: 'keys', path: '/home/claude-runner/config/keys.json' },
];

function mask(value) {
  if (typeof value !== 'string') return '***';
  if (value.length <= 4) return '***';
  return value.slice(0, 4) + '***';
}

function flattenKeys(obj, prefix = '') {
  const result = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      result.push(...flattenKeys(v, key));
    } else {
      result.push({ key, value: String(v), masked: mask(String(v)) });
    }
  }
  return result;
}

// List available keys (masked)
router.get('/keys', async (_req, res) => {
  try {
    const services = [];
    for (const kf of KEY_FILES) {
      try {
        const raw = await fs.promises.readFile(kf.path, 'utf-8');
        const data = JSON.parse(raw);
        services.push({
          name: kf.name,
          keys: flattenKeys(data),
        });
      } catch {
        // skip unreadable files
      }
    }
    res.json({ services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inject keys into project .env
router.post('/inject', async (req, res) => {
  try {
    const { project, keys } = req.body;
    if (!project || !keys || !Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'project and keys[] required' });
    }

    const workspaceDir = req.app.locals.workspaceDir;
    const projectDir = path.join(workspaceDir, project);
    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Resolve actual key values
    const allKeys = {};
    for (const kf of KEY_FILES) {
      try {
        const raw = await fs.promises.readFile(kf.path, 'utf-8');
        const data = JSON.parse(raw);
        for (const fk of flattenKeys(data)) {
          allKeys[fk.key] = fk.value;
        }
      } catch {
        // skip
      }
    }

    // Build .env content
    const envPath = path.join(projectDir, '.env');
    let existing = '';
    try {
      existing = await fs.promises.readFile(envPath, 'utf-8');
    } catch {
      // no existing .env
    }

    const lines = existing ? existing.split('\n') : [];
    for (const keyPath of keys) {
      const val = allKeys[keyPath];
      if (!val) continue;
      const envName = keyPath.replace(/\./g, '_').toUpperCase();
      // Remove existing line if present
      const idx = lines.findIndex(l => l.startsWith(envName + '='));
      if (idx >= 0) lines.splice(idx, 1);
      lines.push(`${envName}=${val}`);
    }

    await fs.promises.writeFile(envPath, lines.filter(l => l.trim()).join('\n') + '\n');
    res.json({ success: true, injected: keys.length, envFile: '.env' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
