/**
 * routes/execute.js - Code execution endpoints
 * Location: /home/claude-runner/projects/josh-replit/backend/routes/execute.js
 *
 * Runs user code in a child process. Auto-detects language from file extension.
 * Tracks running processes per project so old ones can be killed before starting new.
 * Compiled languages (C, C++, Rust) get a compile-then-run pipeline.
 *
 * Mounted at /api/execute by server.js.
 */

import { Router } from 'express';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { auditLog } from '../lib/sandbox.js';

const router = Router();

// Map of project name -> running child process
const runningProcesses = new Map();

// Language configuration keyed by file extension
const LANG_MAP = {
  '.js':  { cmd: 'node',    args: [] },
  '.mjs': { cmd: 'node',    args: [] },
  '.py':  { cmd: 'python3', args: [] },
  '.ts':  { cmd: 'npx',     args: ['tsx'] },
  '.sh':  { cmd: 'bash',    args: [] },
  '.rb':  { cmd: 'ruby',    args: [] },
  '.go':  { cmd: 'go',      args: ['run'] },
  '.rs':  { compile: true, compiler: 'rustc' },
  '.c':   { compile: true, compiler: 'gcc' },
  '.cpp': { compile: true, compiler: 'g++' },
};

/**
 * Kill any running process for a project and remove it from the map.
 */
function killExisting(project) {
  const proc = runningProcesses.get(project);
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    // Force kill after 2 seconds if still alive
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 2000);
  }
  runningProcesses.delete(project);
}

function ensurePackageJson(projectDir, project) {
  const packagePath = path.join(projectDir, 'package.json');
  if (existsSync(packagePath)) return;

  writeFileSync(
    packagePath,
    `${JSON.stringify({ name: project, version: '1.0.0', type: 'module' }, null, 2)}\n`,
    'utf-8'
  );
}

// ---------------------------------------------------------------------------
// GET /api/execute/languages — list supported languages
// ---------------------------------------------------------------------------
router.get('/languages', (_req, res) => {
  const languages = Object.entries(LANG_MAP).map(([ext, cfg]) => ({
    extension: ext,
    command: cfg.compile ? cfg.compiler : cfg.cmd,
    compiled: !!cfg.compile,
  }));
  res.json({ languages });
});

// ---------------------------------------------------------------------------
// POST /api/execute — run code
// Body: { project, file }
// ---------------------------------------------------------------------------
router.post('/', (req, res) => {
  const ws = req.app.locals.workspaceDir;
  const { project, file } = req.body;

  if (!project || !file) {
    return res.status(400).json({ error: 'project and file are required' });
  }

  const projectDir = path.resolve(ws, project);
  if (projectDir !== ws && !projectDir.startsWith(`${ws}${path.sep}`)) {
    auditLog('blocked', `Invalid project: ${project}`, req.ip);
    return res.status(403).json({ error: 'Invalid project' });
  }

  const filePath = path.resolve(projectDir, file);
  if (filePath !== projectDir && !filePath.startsWith(`${projectDir}${path.sep}`)) {
    auditLog('blocked', `Path traversal in execute: ${file} (project: ${project})`, req.ip);
    return res.status(403).json({ error: 'Path traversal blocked' });
  }
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const ext = path.extname(file).toLowerCase();
  const lang = LANG_MAP[ext];
  if (!lang) {
    return res.status(400).json({ error: `Unsupported file type: ${ext}` });
  }
  if (['.js', '.mjs', '.ts'].includes(ext)) {
    ensurePackageJson(projectDir, project);
  }

  // Kill any already-running process for this project
  killExisting(project);
  auditLog('execute', `RUN ${file} (project: ${project})`, req.ip);

  // Load project .env file into execution environment
  const execEnv = { ...process.env };
  const envFilePath = path.join(projectDir, '.env');
  if (existsSync(envFilePath)) {
    try {
      const envContent = readFileSync(envFilePath, 'utf-8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        let value = trimmed.substring(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        execEnv[key] = value;
      }
    } catch (_) { /* .env read failed, proceed without */ }
  }

  let output = '';
  let proc;

  if (lang.compile) {
    // Compiled languages: compile first, then run the binary
    const outBin = filePath.replace(/\.[^.]+$/, '');
    const compileCmd = `${lang.compiler} "${filePath}" -o "${outBin}" && "${outBin}"`;
    proc = spawn('bash', ['-c', compileCmd], {
      cwd: projectDir,
      timeout: 30000,
      env: execEnv,
    });
  } else {
    proc = spawn(lang.cmd, [...lang.args, path.relative(projectDir, filePath)], {
      cwd: projectDir,
      timeout: 30000,
      env: execEnv,
    });
  }

  runningProcesses.set(project, proc);

  proc.stdout.on('data', (data) => { output += data.toString(); });
  proc.stderr.on('data', (data) => { output += data.toString(); });

  proc.on('close', (code) => {
    runningProcesses.delete(project);
    // Response may already be sent if process was killed via /stop
    if (!res.headersSent) {
      res.json({ output, exitCode: code });
    }
  });

  proc.on('error', (err) => {
    runningProcesses.delete(project);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Execution failed', message: err.message });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/execute/stop — kill running process
// Body: { project }
// ---------------------------------------------------------------------------
router.post('/stop', (req, res) => {
  const { project } = req.body;
  if (!project) {
    return res.status(400).json({ error: 'project is required' });
  }

  if (runningProcesses.has(project)) {
    killExisting(project);
    res.json({ ok: true, message: 'Process killed' });
  } else {
    res.json({ ok: true, message: 'No running process' });
  }
});

export default router;
