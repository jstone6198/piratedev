import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const VAULTS_DIR = '/home/claude-runner/config/user-vaults';
const IDE_SECRET_PATH = '/home/claude-runner/config/ide-secret.txt';

let IDE_KEY = '';
try {
  IDE_KEY = fs.readFileSync(IDE_SECRET_PATH, 'utf-8').trim();
} catch (_) {}

const DEFAULT_VAULT = {
  llmProviders: {},
  defaultProvider: 'codex',
  agentProvider: 'codex',
  completionProvider: 'codex',
  globalConnectors: {},
  editorPrefs: { theme: 'dark', fontSize: 14, tabSize: 2, wordWrap: false, minimap: true },
  idePrefs: { defaultTemplate: 'react-app', autoSave: true },
};

function deriveKey(userId) {
  return crypto.createHash('sha256').update(IDE_KEY + ':user:' + userId).digest();
}

function vaultPath(userId) {
  return path.join(VAULTS_DIR, `${userId}.enc`);
}

function encrypt(data, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(buf, key) {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

export function readVault(userId = 'default') {
  const fp = vaultPath(userId);
  if (!fs.existsSync(fp)) {
    return JSON.parse(JSON.stringify(DEFAULT_VAULT));
  }
  const key = deriveKey(userId);
  const buf = fs.readFileSync(fp);
  const data = decrypt(buf, key);
  // Merge with defaults so new fields are always present
  return { ...JSON.parse(JSON.stringify(DEFAULT_VAULT)), ...data };
}

export function writeVault(userId = 'default', data) {
  const fp = vaultPath(userId);
  // Backup before write
  if (fs.existsSync(fp)) {
    fs.copyFileSync(fp, fp + '.bak');
  }
  const key = deriveKey(userId);
  const buf = encrypt(data, key);
  fs.writeFileSync(fp, buf);
}

export function maskVault(data) {
  const masked = JSON.parse(JSON.stringify(data));
  // Mask llmProviders apiKeys
  if (masked.llmProviders) {
    for (const provider of Object.keys(masked.llmProviders)) {
      const p = masked.llmProviders[provider];
      if (p && p.apiKey) {
        p.apiKey = p.apiKey.slice(0, 8) + '****';
      }
    }
  }
  // Mask globalConnectors values
  if (masked.globalConnectors) {
    for (const connId of Object.keys(masked.globalConnectors)) {
      const conn = masked.globalConnectors[connId];
      if (conn && typeof conn === 'object') {
        for (const k of Object.keys(conn)) {
          if (typeof conn[k] === 'string' && conn[k].length > 8) {
            conn[k] = conn[k].slice(0, 8) + '****';
          }
        }
      }
    }
  }
  return masked;
}
