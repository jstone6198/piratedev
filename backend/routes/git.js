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
import { existsSync } from 'fs';
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

export default router;
