/**
 * services/context-indexer.js - Project context indexer for AI enrichment
 * Location: /home/claude-runner/projects/josh-replit/backend/services/context-indexer.js
 *
 * Recursively scans a project directory to build a context object containing
 * project name, stack, README, PIRATEDEV.md, key entry files, and file tree.
 * Used by routes/ai.js to enrich AI prompts with project context, and by
 * routes/context.js to serve project metadata to the frontend.
 */

import fs from 'fs';
import path from 'path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache', 'coverage']);
const ENTRY_FILES = ['index.js', 'app.js', 'server.js', 'main.py', 'App.jsx', 'src/App.jsx', 'src/index.js'];

function listFilesRecursive(dir, base = '') {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...listFilesRecursive(path.join(dir, entry.name), rel));
      } else {
        results.push(rel);
      }
    }
  } catch {}
  return results;
}

function readFileHead(filePath, lines = 40) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').slice(0, lines).join('\n');
  } catch {
    return null;
  }
}

export async function indexProject(projectDir) {
  const context = {
    name: '',
    stack: '',
    readme: '',
    piratedevMd: '',
    keyFiles: [],
    fileTree: '',
  };

  // PIRATEDEV.md
  const piratedevPath = path.join(projectDir, 'PIRATEDEV.md');
  if (fs.existsSync(piratedevPath)) {
    try { context.piratedevMd = fs.readFileSync(piratedevPath, 'utf-8'); } catch {}
  }

  // package.json
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      context.name = pkg.name || '';
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      context.stack = [...deps, ...devDeps].join(', ');
      if (pkg.description) context.name += ` - ${pkg.description}`;
    } catch {}
  }

  // README.md
  const readmePath = path.join(projectDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    context.readme = readFileHead(readmePath, 100) || '';
  }

  // Key entry files
  for (const entry of ENTRY_FILES) {
    const fullPath = path.join(projectDir, entry);
    if (fs.existsSync(fullPath)) {
      const preview = readFileHead(fullPath, 40);
      if (preview !== null) {
        context.keyFiles.push({ path: entry, preview });
      }
    }
  }

  // File tree
  const allFiles = listFilesRecursive(projectDir);
  context.fileTree = allFiles.join(', ');
  if (context.fileTree.length > 2000) {
    context.fileTree = context.fileTree.slice(0, 2000) + '...';
  }

  return context;
}

export function buildContextPrompt(context, userMessage) {
  const parts = [];
  parts.push(`Project: ${context.name || 'Unknown'} | Stack: ${context.stack || 'Unknown'}`);
  parts.push('');

  if (context.keyFiles.length > 0) {
    parts.push('Key files:');
    for (const kf of context.keyFiles) {
      parts.push(`--- ${kf.path} ---`);
      parts.push(kf.preview);
      parts.push('');
    }
  }

  if (context.fileTree) {
    parts.push(`All files: ${context.fileTree}`);
    parts.push('');
  }

  if (context.piratedevMd) {
    parts.push('Project instructions:');
    parts.push(context.piratedevMd);
    parts.push('');
  }

  parts.push(`User: ${userMessage}`);
  return parts.join('\n');
}
