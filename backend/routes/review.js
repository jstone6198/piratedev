import { Router } from 'express';
import { reviewPlan, reviewCode } from '../services/agent-orchestrator.js';

const router = Router();

// POST /api/review/plan — cross-provider plan review
router.post('/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan) return res.status(400).json({ error: 'plan is required' });
    const result = await reviewPlan(plan);
    res.json(result);
  } catch (err) {
    console.error('[review] plan review failed:', err.message);
    res.status(500).json({ error: 'Review failed', message: err.message });
  }
});

// POST /api/review/code — cross-provider code review
router.post('/code', async (req, res) => {
  try {
    const { diff, files } = req.body;
    if (!diff && !files) return res.status(400).json({ error: 'diff or files required' });
    const result = await reviewCode(diff || JSON.stringify(files));
    res.json(result);
  } catch (err) {
    console.error('[review] code review failed:', err.message);
    res.status(500).json({ error: 'Review failed', message: err.message });
  }
});

export default router;
