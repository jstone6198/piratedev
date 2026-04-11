import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

const SKIP_DIRS = new Set(['node_modules', '.git', '.storage']);
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.css',
  '.scss',
  '.env',
  '.md',
  '.py',
  '.rb',
  '.php',
  '.java',
  '.go',
  '.rs',
  '.sh',
  '.sql',
  '.yml',
  '.yaml',
]);
const MAX_FILE_SIZE = 1024 * 1024;

const secretPatterns = [
  /['"]sk[-_][a-zA-Z0-9]{20,}['"]/,
  /['"]AKIA[A-Z0-9]{16}['"]/,
  /password\s*[:=]\s*['"][^'"]+['"]/i,
];

function getWorkspace(req) {
  return path.resolve(req.app.locals.workspaceDir || path.resolve(process.cwd(), '..', 'workspace'));
}

async function resolveProjectDir(req) {
  const workspace = getWorkspace(req);
  const project = req.params.project;

  if (!project || project.includes('..') || path.isAbsolute(project)) {
    return null;
  }

  const projectDir = path.resolve(workspace, project);
  if (!projectDir.startsWith(workspace + path.sep) && projectDir !== workspace) {
    return null;
  }

  try {
    const stat = await fs.stat(projectDir);
    return stat.isDirectory() ? projectDir : null;
  } catch {
    return null;
  }
}

function toRelativeFile(projectDir, filePath) {
  return path.relative(projectDir, filePath).split(path.sep).join('/');
}

async function collectFiles(dir, projectDir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, projectDir, files);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    const stat = await fs.stat(fullPath);
    if (stat.size > MAX_FILE_SIZE || (ext && !TEXT_EXTENSIONS.has(ext))) continue;

    files.push({
      fullPath,
      file: toRelativeFile(projectDir, fullPath),
    });
  }

  return files;
}

function addFinding(findings, file, line, severity, category, message, suggestion) {
  findings.push({ file, line, severity, category, message, suggestion });
}

function lineHasSql(line) {
  return /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(line) && /\b(FROM|INTO|SET|WHERE|VALUES)\b/i.test(line);
}

function templateHasUserInput(line) {
  return /`/.test(line) && /\$\{\s*(req\.|request\.|ctx\.|params|query|body|user|input|.*(?:id|email|name|token).*)/i.test(line);
}

function scanLine(line, file, lineNumber, findings) {
  for (const pattern of secretPatterns) {
    if (pattern.test(line)) {
      addFinding(
        findings,
        file,
        lineNumber,
        'critical',
        'Hardcoded Secret',
        'Potential hardcoded credential found in source code.',
        'Move secrets into environment variables or the project secret store and rotate any exposed value.'
      );
      break;
    }
  }

  if (lineHasSql(line) && /\+/.test(line)) {
    addFinding(
      findings,
      file,
      lineNumber,
      'high',
      'SQL Injection',
      'SQL query appears to use string concatenation.',
      'Use parameterized queries or prepared statements instead of concatenating values into SQL.'
    );
  }

  if (lineHasSql(line) && templateHasUserInput(line)) {
    addFinding(
      findings,
      file,
      lineNumber,
      'high',
      'SQL Injection',
      'SQL template literal appears to interpolate user-controlled input.',
      'Use parameterized queries or prepared statements for all user-controlled values.'
    );
  }

  if (/\.innerHTML\s*=/.test(line) && !/(sanitize|DOMPurify)/i.test(line)) {
    addFinding(
      findings,
      file,
      lineNumber,
      'high',
      'XSS',
      'Direct innerHTML assignment found without obvious sanitization.',
      'Prefer textContent or sanitize trusted HTML with a vetted sanitizer before assignment.'
    );
  }

  if (/dangerouslySetInnerHTML/.test(line) && !/(sanitize|DOMPurify)/i.test(line)) {
    addFinding(
      findings,
      file,
      lineNumber,
      'high',
      'XSS',
      'dangerouslySetInnerHTML used without obvious sanitization.',
      'Sanitize HTML before rendering or replace this with escaped React content.'
    );
  }

  if (/\b(fetch|axios(?:\.\w+)?)\s*\([^)]*['"]http:\/\//.test(line)) {
    addFinding(
      findings,
      file,
      lineNumber,
      'medium',
      'Insecure HTTP',
      'Network request uses an insecure http:// URL.',
      'Use https:// for external requests to protect data in transit.'
    );
  }
}

async function checkEnvIgnored(projectDir, findings) {
  const gitignorePath = path.join(projectDir, '.gitignore');

  try {
    const content = await fs.readFile(gitignorePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const ignoresEnv = lines.some((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && (trimmed === '.env' || trimmed === '*.env' || trimmed === '.env*');
    });

    if (!ignoresEnv) {
      addFinding(
        findings,
        '.gitignore',
        1,
        'medium',
        '.env in Git',
        '.gitignore does not appear to ignore .env files.',
        'Add .env or .env* to .gitignore before committing local configuration.'
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;

    addFinding(
      findings,
      '.gitignore',
      1,
      'medium',
      '.env in Git',
      'Project does not have a .gitignore file to exclude .env files.',
      'Create a .gitignore file and add .env or .env* before committing local configuration.'
    );
  }
}

async function scanProject(projectDir) {
  const files = await collectFiles(projectDir, projectDir);
  const findings = [];

  await checkEnvIgnored(projectDir, findings);

  for (const item of files) {
    let content = '';
    try {
      content = await fs.readFile(item.fullPath, 'utf-8');
    } catch {
      continue;
    }

    content.split(/\r?\n/).forEach((line, index) => {
      scanLine(line, item.file, index + 1, findings);
    });
  }

  return findings;
}

function runNpm(projectDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd: projectDir,
      env: process.env,
      shell: false,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function normalizeVia(via) {
  if (!Array.isArray(via)) return [];
  return via.map((item) => (typeof item === 'string' ? item : item?.title || item?.name)).filter(Boolean);
}

async function readPackageLock(projectDir) {
  try {
    const raw = await fs.readFile(path.join(projectDir, 'package-lock.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getInstalledVersion(vuln, packageLock) {
  const nodePath = Array.isArray(vuln.nodes) ? vuln.nodes[0] : null;
  if (nodePath && packageLock?.packages?.[nodePath]?.version) {
    return packageLock.packages[nodePath].version;
  }

  const rootPackage = packageLock?.packages?.[`node_modules/${vuln.name}`];
  if (rootPackage?.version) return rootPackage.version;

  return vuln.installedVersion || vuln.version || '';
}

function normalizeAudit(data, packageLock) {
  const vulnerabilities = Object.entries(data.vulnerabilities || {}).map(([name, vuln]) => ({
    name,
    severity: vuln.severity || 'low',
    via: normalizeVia(vuln.via),
    fixAvailable: Boolean(vuln.fixAvailable),
    range: vuln.range || '',
    installedVersion: getInstalledVersion({ ...vuln, name }, packageLock),
  }));
  const metadata = data.metadata?.vulnerabilities || {};
  const summary = {
    critical: Number(metadata.critical || 0),
    high: Number(metadata.high || 0),
    moderate: Number(metadata.moderate || 0),
    low: Number(metadata.low || 0),
    total: Number(metadata.total || vulnerabilities.length),
  };

  return { vulnerabilities, summary };
}

router.post('/:project/scan', async (req, res) => {
  try {
    const projectDir = await resolveProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const findings = await scanProject(projectDir);
    return res.json(findings);
  } catch (error) {
    return res.status(500).json({ error: 'Security scan failed', message: error.message });
  }
});

router.post('/:project/npm-audit', async (req, res) => {
  try {
    const projectDir = await resolveProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { stdout, stderr } = await runNpm(projectDir, ['audit', '--json']);
    const rawJson = stdout.trim() || stderr.trim();
    if (!rawJson) {
      return res.json({
        vulnerabilities: [],
        summary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
      });
    }

    const data = JSON.parse(rawJson);
    const packageLock = await readPackageLock(projectDir);
    return res.json(normalizeAudit(data, packageLock));
  } catch (error) {
    return res.status(500).json({ error: 'npm audit failed', message: error.message });
  }
});

router.post('/:project/npm-audit-fix', async (req, res) => {
  try {
    const projectDir = await resolveProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { stdout, stderr } = await runNpm(projectDir, ['audit', 'fix']);
    const output = (stdout + stderr).trim();
    const fixedMatch = output.match(/(?:fixed|removed|added|changed)\s+(\d+)/i);
    const fixed = fixedMatch ? Number(fixedMatch[1]) : 0;

    return res.json({ output, fixed });
  } catch (error) {
    return res.status(500).json({ error: 'npm audit fix failed', message: error.message });
  }
});

export default router;
