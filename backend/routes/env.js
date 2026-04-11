/**
 * routes/env.js - Environment variable endpoints for the IDE
 * Location: /home/claude-runner/projects/piratedev/backend/routes/env.js
 *
 * Reads and writes .env files for projects.
 * GET responses include both raw and masked values for IDE-managed editing.
 *
 * Mounted at /api/env by server.js.
 */

import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { auditLog } from '../lib/sandbox.js';

const router = Router();

/**
 * Resolve and validate the project directory path.
 */
function getProjectDir(req) {
  const ws = req.app.locals.workspaceDir;
  const project = req.params.project;
  if (!project || project.includes('..') || project.startsWith('/')) return null;
  const projectDir = path.resolve(ws, project);
  if (!projectDir.startsWith(ws)) return null;
  if (!existsSync(projectDir)) return null;
  return projectDir;
}

/**
 * Parse a .env file into an array of { key, value } objects.
 * Preserves comments as { comment: line }.
 */
function parseEnv(content) {
  const vars = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let value = trimmed.substring(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars.push({ key, value });
  }
  return vars;
}

/**
 * Mask a value: show first 3 chars + ***
 */
function maskValue(value) {
  if (value.length <= 3) return '***';
  return value.substring(0, 3) + '***';
}

/**
 * Serialize key-value pairs back to .env format.
 */
function serializeEnv(vars) {
  return vars.map(({ key, value }) => `${key}=${value}`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// GET /api/env/:project — read .env, return values for editing
// ---------------------------------------------------------------------------
router.get('/:project', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const envPath = path.join(projectDir, '.env');
    if (!existsSync(envPath)) {
      return res.json({ vars: [] });
    }

    const content = await fs.readFile(envPath, 'utf-8');
    const vars = parseEnv(content).map(({ key, value }) => ({
      key,
      value,
      masked: maskValue(value),
    }));

    auditLog('file', `ENV READ (project: ${req.params.project})`, req.ip);
    res.json({ vars });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/env/:project — write .env from key-value pairs
// Body: { vars: [{ key, value }, ...] }
// ---------------------------------------------------------------------------
router.put('/:project', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { vars } = req.body;
    if (!Array.isArray(vars)) {
      return res.status(400).json({ error: 'vars must be an array of { key, value }' });
    }

    // Validate keys
    for (const { key } of vars) {
      if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return res.status(400).json({ error: `Invalid variable name: ${key}` });
      }
    }

    const envPath = path.join(projectDir, '.env');
    await fs.writeFile(envPath, serializeEnv(vars), 'utf-8');

    auditLog('file', `ENV WRITE ${vars.length} vars (project: ${req.params.project})`, req.ip);
    res.json({ ok: true, count: vars.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
