import express from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_PATH = path.resolve(__dirname, '..', '..', 'config', 'users.json');
const IDE_SECRET_PATH = '/home/claude-runner/config/ide-secret.txt';
const JWT_EXPIRES_IN = '12h';
const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.IDE_JWT_SECRET) return process.env.IDE_JWT_SECRET;

  try {
    return fs.readFileSync(IDE_SECRET_PATH, 'utf-8').trim();
  } catch (_error) {
    return 'josh-replit-jwt-dev-secret';
  }
})();

const router = express.Router();

function readUsersFile() {
  const raw = fs.readFileSync(USERS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.users) ? parsed.users : [];
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
    return jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return null;
  }
}

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

router.get('/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.json({ user: sanitizeUser(user) });
});

export default router;
