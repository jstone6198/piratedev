/**
 * routes/context.js - Project context and PIRATEDEV.md endpoints
 * Location: /home/claude-runner/projects/josh-replit/backend/routes/context.js
 *
 * GET /:project - Returns PIRATEDEV.md content and basic project stats (file count, stack).
 * POST /:project/init - Creates a project directory and writes an initial PIRATEDEV.md.
 *
 * Mounted at /api/context by server.js. Uses services/context-indexer.js for project scanning.
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { indexProject } from '../services/context-indexer.js';

const router = Router();

router.get('/:project', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const project = req.params.project;
    if (!project || project.includes('..') || project.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid project' });
    }
    const projectDir = path.resolve(ws, project);
    if (!projectDir.startsWith(path.resolve(ws))) {
      return res.status(400).json({ error: 'Invalid project path' });
    }

    const piratedevPath = path.join(projectDir, 'PIRATEDEV.md');
    let content = '';
    if (fs.existsSync(piratedevPath)) {
      content = fs.readFileSync(piratedevPath, 'utf-8');
    }

    // Get basic stats
    let fileCount = 0;
    let stack = '';
    try {
      const ctx = await indexProject(projectDir);
      fileCount = ctx.fileTree.split(',').length;
      stack = ctx.stack;
    } catch {}

    res.json({ content, stats: { fileCount, stack } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:project/init', async (req, res) => {
  try {
    const ws = req.app.locals.workspaceDir;
    const project = req.params.project;
    if (!project || project.includes('..') || project.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid project' });
    }
    const projectDir = path.resolve(ws, project);
    if (!projectDir.startsWith(path.resolve(ws))) {
      return res.status(400).json({ error: 'Invalid project path' });
    }

    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const { content } = req.body;
    fs.writeFileSync(path.join(projectDir, 'PIRATEDEV.md'), content || '', 'utf-8');
    res.json({ created: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
