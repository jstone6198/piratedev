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
import gitRouter from './routes/git.js';
import envRouter from './routes/env.js';
import searchRouter from './routes/search.js';
import aiRouter from './routes/ai.js';
import previewRouter from './routes/preview.js';
import agentRouter from './routes/agent.js';
import { configureAgentOrchestrator } from './services/agent-orchestrator.js';
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

  const key = req.headers['x-ide-key'];
  if (!key || key !== IDE_KEY) {
    return res.status(401).json({ error: 'Unauthorized — missing or invalid x-ide-key header' });
  }
  next();
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  path: '/replit/socket.io/',
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Apply auth middleware to all /api/ routes
app.use('/api', authMiddleware);

// Workspace root — each project gets its own subdirectory
const WORKSPACE = path.resolve(__dirname, '..', 'workspace');
const PLANS_DIR = path.resolve(__dirname, '..', '.josh-ide', 'plans');
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
app.use('/api/search', searchRouter);
app.use('/api/ai', aiRouter);
app.use('/api/preview', previewRouter);
app.use('/api/agent', agentRouter);

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
  if (!key || key !== IDE_KEY) {
    return next(new Error('Unauthorized — invalid IDE key'));
  }
  next();
});

// Socket.io terminal
setupTerminal(io, WORKSPACE);

const PORT = process.env.PORT || 3220;
server.listen(PORT, () => {
  console.log(`[server] josh-replit backend on port ${PORT}`);
  console.log(`[server] Workspace: ${WORKSPACE}`);
});
