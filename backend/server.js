/**
 * server.js - Main entry point for the josh-replit backend
 * Location: /home/claude-runner/projects/josh-replit/backend/server.js
 *
 * Starts an Express + Socket.io server on port 3500.
 * Mounts REST routes for file ops, project management, and code execution.
 * Delegates real-time terminal sessions to services/terminal.js via Socket.io.
 *
 * Used by: frontend IDE client connecting over HTTP and WebSocket.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import filesRouter from './routes/files.js';
import projectsRouter from './routes/projects.js';
import executeRouter from './routes/execute.js';
import authRouter, { getUserFromRequest, verifyJwtToken } from './routes/auth.js';
import gitRouter from './routes/git.js';
import envRouter from './routes/env.js';
import databaseRoutes from './routes/database.js';
import searchRouter from './routes/search.js';
import aiRouter from './routes/ai.js';
import imageGenRouter from './routes/imagegen.js';
import previewRouter from './routes/preview.js';
import deployRouter from './routes/deploy.js';
import agentRouter from './routes/agent.js';
import vpsRouter from './routes/vps.js';
import templatesRouter from './routes/templates.js';
import vaultRouter from './routes/vault.js';
import checkpointsRouter from './routes/checkpoints.js';
import storageRouter from './routes/storage.js';
import securityRouter from './routes/security.js';
import authScaffoldRouter from './routes/auth-scaffold.js';
import connectorsRouter from './routes/connectors.js';
import mobileRouter from './routes/mobile.js';
import setupRunner from './routes/runner.js';
import setupPackages from './routes/packages.js';
import setupDiff from './routes/diff.js';
import setupHistory from './routes/history.js';
import setupSecrets from './routes/secrets.js';
import setupSubdomainDeploy from './routes/subdomain-deploy.js';
import { configureAgentOrchestrator } from './services/agent-orchestrator.js';
import { setupCollaboration } from './services/collaboration.js';
import { setupTerminal } from './services/terminal.js';

// ESM __dirname polyfill
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Session validation — require x-ide-key header on all API endpoints
// ---------------------------------------------------------------------------
const IDE_SECRET_PATH = '/home/claude-runner/config/ide-secret.txt';
let IDE_KEY = '';
try {
  IDE_KEY = fs.readFileSync(IDE_SECRET_PATH, 'utf-8').trim();
} catch (err) {
  console.error('[server] WARNING: Could not read IDE secret from', IDE_SECRET_PATH, err.message);
}

function authMiddleware(req, res, next) {
  // Allow health check without auth
  if (req.path === '/health') return next();
  if (req.method === 'GET' && req.path.startsWith('/projects/shared/')) return next();

  const key = req.headers['x-ide-key'];
  if (key && key === IDE_KEY) {
    req.auth = { type: 'ide-key' };
    return next();
  }

  const user = getUserFromRequest(req);
  if (user) {
    req.auth = { type: 'jwt', user };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized — provide a valid Bearer token or x-ide-key header' });
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  path: '/socket.io/',
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Public auth routes must stay available before API auth middleware.
app.use('/api/auth', authRouter);

// Apply auth middleware to all other /api/ routes
app.use('/api', authMiddleware);

// Workspace root — each project gets its own subdirectory
const WORKSPACE = path.resolve(__dirname, '..', 'workspace');
const PLANS_DIR = path.resolve(__dirname, '..', '.piratedev', 'plans');
if (!fs.existsSync(WORKSPACE)) {
  fs.mkdirSync(WORKSPACE, { recursive: true });
}
if (!fs.existsSync(PLANS_DIR)) {
  fs.mkdirSync(PLANS_DIR, { recursive: true });
}

// Seed a default hello-world project if it doesn't have an index.js
const helloDir = path.join(WORKSPACE, 'hello-world');
const helloFile = path.join(helloDir, 'index.js');
if (!fs.existsSync(helloFile)) {
  fs.mkdirSync(helloDir, { recursive: true });
  fs.writeFileSync(helloFile, 'console.log("Hello World!");\n');
}

// Share workspace path and socket.io with route handlers
app.locals.workspaceDir = WORKSPACE;
app.locals.io = io;
app.locals.plansDir = PLANS_DIR;

configureAgentOrchestrator({
  io,
  workspaceDir: WORKSPACE,
  plansDir: PLANS_DIR,
});

// Mount route modules
app.use('/api/files', filesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/execute', executeRouter);
app.use('/api/git', gitRouter);
app.use('/api/env', envRouter);
app.use('/api/database', databaseRoutes);
app.use('/api/search', searchRouter);
app.use('/api/ai', aiRouter);
app.use('/api/imagegen', imageGenRouter);
app.use('/api/preview', previewRouter);
app.use('/api/deploy', deployRouter);
app.use('/api/agent', agentRouter);
app.use('/api/vps', vpsRouter);

// v5 self-registering routes
setupRunner(app, { workspace: WORKSPACE, io });
setupPackages(app, { workspace: WORKSPACE });
setupDiff(app, { workspace: WORKSPACE });
setupHistory(app, { workspace: WORKSPACE });
setupSecrets(app, { workspace: WORKSPACE });
setupSubdomainDeploy(app, { workspace: WORKSPACE });
app.use('/api/templates', templatesRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/checkpoints', checkpointsRouter);
app.use('/api/storage', storageRouter);
app.use('/api/security', securityRouter);
app.use('/api/auth-scaffold', authScaffoldRouter);
app.use('/api/connectors', connectorsRouter);
app.use('/api/mobile', mobileRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Serve static frontend (if present)
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io') && !req.path.startsWith('/replit/socket.io')) {
      res.sendFile(path.join(publicDir, 'index.html'));
    }
  });
}

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Socket.io auth — validate IDE key on connection
io.use((socket, next) => {
  const key = socket.handshake.auth?.ideKey || socket.handshake.headers?.['x-ide-key'];
  if (key && key === IDE_KEY) {
    socket.data.auth = { type: 'ide-key' };
    return next();
  }

  const cookieHeader = socket.handshake.headers?.cookie || '';
  const tokenCookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ide_jwt='));

  if (tokenCookie) {
    try {
      const user = verifyJwtToken(decodeURIComponent(tokenCookie.slice('ide_jwt='.length)));
      socket.data.auth = { type: 'jwt', user };
      return next();
    } catch (_error) {
      // Fall through to the shared unauthorized response.
    }
  }

  return next(new Error('Unauthorized — invalid IDE key or JWT'));
});

// Socket.io realtime services
setupCollaboration(io);
setupTerminal(io, WORKSPACE);

const PORT = process.env.PORT || 3220;
server.listen(PORT, () => {
  console.log(`[server] josh-replit backend on port ${PORT}`);
  console.log(`[server] Workspace: ${WORKSPACE}`);
});
