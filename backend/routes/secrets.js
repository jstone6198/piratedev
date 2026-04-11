import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import crypto from 'crypto';

const IDE_SECRET_PATH = '/home/claude-runner/config/ide-secret.txt';

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

async function getIdeKey() {
  if (process.env.IDE_KEY) return process.env.IDE_KEY;
  return (await fs.readFile(IDE_SECRET_PATH, 'utf-8')).trim();
}

async function deriveKey(project) {
  const ideKey = await getIdeKey();
  return crypto.createHash('sha256').update(`${ideKey}:${project}`).digest();
}

async function readVault(projectDir, project) {
  const vaultPath = path.join(projectDir, '.secrets.enc');

  try {
    const envelope = JSON.parse(await fs.readFile(vaultPath, 'utf-8'));
    const key = await deriveKey(project);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf-8');

    return JSON.parse(decrypted);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeVault(projectDir, project, secrets) {
  const vaultPath = path.join(projectDir, '.secrets.enc');
  const key = await deriveKey(project);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(secrets), 'utf-8'),
    cipher.final(),
  ]);

  const envelope = {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };

  await fs.writeFile(vaultPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf-8');
}

function serializeEnv(secrets) {
  return Object.entries(secrets)
    .map(([key, value]) => `${key}=${String(value).replace(/\n/g, '\\n')}`)
    .join('\n');
}

export default function secretRoutes(app, context = {}) {
  void spawn;

  app.get('/api/secrets/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const secrets = await readVault(projectDir, req.params.project);
      res.json({ keys: Object.keys(secrets) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/secrets/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const key = String(req.body?.key || '').trim();
      const value = req.body?.value;
      if (!key || value === undefined) return res.status(400).json({ error: 'key and value are required' });
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return res.status(400).json({ error: 'Invalid key' });

      const secrets = await readVault(projectDir, req.params.project);
      secrets[key] = String(value);
      await writeVault(projectDir, req.params.project, secrets);

      res.json({ ok: true, key });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/secrets/:project/:key', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const secrets = await readVault(projectDir, req.params.project);
      const existed = Object.prototype.hasOwnProperty.call(secrets, req.params.key);
      delete secrets[req.params.key];
      await writeVault(projectDir, req.params.project, secrets);

      res.json({ ok: true, key: req.params.key, removed: existed });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/secrets/:project/export', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const secrets = await readVault(projectDir, req.params.project);
      res.json({ secrets, env: serializeEnv(secrets) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
