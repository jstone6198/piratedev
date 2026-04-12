import { Router } from 'express';
import {
  cancelJob,
  configureAgentOrchestrator,
  createJobFromPlan,
  createPendingJob,
  executePlan,
  generatePlan,
  getAllJobs,
  getJobStatus,
  loadPlan,
  savePlan,
  updatePendingJob,
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

// Combined plan + execute — returns jobId immediately (202)
router.post('/run', async (req, res) => {
  const { prompt, engine = 'codex', project = null } = req.body ?? {};
  if (!prompt?.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const pendingJob = createPendingJob({ prompt, project });

  // Return immediately with the jobId
  res.status(202).json({
    jobId: pendingJob.jobId,
    status: 'queued',
    startedAt: pendingJob.startedAt,
  });

  // Run plan generation + execution in the background
  (async () => {
    try {
      updatePendingJob(pendingJob.jobId, { status: 'planning' });

      const plan = await generatePlan(prompt, engine, {
        project,
        user: req.auth?.user?.username || req.auth?.type || 'anonymous',
        endpoint: '/api/agent/run',
      });
      const persistedPlan = { ...plan, project };
      await savePlan(persistedPlan);

      updatePendingJob(pendingJob.jobId, {
        status: 'running',
        planId: plan.id,
        title: plan.title,
        totalSteps: plan.steps.length,
        steps: plan.steps,
      });

      const job = createJobFromPlan(persistedPlan);
      await executePlan(persistedPlan, job.jobId);
    } catch (error) {
      console.error('[agent] /run background task failed:', error);
      updatePendingJob(pendingJob.jobId, {
        status: 'error',
        error: error.message,
        completedAt: new Date().toISOString(),
      });
    }
  })();
});

// Generate plan only (existing)
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

// Execute a previously generated plan (existing — already async)
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

// List recent jobs (newest first)
router.get('/jobs', async (_req, res) => {
  const jobList = getAllJobs(20);
  res.json(jobList);
});

// Get single job status
router.get('/jobs/:jobId', async (req, res) => {
  const job = getJobStatus(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Cancel a running job
router.delete('/jobs/:jobId', async (req, res) => {
  const job = cancelJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Legacy status endpoint (keep for backwards compat)
router.get('/status/:jobId', async (req, res) => {
  const job = getJobStatus(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

export default router;
