import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

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

function resolveProjectFile(projectDir, requestedPath) {
  if (!requestedPath || path.isAbsolute(requestedPath)) return null;
  const filePath = path.resolve(projectDir, requestedPath);
  if (!filePath.startsWith(projectDir + path.sep) && filePath !== projectDir) return null;
  return {
    absolute: filePath,
    relative: path.relative(projectDir, filePath).replaceAll(path.sep, '/'),
  };
}

function runGit(projectDir, args, options = {}) {
  const { allowError = false } = options;
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: projectDir });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !allowError) return reject(new Error(stderr || stdout || `git exited with code ${code}`));
      resolve({ stdout, stderr, code });
    });
  });
}

async function gitShow(projectDir, spec) {
  const { stdout, code } = await runGit(projectDir, ['show', spec], { allowError: true });
  return code === 0 ? stdout : '';
}

async function readWorkingFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function extractFileContent(code = '') {
  // Try heredoc: cat <<'EOF' > file\ncontent\nEOF
  const heredocMatch = code.match(/cat\s+<<\s*['"]?(\w+)['"]?\s*>\s*\S+\n([\s\S]*?)\n\1/);
  if (heredocMatch) return heredocMatch[2];

  // Try echo/printf redirect
  const echoMatch = code.match(/(?:echo|printf)\s+['"]([^]*?)['"].*>/);
  if (echoMatch) return echoMatch[1];

  // Try tee: tee file <<'EOF'\ncontent\nEOF
  const teeMatch = code.match(/tee\s+\S+\s*<<\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\1/);
  if (teeMatch) return teeMatch[2];

  // If code itself looks like file content (no shell commands), return it
  if (!/^\s*(?:cat|echo|printf|tee|mkdir|cp|mv|rm|cd|chmod|bash|sh|npm|node|pip)\b/.test(code) && code.includes('\n') && code.length > 20) {
    return code;
  }

  return null;
}

function countLines(before, after) {
  const beforeLines = before ? before.split('\n') : [];
  const afterLines = after ? after.split('\n') : [];
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  let added = 0;
  let removed = 0;
  for (const line of afterLines) {
    if (!beforeSet.has(line)) added++;
  }
  for (const line of beforeLines) {
    if (!afterSet.has(line)) removed++;
  }
  return { addedLines: added, removedLines: removed };
}

export default function diffRoutes(app, context = {}) {
  app.get('/api/diff/status/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const { stdout } = await runGit(projectDir, ['status', '--porcelain']);
      const files = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => ({
          status: line.slice(0, 2),
          path: line.slice(3),
        }));

      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/diff/file/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const target = resolveProjectFile(projectDir, String(req.query.path || ''));
      if (!target) return res.status(400).json({ error: 'path is required' });

      const [original, modified, diffResult] = await Promise.all([
        gitShow(projectDir, `HEAD:${target.relative}`),
        readWorkingFile(target.absolute),
        runGit(projectDir, ['diff', '--', target.relative], { allowError: true }),
      ]);

      res.json({ original, modified, diff: diffResult.stdout });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/diff/staged/:project', async (req, res) => {
    try {
      const projectDir = await resolveProjectDir(app, context, req.params.project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const requestedPath = String(req.query.path || '').trim();
      if (!requestedPath) {
        const { stdout } = await runGit(projectDir, ['diff', '--cached'], { allowError: true });
        return res.json({ diff: stdout });
      }

      const target = resolveProjectFile(projectDir, requestedPath);
      if (!target) return res.status(400).json({ error: 'Invalid path' });

      const [original, modified, diffResult] = await Promise.all([
        gitShow(projectDir, `HEAD:${target.relative}`),
        gitShow(projectDir, `:${target.relative}`),
        runGit(projectDir, ['diff', '--cached', '--', target.relative], { allowError: true }),
      ]);

      res.json({ original, modified, diff: diffResult.stdout });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/diff/preview - Generate diffs for agent plan steps before applying
  app.post('/api/diff/preview', async (req, res) => {
    try {
      const { project, steps } = req.body;
      if (!project || !Array.isArray(steps)) {
        return res.status(400).json({ error: 'project and steps array are required' });
      }

      const projectDir = await resolveProjectDir(app, context, project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const diffs = [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step.type || !['edit_file', 'create_file', 'delete_file'].includes(step.type)) {
          continue;
        }

        const filePath = step.file;
        if (!filePath) continue;

        const target = resolveProjectFile(projectDir, filePath);
        if (!target) continue;

        const before = await readWorkingFile(target.absolute);
        let after = '';
        let type = 'edit';

        if (step.type === 'delete_file') {
          type = 'delete';
          after = '';
        } else if (step.type === 'create_file') {
          type = before ? 'edit' : 'create';
          after = extractFileContent(step.code || '') || step.code || '';
        } else {
          // edit_file
          type = 'edit';
          after = extractFileContent(step.code || '') || step.code || '';
        }

        const { addedLines, removedLines } = countLines(before, after);

        diffs.push({
          stepIndex: i,
          file: filePath,
          type,
          before,
          after,
          addedLines,
          removedLines,
        });
      }

      res.json({ diffs });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/diff/apply - Apply accepted steps from agent plan
  app.post('/api/diff/apply', async (req, res) => {
    try {
      const { project, steps, accepted } = req.body;
      if (!project || !Array.isArray(steps) || !Array.isArray(accepted)) {
        return res.status(400).json({ error: 'project, steps, and accepted array are required' });
      }

      const projectDir = await resolveProjectDir(app, context, project);
      if (!projectDir) return res.status(404).json({ error: 'Project not found' });

      const acceptedSet = new Set(accepted);
      const applied = [];
      const skipped = [];
      const errors = [];

      for (let i = 0; i < steps.length; i++) {
        if (!acceptedSet.has(i)) {
          skipped.push(i);
          continue;
        }

        const step = steps[i];
        try {
          if (step.type === 'edit_file' || step.type === 'create_file') {
            const filePath = step.file;
            if (!filePath) {
              errors.push({ stepIndex: i, error: 'No file path specified' });
              continue;
            }

            const target = resolveProjectFile(projectDir, filePath);
            if (!target) {
              errors.push({ stepIndex: i, error: 'Invalid file path' });
              continue;
            }

            const content = extractFileContent(step.code || '') || step.code || '';
            const dir = path.dirname(target.absolute);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(target.absolute, content, 'utf-8');
            applied.push(i);
          } else if (step.type === 'delete_file') {
            const target = resolveProjectFile(projectDir, step.file);
            if (target) {
              await fs.unlink(target.absolute).catch(() => {});
            }
            applied.push(i);
          } else if (step.type === 'command' || step.type === 'test') {
            const code = step.code || '';
            if (!code.trim()) {
              skipped.push(i);
              continue;
            }
            const result = await new Promise((resolve) => {
              const child = spawn('bash', ['-c', code], {
                cwd: projectDir,
                timeout: 30000,
                env: { ...process.env, HOME: process.env.HOME },
              });
              let stdout = '';
              let stderr = '';
              child.stdout.on('data', (d) => { stdout += d.toString(); });
              child.stderr.on('data', (d) => { stderr += d.toString(); });
              child.on('error', (err) => resolve({ ok: false, output: err.message }));
              child.on('close', (exitCode) => resolve({ ok: exitCode === 0, output: stdout + stderr }));
            });
            if (result.ok) {
              applied.push(i);
            } else {
              errors.push({ stepIndex: i, error: result.output || 'Command failed' });
            }
          } else {
            skipped.push(i);
          }
        } catch (stepErr) {
          errors.push({ stepIndex: i, error: stepErr.message });
        }
      }

      res.json({ applied, skipped, errors });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
