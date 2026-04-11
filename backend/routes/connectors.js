import { spawn } from 'child_process';
import { createSign } from 'crypto';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';

const router = Router();

const CONNECTORS = [
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Accept payments, create checkout sessions, and handle webhooks.',
    icon: '💳',
    npmPackage: 'stripe',
    envVars: [{ key: 'STRIPE_SECRET_KEY', placeholder: 'sk_test_...' }],
    files: ['webhook route', 'checkout example'],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Read repositories and automate GitHub workflows.',
    icon: '🐙',
    npmPackage: 'octokit',
    envVars: [{ key: 'GITHUB_TOKEN', placeholder: 'ghp_...' }],
    files: ['repo list example'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send bot messages to Slack channels.',
    icon: '💬',
    npmPackage: '@slack/web-api',
    envVars: [{ key: 'SLACK_BOT_TOKEN', placeholder: 'xoxb-...' }],
    files: ['message sender example'],
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    description: 'Read and write rows with a Google service account.',
    icon: '📊',
    npmPackage: 'googleapis',
    envVars: [{ key: 'GOOGLE_SERVICE_ACCOUNT_JSON', placeholder: '{...}' }],
    files: ['read/write example'],
  },
  {
    id: 'email',
    name: 'Email',
    description: 'Send transactional email with Resend.',
    icon: '✉️',
    npmPackage: 'resend',
    envVars: [{ key: 'RESEND_API_KEY', placeholder: 're_...' }],
    files: ['transactional email example'],
  },
];

const EXAMPLES = {
  stripe: `import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function createCheckoutSession({ priceId, successUrl, cancelUrl }) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function stripeWebhook(req, res) {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    const event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, signature, webhookSecret)
      : req.body;

    if (event.type === 'checkout.session.completed') {
      console.log('Checkout completed', event.data.object.id);
    }

    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
`,
  github: `import { Octokit } from 'octokit';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function listRepositories({ owner }) {
  const response = await octokit.rest.repos.listForUser({
    username: owner,
    per_page: 20,
    sort: 'updated',
  });

  return response.data.map((repo) => ({
    name: repo.name,
    url: repo.html_url,
    private: repo.private,
  }));
}
`,
  slack: `import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function sendSlackMessage({ channel, text }) {
  const response = await slack.chat.postMessage({ channel, text });
  return { ok: response.ok, ts: response.ts };
}
`,
  sheets: `import { google } from 'googleapis';

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function readSheet({ spreadsheetId, range }) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return response.data.values || [];
}

export async function appendSheetRow({ spreadsheetId, range, values }) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  return sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}
`,
  email: `import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendTransactionalEmail({ to, subject, html }) {
  const response = await resend.emails.send({
    from: 'App <onboarding@resend.dev>',
    to,
    subject,
    html,
  });

  return response.data;
}
`,
};

function getConnector(connectorId) {
  return CONNECTORS.find((connector) => connector.id === connectorId);
}

function getWorkspaceDir(req) {
  return path.resolve(req.app.locals.workspaceDir || path.resolve(process.cwd(), '..', 'workspace'));
}

async function getProjectDir(req) {
  const workspaceDir = getWorkspaceDir(req);
  const project = req.params.project;
  if (!project || project.includes('..') || path.isAbsolute(project)) return null;

  const projectDir = path.resolve(workspaceDir, project);
  const relativePath = path.relative(workspaceDir, projectDir);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;

  try {
    const stat = await fs.stat(projectDir);
    return stat.isDirectory() ? projectDir : null;
  } catch {
    return null;
  }
}

async function ensurePackageJson(projectDir, project) {
  const packagePath = path.join(projectDir, 'package.json');
  if (existsSync(packagePath)) return;

  await fs.writeFile(
    packagePath,
    `${JSON.stringify({ name: project, version: '1.0.0', type: 'module' }, null, 2)}\n`,
    'utf-8',
  );
}

function runNpm(projectDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd: projectDir, env: process.env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `npm exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function connectorsPath(projectDir) {
  return path.join(projectDir, '.connectors.json');
}

async function readActiveConnectors(projectDir) {
  const data = await readJson(connectorsPath(projectDir), { connectors: [] });
  return Array.isArray(data.connectors) ? data.connectors : [];
}

async function saveActiveConnectors(projectDir, connectors) {
  await writeJson(connectorsPath(projectDir), { connectors });
}

async function appendEnvPlaceholders(projectDir, connector) {
  const envPath = path.join(projectDir, '.env');
  let content = '';

  try {
    content = await fs.readFile(envPath, 'utf-8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const existingKeys = new Set(
    content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.slice(0, line.indexOf('=')).trim()),
  );

  const missingLines = connector.envVars
    .filter(({ key }) => !existingKeys.has(key))
    .map(({ key, placeholder }) => `${key}=${placeholder}`);

  if (missingLines.length === 0) return [];

  const prefix = content && !content.endsWith('\n') ? '\n' : '';
  await fs.writeFile(envPath, `${content}${prefix}${missingLines.join('\n')}\n`, 'utf-8');
  return missingLines.map((line) => line.slice(0, line.indexOf('=')));
}

async function createExampleFile(projectDir, connector) {
  const connectorDir = path.join(projectDir, 'connectors');
  await fs.mkdir(connectorDir, { recursive: true });

  const filePath = path.join(connectorDir, `${connector.id}.js`);
  await fs.writeFile(filePath, EXAMPLES[connector.id], 'utf-8');
  return path.relative(projectDir, filePath);
}

function parseEnv(content) {
  return content.split('\n').reduce((vars, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return vars;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) return vars;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
    return vars;
  }, {});
}

async function getProjectEnv(projectDir, providedEnv = {}) {
  const envPath = path.join(projectDir, '.env');
  let fileEnv = {};

  try {
    fileEnv = parseEnv(await fs.readFile(envPath, 'utf-8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return { ...fileEnv, ...providedEnv };
}

async function testConnector(connector, env) {
  const missing = connector.envVars.filter(({ key }) => !env[key] || env[key] === getPlaceholder(connector, key));
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.map(({ key }) => key).join(', ')}`);
  }

  if (connector.id === 'stripe') {
    await fetchJson('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    return 'Stripe API key is valid.';
  }

  if (connector.id === 'github') {
    const user = await fetchJson('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'piratedev-connectors',
      },
    });
    return `Authenticated as ${user.login}.`;
  }

  if (connector.id === 'slack') {
    const response = await fetchJson('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    });
    if (!response.ok) throw new Error(response.error || 'Slack auth test failed');
    return `Connected to Slack team ${response.team || response.team_id}.`;
  }

  if (connector.id === 'sheets') {
    const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    await getGoogleAccessToken(credentials);
    return `Google service account ${credentials.client_email || 'credentials'} loaded.`;
  }

  if (connector.id === 'email') {
    await fetchJson('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    return 'Resend API key is valid.';
  }

  throw new Error('Unknown connector');
}

function getPlaceholder(connector, key) {
  return connector.envVars.find((envVar) => envVar.key === key)?.placeholder;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `Request failed with ${response.status}`);
  }

  return data;
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

async function getGoogleAccessToken(credentials) {
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google service account JSON must include client_email and private_key');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsignedToken = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();

  const assertion = `${unsignedToken}.${signer.sign(credentials.private_key, 'base64url')}`;
  return fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
}

router.get('/available', (req, res) => {
  res.json(CONNECTORS);
});

router.post('/:project/add', async (req, res) => {
  try {
    const connector = getConnector(req.body?.connectorId);
    if (!connector) return res.status(400).json({ error: 'Unknown connectorId' });

    const projectDir = await getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    await ensurePackageJson(projectDir, req.params.project);
    await runNpm(projectDir, ['install', connector.npmPackage]);
    const exampleFile = await createExampleFile(projectDir, connector);
    const addedEnvVars = await appendEnvPlaceholders(projectDir, connector);

    const activeConnectors = await readActiveConnectors(projectDir);
    const nextConnectors = [
      ...activeConnectors.filter((active) => active.id !== connector.id),
      {
        id: connector.id,
        name: connector.name,
        npmPackage: connector.npmPackage,
        files: [exampleFile],
        envVars: connector.envVars,
        installedAt: new Date().toISOString(),
      },
    ];
    await saveActiveConnectors(projectDir, nextConnectors);

    res.json({
      success: true,
      files: [exampleFile, '.connectors.json', ...(addedEnvVars.length > 0 ? ['.env'] : [])],
      instructions: `Set ${connector.envVars.map(({ key }) => key).join(', ')} in .env, then import helpers from ./${exampleFile}.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:project/active', async (req, res) => {
  try {
    const projectDir = await getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const activeConnectors = await readActiveConnectors(projectDir);
    res.json(activeConnectors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:project/:connectorId', async (req, res) => {
  try {
    const connector = getConnector(req.params.connectorId);
    if (!connector) return res.status(400).json({ error: 'Unknown connectorId' });

    const projectDir = await getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    await ensurePackageJson(projectDir, req.params.project);
    await runNpm(projectDir, ['uninstall', connector.npmPackage]);
    await fs.rm(path.join(projectDir, 'connectors', `${connector.id}.js`), { force: true });

    const activeConnectors = await readActiveConnectors(projectDir);
    const nextConnectors = activeConnectors.filter((active) => active.id !== connector.id);
    await saveActiveConnectors(projectDir, nextConnectors);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:project/:connectorId/test', async (req, res) => {
  try {
    const connector = getConnector(req.params.connectorId);
    if (!connector) return res.status(400).json({ error: 'Unknown connectorId' });

    const projectDir = await getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const activeConnectors = await readActiveConnectors(projectDir);
    if (!activeConnectors.some((active) => active.id === connector.id)) {
      return res.status(400).json({ success: false, error: 'Connector is not installed for this project' });
    }

    const env = await getProjectEnv(projectDir, req.body?.env || {});
    const message = await testConnector(connector, env);
    res.json({ success: true, message });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
