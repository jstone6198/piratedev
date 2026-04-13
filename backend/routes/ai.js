import { Router } from 'express';
import { execFile, exec, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  appendUsageEntry,
  createUsageEntry,
  getUsageStats,
  resetUsageLog,
} from '../services/usage-tracker.js';
import { callLLM } from '../services/llm-router.js';
import { readVault } from '../services/user-vault.js';
import { indexProject, buildContextPrompt } from '../services/context-indexer.js';

const router = Router();
const WORKSPACE = '/home/claude-runner/projects/josh-replit/workspace';
const contextCache = new Map();

/**
 * POST /api/ai/chat
 * Body: { message, fileContent?, fileName?, project?, engine? }
 * engine: 'codex' (default, gpt-5.4) or 'claude' (Claude Code, Sonnet)
 * Returns: { reply }
 *
 * Both run directly on VPS — $0 via existing accounts.
 */
router.post('/chat', async (req, res) => {
  const { message, fileContent, fileName, project, engine = 'codex', history, screenshotBase64 } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  let prompt = message;
  if (fileContent) {
    const label = fileName || 'current file';
    prompt = `Current file (${label}):\n\`\`\`\n${fileContent}\n\`\`\`\n\nUser question: ${message}\n\nRespond with helpful code advice. Do NOT modify any files.`;
  }

  // Build conversation context from history
  const historyCtx = Array.isArray(history) ? history.slice(-10) : [];
  const fullPrompt = buildPromptWithHistory(prompt, historyCtx);

  const cwd = project ? path.join(WORKSPACE, project) : WORKSPACE;

  // Context enrichment
  const includeContext = req.body.includeContext;
  if (project && includeContext !== false) {
    try {
      const cacheKey = project;
      const cached = contextCache.get(cacheKey);
      const now = Date.now();
      let context;
      if (cached && (now - cached.time) < 30000) {
        context = cached.data;
      } else {
        context = await Promise.race([
          indexProject(cwd),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Context timeout')), 5000)),
        ]);
        contextCache.set(cacheKey, { data: context, time: now });
      }
      prompt = buildContextPrompt(context, prompt);
    } catch (err) {
      console.error('[ai] context indexing failed:', err.message);
    }
  }

  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

  try {
    let reply;
    if (engine === 'codex') {
      reply = await runCodex(prompt, cwd, historyCtx);
    } else if (engine === 'claude') {
      // When screenshot is present, try Anthropic API directly (supports vision)
      if (screenshotBase64) {
        try {
          const vault = readVault('default');
          const anthropicConfig = vault.llmProviders?.anthropic;
          if (anthropicConfig?.apiKey) {
            const userContent = [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } },
              { type: 'text', text: '[Screenshot above shows the current live preview of the app.]\n\n' + fullPrompt },
            ];
            reply = await callLLM({
              provider: 'anthropic',
              model: anthropicConfig.model || 'claude-sonnet-4-20250514',
              apiKey: anthropicConfig.apiKey,
              messages: [{ role: 'user', content: userContent }],
              baseUrl: anthropicConfig.baseUrl,
            });
          }
        } catch (err) {
          console.warn('[ai] Anthropic vision call failed, falling back to CLI:', err.message);
        }
      }
      // Fallback to Claude CLI if vision call wasn't used or failed
      if (!reply) {
        reply = await runClaude(prompt, cwd, historyCtx);
      }
    } else {
      // BYOK provider — read vault for apiKey and model
      const vault = readVault('default');
      const providerConfig = vault.llmProviders[engine];
      if (!providerConfig || !providerConfig.apiKey) {
        return res.status(400).json({ error: `No API key configured for provider: ${engine}` });
      }
      // Include screenshot for Anthropic BYOK provider
      let userContent = fullPrompt;
      if (screenshotBase64 && engine === 'anthropic') {
        userContent = [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } },
          { type: 'text', text: '[Screenshot above shows the current live preview of the app.]\n\n' + fullPrompt },
        ];
      }
      reply = await callLLM({
        provider: engine,
        model: providerConfig.model,
        apiKey: providerConfig.apiKey,
        messages: [{ role: 'user', content: userContent }],
        baseUrl: providerConfig.baseUrl,
      });
    }
    await appendUsageEntry(createUsageEntry({
      engine,
      endpoint: '/api/ai/chat',
      prompt: fullPrompt,
      response: reply,
      project,
      user: req.auth?.user?.username || req.auth?.type || 'anonymous',
    }));
    res.json({ reply, engine });
  } catch (err) {
    console.error(`[ai] ${engine} failed:`, err.message);
    res.status(500).json({ error: 'AI request failed', message: err.message, engine });
  }
});

router.post('/complete', async (req, res) => {
  const {
    code,
    cursorLine,
    cursorColumn,
    filePath,
    project,
  } = req.body ?? {};

  if (typeof code !== 'string') {
    return res.status(400).json({ error: 'code is required' });
  }
  if (!Number.isInteger(cursorLine) || cursorLine < 1) {
    return res.status(400).json({ error: 'cursorLine must be a positive integer' });
  }
  if (!Number.isInteger(cursorColumn) || cursorColumn < 1) {
    return res.status(400).json({ error: 'cursorColumn must be a positive integer' });
  }

  const cwd = project ? path.join(WORKSPACE, project) : WORKSPACE;
  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

  try {
    let completion;
    let engineUsed = 'codex';
    let promptUsed;

    // Check vault for completionProvider
    const vault = await readVault('default').catch(() => null);
    const completionProvider = vault?.completionProvider || 'codex';
    const providerConfig = vault?.llmProviders?.[completionProvider];

    if (completionProvider !== 'codex' && completionProvider !== 'claude-code' && providerConfig?.apiKey) {
      // Build completion prompt from excerpt logic
      const lines = code.split('\n');
      const startLine = Math.max(1, cursorLine - 20);
      const endLine = Math.min(lines.length, cursorLine + 20);
      const visibleLines = lines.slice(startLine - 1, endLine);
      const cursorLineContent = lines[cursorLine - 1] ?? '';
      const cursorOffset = Math.max(0, Math.min(cursorColumn - 1, cursorLineContent.length));
      const linePrefix = cursorLineContent.slice(0, cursorOffset);
      const lineSuffix = cursorLineContent.slice(cursorOffset);

      const excerpt = visibleLines.map((line, index) => {
        const lineNumber = startLine + index;
        if (lineNumber !== cursorLine) {
          return `  ${String(lineNumber).padStart(4, ' ')} | ${line}`;
        }
        return [
          `> ${String(lineNumber).padStart(4, ' ')} | ${line}`,
          `           | ${linePrefix}<CURSOR>${lineSuffix}`,
        ].join('\n');
      }).join('\n');

      promptUsed = [
        'Complete this code. Return ONLY the completion text, no explanation, no markdown.',
        '',
        `File: ${filePath || 'unknown'}`,
        `Cursor line: ${cursorLine}`,
        `Cursor column: ${cursorColumn}`,
        '',
        'Return only the text that should be inserted at <CURSOR>.',
        '',
        excerpt,
      ].join('\n');

      const result = await callLLM({
        provider: completionProvider,
        model: providerConfig.model,
        apiKey: providerConfig.apiKey,
        messages: [{ role: 'user', content: promptUsed }],
        maxTokens: 256,
        temperature: 0.1,
        baseUrl: providerConfig.baseUrl,
      });
      completion = result.trim();
      engineUsed = completionProvider;
    } else {
      const result = await runCodexCompletion({
        code,
        cursorLine,
        cursorColumn,
        filePath,
        cwd,
      });
      completion = result.completion;
      promptUsed = result.prompt;
    }

    await appendUsageEntry(createUsageEntry({
      engine: engineUsed,
      endpoint: '/api/ai/complete',
      prompt: promptUsed,
      response: completion,
      project,
      user: req.auth?.user?.username || req.auth?.type || 'anonymous',
    }));
    res.json({ completion });
  } catch (err) {
    console.error('[ai] completion failed:', err.message);
    res.status(500).json({ error: 'AI completion failed', message: err.message });
  }
});

router.get('/usage', async (req, res) => {
  try {
    const project = typeof req.query?.project === 'string' && req.query.project.trim()
      ? req.query.project.trim()
      : null;

    const stats = await getUsageStats({ project, days: 30 });
    res.json(stats);
  } catch (error) {
    console.error('[ai] usage stats failed:', error);
    res.status(500).json({ error: 'Failed to load usage stats', message: error.message });
  }
});

router.delete('/usage', async (_req, res) => {
  try {
    await resetUsageLog();
    res.json({ ok: true });
  } catch (error) {
    console.error('[ai] usage reset failed:', error);
    res.status(500).json({ error: 'Failed to reset usage stats', message: error.message });
  }
});

/** GET /api/ai/engines — list available engines */
router.get('/engines', (_req, res) => {
  const vault = readVault('default');
  const providers = vault.llmProviders || {};

  const staticProviders = [
    { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini'] },
    { id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-3-haiku-20240307', 'claude-opus-4-20250514'] },
    { id: 'google', name: 'Google Gemini', models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'] },
    { id: 'groq', name: 'Groq', models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
    { id: 'mistral', name: 'Mistral', models: ['mistral-large-latest', 'mistral-small-latest', 'open-mixtral-8x22b'] },
    { id: 'custom', name: 'Custom (OpenAI-compatible)', models: [] },
  ];

  const engines = [
    { id: 'codex', name: 'Codex (GPT-5.4)', description: 'Free — OpenAI via ChatGPT account', keyConfigured: true },
    { id: 'claude-code', name: 'Claude Code (Sonnet)', description: 'Free — Anthropic Claude via Max plan', keyConfigured: true },
  ];

  for (const sp of staticProviders) {
    const cfg = providers[sp.id];
    engines.push({
      id: sp.id,
      name: sp.name,
      models: sp.models,
      keyConfigured: !!(cfg && cfg.apiKey),
      model: cfg?.model || null,
      enabled: cfg?.enabled !== false,
    });
  }

  // Add any extra providers from vault not in static list
  for (const [id, cfg] of Object.entries(providers)) {
    if (!engines.find(e => e.id === id)) {
      engines.push({
        id,
        name: cfg.name || id,
        models: [],
        keyConfigured: !!cfg.apiKey,
        model: cfg.model || null,
        enabled: cfg.enabled !== false,
      });
    }
  }

  res.json({
    engines,
    defaultProvider: vault.defaultProvider || 'codex',
    agentProvider: vault.agentProvider || 'codex',
    completionProvider: vault.completionProvider || 'codex',
    reviewProvider: vault.reviewProvider || null,
  });
});

function formatHistory(history) {
  if (!history || history.length === 0) return '';
  return history.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n\n');
}

function buildPromptWithHistory(prompt, history = []) {
  const ctx = formatHistory(history);
  return ctx ? `Previous conversation:\n${ctx}\n\nNow answer:\n${prompt}` : prompt;
}

function runCodex(prompt, cwd, history = [], { trimMode = 'both' } = {}) {
  const SYSTEM_PROMPT = `You are PirateDev, an expert AI coding assistant embedded in a cloud IDE. Help developers write, debug, explain, and improve code. Be concise but thorough. Format all code in markdown code blocks with language tags. Always consider project context. Never refuse reasonable coding requests.`;
  const historyCtx = buildPromptWithHistory(prompt, history);
  const fullPrompt = SYSTEM_PROMPT + '\n\n' + historyCtx;
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color', 'never',
    '--dangerously-bypass-approvals-and-sandbox',
    '-C', cwd,
    fullPrompt,
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/codex', args, {
      env: { ...process.env, HOME: '/home/claude-runner' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Close stdin immediately so codex doesn't wait for input
    proc.stdin.end();
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Codex timed out after 120s')); }, 120000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const output = stdout || '';
      const normalized = trimMode === 'end'
        ? output.replace(/\s+$/, '')
        : output.trim();
      if (!normalized && code !== 0) {
        return reject(new Error(stderr || 'Codex exited with code ' + code));
      }
      resolve(normalized || 'No response from Codex.');
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function runCodexCompletion({ code, cursorLine, cursorColumn, filePath, cwd }) {
  const lines = code.split('\n');
  const startLine = Math.max(1, cursorLine - 20);
  const endLine = Math.min(lines.length, cursorLine + 20);
  const visibleLines = lines.slice(startLine - 1, endLine);
  const cursorLineContent = lines[cursorLine - 1] ?? '';
  const cursorOffset = Math.max(0, Math.min(cursorColumn - 1, cursorLineContent.length));
  const linePrefix = cursorLineContent.slice(0, cursorOffset);
  const lineSuffix = cursorLineContent.slice(cursorOffset);

  const excerpt = visibleLines.map((line, index) => {
    const lineNumber = startLine + index;
    if (lineNumber !== cursorLine) {
      return `  ${String(lineNumber).padStart(4, ' ')} | ${line}`;
    }

    return [
      `> ${String(lineNumber).padStart(4, ' ')} | ${line}`,
      `           | ${linePrefix}<CURSOR>${lineSuffix}`,
    ].join('\n');
  }).join('\n');

  const prompt = [
    'System: Complete this code. Return ONLY the completion text, no explanation, no markdown.',
    '',
    'User:',
    `File: ${filePath || 'unknown'}`,
    `Cursor line: ${cursorLine}`,
    `Cursor column: ${cursorColumn}`,
    '',
    'Return only the text that should be inserted at <CURSOR>.',
    'The excerpt below includes up to 20 lines above and 20 lines below the cursor.',
    '',
    excerpt,
  ].join('\n');

  return runCodex(prompt, cwd, [], { trimMode: 'end' }).then((completion) => ({
    completion,
    prompt,
  }));
}

function runClaude(prompt, cwd, history = []) {
  const fullPrompt = buildPromptWithHistory(prompt, history);
  return new Promise((resolve, reject) => {
    const proc = exec(
      `cd ${JSON.stringify(cwd)} && echo ${JSON.stringify(fullPrompt)} | claude -p --dangerously-skip-permissions --bare --model sonnet --no-session-persistence 2>/dev/null`,
      {
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, HOME: '/home/claude-runner' },
      },
      (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout.trim() || 'No response from Claude.');
      }
    );
  });
}

export default router;
