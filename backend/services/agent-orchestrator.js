import { exec, execFile } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const DEFAULT_WORKSPACE_DIR = path.join(repoRoot, 'workspace');
const DEFAULT_PLANS_DIR = path.join(repoRoot, '.josh-ide', 'plans');

const jobs = new Map();

const runtime = {
  io: null,
  workspaceDir: DEFAULT_WORKSPACE_DIR,
  plansDir: DEFAULT_PLANS_DIR,
};

const PLAN_SYSTEM_PROMPT = `
You are an agent planning system for a code IDE.
Return ONLY valid JSON.

Create a plan object with this exact shape:
{
  "title": "short title",
  "steps": [
    {
      "description": "clear action summary",
      "code": "single shell command or short bash snippet to run for this step"
    }
  ]
}

Rules:
- No markdown fences.
- Steps must be sequential and executable.
- Use bash-compatible commands.
- Keep descriptions short and concrete.
- Prefer safe commands that work inside a project workspace.
- Do not include explanations outside the JSON object.
`.trim();

export function configureAgentOrchestrator({ io, workspaceDir, plansDir } = {}) {
  if (io) runtime.io = io;
  if (workspaceDir) runtime.workspaceDir = workspaceDir;
  if (plansDir) runtime.plansDir = plansDir;
}

export async function generatePlan(prompt, engine = 'codex') {
  if (!prompt?.trim()) {
    throw new Error('Prompt is required');
  }

  await ensurePlansDir();

  const fullPrompt = `${PLAN_SYSTEM_PROMPT}\n\nUser request:\n${prompt.trim()}`;
  const raw = engine === 'claude'
    ? await runClaude(fullPrompt, runtime.workspaceDir)
    : await runCodex(fullPrompt, runtime.workspaceDir);

  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('Planner did not return a valid steps array');
  }

  const planId = randomUUID();
  const plan = {
    id: planId,
    title: typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim()
      : prompt.trim().slice(0, 80),
    prompt: prompt.trim(),
    engine,
    project: null,
    createdAt: new Date().toISOString(),
    steps: parsed.steps.map((step, index) => ({
      id: String(step.id ?? index + 1),
      description: String(step.description ?? `Step ${index + 1}`).trim(),
      code: String(step.code ?? '').trim(),
      status: 'pending',
      output: '',
    })),
  };

  await savePlan(plan);
  return plan;
}

export async function savePlan(plan) {
  await ensurePlansDir();
  const planPath = getPlanPath(plan.id);
  await fs.promises.writeFile(planPath, JSON.stringify(plan, null, 2));
  return plan;
}

export async function loadPlan(planId) {
  const planPath = getPlanPath(planId);
  const raw = await fs.promises.readFile(planPath, 'utf8');
  return JSON.parse(raw);
}

export async function executePlan(plan, jobId) {
  if (!plan?.id) {
    throw new Error('Plan id is required');
  }

  const cwd = resolveExecutionDir(plan.project);
  await fs.promises.mkdir(cwd, { recursive: true });

  const startedAt = new Date().toISOString();
  const workingPlan = {
    ...plan,
    steps: (plan.steps || []).map((step, index) => ({
      id: String(step.id ?? index + 1),
      description: String(step.description ?? `Step ${index + 1}`),
      code: String(step.code ?? ''),
      status: 'pending',
      output: '',
    })),
    startedAt,
  };

  let job = createJobSnapshot(jobId, workingPlan, 'running');
  jobs.set(jobId, job);
  await persistJob(job);
  emitJobUpdate(job);

  for (let index = 0; index < workingPlan.steps.length; index += 1) {
    const step = workingPlan.steps[index];
    step.status = 'running';
    job = createJobSnapshot(jobId, workingPlan, 'running', index);
    jobs.set(jobId, job);
    await persistJob(job);
    emitJobUpdate(job);

    try {
      const output = await runShellCommand(step.code, cwd);
      step.output = output.trim();
      step.status = 'done';
      job = createJobSnapshot(jobId, workingPlan, 'running', index);
      jobs.set(jobId, job);
      await persistJob(job);
      emitJobUpdate(job);
    } catch (error) {
      step.output = error.message.trim();
      step.status = 'failed';
      job = createJobSnapshot(jobId, workingPlan, 'failed', index, error.message);
      jobs.set(jobId, job);
      await persistJob(job);
      emitJobUpdate(job);
      emitJobDone(job);
      throw error;
    }
  }

  job = createJobSnapshot(jobId, workingPlan, 'done', workingPlan.steps.length - 1);
  jobs.set(jobId, job);
  await savePlan({
    ...workingPlan,
    completedAt: new Date().toISOString(),
  });
  await persistJob(job);
  emitJobUpdate(job);
  emitJobDone(job);
  return job;
}

export function getJobStatus(jobId) {
  return jobs.get(jobId) ?? null;
}

export function createJobFromPlan(plan) {
  const jobId = randomUUID();
  const job = createJobSnapshot(jobId, plan, 'queued');
  jobs.set(jobId, job);
  return job;
}

async function ensurePlansDir() {
  await fs.promises.mkdir(runtime.plansDir, { recursive: true });
}

function getPlanPath(planId) {
  return path.join(runtime.plansDir, `plan-${planId}.json`);
}

function getJobPath(jobId) {
  return path.join(runtime.plansDir, `job-${jobId}.json`);
}

async function persistJob(job) {
  await ensurePlansDir();
  await fs.promises.writeFile(getJobPath(job.jobId), JSON.stringify(job, null, 2));
}

function resolveExecutionDir(project) {
  if (!project) {
    return runtime.workspaceDir;
  }
  return path.join(runtime.workspaceDir, project);
}

function createJobSnapshot(jobId, plan, status, activeStepIndex = -1, error = null) {
  const totalSteps = plan.steps.length;
  const completedSteps = plan.steps.filter((step) => step.status === 'done').length;
  const failedSteps = plan.steps.filter((step) => step.status === 'failed').length;

  return {
    jobId,
    planId: plan.id,
    title: plan.title,
    project: plan.project ?? null,
    status,
    error,
    activeStepId: activeStepIndex >= 0 ? plan.steps[activeStepIndex]?.id ?? null : null,
    completedSteps,
    failedSteps,
    totalSteps,
    progress: totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100),
    startedAt: plan.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: plan.steps.map((step) => ({
      id: step.id,
      description: step.description,
      code: step.code,
      status: step.status,
      output: step.output,
    })),
  };
}

function emitJobUpdate(job) {
  runtime.io?.emit('agent:job:update', job);
}

function emitJobDone(job) {
  runtime.io?.emit('agent:job:done', job);
}

function parseJsonObject(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      return JSON.parse(fencedMatch[1]);
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error('Unable to parse planner response as JSON');
  }
}

function runCodex(prompt, cwd) {
  const tmpFile = `/tmp/codex-plan-${randomUUID()}.txt`;
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color', 'never',
    '--dangerously-bypass-approvals-and-sandbox',
    '-C', cwd,
    '-o', tmpFile,
    prompt.trim(),
  ];

  return new Promise((resolve, reject) => {
    execFile('/usr/bin/codex', args, {
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, HOME: '/home/claude-runner' },
    }, (error) => {
      if (error && !fs.existsSync(tmpFile)) {
        reject(error);
        return;
      }

      try {
        const output = fs.readFileSync(tmpFile, 'utf8').trim();
        fs.unlinkSync(tmpFile);
        resolve(output || '{}');
      } catch (readError) {
        reject(readError);
      }
    });
  });
}

function runClaude(prompt, cwd) {
  const safePrompt = JSON.stringify(prompt.trim());
  const safeCwd = JSON.stringify(cwd);

  return new Promise((resolve, reject) => {
    exec(
      `cd ${safeCwd} && echo ${safePrompt} | claude -p --dangerously-skip-permissions --bare --model sonnet --no-session-persistence 2>/dev/null`,
      {
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, HOME: '/home/claude-runner' },
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim() || '{}');
      },
    );
  });
}

function runShellCommand(command, cwd) {
  const trimmed = command.trim();
  if (!trimmed) {
    return Promise.resolve('');
  }

  return new Promise((resolve, reject) => {
    exec(trimmed, {
      cwd,
      timeout: 5 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, HOME: '/home/claude-runner' },
      shell: '/bin/bash',
    }, (error, stdout, stderr) => {
      const combined = [stdout, stderr].filter(Boolean).join('');
      if (error) {
        reject(new Error(combined || error.message));
        return;
      }
      resolve(combined);
    });
  });
}
