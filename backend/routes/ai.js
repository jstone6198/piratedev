import { Router } from 'express';
import { execFile, exec } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const router = Router();
const WORKSPACE = '/home/claude-runner/projects/josh-replit/workspace';

/**
 * POST /api/ai/chat
 * Body: { message, fileContent?, fileName?, project?, engine? }
 * engine: 'codex' (default, gpt-5.4) or 'claude' (Claude Code, Sonnet)
 * Returns: { reply }
 *
 * Both run directly on VPS — $0 via existing accounts.
 */
router.post('/chat', async (req, res) => {
  const { message, fileContent, fileName, project, engine = 'codex', history } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  let prompt = message;
  if (fileContent) {
    const label = fileName || 'current file';
    prompt = `Current file (${label}):\n\`\`\`\n${fileContent}\n\`\`\`\n\nUser question: ${message}\n\nRespond with helpful code advice. Do NOT modify any files.`;
  }

  // Build conversation context from history
  const historyCtx = Array.isArray(history) ? history.slice(-10) : [];

  const cwd = project ? path.join(WORKSPACE, project) : WORKSPACE;
  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

  try {
    let reply;
    if (engine === 'claude') {
      reply = await runClaude(prompt, cwd, historyCtx);
    } else {
      reply = await runCodex(prompt, cwd, historyCtx);
    }
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
    const completion = await runCodexCompletion({
      code,
      cursorLine,
      cursorColumn,
      filePath,
      cwd,
    });
    res.json({ completion });
  } catch (err) {
    console.error('[ai] completion failed:', err.message);
    res.status(500).json({ error: 'AI completion failed', message: err.message });
  }
});

/** GET /api/ai/engines — list available engines */
router.get('/engines', (_req, res) => {
  res.json({
    engines: [
      { id: 'codex', name: 'Codex (GPT-5.4)', description: 'OpenAI via ChatGPT account' },
      { id: 'claude', name: 'Claude Code (Sonnet)', description: 'Anthropic Claude via Max plan' },
    ],
  });
});

function formatHistory(history) {
  if (!history || history.length === 0) return '';
  return history.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n\n');
}

function runCodex(prompt, cwd, history = [], { trimMode = 'both' } = {}) {
  const tmpFile = `/tmp/codex-reply-${randomUUID()}.txt`;
  const ctx = formatHistory(history);
  const fullPrompt = ctx ? `Previous conversation:\n${ctx}\n\nNow answer:\n${prompt}` : prompt;
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color', 'never',
    '--dangerously-bypass-approvals-and-sandbox',
    '-o', tmpFile,
    '-C', cwd,
    fullPrompt,
  ];
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/codex', args, {
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, HOME: '/home/claude-runner' },
    }, (err) => {
      if (err && !fs.existsSync(tmpFile)) return reject(err);
      try {
        const output = fs.readFileSync(tmpFile, 'utf-8');
        fs.unlinkSync(tmpFile);
        const normalized = trimMode === 'end'
          ? output.replace(/\s+$/, '')
          : output.trim();
        resolve(normalized || 'No response from Codex.');
      } catch (e) { reject(e); }
    });
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

  return runCodex(prompt, cwd, [], { trimMode: 'end' });
}

function runClaude(prompt, cwd, history = []) {
  const ctx = formatHistory(history);
  const fullPrompt = ctx ? `Previous conversation:\n${ctx}\n\nNow answer:\n${prompt}` : prompt;
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
