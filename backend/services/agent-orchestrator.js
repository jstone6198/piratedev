/**
 * agent-orchestrator.js — Plan generation and execution for Agent Mode
 *
 * Generates build plans via AI engines, then executes steps sequentially
 * with real-time progress via Socket.io.
 */

import { exec, execFile } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const SYSTEM_PROMPT = `You are a build planner. Given a user request, output ONLY a JSON array of build steps. Each step: {id: number, type: create_file|edit_file|run_command|install_package|test, description: string, file?: string, command?: string, content?: string}. Order logically. Be thorough but concise.`;

const WORKSPACE = '/home/claude-runner/projects/josh-replit/workspace';

/**
 * Generate a build plan from a user prompt using an AI engine.
 * Returns an array of step objects.
 */
export async function generatePlan(prompt, engine = 'codex') {
  const fullPrompt = `${SYSTEM_PROMPT}\n\nUser request: ${prompt}`;

  let raw;
  if (engine === 'claude') {
    raw = await runClaude(fullPrompt);
  } else {
    raw = await runCodex(fullPrompt);
  }

  // Extract JSON array from response (handle markdown fences)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('AI did not return a valid JSON array. Raw response:\n' + raw.slice(0, 500));
  }

  const plan = JSON.parse(jsonMatch[0]);

  // Validate and normalize
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    step.id = step.id ?? i + 1;
    if (!step.type || !step.description) {
      throw new Error(`Step ${i + 1} missing required fields (type, description)`);
    }
  }

  return plan;
}

/**
 * Execute a single build step in the given project directory.
 * Returns { success, output } or throws.
 */
export async function executeStep(step, projectDir) {
  switch (step.type) {
    case 'create_file':
    case 'edit_file': {
      if (!step.file || step.content == null) {
        throw new Error(`Step ${step.id}: create_file/edit_file requires file and content`);
      }
      const filePath = path.join(projectDir, step.file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, step.content, 'utf-8');
      return { success: true, output: `Wrote ${step.file}` };
    }

    case 'run_command': {
      if (!step.command) {
        throw new Error(`Step ${step.id}: run_command requires command`);
      }
      const output = await runShellCommand(step.command, projectDir);
      return { success: true, output };
    }

    case 'install_package': {
      const cmd = step.command || `npm install ${step.description.replace(/^install\s+/i, '')}`;
      const output = await runShellCommand(cmd, projectDir);
      return { success: true, output };
    }

    case 'test': {
      const cmd = step.command || 'npm test';
      const output = await runShellCommand(cmd, projectDir);
      return { success: true, output };
    }

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

/**
 * Execute an entire plan sequentially, emitting socket events for progress.
 * socket events: agent:step-start, agent:step-complete, agent:log, agent:error, agent:done
 */
export async function executePlan(plan, projectDir, socket) {
  const results = [];

  // Ensure .josh-ide/plans directory exists
  const plansDir = path.join(projectDir, '.josh-ide', 'plans');
  await fs.promises.mkdir(plansDir, { recursive: true });

  // Save plan before execution
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const planFile = path.join(plansDir, `${timestamp}.json`);
  await fs.promises.writeFile(planFile, JSON.stringify({ plan, startedAt: new Date().toISOString() }, null, 2));

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];

    if (socket) {
      socket.emit('agent:step-start', { stepId: step.id, index: i, total: plan.length, step });
    }

    try {
      const result = await executeStep(step, projectDir);
      results.push({ stepId: step.id, ...result });

      if (socket) {
        socket.emit('agent:step-complete', { stepId: step.id, index: i, ...result });
        socket.emit('agent:log', { stepId: step.id, message: result.output });
      }
    } catch (err) {
      const errorResult = { stepId: step.id, success: false, error: err.message };
      results.push(errorResult);

      if (socket) {
        socket.emit('agent:error', { stepId: step.id, index: i, error: err.message });
      }

      // Stop execution on error — user can resume from step N
      break;
    }
  }

  // Update saved plan with results
  await fs.promises.writeFile(planFile, JSON.stringify({
    plan,
    results,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  }, null, 2));

  if (socket) {
    socket.emit('agent:done', { results, planFile: path.relative(projectDir, planFile) });
  }

  return { results, planFile };
}

// --- Engine runners (mirroring ai.js patterns) ---

function runCodex(prompt) {
  const tmpFile = `/tmp/codex-reply-${randomUUID()}.txt`;
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color', 'never',
    '--dangerously-bypass-approvals-and-sandbox',
    '-o', tmpFile,
    prompt,
  ];
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/codex', args, {
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, HOME: '/home/claude-runner' },
    }, (err) => {
      if (err && !fs.existsSync(tmpFile)) return reject(err);
      try {
        const output = fs.readFileSync(tmpFile, 'utf-8').trim();
        fs.unlinkSync(tmpFile);
        resolve(output || 'No response.');
      } catch (e) { reject(e); }
    });
  });
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    exec(
      `echo ${JSON.stringify(prompt)} | claude -p --dangerously-skip-permissions --bare --model sonnet --no-session-persistence 2>/dev/null`,
      {
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, HOME: '/home/claude-runner' },
      },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim() || 'No response.');
      }
    );
  });
}

function runShellCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout: 60000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${err.message}\n${stderr}`));
      resolve(stdout + (stderr ? '\n' + stderr : ''));
    });
  });
}
