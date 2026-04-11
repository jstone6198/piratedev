import { Router } from 'express';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { auditLog } from '../lib/sandbox.js';

const router = Router();

const DEFAULT_GIT_ENV = {
  GIT_AUTHOR_NAME: 'PirateDev',
  GIT_AUTHOR_EMAIL: 'checkpoint@local.ide',
  GIT_COMMITTER_NAME: 'PirateDev',
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

function isSafeGitPath(filePath) {
  if (!filePath || filePath.startsWith('/') || filePath.includes('\\')) {
    return false;
  }

  return !filePath.split('/').some((part) => part === '..' || part === '');
}

function mapGitStatus(status) {
  const statusType = status?.[0];
  if (statusType === 'A') return 'added';
  if (statusType === 'D') return 'deleted';
  return 'modified';
}

function parseChangedFilesFromNameStatus(lines) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^[A-Z]\d*\t/.test(line))
    .map((line) => {
      const [rawStatus, ...fileParts] = line.split('\t');
      const filePath = fileParts[fileParts.length - 1] || '';
      return {
        path: filePath,
        status: mapGitStatus(rawStatus),
      };
    })
    .filter((file) => file.path);
}

function parseTimelineLog(stdout) {
  return stdout
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [headerLine, ...detailLines] = entry.split('\n');
      const [hash, timestamp, ...messageParts] = headerLine.split('\x1f');
      const changedFiles = parseChangedFilesFromNameStatus(detailLines);
      const shortStat = detailLines
        .map((line) => line.trim())
        .find((line) => /\d+ files? changed/.test(line) || /\d+ insertions?\(\+\)/.test(line) || /\d+ deletions?\(-\)/.test(line));

      return {
        hash,
        timestamp,
        message: messageParts.join('\x1f'),
        changedFiles,
        diffSummary: shortStat || `${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'} changed`,
      };
    });
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

router.get('/:project/timeline', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const repoState = await runGit(projectDir, ['rev-parse', '--is-inside-work-tree'], { allowError: true });
    if (repoState.stdout.trim() !== 'true') {
      return res.json({ timeline: [], initialized: false });
    }

    const { stdout } = await runGit(projectDir, [
      'log',
      '-100',
      '--date=iso-strict',
      '--format=%x1e%H%x1f%cI%x1f%s',
      '--name-status',
      '--shortstat',
    ]);

    return res.json({ timeline: parseTimelineLog(stdout), initialized: true });
  } catch (error) {
    if (error.message.includes('does not have any commits')) {
      return res.json({ timeline: [], initialized: true });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.get('/:project/diff/:hash1/:hash2', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { hash1, hash2 } = req.params;
    if (!isValidCommitHash(hash1) || !isValidCommitHash(hash2)) {
      return res.status(400).json({ error: 'Invalid commit hash' });
    }

    const filePath = typeof req.query?.path === 'string' ? req.query.path : '';
    if (filePath && !isSafeGitPath(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const diffArgs = ['diff', `${hash1}..${hash2}`];
    if (filePath) {
      diffArgs.push('--', filePath);
    }

    const { stdout } = await runGit(projectDir, diffArgs);
    return res.json({ diff: stdout });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:project/auto-checkpoint', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await ensureRepository(projectDir);
    const { stdout: statusOut } = await runGit(projectDir, ['status', '--porcelain']);
    const changedFileCount = statusOut.trim().split('\n').filter(Boolean).length;

    if (changedFileCount === 0) {
      return res.json({ created: false, message: 'No changes to checkpoint' });
    }

    const timestamp = new Date().toISOString();
    const label = `Auto: ${timestamp} - ${changedFileCount} files`;

    await runGit(projectDir, ['add', '-A']);
    await runGit(projectDir, ['commit', '-m', label], { env: DEFAULT_GIT_ENV });

    const checkpoint = await readCommitDetails(projectDir, 'HEAD');
    auditLog('file', `CHECKPOINT AUTO "${label}" (project: ${req.params.project})`, req.ip);
    return res.json({ created: true, changedFileCount, ...checkpoint });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:project/file-at/:hash/*', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { hash } = req.params;
    const filePath = req.params[0];
    if (!isValidCommitHash(hash)) {
      return res.status(400).json({ error: 'Invalid commit hash' });
    }

    if (!isSafeGitPath(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const { stdout } = await runGit(projectDir, ['show', `${hash}:${filePath}`]);
    return res.json({ path: filePath, hash, content: stdout });
  } catch (error) {
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

    const branch = `restore-${Date.now()}`;
    await runGit(projectDir, ['checkout', '-B', branch, commitHash]);

    auditLog('file', `CHECKPOINT RESTORE ${commitHash} (project: ${req.params.project})`, req.ip);
    return res.json({ restored: true, branch, commitHash });
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
