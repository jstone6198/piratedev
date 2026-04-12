import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { readVault, writeVault } from '../services/user-vault.js';

const router = Router();

const IDE_SECRET_PATH = '/home/claude-runner/config/ide-secret.txt';
let SECRET = '';
try {
  SECRET = fs.readFileSync(IDE_SECRET_PATH, 'utf-8').trim();
} catch (_) {}

const TIER_FEATURES = {
  free: ['projects_3', 'ai_chat', 'file_editor', 'terminal'],
  pro: ['projects_3', 'ai_chat', 'file_editor', 'terminal',
        'projects_unlimited', 'agent', 'live_preview', 'git_sync', 'connectors_5', 'byok'],
  team: ['projects_3', 'ai_chat', 'file_editor', 'terminal',
         'projects_unlimited', 'agent', 'live_preview', 'git_sync', 'connectors_5', 'byok',
         'connectors_unlimited', 'collaboration', 'usage_dashboard', 'priority_support'],
};

const DEV_KEY = 'PD-DEV1-TEST-ABCD-1234';

function validateKey(key) {
  if (!key || typeof key !== 'string') return { valid: false, tier: 'free', message: 'No key provided' };

  // Accept dev key
  if (key === DEV_KEY) return { valid: true, tier: 'pro', message: 'Dev key accepted' };

  const parts = key.split('-');
  if (parts.length !== 5 || parts[0] !== 'PD') {
    return { valid: false, tier: 'free', message: 'Invalid key format' };
  }

  const [, seg1, seg2, seg3, seg4] = parts;
  const payload = `${seg1}-${seg2}`;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 8).toUpperCase();
  const provided = seg3 + seg4;

  if (provided !== expected) {
    return { valid: false, tier: 'free', message: 'Invalid license key' };
  }

  const tier = [seg1, seg2, seg3, seg4].some(s => s.includes('TEAM')) ? 'team' : 'pro';
  return { valid: true, tier, message: `Valid ${tier} license` };
}

// POST /api/license/validate
router.post('/validate', (req, res) => {
  const { key } = req.body;
  const result = validateKey(key);

  if (result.valid) {
    const vault = readVault();
    vault.licenseKey = key;
    vault.licenseTier = result.tier;
    writeVault('default', vault);
  }

  return res.json({
    valid: result.valid,
    tier: result.tier,
    features: TIER_FEATURES[result.tier],
    message: result.message,
  });
});

// GET /api/license/status
router.get('/status', (_req, res) => {
  const vault = readVault();
  const key = vault.licenseKey || null;
  const tier = vault.licenseTier || 'free';

  return res.json({
    valid: !!key,
    tier,
    features: TIER_FEATURES[tier] || TIER_FEATURES.free,
    licenseKey: key ? key.slice(0, 7) + '****' : null,
  });
});

// DELETE /api/license/key
router.delete('/key', (_req, res) => {
  const vault = readVault();
  delete vault.licenseKey;
  delete vault.licenseTier;
  writeVault('default', vault);
  return res.json({ message: 'License key removed', tier: 'free', features: TIER_FEATURES.free });
});

// POST /api/license/generate (admin only — requires x-ide-key)
router.post('/generate', (req, res) => {
  if (!req.auth || req.auth.type !== 'ide-key') {
    return res.status(403).json({ error: 'Admin access required (x-ide-key)' });
  }

  const { tier = 'pro', label } = req.body;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const randSeg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

  let seg1 = randSeg();
  const seg2 = randSeg();

  if (tier === 'team') {
    seg1 = 'T' + seg1.slice(1);
  }

  const payload = `${seg1}-${seg2}`;
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 8).toUpperCase();
  const seg3 = hmac.slice(0, 4);
  const seg4 = hmac.slice(4, 8);
  const key = `PD-${seg1}-${seg2}-${seg3}-${seg4}`;

  return res.json({ key, tier, label: label || null });
});

export default router;
