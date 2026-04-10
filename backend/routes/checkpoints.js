import { Router } from 'express';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { auditLog } from '../lib/sandbox.js';

const router = Router();

const DEFAULT_GIT_ENV = {
  GIT_AUTHOR_NAME: 'Josh IDE',
  GIT_AUTHOR_EMAIL: 'checkpoint@local.ide',
  GIT_COMMITTER_NAME: 'Josh IDE',
  GIT_COMMITTER_EMAIL: 'checkpoint@local.ide',
};

function runGit(projectDir, args, options = {}) {
  const { allowError = false, env, ...execOptions } = options;

  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: projectDir,
        timeout: 15000,
        env: { ...process.env, ...env },
        ...execOptions,
      },
      (error, stdout, stderr) => {
        if (error && !allowError) {
          reject(new Error((stderr || error.message || '').trim()));
          return;
        }

        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
        });
      },
    );
  });
}

function getProjectDir(req) {
  const workspaceDir = req.app.locals.workspaceDir;
  const project = req.params.project;

  if (!project || project.includes('..') || project.startsWith('/')) {
    return null;
  }

  const projectDir = path.resolve(workspaceDir, project);
  if (!projectDir.startsWith(path.resolve(workspaceDir))) {
    return null;
  }

  if (!existsSync(projectDir)) {
    return null;
  }

  return projectDir;
}

function isValidCommitHash(commitHash) {
  return /^[0-9a-f]{7,40}$/i.test(commitHash || '');
}

async function ensureRepository(projectDir) {
  const { stdout } = await runGit(projectDir, ['rev-parse', '--is-inside-work-tree'], { allowError: true });
  if (stdout.trim() === 'true') {
    return;
  }

  await runGit(projectDir, ['init']);
}

async function readCommitDetails(projectDir, ref) {
  const { stdout } = await runGit(projectDir, ['show', '-s', '--format=%H|%ct|%s', ref]);
  const [id, unixTimestamp, ...labelParts] = stdout.trim().split('|');

  return {
    id,
    label: labelParts.join('|'),
    timestamp: new Date(Number(unixTimestamp) * 1000).toISOString(),
  };
}

router.post('/:project/create', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const label = String(req.body?.label || '').trim();
    if (!label) {
      return res.status(400).json({ error: 'Checkpoint label is required' });
    }

    await ensureRepository(projectDir);
    await runGit(projectDir, ['add', '-A']);
    await runGit(projectDir, ['commit', '--allow-empty', '-m', label], { env: DEFAULT_GIT_ENV });

    const checkpoint = await readCommitDetails(projectDir, 'HEAD');

    auditLog('file', `CHECKPOINT CREATE "${label}" (project: ${req.params.project})`, req.ip);
    return res.json(checkpoint);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:project', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const repoState = await runGit(projectDir, ['rev-parse', '--is-inside-work-tree'], { allowError: true });
    if (repoState.stdout.trim() !== 'true') {
      return res.json({ checkpoints: [], initialized: false });
    }

    const { stdout } = await runGit(projectDir, ['log', '--oneline', '--format=%H|%ct|%s', '-50']);
    const checkpoints = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, unixTimestamp, ...labelParts] = line.split('|');
        return {
          id,
          shortId: id.slice(0, 7),
          label: labelParts.join('|'),
          timestamp: new Date(Number(unixTimestamp) * 1000).toISOString(),
        };
      });

    return res.json({ checkpoints, initialized: true });
  } catch (error) {
    if (error.message.includes('does not have any commits')) {
      return res.json({ checkpoints: [], initialized: true });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.post('/:project/restore/:commitHash', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { commitHash } = req.params;
    if (!isValidCommitHash(commitHash)) {
      return res.status(400).json({ error: 'Invalid commit hash' });
    }

    await runGit(projectDir, ['checkout', '--force', commitHash]);
    const checkpoint = await readCommitDetails(projectDir, 'HEAD');

    auditLog('file', `CHECKPOINT RESTORE ${commitHash} (project: ${req.params.project})`, req.ip);
    return res.json({ ok: true, ...checkpoint });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:project/preview/:commitHash', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { commitHash } = req.params;
    if (!isValidCommitHash(commitHash)) {
      return res.status(400).json({ error: 'Invalid commit hash' });
    }

    const [{ stdout: preview }, { stdout: filesOut }] = await Promise.all([
      runGit(projectDir, ['show', '--stat', commitHash]),
      runGit(projectDir, ['diff-tree', '--no-commit-id', '--name-only', '-r', commitHash]),
    ]);
    const checkpoint = await readCommitDetails(projectDir, commitHash);

    return res.json({
      ...checkpoint,
      preview,
      files: filesOut.trim().split('\n').filter(Boolean),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
