/**
 * agent.js — REST routes for Agent Mode (plan + execute)
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { generatePlan, executePlan } from '../services/agent-orchestrator.js';

const router = Router();
const WORKSPACE = '/home/claude-runner/projects/josh-replit/workspace';

// Current execution state
let executionState = { status: 'idle', plan: null, project: null, results: [] };

/**
 * POST /api/agent/plan
 * Body: { prompt, engine }
 * Returns: { plan: [...steps] }
 */
router.post('/plan', async (req, res) => {
  const { prompt, engine = 'codex' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  try {
    const plan = await generatePlan(prompt, engine);
    res.json({ plan });
  } catch (err) {
    console.error('[agent] Plan generation failed:', err.message);
    res.status(500).json({ error: 'Plan generation failed', message: err.message });
  }
});

/**
 * POST /api/agent/execute
 * Body: { plan, project, engine, startFrom? }
 * Streams progress via socket events.
 */
router.post('/execute', async (req, res) => {
  const { plan, project, startFrom = 0 } = req.body;
  if (!plan || !Array.isArray(plan)) return res.status(400).json({ error: 'plan array is required' });
  if (!project) return res.status(400).json({ error: 'project is required' });

  const projectDir = path.join(WORKSPACE, project);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  // Slice plan if resuming from a specific step
  const stepsToRun = startFrom > 0 ? plan.slice(startFrom) : plan;

  // Get socket.io from app.locals
  const io = req.app.locals.io;
  // Find the first connected socket to emit to (agent events are broadcast)
  const sockets = await io.fetchSockets();
  const socket = sockets.length > 0 ? sockets[0] : null;

  executionState = { status: 'running', plan, project, results: [], startedAt: new Date().toISOString() };

  // Run async — respond immediately
  res.json({ status: 'started', steps: stepsToRun.length, startFrom });

  try {
    const { results, planFile } = await executePlan(stepsToRun, projectDir, socket);
    executionState = { status: 'complete', plan, project, results, planFile, completedAt: new Date().toISOString() };
  } catch (err) {
    executionState = { status: 'error', plan, project, error: err.message };
  }
});

/**
 * GET /api/agent/status
 * Returns current execution state.
 */
router.get('/status', (_req, res) => {
  res.json(executionState);
});

/**
 * GET /api/agent/plans/:project
 * List saved plans for a project.
 */
router.get('/plans/:project', async (req, res) => {
  const plansDir = path.join(WORKSPACE, req.params.project, '.josh-ide', 'plans');
  try {
    if (!fs.existsSync(plansDir)) return res.json({ plans: [] });
    const files = await fs.promises.readdir(plansDir);
    const plans = files.filter(f => f.endsWith('.json')).sort().reverse();
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
