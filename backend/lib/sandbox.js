/**
 * lib/sandbox.js - Workspace sandboxing utilities
 * Location: /home/claude-runner/projects/piratedev/backend/lib/sandbox.js
 *
 * Provides path validation, command blacklisting, and audit logging
 * to keep all operations confined to the workspace directory.
 */

import fs from 'fs';
import path from 'path';

const AUDIT_LOG = path.resolve(
  import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
  '../../audit.log'
);

// ---------------------------------------------------------------------------
// Command blacklist — patterns that should never run in the terminal
// ---------------------------------------------------------------------------
const BLOCKED_PATTERNS = [
  // Destructive recursive operations targeting root or critical paths
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\//,
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\//,
  // dd writing to block devices
  /dd\s+.*of=\/dev\//,
  // Fork bombs
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/,
  /\.\s*\/dev\/tcp/,
  // mkfs on any device
  /mkfs/,
  // Direct writes to block devices
  />\s*\/dev\/[sh]d/,
  // Shutdown / reboot
  /shutdown/,
  /reboot/,
  /init\s+[06]/,
  // chmod 777 on root
  /chmod\s+(-[a-zA-Z]*\s+)?777\s+\//,
  // Dangerous wget/curl pipes to shell
  /curl\s.*\|\s*(ba)?sh/,
  /wget\s.*\|\s*(ba)?sh/,
];

/**
 * Check if a command string matches any blocked pattern.
 * @param {string} command
 * @returns {{ blocked: boolean, pattern?: string }}
 */
export function isCommandBlocked(command) {
  const trimmed = command.trim();
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { blocked: true, pattern: pattern.toString() };
    }
  }
  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Validate that a resolved path is within the workspace boundary.
 * @param {string} workspaceDir - Absolute path to workspace root
 * @param {string} requestedPath - The path to validate (absolute or relative)
 * @returns {boolean}
 */
export function isWithinWorkspace(workspaceDir, requestedPath) {
  const resolved = path.resolve(workspaceDir, requestedPath);
  return resolved.startsWith(workspaceDir);
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

/**
 * Append an entry to the audit log.
 * @param {'terminal'|'file'|'execute'|'blocked'} type
 * @param {string} detail
 * @param {string} [socketId]
 */
export function auditLog(type, detail, socketId) {
  const ts = new Date().toISOString();
  const id = socketId ? ` [${socketId}]` : '';
  const line = `${ts}${id} [${type}] ${detail}\n`;
  fs.appendFile(AUDIT_LOG, line, (err) => {
    if (err) console.error('[sandbox] audit log write error:', err.message);
  });
}
