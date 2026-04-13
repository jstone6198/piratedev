import { exec, execFile, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { appendUsageEntry, createUsageEntry } from './usage-tracker.js';
import { readVault } from './user-vault.js';
import { callLLM } from './llm-router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const DEFAULT_WORKSPACE_DIR = path.join(repoRoot, 'workspace');
const DEFAULT_PLANS_DIR = path.join(repoRoot, '.piratedev', 'plans');
const IDE_SECRET_PATH = '/home/claude-runner/config/ide-secret.txt';
const SERVER_PORT = process.env.PORT || 3220;
const STEP_TYPES = new Set(['command', 'create_file', 'edit_file', 'test']);

const jobs = new Map();
const activeJobContexts = new Map();
const retryBoundSockets = new WeakSet();

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
      "type": "command",
      "code": "single shell command or short bash snippet to run for this step",
      "file": "optional relative file path"
    }
  ]
}

Rules:
- No markdown fences.
- Steps must be sequential and executable.
- Supported step types: command, create_file, edit_file, test.
- Use type "test" only for commands that verify behavior and should exit 0.
- Use type "create_file" or "edit_file" when the step changes a file; include "file" when known.
- Use bash-compatible commands.
- Keep descriptions short and concrete.
- Prefer safe commands that work inside a project workspace.
- Do not include explanations outside the JSON object.
`.trim();

export function configureAgentOrchestrator({ io, workspaceDir, plansDir } = {}) {
  if (io) {
    runtime.io = io;
    bindRetrySocket(io);
  }
  if (workspaceDir) runtime.workspaceDir = workspaceDir;
  if (plansDir) runtime.plansDir = plansDir;
}

export async function generatePlan(prompt, engine = 'codex', options = {}) {
  if (!prompt?.trim()) {
    throw new Error('Prompt is required');
  }

  await ensurePlansDir();

  // Read PIRATEDEV.md for project context if available
  let projectContext = '';
  if (options.project) {
    try {
      const piratedevPath = path.join(runtime.workspaceDir, options.project, 'PIRATEDEV.md');
      projectContext = await fs.promises.readFile(piratedevPath, 'utf-8');
    } catch {
      // No PIRATEDEV.md — that's fine
    }
  }

  const contextBlock = projectContext
    ? `\nProject context from PIRATEDEV.md:\n${projectContext}\n\n`
    : '';
  const fullPrompt = `${PLAN_SYSTEM_PROMPT}${contextBlock}\nUser request:\n${prompt.trim()}`;

  // Check vault for agentProvider override
  let effectiveEngine = engine;
  let raw;
  try {
    const vault = await readVault('default');
    const agentProvider = vault?.agentProvider || 'codex';
    const providerConfig = vault?.llmProviders?.[agentProvider];

    if (agentProvider !== 'codex' && agentProvider !== 'claude-code' && providerConfig?.apiKey) {
      effectiveEngine = agentProvider;
      // Build message content — include screenshot for Anthropic providers
      let userContent = fullPrompt;
      if (options.screenshotBase64 && (agentProvider === 'anthropic')) {
        userContent = [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: options.screenshotBase64 } },
          { type: 'text', text: 'The screenshot above shows the current state of the running application. Use it to understand what the user is looking at when making your plan.\n\n' + fullPrompt },
        ];
      }
      raw = await callLLM({
        provider: agentProvider,
        model: providerConfig.model,
        apiKey: providerConfig.apiKey,
        messages: [{ role: 'user', content: userContent }],
        maxTokens: 4096,
        temperature: 0.3,
        baseUrl: providerConfig.baseUrl,
      });
    }
  } catch (err) {
    console.warn('[agent] vault read or LLM call failed, falling back to CLI:', err.message);
  }

  // Fall back to existing CLI logic if vault provider wasn't used
  if (!raw) {
    effectiveEngine = engine;
    raw = engine === 'claude'
      ? await runClaude(fullPrompt, runtime.workspaceDir)
      : await runCodex(fullPrompt, runtime.workspaceDir);
  }

  await appendUsageEntry(createUsageEntry({
    engine: effectiveEngine,
    endpoint: options.endpoint || '/api/agent/plan',
    prompt: fullPrompt,
    response: raw,
    project: options.project || null,
    user: options.user || null,
  }));

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
    engine: effectiveEngine,
    project: options.project || null,
    createdAt: new Date().toISOString(),
    steps: parsed.steps.map((step, index) => normalizeStep(step, index)),
  };

  await savePlan(plan);
  return plan;
}

export async function reviewPlan(plan, options = {}) {
  try {
    const vault = readVault('default');
    const reviewProvider = vault?.reviewProvider;
    if (!reviewProvider) {
      return { approved: true, suggestions: [], issues: [], reviewedBy: null };
    }
    const providerConfig = vault?.llmProviders?.[reviewProvider];
    if (!providerConfig?.apiKey) {
      return { approved: true, suggestions: [], issues: [], reviewedBy: null };
    }
    const raw = await callLLM({
      provider: reviewProvider,
      model: providerConfig.model,
      apiKey: providerConfig.apiKey,
      messages: [
        { role: 'system', content: 'You are a code review agent. Review the following execution plan for correctness, safety, and completeness. Return JSON: { approved: boolean, suggestions: string[], issues: string[] }' },
        { role: 'user', content: typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2) },
      ],
      maxTokens: 2048,
      temperature: 0.2,
      baseUrl: providerConfig.baseUrl,
    });
    const parsed = parseJsonObject(raw);
    return {
      approved: parsed.approved !== false,
      suggestions: parsed.suggestions || [],
      issues: parsed.issues || [],
      reviewedBy: reviewProvider,
    };
  } catch (err) {
    console.error('[agent] reviewPlan failed:', err.message);
    return { approved: true, suggestions: [], issues: [], reviewedBy: null, error: err.message };
  }
}

export async function reviewCode(diff, options = {}) {
  try {
    const vault = readVault('default');
    const reviewProvider = vault?.reviewProvider;
    if (!reviewProvider) {
      return { approved: true, comments: [], reviewedBy: null };
    }
    const providerConfig = vault?.llmProviders?.[reviewProvider];
    if (!providerConfig?.apiKey) {
      return { approved: true, comments: [], reviewedBy: null };
    }
    const raw = await callLLM({
      provider: reviewProvider,
      model: providerConfig.model,
      apiKey: providerConfig.apiKey,
      messages: [
        { role: 'system', content: 'You are a cross-provider code review agent. Review this code diff for bugs, security issues, and improvements. Return JSON: { approved: boolean, comments: [{ file: string, line: number, severity: "error"|"warning"|"info", message: string }] }' },
        { role: 'user', content: diff },
      ],
      maxTokens: 2048,
      temperature: 0.2,
      baseUrl: providerConfig.baseUrl,
    });
    const parsed = parseJsonObject(raw);
    return {
      approved: parsed.approved !== false,
      comments: parsed.comments || [],
      reviewedBy: reviewProvider,
    };
  } catch (err) {
    console.error('[agent] reviewCode failed:', err.message);
    return { approved: true, comments: [], reviewedBy: null, error: err.message };
  }
}

export async function savePlan(plan) {
  await ensurePlansDir();
  const normalizedPlan = {
    ...plan,
    steps: (plan.steps || []).map((step, index) => normalizeStep(step, index)),
    finalValidation: normalizeValidationSummary(plan.finalValidation),
  };
  const planPath = getPlanPath(normalizedPlan.id);
  await fs.promises.writeFile(planPath, JSON.stringify(normalizedPlan, null, 2));
  return normalizedPlan;
}

export async function loadPlan(planId) {
  const planPath = getPlanPath(planId);
  const raw = await fs.promises.readFile(planPath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    steps: (parsed.steps || []).map((step, index) => normalizeStep(step, index)),
    finalValidation: normalizeValidationSummary(parsed.finalValidation),
  };
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
      ...normalizeStep(step, index),
      status: 'draft',
      output: '',
      tests: [],
    })),
    finalValidation: null,
    startedAt,
  };

  let batches = null;
  try {
    batches = buildParallelBatches(workingPlan.steps);
  } catch (error) {
    console.warn('[agent] dependency analysis failed, falling back to sequential execution:', error);
    return executePlanSequential(plan, jobId);
  }

  let job = createJobSnapshot(jobId, workingPlan, 'running');
  const changedFiles = new Set();
  const modifiedDependencyFiles = new Set();

  const persistProgress = async (status = 'running', activeStepIndex = -1, error = null) => {
    job = createJobSnapshot(jobId, workingPlan, status, activeStepIndex, error);
    jobs.set(jobId, job);
    await persistJob(job);
    emitJobUpdate(job);
  };

  const context = {
    cwd,
    workingPlan,
    changedFiles,
    modifiedDependencyFiles,
    persistProgress,
    getJob: () => job,
    setJob: (nextJob) => {
      job = nextJob;
    },
  };

  activeJobContexts.set(jobId, context);
  jobs.set(jobId, job);
  await persistJob(job);
  emitJobUpdate(job);

  try {
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      emitBatchStart({
        jobId,
        batchIndex,
        stepIndexes: batch.map((stepIndex) => stepIndex),
      });

      const results = await Promise.allSettled(
        batch.map((stepIndex) => executeParallelStep({ jobId, stepIndex, context })),
      );

      const failedResult = results.find((result) => result.status === 'rejected');
      if (failedResult) {
        const message = failedResult.reason?.message || 'Step failed';
        await persistProgress('failed', batch[0] ?? -1, message);
        emitJobDone(job);
        throw failedResult.reason;
      }
    }

    const dependencyInstallStep = buildDependencyInstallStep({
      modifiedDependencyFiles: [...modifiedDependencyFiles],
      cwd,
      nextStepIndex: workingPlan.steps.length,
    });

    if (dependencyInstallStep) {
      workingPlan.steps.push({ ...dependencyInstallStep, status: 'draft', output: '', tests: [] });
      const installStepIndex = workingPlan.steps.length - 1;
      await executeParallelStep({ jobId, stepIndex: installStepIndex, context });
    }

    workingPlan.finalValidation = await runFinalValidation({
      cwd,
      project: workingPlan.project,
      engine: workingPlan.engine,
      changedFiles: [...changedFiles],
    });

    if (workingPlan.finalValidation.status === 'failed') {
      const message = buildValidationErrorMessage(workingPlan.finalValidation.results);
      await persistProgress('failed', workingPlan.steps.length - 1, message);
      emitJobDone(job);
      throw new Error(message);
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
  } finally {
    if (job?.status === 'done') {
      activeJobContexts.delete(jobId);
    }
  }
}

async function executePlanSequential(plan, jobId) {
  if (!plan?.id) {
    throw new Error('Plan id is required');
  }

  const cwd = resolveExecutionDir(plan.project);
  await fs.promises.mkdir(cwd, { recursive: true });

  const startedAt = new Date().toISOString();
  const workingPlan = {
    ...plan,
    steps: (plan.steps || []).map((step, index) => normalizeStep(step, index)),
    finalValidation: null,
    startedAt,
  };

  let job = createJobSnapshot(jobId, workingPlan, 'running');
  jobs.set(jobId, job);
  await persistJob(job);
  emitJobUpdate(job);

  const persistProgress = async (status = 'running', activeStepIndex = -1, error = null) => {
    job = createJobSnapshot(jobId, workingPlan, status, activeStepIndex, error);
    jobs.set(jobId, job);
    await persistJob(job);
    emitJobUpdate(job);
  };

  const changedFiles = new Set();
  const modifiedDependencyFiles = new Set();

  for (let index = 0; index < workingPlan.steps.length; index += 1) {
    const step = workingPlan.steps[index];
    step.status = 'running';
    step.output = '';
    step.tests = [];
    await persistProgress('running', index);

    try {
      const snapshotBefore = shouldTrackFileChanges(step)
        ? await snapshotProjectFiles(cwd)
        : null;

      const output = step.type === 'test'
        ? ''
        : await runShellCommand(step.code, cwd);

      const snapshotAfter = snapshotBefore
        ? await snapshotProjectFiles(cwd)
        : null;

      const touchedFiles = dedupePaths([
        step.file,
        ...diffProjectFiles(snapshotBefore, snapshotAfter),
      ]);

      touchedFiles.forEach((file) => changedFiles.add(file));
      collectModifiedDependencyFiles(touchedFiles).forEach((file) => modifiedDependencyFiles.add(file));
      step.output = output.trim();

      const validationSummary = await runStepValidation({
        step,
        cwd,
        project: workingPlan.project,
        engine: workingPlan.engine,
        touchedFiles,
      });

      if (step.type === 'test') {
        const commandResult = validationSummary.results[0];
        step.output = commandResult?.output || '';
      }

      step.tests = validationSummary.results;
      if (validationSummary.status === 'failed') {
        const message = buildValidationErrorMessage(validationSummary.results);
        throw new Error(message);
      }

      if (step.type === 'create_file' || step.type === 'edit_file') {
        touchedFiles.forEach((filePath) => emitFileChanged(workingPlan.project, filePath));
      }

      step.status = 'done';
      await persistProgress('running', index);
    } catch (error) {
      step.output = [step.output, error.message].filter(Boolean).join('\n\n').trim();
      step.status = 'failed';
      await persistProgress('failed', index, error.message);
      emitJobDone(job);
      throw error;
    }
  }

  const dependencyInstallStep = buildDependencyInstallStep({
    modifiedDependencyFiles: [...modifiedDependencyFiles],
    cwd,
    nextStepIndex: workingPlan.steps.length,
  });

  if (dependencyInstallStep) {
    workingPlan.steps.push(dependencyInstallStep);
    const installStepIndex = workingPlan.steps.length - 1;
    dependencyInstallStep.status = 'running';
    await persistProgress('running', installStepIndex);

    try {
      const snapshotBeforeInstall = await snapshotProjectFiles(cwd);
      const installResult = await runDependencyInstall(dependencyInstallStep, cwd);
      const snapshotAfterInstall = await snapshotProjectFiles(cwd);
      const touchedFiles = diffProjectFiles(snapshotBeforeInstall, snapshotAfterInstall);

      touchedFiles.forEach((file) => changedFiles.add(file));
      touchedFiles.forEach((filePath) => emitFileChanged(workingPlan.project, filePath));

      dependencyInstallStep.output = installResult.output;
      dependencyInstallStep.tests = [installResult.result];
      dependencyInstallStep.status = 'done';
      await persistProgress('running', installStepIndex);
    } catch (error) {
      dependencyInstallStep.output = [dependencyInstallStep.output, error.message].filter(Boolean).join('\n\n').trim();
      dependencyInstallStep.tests = [buildDependencyInstallResult({
        command: dependencyInstallStep.code,
        status: 'failed',
        output: error.output || error.message,
      })];
      dependencyInstallStep.status = 'failed';
      await persistProgress('failed', installStepIndex, error.message);
      emitJobDone(job);
      throw error;
    }
  }

  workingPlan.finalValidation = await runFinalValidation({
    cwd,
    project: workingPlan.project,
    engine: workingPlan.engine,
    changedFiles: [...changedFiles],
  });

  if (workingPlan.finalValidation.status === 'failed') {
    const message = buildValidationErrorMessage(workingPlan.finalValidation.results);
    await persistProgress('failed', workingPlan.steps.length - 1, message);
    emitJobDone(job);
    throw new Error(message);
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

export function getAllJobs(limit = 20) {
  return [...jobs.values()]
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, limit);
}

export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
    return job;
  }

  const context = activeJobContexts.get(jobId);
  if (context) {
    const { workingPlan } = context;
    for (const step of workingPlan.steps) {
      if (step.status === 'running' || step.status === 'active') {
        step.status = 'failed';
        step.error = 'Cancelled by user';
      }
    }
    activeJobContexts.delete(jobId);
  }

  job.status = 'cancelled';
  job.error = 'Cancelled by user';
  job.updatedAt = new Date().toISOString();
  job.completedAt = new Date().toISOString();
  jobs.set(jobId, job);
  emitJobUpdate(job);
  emitJobDone(job);
  return job;
}

export function createPendingJob({ prompt, project }) {
  const jobId = randomUUID();
  const job = {
    jobId,
    planId: null,
    title: prompt.trim().slice(0, 80),
    project: project ?? null,
    status: 'queued',
    error: null,
    activeStepId: null,
    completedSteps: 0,
    failedSteps: 0,
    totalSteps: 0,
    progress: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finalValidation: null,
    steps: [],
  };
  jobs.set(jobId, job);
  emitJobUpdate(job);
  return job;
}

export function updatePendingJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  jobs.set(jobId, job);
  emitJobUpdate(job);
  return job;
}

export function createJobFromPlan(plan) {
  const normalizedPlan = {
    ...plan,
    steps: (plan.steps || []).map((step, index) => ({
      ...normalizeStep(step, index),
      status: 'pending',
    })),
    finalValidation: normalizeValidationSummary(plan.finalValidation),
  };
  const jobId = randomUUID();
  const job = createJobSnapshot(jobId, normalizedPlan, 'queued');
  jobs.set(jobId, job);
  return job;
}

function bindRetrySocket(io) {
  if (!io || retryBoundSockets.has(io)) {
    return;
  }

  retryBoundSockets.add(io);
  io.on('connection', (socket) => {
    socket.on('agent:retry-step', async (payload = {}) => {
      const jobId = String(payload.jobId || '');
      const stepIndex = Number(payload.stepIndex);
      const context = activeJobContexts.get(jobId);

      if (!context || !Number.isInteger(stepIndex)) {
        socket.emit('agent:step-update', {
          jobId,
          stepIndex,
          status: 'failed',
          output: '',
          error: 'Job or step is no longer available for retry.',
          elapsed: 0,
        });
        return;
      }

      try {
        await executeParallelStep({ jobId, stepIndex, context, retry: true });
        await completeRetriedJobIfReady(jobId, context, stepIndex);
      } catch (error) {
        console.error(`[agent] retry failed for job ${jobId} step ${stepIndex}:`, error);
      }
    });
  });
}

function buildParallelBatches(steps) {
  if (!Array.isArray(steps)) {
    throw new Error('Plan steps must be an array');
  }

  const batches = [];
  const batchFiles = [];

  steps.forEach((step, stepIndex) => {
    const files = inferStepFiles(step, stepIndex);
    let placed = false;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      if (!setsOverlap(batchFiles[batchIndex], files)) {
        batches[batchIndex].push(stepIndex);
        files.forEach((file) => batchFiles[batchIndex].add(file));
        placed = true;
        break;
      }
    }

    if (!placed) {
      batches.push([stepIndex]);
      batchFiles.push(new Set(files));
    }
  });

  return batches;
}

function inferStepFiles(step, stepIndex) {
  const explicit = dedupePaths([step.file]);
  const fromCode = extractFileCandidatesFromCommand(step.code || '');
  const files = dedupePaths([...explicit, ...fromCode]);

  if (files.length > 0) {
    return new Set(files);
  }

  return new Set([`__independent_step_${stepIndex}`]);
}

function extractFileCandidatesFromCommand(code) {
  const matches = String(code || '').match(/(?:^|[\s"'=])([A-Za-z0-9_./-]+\.(?:js|jsx|ts|tsx|mjs|cjs|css|scss|sass|html|json|md|txt|py|yml|yaml|sh))(?=$|[\s"',;:])/g) || [];
  return matches.map((match) => match.replace(/^[\s"'=]+/, '').replace(/^\.\//, ''));
}

function setsOverlap(first, second) {
  for (const item of first) {
    if (second.has(item)) {
      return true;
    }
  }
  return false;
}

async function executeParallelStep({ jobId, stepIndex, context, retry = false }) {
  const { cwd, workingPlan, changedFiles, modifiedDependencyFiles, persistProgress } = context;
  const step = workingPlan.steps[stepIndex];
  if (!step) {
    throw new Error(`Step ${stepIndex + 1} not found`);
  }

  const startedAt = Date.now();
  step.status = 'active';
  step.output = retry ? '' : step.output || '';
  step.error = null;
  step.tests = [];
  emitStepUpdate({ jobId, stepIndex, step, status: 'active', elapsed: 0 });
  await persistProgress('running', stepIndex);

  try {
    const snapshotBefore = shouldTrackFileChanges(step)
      ? await snapshotProjectFiles(cwd)
      : null;

    const output = step.type === 'test'
      ? ''
      : await runShellCommand(step.code, cwd);

    const snapshotAfter = snapshotBefore
      ? await snapshotProjectFiles(cwd)
      : null;

    const touchedFiles = dedupePaths([
      step.file,
      ...diffProjectFiles(snapshotBefore, snapshotAfter),
    ]);

    touchedFiles.forEach((file) => changedFiles.add(file));
    collectModifiedDependencyFiles(touchedFiles).forEach((file) => modifiedDependencyFiles.add(file));
    step.output = output.trim();

    const validationSummary = await runStepValidation({
      step,
      cwd,
      project: workingPlan.project,
      engine: workingPlan.engine,
      touchedFiles,
    });

    if (step.type === 'test') {
      const commandResult = validationSummary.results[0];
      step.output = commandResult?.output || '';
    }

    step.tests = validationSummary.results;
    if (validationSummary.status === 'failed') {
      throw new Error(buildValidationErrorMessage(validationSummary.results));
    }

    if (step.type === 'create_file' || step.type === 'edit_file') {
      touchedFiles.forEach((filePath) => emitFileChanged(workingPlan.project, filePath));
    }

    step.status = 'done';
    const elapsed = Date.now() - startedAt;
    emitStepUpdate({ jobId, stepIndex, step, status: 'done', elapsed });
    await persistProgress('running', stepIndex);
    return step;
  } catch (error) {
    step.output = [step.output, error.message].filter(Boolean).join('\n\n').trim();
    step.error = error.message;
    step.status = 'failed';
    const elapsed = Date.now() - startedAt;
    emitStepUpdate({ jobId, stepIndex, step, status: 'failed', error: error.message, elapsed });
    await persistProgress('failed', stepIndex, error.message);
    throw error;
  }
}

async function completeRetriedJobIfReady(jobId, context, activeStepIndex) {
  const { cwd, workingPlan, changedFiles, persistProgress } = context;
  if (!workingPlan.steps.every((step) => step.status === 'done')) {
    return;
  }

  workingPlan.finalValidation = await runFinalValidation({
    cwd,
    project: workingPlan.project,
    engine: workingPlan.engine,
    changedFiles: [...changedFiles],
  });

  if (workingPlan.finalValidation.status === 'failed') {
    const message = buildValidationErrorMessage(workingPlan.finalValidation.results);
    await persistProgress('failed', activeStepIndex, message);
    emitJobDone(context.getJob());
    return;
  }

  const job = createJobSnapshot(jobId, workingPlan, 'done', activeStepIndex);
  context.setJob(job);
  jobs.set(jobId, job);
  await savePlan({
    ...workingPlan,
    completedAt: new Date().toISOString(),
  });
  await persistJob(job);
  emitJobUpdate(job);
  emitJobDone(job);
  activeJobContexts.delete(jobId);
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
    finalValidation: normalizeValidationSummary(plan.finalValidation),
    steps: plan.steps.map((step, index) => {
      const normalized = normalizeStep(step, index);
      return {
        id: normalized.id,
        description: normalized.description,
        type: normalized.type,
        file: normalized.file,
        code: normalized.code,
        status: normalized.status,
        output: normalized.output,
        tests: normalized.tests,
        error: normalized.error,
        elapsed: normalized.elapsed,
      };
    }),
  };
}

function emitJobUpdate(job) {
  runtime.io?.emit('agent:job:update', job);
}

function emitJobDone(job) {
  runtime.io?.emit('agent:job:done', job);
}

function emitStepUpdate({ jobId, stepIndex, step, status, output = step?.output || '', error = null, elapsed = step?.elapsed || 0 }) {
  if (step) {
    step.elapsed = elapsed;
    if (error) {
      step.error = error;
    }
  }

  runtime.io?.emit('agent:step-update', {
    jobId,
    stepIndex,
    status,
    output,
    error,
    elapsed,
  });
}

function emitBatchStart({ jobId, batchIndex, stepIndexes }) {
  runtime.io?.emit('agent:batch-start', {
    jobId,
    batchIndex,
    stepIndexes,
  });
}

function emitFileChanged(project, filePath) {
  const normalizedFilePath = normalizePathValue(filePath);
  if (!project || !normalizedFilePath) {
    return;
  }
  runtime.io?.emit('file:changed', { project, filePath: normalizedFilePath });
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
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color', 'never',
    '--dangerously-bypass-approvals-and-sandbox',
    '-C', cwd,
    prompt.trim(),
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/codex', args, {
      env: { ...process.env, HOME: '/home/claude-runner' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdin.end();
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Codex agent timed out after 120s')); }, 120000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const output = (stdout || '').trim();
      if (!output && code !== 0) {
        return reject(new Error(stderr || 'Codex exited with code ' + code));
      }
      resolve(output || '{}');
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
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
  return runShellCommandDetailed(command, cwd).then((result) => formatCommandResult(result));
}

function normalizeStep(step, index) {
  const code = String(step?.code ?? '').trim();
  const type = normalizeStepType(step?.type, code);
  return {
    id: String(step?.id ?? index + 1),
    description: String(step?.description ?? `Step ${index + 1}`).trim(),
    type,
    file: normalizePathValue(step?.file) || inferFileFromCommand(code),
    code,
    status: step?.status || 'pending',
    output: step?.output || '',
    error: step?.error || '',
    elapsed: Number(step?.elapsed || 0),
    tests: normalizeValidationResults(step?.tests),
  };
}

function normalizeStepType(type, code = '') {
  const normalized = String(type || '').trim().toLowerCase();
  if (STEP_TYPES.has(normalized)) {
    return normalized;
  }
  if (/\bcreate_file\b/.test(code)) {
    return 'create_file';
  }
  if (/\bedit_file\b/.test(code)) {
    return 'edit_file';
  }
  return 'command';
}

function normalizePathValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.trim().replace(/\\/g, '/');
}

function inferFileFromCommand(code) {
  const match = code.match(/\b(?:create_file|edit_file)\s+['"]?([^'"\s]+)['"]?/);
  return normalizePathValue(match?.[1] || null);
}

function normalizeValidationResults(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results.map((result, index) => ({
    id: String(result?.id ?? index + 1),
    name: String(result?.name ?? `Test ${index + 1}`),
    status: result?.status || 'pending',
    command: result?.command || '',
    file: normalizePathValue(result?.file),
    output: result?.output || '',
    attempts: Number(result?.attempts ?? 0),
    httpStatus: result?.httpStatus != null ? String(result.httpStatus) : '',
    responseSnippet: result?.responseSnippet || '',
  }));
}

function normalizeValidationSummary(summary) {
  if (!summary) {
    return null;
  }
  return {
    label: summary.label || 'Validation',
    status: summary.status || 'pending',
    results: normalizeValidationResults(summary.results),
  };
}

function shouldTrackFileChanges(step) {
  return step.type !== 'test';
}

function collectModifiedDependencyFiles(files) {
  return dedupePaths(files.filter((file) => {
    const normalized = normalizePathValue(file);
    if (!normalized) {
      return false;
    }

    return path.posix.basename(normalized) === 'package.json' || path.posix.basename(normalized) === 'requirements.txt';
  }));
}

function buildDependencyInstallStep({ modifiedDependencyFiles, cwd, nextStepIndex }) {
  const shouldRunNpmInstall = modifiedDependencyFiles.some((file) => path.posix.basename(file) === 'package.json');
  const shouldRunPipInstall = modifiedDependencyFiles.some((file) => path.posix.basename(file) === 'requirements.txt');

  if (!shouldRunNpmInstall && !shouldRunPipInstall) {
    return null;
  }

  const commands = [];
  if (shouldRunNpmInstall && fs.existsSync(path.join(cwd, 'package.json'))) {
    commands.push('npm install');
  }
  if (shouldRunPipInstall && fs.existsSync(path.join(cwd, 'requirements.txt'))) {
    commands.push('pip install -r requirements.txt');
  }

  if (commands.length === 0) {
    return null;
  }

  return normalizeStep({
    id: `dependency-install-${nextStepIndex + 1}`,
    description: 'Install updated dependencies',
    type: 'command',
    code: commands.join(' && '),
    file: modifiedDependencyFiles[0] || null,
  }, nextStepIndex);
}

async function snapshotProjectFiles(rootDir) {
  const snapshot = new Map();

  async function walk(currentDir) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.promises.stat(fullPath);
      snapshot.set(path.relative(rootDir, fullPath).replace(/\\/g, '/'), `${stat.mtimeMs}:${stat.size}`);
    }
  }

  await walk(rootDir);
  return snapshot;
}

function diffProjectFiles(before, after) {
  if (!before || !after) {
    return [];
  }

  const changed = [];
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const file of paths) {
    if (before.get(file) !== after.get(file)) {
      changed.push(file);
    }
  }
  return changed;
}

async function runStepValidation({ step, cwd, project, engine, touchedFiles }) {
  const validations = await buildValidationTasks({
    scope: step.type === 'test' ? 'step-test' : 'step',
    step,
    cwd,
    project,
    touchedFiles,
  });

  if (validations.length === 0) {
    return {
      status: 'passed',
      results: [],
    };
  }

  const results = [];
  for (const validation of validations) {
    const result = await executeValidationTask(validation, { cwd, engine });
    results.push(result);
    if (result.status === 'failed') {
      return { status: 'failed', results };
    }
  }

  return {
    status: results.some((result) => result.status === 'failed') ? 'failed' : 'passed',
    results,
  };
}

async function runFinalValidation({ cwd, project, engine, changedFiles }) {
  // Skip preview validation for static HTML projects (no package.json = no preview server)
  const hasPackageJson = project ? fs.existsSync(path.join(cwd, 'package.json')) : false;
  const validations = (project && hasPackageJson)
    ? [{
      id: 'final-preview',
      name: 'Final preview validation',
      kind: 'final-preview',
      command: `/api/preview/${project}/start`,
      files: dedupePaths(changedFiles),
      project,
    }]
    : [{
      id: 'final-preview',
      name: 'Final preview validation',
      kind: 'final-preview',
      command: '',
      files: [],
      project: null,
      skipReason: project
        ? 'Skipped: static project (no package.json) — no preview server needed.'
        : 'Skipped: no project selected for final preview validation.',
    }];

  if (validations.length === 0) {
    return {
      label: 'Final validation',
      status: 'skipped',
      results: [{
        id: 'final-1',
        name: 'No final validations applicable',
        status: 'skipped',
        command: '',
        file: null,
        output: 'No editable frontend or backend files were changed.',
        attempts: 0,
      }],
    };
  }

  // Give preview server time to start before validation
  if (validations.length > 0 && validations[0].kind === 'final-preview' && !validations[0].skipReason) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  const results = [];
  for (const validation of validations) {
    const result = await executeValidationTask(validation, { cwd, engine });
    results.push(result);
    if (result.status === 'failed') {
      return {
        label: 'Final validation',
        status: 'failed',
        results,
      };
    }
  }

  return {
    label: 'Final validation',
    status: results.every((result) => result.status === 'skipped') ? 'skipped' : 'passed',
    results,
  };
}

async function runDependencyInstall(step, cwd) {
  const result = await runShellCommandDetailed(step.code, cwd);
  return {
    output: formatCommandResult(result),
    result: buildDependencyInstallResult({
      command: step.code,
      status: 'passed',
      output: formatCommandResult(result),
    }),
  };
}

function buildDependencyInstallResult({ command, status, output }) {
  return {
    id: 'dependency_install',
    name: 'dependency_install',
    status,
    command,
    file: null,
    output: output || '',
    attempts: 1,
    httpStatus: '',
    responseSnippet: '',
  };
}

async function buildValidationTasks({ scope, step, cwd, project, touchedFiles }) {
  const files = dedupePaths(touchedFiles);
  const tasks = [];

  if (scope === 'step-test' && step) {
    tasks.push({
      id: `${step.id}-test-command`,
      name: step.description || `Test step ${step.id}`,
      kind: 'command',
      command: step.code,
      files: dedupePaths([step.file, ...files]),
      cwd,
    });
  }

  if (!step || !['create_file', 'edit_file'].includes(step.type)) {
    return tasks;
  }

  const frontendFiles = [];
  const backendFiles = [];
  const frontendRoots = new Set();

  for (const file of files) {
    const classification = await classifyFileForValidation(cwd, file);
    if (classification.kind === 'frontend') {
      frontendFiles.push(file);
      if (classification.rootDir) {
        frontendRoots.add(classification.rootDir);
      }
    } else if (classification.kind === 'node-backend') {
      backendFiles.push(file);
    }
  }

  if (frontendFiles.length > 0) {
    tasks.push({
      id: `${scope}-preview`,
      name: 'Preview server responds with HTTP 200',
      kind: 'preview',
      command: project ? `/api/preview/${project}/start` : '',
      files: frontendFiles,
      project,
      skipReason: project ? '' : 'Skipped: no project selected for preview startup.',
    });

    const frontendRoot = [...frontendRoots][0] || await detectFrontendBuildRoot(cwd);
    tasks.push({
      id: `${scope}-vite-build`,
      name: 'Vite build compiles successfully',
      kind: 'vite-build',
      command: 'npx vite build 2>&1',
      files: frontendFiles,
      cwd: frontendRoot || cwd,
      skipReason: frontendRoot ? '' : 'Skipped: no Vite frontend detected.',
    });
  }

  for (const file of backendFiles) {
    tasks.push({
      id: `${scope}-node-check-${file}`,
      name: `Node syntax check: ${file}`,
      kind: 'node-check',
      command: `node --check ${shellQuote(path.resolve(cwd, file))}`,
      files: [file],
      file,
      cwd,
    });
  }

  return tasks;
}

async function classifyFileForValidation(cwd, relativeFile) {
  const file = normalizePathValue(relativeFile);
  if (!file) {
    return { kind: 'other', rootDir: null };
  }

  const absoluteFile = path.resolve(cwd, file);
  const frontendRoot = await findPackageRoot(absoluteFile, cwd, (pkg) => hasViteSignals(pkg));
  if (frontendRoot) {
    return { kind: 'frontend', rootDir: frontendRoot };
  }

  if (/\.(js|mjs|cjs)$/.test(file)) {
    const backendRoot = await findPackageRoot(absoluteFile, cwd, (pkg) => !hasViteSignals(pkg));
    if (backendRoot || file.startsWith('backend/')) {
      return { kind: 'node-backend', rootDir: backendRoot };
    }
  }

  return { kind: 'other', rootDir: null };
}

async function detectFrontendBuildRoot(cwd) {
  const candidates = [path.join(cwd, 'frontend'), cwd];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(await fs.promises.readFile(path.join(candidate, 'package.json'), 'utf8'));
      if (hasViteSignals(pkg)) {
        return candidate;
      }
    } catch {
      // Ignore missing package.json files.
    }
  }
  return null;
}

function hasViteSignals(pkg) {
  const scripts = pkg?.scripts || {};
  const dependencies = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
  };

  return Boolean(
    dependencies.vite
    || dependencies.react
    || Object.values(scripts).some((value) => typeof value === 'string' && value.includes('vite')),
  );
}

async function findPackageRoot(startFile, rootDir, predicate) {
  let currentDir = path.dirname(startFile);
  const normalizedRoot = path.resolve(rootDir);

  while (currentDir.startsWith(normalizedRoot)) {
    const packagePath = path.join(currentDir, 'package.json');
    try {
      const pkg = JSON.parse(await fs.promises.readFile(packagePath, 'utf8'));
      if (predicate(pkg)) {
        return currentDir;
      }
    } catch {
      // Ignore missing or invalid package.json.
    }

    if (currentDir === normalizedRoot) {
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

async function executeValidationTask(task, context) {
  if (task.skipReason) {
    return {
      id: task.id,
      name: task.name,
      status: 'skipped',
      command: task.command || '',
      file: normalizePathValue(task.file),
      output: task.skipReason,
      attempts: 0,
      httpStatus: '',
      responseSnippet: '',
    };
  }

  let lastError = null;
  let lastResult = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    attempts = attempt;
    try {
      const outcome = await runValidationCommand(task);
      lastResult = outcome;
      return {
        id: task.id,
        name: task.name,
        status: 'passed',
        command: task.command || '',
        file: normalizePathValue(task.file),
        output: (outcome.output || '').trim(),
        attempts,
        httpStatus: outcome.httpStatus || '',
        responseSnippet: outcome.responseSnippet || '',
      };
    } catch (error) {
      lastError = error;
      lastResult = {
        output: error.output || error.message,
        httpStatus: error.httpStatus || '',
        responseSnippet: error.responseSnippet || '',
      };
      if (attempt === 4) {
        break;
      }

      const fixed = await attemptAiFix({
        task,
        cwd: context.cwd,
        engine: context.engine,
        errorOutput: [error.message, error.output].filter(Boolean).join('\n\n'),
      });

      if (!fixed) {
        break;
      }
    }
  }

  return {
    id: task.id,
    name: task.name,
    status: 'failed',
    command: task.command || '',
    file: normalizePathValue(task.file),
    output: [lastError?.message, lastError?.output].filter(Boolean).join('\n\n').trim() || 'Validation failed',
    attempts,
    httpStatus: lastResult?.httpStatus || '',
    responseSnippet: lastResult?.responseSnippet || '',
  };
}

async function runValidationCommand(task) {
  if (task.kind === 'preview') {
    const preview = await startPreviewServer(task.project);
    await waitForPreviewServer(task.project);
    const statusProbe = await runShellCommandDetailed(
      `curl -s -o /dev/null -w "%{http_code}" http://localhost:${preview.port}/`,
      repoRoot,
    );
    const statusCode = statusProbe.combined.trim();

    if (statusCode !== '200') {
      const error = new Error(`Preview returned HTTP ${statusCode}`);
      error.httpStatus = statusCode;
      error.output = formatCommandResult(statusProbe);
      throw error;
    }

    return {
      output: [
        `Preview ready on port ${preview.port} with HTTP 200.`,
        formatCommandResult(statusProbe),
      ].filter(Boolean).join('\n\n'),
      httpStatus: statusCode,
      responseSnippet: '',
    };
  }

  if (task.kind === 'final-preview') {
    const preview = await startPreviewServer(task.project);
    await waitForPreviewServer(task.project);
    const probe = await curlPreview(task.project, preview.port);
    if (probe.httpStatus !== '200') {
      const error = new Error(`Final preview returned HTTP ${probe.httpStatus}\n${probe.responseSnippet}`.trim());
      error.httpStatus = probe.httpStatus;
      error.responseSnippet = probe.responseSnippet;
      error.output = [
        `HTTP ${probe.httpStatus}`,
        probe.output,
        probe.responseSnippet,
      ].filter(Boolean).join('\n\n').trim();
      throw error;
    }
    return {
      output: [
        `HTTP ${probe.httpStatus}`,
        probe.output,
        probe.responseSnippet,
      ].filter(Boolean).join('\n\n').trim(),
      httpStatus: probe.httpStatus,
      responseSnippet: probe.responseSnippet,
    };
  }

  const output = await runShellCommand(task.command, task.cwd || repoRoot);
  return {
    output,
    httpStatus: '',
    responseSnippet: '',
  };
}

async function startPreviewServer(project) {
  if (!project) {
    throw new Error('Preview start requires a project');
  }

  const responseText = await runChildProcess('/usr/bin/curl', [
    '-sS',
    '-X',
    'POST',
    '-H',
    `x-ide-key: ${await getIdeKey()}`,
    `http://127.0.0.1:${SERVER_PORT}/api/preview/${encodeURIComponent(project)}/start`,
  ], repoRoot);

  let payload = null;
  try {
    payload = JSON.parse(responseText || '{}');
  } catch {
    throw new Error(responseText.trim() || 'Preview start returned invalid JSON');
  }

  if (!payload?.running || !payload?.port) {
    throw new Error(payload?.message || payload?.error || 'Preview start failed');
  }

  return payload;
}

async function waitForPreviewServer(project) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    const response = await internalApiRequest(`/api/preview/${encodeURIComponent(project)}/status`);
    if (response.ok) {
      const payload = await safeJson(response);
      if (payload?.running && payload?.port) {
        return payload;
      }
    }
    await sleep(1000);
  }

  throw new Error(`Preview server for ${project} did not become ready in time`);
}

async function internalApiRequest(pathname, options = {}) {
  const headers = {
    ...(options.headers || {}),
    'x-ide-key': await getIdeKey(),
    'content-type': options.body ? 'application/json' : undefined,
  };

  Object.keys(headers).forEach((key) => headers[key] === undefined && delete headers[key]);

  return fetch(`http://127.0.0.1:${SERVER_PORT}${pathname}`, {
    ...options,
    headers,
  });
}

let ideKeyCache = null;

async function getIdeKey() {
  if (ideKeyCache !== null) {
    return ideKeyCache;
  }
  ideKeyCache = (await fs.promises.readFile(IDE_SECRET_PATH, 'utf8')).trim();
  return ideKeyCache;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function curlPreview(project, port) {
  const responsePath = `/tmp/agent-preview-response-${randomUUID()}.txt`;
  try {
    const result = await runShellCommandDetailed(
      `curl -s -o ${shellQuote(responsePath)} -w "%{http_code}" http://localhost:${port}/`,
      repoRoot,
    );
    const httpStatus = result.combined.trim();
    let body = '';
    try {
      body = await fs.promises.readFile(responsePath, 'utf8');
    } catch {
      body = '';
    }

    return {
      project,
      httpStatus,
      output: formatCommandResult(result),
      responseSnippet: body.slice(0, 500),
    };
  } finally {
    await fs.promises.unlink(responsePath).catch(() => {});
  }
}

function runChildProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, HOME: '/home/claude-runner' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const combined = [stdout, stderr].filter(Boolean).join('');
      if (code !== 0) {
        const error = new Error(combined || `${command} exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.output = formatCommandStreams({ stdout, stderr });
        reject(error);
        return;
      }
      resolve(combined);
    });
  });
}

function formatCommandStreams({ stdout = '', stderr = '' }) {
  return [
    `stdout:\n${stdout.trim() || '(empty)'}`,
    `stderr:\n${stderr.trim() || '(empty)'}`,
  ].join('\n\n');
}

function formatCommandResult(result) {
  if (!result) {
    return '';
  }

  return formatCommandStreams({
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  });
}

async function runShellCommandDetailed(command, cwd) {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      stdout: '',
      stderr: '',
      combined: '',
    };
  }

  return new Promise((resolve, reject) => {
    exec(trimmed, {
      cwd,
      timeout: 5 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, HOME: '/home/claude-runner' },
      shell: '/bin/bash',
    }, (error, stdout, stderr) => {
      const result = {
        stdout,
        stderr,
        combined: [stdout, stderr].filter(Boolean).join(''),
      };

      if (error) {
        const wrappedError = new Error(result.combined || error.message);
        wrappedError.stdout = stdout;
        wrappedError.stderr = stderr;
        wrappedError.output = formatCommandResult(result);
        reject(wrappedError);
        return;
      }

      resolve(result);
    });
  });
}

async function attemptAiFix({ task, cwd, engine, errorOutput }) {
  const candidates = dedupePaths([
    task.file,
    ...(task.files || []),
    ...extractFilesFromError(errorOutput, cwd),
  ]);

  if (candidates.length === 0) {
    return false;
  }

  for (const file of candidates) {
    const absolutePath = path.resolve(cwd, file);
    try {
      const currentContent = await fs.promises.readFile(absolutePath, 'utf8');
      const prompt = buildFixPrompt({
        file,
        currentContent,
        errorOutput,
        testName: task.name,
      });

      const raw = engine === 'claude'
        ? await runClaude(prompt, cwd)
        : await runCodex(prompt, cwd);

      const fixedContent = parseFixedFileContent(raw);
      if (!fixedContent || fixedContent.trim() === currentContent.trim()) {
        continue;
      }

      await fs.promises.writeFile(absolutePath, fixedContent, 'utf8');
      return true;
    } catch {
      // Try the next candidate file.
    }
  }

  return false;
}

function buildFixPrompt({ file, currentContent, errorOutput, testName }) {
  return `
You are fixing a single file after an automated test failure.
Return ONLY valid JSON in this shape:
{
  "content": "full corrected file contents"
}

Constraints:
- Fix only this file: ${file}
- Preserve the file's overall purpose.
- Do not use markdown fences.
- The response must be the complete updated file content.

Test:
${testName}

Error:
${errorOutput}

Current file:
${currentContent}
  `.trim();
}

function parseFixedFileContent(raw) {
  const trimmed = raw.trim();
  try {
    const parsed = parseJsonObject(trimmed);
    if (typeof parsed.content === 'string') {
      return parsed.content;
    }
  } catch {
    // Fall through.
  }
  return trimmed;
}

function extractFilesFromError(errorOutput, cwd) {
  const normalizedCwd = `${path.resolve(cwd).replace(/\\/g, '/')}/`;
  const matches = errorOutput.match(/([A-Za-z0-9_./-]+\.(?:js|jsx|ts|tsx|mjs|cjs|css|scss|sass|html))/g) || [];

  return matches.map((match) => {
    const normalized = match.replace(/\\/g, '/');
    if (normalized.startsWith(normalizedCwd)) {
      return normalized.slice(normalizedCwd.length);
    }
    return normalized.replace(/^\.\//, '');
  });
}

function buildValidationErrorMessage(results) {
  const failed = results.find((result) => result.status === 'failed');
  if (!failed) {
    return 'Validation failed';
  }

  return `${failed.name}\n${failed.output}`.trim();
}

function dedupePaths(paths) {
  return [...new Set((paths || []).map(normalizePathValue).filter(Boolean))];
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
