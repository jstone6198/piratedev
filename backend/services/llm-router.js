import { execFile, exec, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const WORKSPACE = '/home/claude-runner/projects/piratedev/workspace';

/**
 * callLLM - Unified LLM call interface
 * Returns plain string response text
 */
export async function callLLM({
  provider,
  model,
  apiKey,
  messages,
  systemPrompt,
  maxTokens = 4096,
  temperature = 0.3,
  baseUrl,
}) {
  switch (provider) {
    case 'openai':
      return callOpenAIFormat({
        baseUrl: 'https://api.openai.com',
        apiKey, model, messages, systemPrompt, maxTokens, temperature,
      });

    case 'anthropic':
      return callAnthropic({ apiKey, model, messages, systemPrompt, maxTokens, temperature });

    case 'google':
      return callGoogle({ apiKey, model, messages, systemPrompt, maxTokens, temperature });

    case 'groq':
      return callOpenAIFormat({
        baseUrl: 'https://api.groq.com/openai',
        apiKey, model, messages, systemPrompt, maxTokens, temperature,
      });

    case 'mistral':
      return callOpenAIFormat({
        baseUrl: 'https://api.mistral.ai',
        apiKey, model, messages, systemPrompt, maxTokens, temperature,
      });

    case 'custom':
      if (!baseUrl) throw new Error('custom provider requires baseUrl');
      return callOpenAIFormat({
        baseUrl, apiKey, model, messages, systemPrompt, maxTokens, temperature,
      });

    case 'codex':
      return runCodexViaRouter(messages);

    case 'claude-code':
      return runClaudeViaRouter(messages);

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// OpenAI-compatible format (OpenAI, Groq, Mistral, Custom)
async function callOpenAIFormat({ baseUrl, apiKey, model, messages, systemPrompt, maxTokens, temperature }) {
  const body = {
    model,
    messages: buildOpenAIMessages(messages, systemPrompt),
    max_tokens: maxTokens,
    temperature,
  };

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${model} API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// Anthropic Messages API
async function callAnthropic({ apiKey, model, messages, systemPrompt, maxTokens, temperature }) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  };
  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// Google Gemini API
async function callGoogle({ apiKey, model, messages, systemPrompt, maxTokens, temperature }) {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
    },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google AI error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function buildOpenAIMessages(messages, systemPrompt) {
  const out = [];
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

// Codex CLI fallback
function runCodexViaRouter(messages) {
  const prompt = messages.map(m => m.content).join('\n\n');
  const args = [
    'exec', '--skip-git-repo-check', '--ephemeral',
    '--color', 'never', '--dangerously-bypass-approvals-and-sandbox',
    '-C', WORKSPACE, prompt,
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/codex', args, {
      env: { ...process.env, HOME: '/home/claude-runner' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdin.end();
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Codex timed out after 120s')); }, 120000);
    proc.on('close', code => {
      clearTimeout(timer);
      const output = stdout.trim();
      if (!output && code !== 0) return reject(new Error(stderr || 'Codex exited with code ' + code));
      resolve(output || 'No response from Codex.');
    });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// Claude Code CLI fallback
function runClaudeViaRouter(messages) {
  const prompt = messages.map(m => m.content).join('\n\n');
  return new Promise((resolve, reject) => {
    exec(
      `cd ${JSON.stringify(WORKSPACE)} && echo ${JSON.stringify(prompt)} | claude -p --dangerously-skip-permissions --bare --model sonnet --no-session-persistence 2>/dev/null`,
      {
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, HOME: '/home/claude-runner' },
      },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim() || 'No response from Claude.');
      },
    );
  });
}
