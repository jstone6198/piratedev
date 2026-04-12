import express from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_PATH = path.resolve(__dirname, '..', '..', 'config', 'users.json');
const IDE_SECRET_PATH = '/home/claude-runner/config/ide-secret.txt';
const JWT_EXPIRES_IN = '7d';
const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.IDE_JWT_SECRET) return process.env.IDE_JWT_SECRET;

  try {
    return fs.readFileSync(IDE_SECRET_PATH, 'utf-8').trim();
  } catch (_error) {
    return 'piratedev-jwt-dev-secret';
  }
})();

const OAUTH_CALLBACK_BASE =
  process.env.OAUTH_CALLBACK_BASE || 'https://app.piratedev.ai';

const router = express.Router();

function readUsersFile() {
  const raw = fs.readFileSync(USERS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.users) ? parsed.users : [];
}

function writeUsersFile(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify({ users }, null, 2));
}

function sanitizeUser(user) {
  return {
    username: user.username,
    role: user.role,
  };
}

export function signUserToken(user) {
  return jwt.sign(sanitizeUser(user), JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim() || null;
}

export function getUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  try {
    return verifyJwtToken(token);
  } catch (_error) {
    return null;
  }
}

export function verifyJwtToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ─── Existing: login ────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const users = readUsersFile();
    const user = users.find((entry) => entry.username === username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    return res.json({
      token: signUserToken(user),
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('[auth] Login failed:', error);
    return res.status(500).json({ error: 'Failed to authenticate user' });
  }
});

// ─── Existing: me ───────────────────────────────────────────────────────────

router.get('/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.json({ user: sanitizeUser(user) });
});

// ─── New: registration ──────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  // Validate username
  if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 alphanumeric characters' });
  }

  // Validate password
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  // Validate email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    const users = readUsersFile();

    if (users.some((u) => u.username === username)) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const newUser = {
      username,
      password: hashed,
      email,
      role: 'user',
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    writeUsersFile(users);

    return res.json({
      token: signUserToken(newUser),
      user: sanitizeUser(newUser),
    });
  } catch (error) {
    console.error('[auth] Registration failed:', error);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── New: providers info ────────────────────────────────────────────────────

router.get('/providers', (_req, res) => {
  const githubConfigured = Boolean(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
  );
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

  const providers = ['email'];
  if (githubConfigured) providers.push('github');
  if (googleConfigured) providers.push('google');

  return res.json({ providers, githubConfigured, googleConfigured });
});

// ─── New: GitHub OAuth ──────────────────────────────────────────────────────

router.get('/github', (req, res, next) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(404).json({ error: 'GitHub OAuth not configured' });
  }
  passport.authenticate('github', { scope: ['user:email'] })(req, res, next);
});

router.get('/github/callback', (req, res, next) => {
  passport.authenticate('github', { session: false }, (err, user) => {
    if (err || !user) {
      return res.redirect(`${OAUTH_CALLBACK_BASE}/login?error=oauth_failed`);
    }
    const token = signUserToken(user);
    return res.redirect(
      `${OAUTH_CALLBACK_BASE}/auth/callback?token=${encodeURIComponent(token)}&username=${encodeURIComponent(user.username)}`
    );
  })(req, res, next);
});

// ─── New: Google OAuth ──────────────────────────────────────────────────────

router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(404).json({ error: 'Google OAuth not configured' });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) {
      return res.redirect(`${OAUTH_CALLBACK_BASE}/login?error=oauth_failed`);
    }
    const token = signUserToken(user);
    return res.redirect(
      `${OAUTH_CALLBACK_BASE}/auth/callback?token=${encodeURIComponent(token)}&username=${encodeURIComponent(user.username)}`
    );
  })(req, res, next);
});

export default router;
