import { Router } from 'express';
import {
  configureAgentOrchestrator,
  createJobFromPlan,
  executePlan,
  generatePlan,
  getJobStatus,
  loadPlan,
  savePlan,
} from '../services/agent-orchestrator.js';

const router = Router();

router.use((req, _res, next) => {
  configureAgentOrchestrator({
    io: req.app.locals.io,
    workspaceDir: req.app.locals.workspaceDir,
    plansDir: req.app.locals.plansDir,
  });
  next();
});

router.post('/plan', async (req, res) => {
  const { prompt, engine = 'codex', project = null } = req.body ?? {};
  if (!prompt?.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    const plan = await generatePlan(prompt, engine, {
      project,
      user: req.auth?.user?.username || req.auth?.type || 'anonymous',
      endpoint: '/api/agent/plan',
    });
    const persistedPlan = { ...plan, project };
    await savePlan(persistedPlan);
    res.json(persistedPlan);
  } catch (error) {
    console.error('[agent] plan generation failed:', error);
    res.status(500).json({
      error: 'Plan generation failed',
      message: error.message,
    });
  }
});

router.post('/execute', async (req, res) => {
  const { planId, plan: editedPlan, project = null } = req.body ?? {};
  if (!planId?.trim()) {
    return res.status(400).json({ error: 'planId is required' });
  }

  try {
    const savedPlan = await loadPlan(planId);
    const plan = editedPlan
      ? {
          ...savedPlan,
          ...editedPlan,
          id: savedPlan.id,
          project: project ?? editedPlan.project ?? savedPlan.project ?? null,
          steps: Array.isArray(editedPlan.steps) ? editedPlan.steps : savedPlan.steps,
        }
      : {
          ...savedPlan,
          project: project ?? savedPlan.project ?? null,
        };

    await savePlan(plan);

    const job = createJobFromPlan(plan);
    res.json({ jobId: job.jobId, planId: plan.id, status: job.status });

    executePlan(plan, job.jobId).catch((error) => {
      console.error(`[agent] execution failed for job ${job.jobId}:`, error);
    });
  } catch (error) {
    console.error('[agent] execute failed:', error);
    res.status(500).json({
      error: 'Plan execution failed',
      message: error.message,
    });
  }
});

router.get('/status/:jobId', async (req, res) => {
  const job = getJobStatus(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

export default router;
