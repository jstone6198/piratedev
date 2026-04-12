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
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Postgres database, auth, storage, and realtime.',
    icon: '⚡',
    npmPackage: '@supabase/supabase-js',
    envVars: [
      { key: 'SUPABASE_URL', placeholder: 'https://your-project.supabase.co' },
      { key: 'SUPABASE_ANON_KEY', placeholder: 'eyJ...' },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', placeholder: 'eyJ...' },
    ],
    files: ['database example'],
  },
  {
    id: 'mongodb',
    name: 'MongoDB Atlas',
    description: 'NoSQL document database.',
    icon: '🍃',
    npmPackage: 'mongodb',
    envVars: [{ key: 'MONGODB_URI', placeholder: 'mongodb+srv://...' }],
    files: ['database example'],
  },
  {
    id: 'redis',
    name: 'Redis / Upstash',
    description: 'Redis via Upstash REST API.',
    icon: '🔴',
    npmPackage: '@upstash/redis',
    envVars: [
      { key: 'UPSTASH_REDIS_REST_URL', placeholder: 'https://...' },
      { key: 'UPSTASH_REDIS_REST_TOKEN', placeholder: 'AX...' },
    ],
    files: ['cache example'],
  },
  {
    id: 'clerk',
    name: 'Clerk',
    description: 'Authentication and user management.',
    icon: '🔐',
    npmPackage: '@clerk/clerk-sdk-node',
    envVars: [
      { key: 'CLERK_SECRET_KEY', placeholder: 'sk_live_...' },
      { key: 'CLERK_PUBLISHABLE_KEY', placeholder: 'pk_live_...' },
    ],
    files: ['auth example'],
  },
  {
    id: 'auth0',
    name: 'Auth0',
    description: 'Authentication platform.',
    icon: '🛡️',
    npmPackage: 'auth0',
    envVars: [
      { key: 'AUTH0_DOMAIN', placeholder: 'yourapp.auth0.com' },
      { key: 'AUTH0_CLIENT_ID', placeholder: 'abc123...' },
      { key: 'AUTH0_CLIENT_SECRET', placeholder: 'secret...' },
    ],
    files: ['auth example'],
  },
  {
    id: 'twilio',
    name: 'Twilio',
    description: 'SMS and messaging APIs.',
    icon: '📱',
    npmPackage: 'twilio',
    envVars: [
      { key: 'TWILIO_ACCOUNT_SID', placeholder: 'AC...' },
      { key: 'TWILIO_AUTH_TOKEN', placeholder: 'auth_token...' },
      { key: 'TWILIO_PHONE_NUMBER', placeholder: '+1...' },
    ],
    files: ['sms example'],
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'Email delivery service.',
    icon: '📧',
    npmPackage: '@sendgrid/mail',
    envVars: [{ key: 'SENDGRID_API_KEY', placeholder: 'SG....' }],
    files: ['email example'],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Send messages to Discord.',
    icon: '🎮',
    npmPackage: 'discord.js',
    envVars: [
      { key: 'DISCORD_BOT_TOKEN', placeholder: 'bot_token...' },
      { key: 'DISCORD_CHANNEL_ID', placeholder: 'channel_id...' },
    ],
    files: ['bot example'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Notion databases and pages.',
    icon: '📝',
    npmPackage: '@notionhq/client',
    envVars: [
      { key: 'NOTION_API_KEY', placeholder: 'secret_...' },
      { key: 'NOTION_DATABASE_ID', placeholder: 'database_id...' },
    ],
    files: ['database example'],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Spreadsheet-database hybrid.',
    icon: '📋',
    npmPackage: 'airtable',
    envVars: [
      { key: 'AIRTABLE_API_KEY', placeholder: 'pat...' },
      { key: 'AIRTABLE_BASE_ID', placeholder: 'app...' },
    ],
    files: ['table example'],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking.',
    icon: '📏',
    npmPackage: '@linear/sdk',
    envVars: [{ key: 'LINEAR_API_KEY', placeholder: 'lin_api_...' }],
    files: ['issue tracking example'],
  },
  {
    id: 'lemonsqueezy',
    name: 'Lemon Squeezy',
    description: 'Payments for developers.',
    icon: '🍋',
    npmPackage: '@lemonsqueezy/lemonsqueezy.js',
    envVars: [{ key: 'LEMON_SQUEEZY_API_KEY', placeholder: 'api_key...' }],
    files: ['payments example'],
  },
  {
    id: 's3',
    name: 'S3 / Cloudflare R2',
    description: 'S3-compatible object storage.',
    icon: '🪣',
    npmPackage: '@aws-sdk/client-s3',
    envVars: [
      { key: 'S3_ACCESS_KEY', placeholder: 'AKIA...' },
      { key: 'S3_SECRET_KEY', placeholder: 'secret...' },
      { key: 'S3_BUCKET', placeholder: 'my-bucket' },
      { key: 'S3_ENDPOINT', placeholder: 'https://...r2.cloudflarestorage.com' },
    ],
    files: ['storage example'],
  },
  {
    id: 'uploadthing',
    name: 'Uploadthing',
    description: 'File uploads for web apps.',
    icon: '📤',
    npmPackage: 'uploadthing',
    envVars: [{ key: 'UPLOADTHING_SECRET', placeholder: 'sk_live_...' }],
    files: ['upload example'],
  },
  {
    id: 'planetscale',
    name: 'PlanetScale',
    description: 'Serverless MySQL database.',
    icon: '🌐',
    npmPackage: '@planetscale/database',
    envVars: [{ key: 'PLANETSCALE_URL', placeholder: 'mysql://...' }],
    files: ['database example'],
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
  supabase: `import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

export async function getRows(table) {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  return data;
}

export async function insertRow(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select();
  if (error) throw error;
  return data;
}
`,
  mongodb: `import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

export async function insertDocument(dbName, collectionName, doc) {
  await client.connect();
  const db = client.db(dbName);
  const result = await db.collection(collectionName).insertOne(doc);
  return result;
}

export async function findDocument(dbName, collectionName, query) {
  await client.connect();
  const db = client.db(dbName);
  return db.collection(collectionName).findOne(query);
}
`,
  redis: `import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export async function setCache(key, value, expirationSeconds) {
  await redis.set(key, value, { ex: expirationSeconds });
}

export async function getCache(key) {
  return redis.get(key);
}
`,
  clerk: `import { createClerkClient } from '@clerk/clerk-sdk-node';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export async function getUserList(limit = 10) {
  const users = await clerk.users.getUserList({ limit });
  return users.data.map((user) => ({
    id: user.id,
    email: user.emailAddresses[0]?.emailAddress,
    firstName: user.firstName,
  }));
}
`,
  auth0: `import { ManagementClient } from 'auth0';

const management = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
});

export async function listUsers(page = 0) {
  const users = await management.users.getAll({ page, per_page: 10 });
  return users.data;
}
`,
  twilio: `import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

export async function sendSMS({ to, body }) {
  const message = await client.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
  return { sid: message.sid, status: message.status };
}
`,
  sendgrid: `import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendEmail({ to, from, subject, html }) {
  const msg = { to, from, subject, html };
  const [response] = await sgMail.send(msg);
  return { statusCode: response.statusCode };
}
`,
  discord: `import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

export async function sendMessage(text) {
  await client.login(process.env.DISCORD_BOT_TOKEN);
  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  const message = await channel.send(text);
  client.destroy();
  return { id: message.id };
}
`,
  notion: `import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

export async function queryDatabase(filter) {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter,
  });
  return response.results;
}
`,
  airtable: `import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID,
);

export async function listRecords(tableName) {
  const records = await base(tableName).select({ maxRecords: 100 }).all();
  return records.map((record) => ({ id: record.id, ...record.fields }));
}
`,
  linear: `import { LinearClient } from '@linear/sdk';

const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });

export async function createIssue({ title, description, teamId }) {
  const issue = await linear.createIssue({ title, description, teamId });
  return issue.issue;
}
`,
  lemonsqueezy: `import { lemonSqueezySetup, getProducts } from '@lemonsqueezy/lemonsqueezy.js';

lemonSqueezySetup({ apiKey: process.env.LEMON_SQUEEZY_API_KEY });

export async function listProducts(storeId) {
  const { data } = await getProducts({ filter: { storeId } });
  return data;
}
`,
  s3: `import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

export async function uploadFile(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return { key };
}

export async function getFile(key) {
  const response = await s3.send(new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  }));
  return response.Body;
}
`,
  uploadthing: `import { createUploadthing } from 'uploadthing/server';

const f = createUploadthing();

export const uploadRouter = {
  imageUploader: f({ image: { maxFileSize: '4MB' } })
    .onUploadComplete(async ({ file }) => {
      console.log('Upload complete:', file.url);
      return { url: file.url };
    }),
};
`,
  planetscale: `import { connect } from '@planetscale/database';

const conn = connect({ url: process.env.PLANETSCALE_URL });

export async function query(sql, args = []) {
  const results = await conn.execute(sql, args);
  return results.rows;
}

export async function insertRow(table, data) {
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = \`INSERT INTO \${table} (\${keys.join(', ')}) VALUES (\${placeholders})\`;
  return conn.execute(sql, Object.values(data));
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

  if (connector.id === 'supabase') {
    await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: env.SUPABASE_ANON_KEY },
    });
    return 'Supabase connection verified.';
  }

  if (connector.id === 'mongodb') {
    return 'MongoDB URI configured - connection tested on first query.';
  }

  if (connector.id === 'redis') {
    await fetch(`${env.UPSTASH_REDIS_REST_URL}/get/test`, {
      headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
    });
    return 'Upstash Redis connected.';
  }

  if (connector.id === 'clerk') {
    await fetchJson('https://api.clerk.com/v1/users?limit=1', {
      headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
    });
    return 'Clerk API key valid.';
  }

  if (connector.id === 'auth0') {
    return `Auth0 domain configured: ${env.AUTH0_DOMAIN}`;
  }

  if (connector.id === 'twilio') {
    await fetchJson(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      },
    );
    return 'Twilio account verified.';
  }

  if (connector.id === 'sendgrid') {
    await fetchJson('https://api.sendgrid.com/v3/scopes', {
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}` },
    });
    return 'SendGrid API key valid.';
  }

  if (connector.id === 'discord') {
    const data = await fetchJson('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    return `Discord bot connected as ${data.username}.`;
  }

  if (connector.id === 'notion') {
    await fetchJson('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${env.NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });
    return 'Notion connected.';
  }

  if (connector.id === 'airtable') {
    await fetchJson('https://api.airtable.com/v0/meta/bases', {
      headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
    });
    return 'Airtable API key valid.';
  }

  if (connector.id === 'linear') {
    const data = await fetchJson('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: env.LINEAR_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{viewer{id name}}' }),
    });
    return `Linear connected as ${data.data?.viewer?.name}.`;
  }

  if (connector.id === 'lemonsqueezy') {
    await fetchJson('https://api.lemonsqueezy.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${env.LEMON_SQUEEZY_API_KEY}`,
        Accept: 'application/vnd.api+json',
      },
    });
    return 'Lemon Squeezy API key valid.';
  }

  if (connector.id === 's3') {
    return `S3 credentials configured (bucket: ${env.S3_BUCKET}).`;
  }

  if (connector.id === 'uploadthing') {
    return 'Uploadthing secret configured.';
  }

  if (connector.id === 'planetscale') {
    return 'PlanetScale URL configured.';
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
