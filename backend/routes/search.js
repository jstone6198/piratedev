/**
 * routes/search.js - Project-wide search endpoint
 * Location: /home/claude-runner/projects/josh-replit/backend/routes/search.js
 *
 * Provides grep-based search across all files in a project workspace.
 * Excludes node_modules, .git, and binary files. Limited to 100 results.
 *
 * Mounted at /api/search by server.js.
 */

import { Router } from 'express';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const router = Router();

const MAX_RESULTS = 100;

/**
 * GET /api/search/:project?q=searchterm
 * Returns JSON array of { file, line, content } matches.
 */
router.get('/:project', (req, res) => {
  const ws = req.app.locals.workspaceDir;
  const project = req.params.project;
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  const projectDir = path.resolve(ws, project);
  if (!projectDir.startsWith(path.resolve(ws))) {
    return res.status(403).json({ error: 'Path traversal blocked' });
  }
  if (!existsSync(projectDir)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const args = [
    '-rn',                          // recursive, line numbers
    '--include=*',                   // all files
    '--exclude-dir=node_modules',
    '--exclude-dir=.git',
    '--exclude-dir=dist',
    '--exclude-dir=build',
    '-I',                            // skip binary files
    '-m', String(MAX_RESULTS),       // max matches per file
    '--',                            // end of options
    query,
    '.',
  ];

  execFile('grep', args, { cwd: projectDir, maxBuffer: 2 * 1024 * 1024, timeout: 10000 }, (err, stdout) => {
    // grep exits 1 when no matches found — that's not an error
    if (err && err.code !== 1) {
      console.error('[search] grep error:', err);
      return res.status(500).json({ error: 'Search failed', message: err.message });
    }

    if (!stdout.trim()) {
      return res.json([]);
    }

    const lines = stdout.trim().split('\n');
    const results = [];

    for (const line of lines) {
      if (results.length >= MAX_RESULTS) break;

      // grep -rn output format: ./path/to/file:lineNum:content
      const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
      if (match) {
        results.push({
          file: match[1],
          line: parseInt(match[2], 10),
          content: match[3],
        });
      }
    }

    res.json(results);
  });
});

export default router;
