/**
 * routes/git.js - Git operation endpoints for the IDE
 * Location: /home/claude-runner/projects/piratedev/backend/routes/git.js
 *
 * Provides git status, init, commit, push, pull, log, and diff.
 * All operations are scoped to project directories within the workspace.
 *
 * Mounted at /api/git by server.js.
 */

import { Router } from 'express';
import { execFile } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import crypto from 'crypto';
import path from 'path';
import { auditLog } from '../lib/sandbox.js';

const router = Router();

function normalizeBranchName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.startsWith('-')) return '';
  return name;
}

function parseBranchList(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const current = line.startsWith('*');
      const name = line.replace(/^[* ]+\s*/, '');
      return { name, current, remote: name.startsWith('remotes/') };
    })
    .filter((branch, index, branches) => (
      branch.name &&
      branch.name !== 'HEAD' &&
      !branch.name.includes(' -> ') &&
      branches.findIndex((item) => item.name === branch.name) === index
    ));
}

async function getBranchState(projectDir) {
  const [{ stdout: branchStdout }, { stdout: currentStdout }] = await Promise.all([
    runGit(projectDir, ['branch', '-a', '--no-color']),
    runGit(projectDir, ['branch', '--show-current'], { allowError: true }),
  ]);

  const branches = parseBranchList(branchStdout);
  const currentBranch = currentStdout.trim() || branches.find((branch) => branch.current)?.name || '';
  return { branches, currentBranch };
}

/**
 * Run a git command in the project directory, return { stdout, stderr }.
 */
function runGit(projectDir, args, options = {}) {
  const { allowError, ...execOpts } = options;
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: projectDir, timeout: 15000, ...execOpts }, (err, stdout, stderr) => {
      if (err && !allowError) {
        return reject(new Error(stderr || err.message));
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/**
 * Resolve and validate the project directory path.
 */
function getProjectDir(req) {
  const ws = req.app.locals.workspaceDir;
  const project = req.params.project;
  if (!project || project.includes('..') || project.startsWith('/')) return null;
  const projectDir = path.resolve(ws, project);
  if (!projectDir.startsWith(path.resolve(ws))) return null;
  if (!existsSync(projectDir)) return null;
  return projectDir;
}

// ---------------------------------------------------------------------------
// POST /api/git/:project/clone
// Body: { repoUrl, token? }
// ---------------------------------------------------------------------------
router.post('/:project/clone', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const project = req.params.project;
    if (!project || project.includes('..') || project.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid project name' });
    }
    const projectDir = path.resolve(ws, project);
    if (!projectDir.startsWith(path.resolve(ws))) {
      return res.status(400).json({ error: 'Invalid project path' });
    }

    const { repoUrl, token } = req.body;
    if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

    let cloneUrl = repoUrl;
    if (token) {
      try {
        const urlObj = new URL(repoUrl);
        urlObj.username = token;
        cloneUrl = urlObj.toString();
      } catch {
        cloneUrl = repoUrl.replace('https://', `https://${token}@`);
      }
    }

    await new Promise((resolve, reject) => {
      execFile('git', ['clone', cloneUrl, projectDir], { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve({ stdout, stderr });
      });
    });

    auditLog('file', `GIT CLONE ${repoUrl} -> ${project}`, req.ip);
    res.json({ success: true, message: `Cloned ${repoUrl} into ${project}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/git/:project/status
// ---------------------------------------------------------------------------
router.get('/:project/status', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const [{ stdout }, { currentBranch }] = await Promise.all([
      runGit(projectDir, ['status', '--porcelain']),
      getBranchState(projectDir),
    ]);
    const files = stdout.trim().split('\n').filter(Boolean).map(line => {
      const status = line.substring(0, 2).trim();
      const file = line.substring(3);
      return { status, file };
    });

    auditLog('file', `GIT STATUS (project: ${req.params.project})`, req.ip);
    res.json({ files, branch: currentBranch });
  } catch (e) {
    if (e.message.includes('not a git repository')) {
      return res.json({ files: [], initialized: false, branch: '' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/git/:project/branches
// ---------------------------------------------------------------------------
router.get('/:project/branches', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { branches, currentBranch } = await getBranchState(projectDir);
    auditLog('file', `GIT BRANCH LIST (project: ${req.params.project})`, req.ip);
    res.json({ branches, currentBranch });
  } catch (e) {
    if (e.message.includes('not a git repository')) {
      return res.json({ branches: [], currentBranch: '', initialized: false });
    }
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/git/:project/init
// ---------------------------------------------------------------------------
router.post('/:project/init', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    await runGit(projectDir, ['init']);
    auditLog('file', `GIT INIT (project: ${req.params.project})`, req.ip);
    res.json({ ok: true, message: 'Git repository initialized' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/git/:project/commit
// Body: { message, files? }
// ---------------------------------------------------------------------------
router.post('/:project/commit', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { message, files } = req.body;
    if (!message) return res.status(400).json({ error: 'Commit message is required' });

    if (files && Array.isArray(files) && files.length > 0) {
      await runGit(projectDir, ['add', ...files]);
    } else {
      await runGit(projectDir, ['add', '-A']);
    }

    const { stdout } = await runGit(projectDir, ['commit', '-m', message]);
    auditLog('file', `GIT COMMIT "${message}" (project: ${req.params.project})`, req.ip);
    res.json({ ok: true, output: stdout.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/git/:project/push
// ---------------------------------------------------------------------------
router.post('/:project/push', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { stdout, stderr } = await runGit(projectDir, ['push'], { timeout: 30000, allowError: true });
    auditLog('file', `GIT PUSH (project: ${req.params.project})`, req.ip);
    res.json({ ok: true, output: (stdout + stderr).trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/git/:project/pull
// ---------------------------------------------------------------------------
router.post('/:project/pull', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { stdout, stderr } = await runGit(projectDir, ['pull'], { timeout: 30000, allowError: true });
    auditLog('file', `GIT PULL (project: ${req.params.project})`, req.ip);
    res.json({ ok: true, output: (stdout + stderr).trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/git/:project/branch
// Body: { name }
// ---------------------------------------------------------------------------
router.post('/:project/branch', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const name = normalizeBranchName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Branch name is required' });

    const { stdout, stderr } = await runGit(projectDir, ['checkout', '-b', name], { allowError: true });
    if (stderr.trim() && !stdout.trim()) {
      return res.status(400).json({ error: stderr.trim() });
    }
    const { currentBranch } = await getBranchState(projectDir);
    auditLog('file', `GIT CREATE BRANCH "${name}" (project: ${req.params.project})`, req.ip);
    res.json({ ok: true, output: (stdout + stderr).trim(), branch: currentBranch });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/git/:project/checkout
// Body: { branch }
// ---------------------------------------------------------------------------
router.post('/:project/checkout', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const branch = normalizeBranchName(req.body?.branch);
    if (!branch) return res.status(400).json({ error: 'Branch is required' });

    const { stdout, stderr } = await runGit(projectDir, ['checkout', branch], { allowError: true });
    if (stderr.trim() && !stdout.trim()) {
      return res.status(400).json({ error: stderr.trim() });
    }
    const { currentBranch } = await getBranchState(projectDir);
    auditLog('file', `GIT CHECKOUT "${branch}" (project: ${req.params.project})`, req.ip);
    res.json({ ok: true, output: (stdout + stderr).trim(), branch: currentBranch });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/git/:project/merge
// Body: { branch }
// ---------------------------------------------------------------------------
router.post('/:project/merge', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const branch = normalizeBranchName(req.body?.branch);
    if (!branch) return res.status(400).json({ error: 'Branch is required' });

    const { stdout, stderr } = await runGit(projectDir, ['merge', branch], { allowError: true, timeout: 30000 });
    if (stderr.trim() && !stdout.trim()) {
      return res.status(400).json({ error: stderr.trim() });
    }
    const { currentBranch } = await getBranchState(projectDir);
    auditLog('file', `GIT MERGE "${branch}" (project: ${req.params.project})`, req.ip);
    res.json({ ok: true, output: (stdout + stderr).trim(), branch: currentBranch });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/git/:project/log
// ---------------------------------------------------------------------------
router.get('/:project/log', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { stdout } = await runGit(projectDir, [
      'log', '--oneline', '--format=%H|%an|%ar|%s', '-20'
    ]);

    const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [hash, author, date, ...msgParts] = line.split('|');
      return { hash, author, date, message: msgParts.join('|') };
    });

    res.json({ commits });
  } catch (e) {
    if (e.message.includes('does not have any commits')) {
      return res.json({ commits: [] });
    }
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/git/:project/diff
// ---------------------------------------------------------------------------
router.get('/:project/diff', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { stdout } = await runGit(projectDir, ['diff'], { allowError: true });
    res.json({ diff: stdout });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GitHub Sync Config helpers
// Stored per-project in .piratedev/github-sync.json relative to workspace
// ---------------------------------------------------------------------------
function getSyncConfigPath(ws) {
  const dir = path.resolve(ws, '..', '.piratedev');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path.join(dir, 'github-sync.json');
}

function loadSyncConfig(ws) {
  const p = getSyncConfigPath(ws);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

function saveSyncConfig(ws, config) {
  writeFileSync(getSyncConfigPath(ws), JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// GET /api/git/:project/sync-config
// Returns current sync settings for this project
// ---------------------------------------------------------------------------
router.get('/:project/sync-config', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const config = loadSyncConfig(ws);
    const projectConfig = config[req.params.project] || {};
    res.json({
      enabled: projectConfig.enabled || false,
      webhookSecret: projectConfig.webhookSecret || '',
      lastSync: projectConfig.lastSync || null,
      autoSync: projectConfig.autoSync || false,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/git/:project/sync-config
// Body: { enabled, autoSync }
// Generates a webhook secret on first enable
// ---------------------------------------------------------------------------
router.post('/:project/sync-config', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const project = req.params.project;
    const config = loadSyncConfig(ws);
    const existing = config[project] || {};

    const enabled = req.body.enabled !== undefined ? Boolean(req.body.enabled) : existing.enabled || false;
    const autoSync = req.body.autoSync !== undefined ? Boolean(req.body.autoSync) : existing.autoSync || false;

    if (!existing.webhookSecret) {
      existing.webhookSecret = crypto.randomBytes(20).toString('hex');
    }

    config[project] = {
      ...existing,
      enabled,
      autoSync,
    };
    saveSyncConfig(ws, config);

    auditLog('file', `GIT SYNC CONFIG updated (project: ${project}, enabled: ${enabled})`, req.ip);
    res.json({
      enabled,
      autoSync,
      webhookSecret: existing.webhookSecret,
      lastSync: existing.lastSync || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/git/:project/remote
// Returns git remote info
// ---------------------------------------------------------------------------
router.get('/:project/remote', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { stdout } = await runGit(projectDir, ['remote', '-v'], { allowError: true });
    const remotes = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [name, url, type] = line.split(/\s+/);
      return { name, url: url?.replace(/\/\/[^@]+@/, '//***@'), type: type?.replace(/[()]/g, '') };
    });
    res.json({ remotes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/git/:project/remote
// Body: { url, token? }
// Sets the origin remote (add or set-url)
// ---------------------------------------------------------------------------
router.post('/:project/remote', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { url, token } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    let remoteUrl = url;
    if (token) {
      try {
        const urlObj = new URL(url);
        urlObj.username = token;
        remoteUrl = urlObj.toString();
      } catch {
        remoteUrl = url.replace('https://', `https://${token}@`);
      }
    }

    // Try set-url first, fall back to add
    try {
      await runGit(projectDir, ['remote', 'set-url', 'origin', remoteUrl]);
    } catch {
      await runGit(projectDir, ['remote', 'add', 'origin', remoteUrl]);
    }

    auditLog('file', `GIT REMOTE SET origin=${url} (project: ${req.params.project})`, req.ip);
    res.json({ ok: true, message: `Remote origin set to ${url}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Webhook handler - exported separately for pre-auth mounting
// POST /api/git/webhook/:project
// Verifies GitHub signature, runs git pull
// ---------------------------------------------------------------------------
export async function handleGitHubWebhook(req, res) {
  try {
    const project = req.params.project;
    const ws = req.app.locals.workspaceDir;
    if (!project || project.includes('..') || project.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid project' });
    }

    const projectDir = path.resolve(ws, project);
    if (!projectDir.startsWith(path.resolve(ws)) || !existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const config = loadSyncConfig(ws);
    const projectConfig = config[project];
    if (!projectConfig?.enabled) {
      return res.status(403).json({ error: 'Sync not enabled for this project' });
    }

    // Verify GitHub webhook signature
    const signature = req.headers['x-hub-signature-256'];
    if (projectConfig.webhookSecret && signature) {
      const hmac = crypto.createHmac('sha256', projectConfig.webhookSecret);
      const body = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body);
      hmac.update(body);
      const expected = `sha256=${hmac.digest('hex')}`;
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Only act on push events
    const event = req.headers['x-github-event'];
    if (event && event !== 'push' && event !== 'ping') {
      return res.json({ ok: true, action: 'ignored', event });
    }

    if (event === 'ping') {
      return res.json({ ok: true, action: 'pong' });
    }

    // Run git pull
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      execFile('git', ['pull'], { cwd: projectDir, timeout: 30000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      });
    });

    // Update last sync time
    config[project] = { ...projectConfig, lastSync: new Date().toISOString() };
    saveSyncConfig(ws, config);

    // Notify connected clients via socket.io
    const io = req.app.locals.io;
    if (io) {
      io.emit('git:sync', { project, action: 'pull', output: (stdout + stderr).trim() });
    }

    auditLog('file', `GIT WEBHOOK PULL (project: ${project})`, req.ip);
    res.json({ ok: true, action: 'pulled', output: (stdout + stderr).trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export default router;
