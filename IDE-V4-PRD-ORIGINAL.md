# JOSH IDE v4 — Production-Ready PRD + Session Handoff
**Created:** April 10, 2026
**Status:** READY FOR NEXT SESSION
**Source:** /home/claude-runner/projects/josh-replit/
**Production:** https://ide.callcommand.ai
**GitHub:** github.com/jstone6198/josh-ide (private, HTTPS push with token in remote)
**Backend:** Express + Socket.io, port 3220, PM2: replit-backend (ID 5)
**Frontend:** React + Vite, deployed to /var/www/replit/
**Deploy:** ./deploy.sh (git add+commit+push, npm run build, rsync, pm2 restart)
**PM2:** /home/claude-runner/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2

---

## CURRENT STATE (what exists on disk)

### Backend Routes (12 files in backend/routes/)
- files.js, projects.js, execute.js, git.js, env.js, search.js
- ai.js (dual engine: codex exec + claude -p, both $0 on VPS)
- preview.js (live preview server management)
- agent.js (prompt->plan->execute pipeline)
- vps.js (VPS filesystem browser)
- templates.js (project templates)
- vault.js (API key injection)

### Backend Services (2 files in backend/services/)
- terminal.js (xterm.js pty management)
- agent-orchestrator.js (plan generation + step execution + job tracking)

### Frontend Components (18 files in frontend/src/components/)
- AIChat.jsx (engine selector, conversation history, code action buttons)
- AgentPanel.jsx (prompt->plan->execute UI with rocket icon)
- CodeEditor.jsx (Monaco + minimap + breadcrumbs)
- CommandPalette.jsx (Ctrl+Shift+P)
- ElementInspector.jsx (preview element selection)
- EnvPanel.jsx (.env key-value editor)
- FileExplorer.jsx (tree + icons + context menu)
- GitPanel.jsx (status/commit/push/pull/log)
- PackagePanel.jsx (npm/pip package management)
- PreviewPane.jsx (iframe + url bar + refresh)
- ProjectSelector.jsx (project switcher + template creation)
- SearchPanel.jsx (grep-based project search)
- StatusBar.jsx (language, cursor pos, git branch)
- StyleEditor.jsx (CSS property editor for inspector)
- Terminal.jsx (xterm.js terminal)
- Toolbar.jsx (all toolbar buttons)
- VPSBrowser.jsx (VPS filesystem modal)
- VaultPanel.jsx (API key injection UI)

### Key Config Files
- frontend/src/api.js — API base + socket.io config
- backend/server.js — main Express server, all 12 routes registered
- deploy.sh — git push + build + rsync + pm2 restart
- .gitignore — excludes node_modules, dist, workspace, .env

---

## KNOWN BROKEN (fix these FIRST)

### 1. Socket.io path keeps reverting to /replit/socket.io/
**File:** frontend/src/api.js
**Problem:** Every time Codex or Claude Code touches this file, they rewrite the socket path back to /replit/socket.io/ instead of /socket.io/. This breaks the terminal (shows "disconnected").
**Fix:** After ANY build that touches api.js, verify the socket path is /socket.io/ NOT /replit/socket.io/. Consider adding a post-build check in deploy.sh:
```bash
if grep -q "replit/socket" frontend/src/api.js; then
  sed -i "s|/replit/socket.io/|/socket.io/|g" frontend/src/api.js
  echo "WARNING: Fixed /replit/ socket path"
fi
```
**Also verify:** vite.config.js has base: '/' NOT base: '/replit/'

### 2. Multiple AI engines edited App.jsx in parallel
**Problem:** Phase 3 (Claude Code), Phase 6+7 (Claude Code), and Phase 7 (Codex) all modified App.jsx independently. There may be merge conflicts, missing imports, or duplicate state declarations.
**Fix:** Read App.jsx carefully. Verify ALL component imports are present and not duplicated. Verify ALL toolbar buttons exist. Test that every panel/modal opens.

### 3. Backend port mismatch history
**Problem:** server.js says port 3220. Nginx was updated to proxy to 3220. But PM2 ecosystem file or env vars might still reference 3501 somewhere.
**Verify:** grep -r "3501" in the project. Should return zero results.

---

## V4 PRD — WHAT REPLIT HAS THAT WE DON'T

### PRIORITY 1: Agent Self-Testing (THE BIGGEST GAP)
**Why it matters:** Josh wants to paste an 80-page prompt. Without self-testing, the agent builds blind — it can't verify buttons work, pages render, or APIs respond.

**Task 1.1: Add browser-based test runner to agent orchestrator**
- File: backend/services/agent-orchestrator.js
- After each "create_file" or "edit_file" step that touches frontend code:
  - Auto-start the preview server for the project (use existing /api/preview/:project/start)
  - Wait for server to be ready (poll /api/preview/:project/status until running=true)
  - Use a headless check: spawn `curl -s -o /dev/null -w "%{http_code}" http://localhost:{port}/` to verify the page loads (200 OK)
  - For JS/React projects: run `npx vite build 2>&1` as a compilation check — if it fails, the step fails
  - For Node.js backends: run `node --check {file}` for syntax validation
  - Capture stdout/stderr and include in step output
- Add a new step type: "test" — runs a command and expects exit code 0
- After ALL steps complete, run a final validation: start preview, curl the main page, check for 200

**Task 1.2: Add test results to AgentPanel UI**
- File: frontend/src/components/AgentPanel.jsx
- Each step that includes a test shows: green checkmark (passed), red X (failed), yellow warning (skipped)
- Failed tests show the error output expandable
- Final validation shows a screenshot-like summary (or at minimum, the HTTP status + first 500 chars of response)

**Task 1.3: Add auto-fix loop**
- When a test fails, the agent should:
  1. Read the error output
  2. Send error + relevant file content to AI engine with prompt: "This test failed with the following error. Fix the code."
  3. Apply the fix
  4. Re-run the test
  5. Max 3 retries before marking step as failed
- This mimics Replit Agent's "test, find failures, fix" loop

### PRIORITY 2: Fix Socket.io Permanently
**Task 2.1: Lock api.js with a build guard**
- Add to deploy.sh BEFORE npm run build:
```bash
# Lock socket path
cat > frontend/src/api.js << APIEOF
import axios from 'axios';
import { io } from 'socket.io-client';
const IDE_KEY = window.IDE_KEY || '';
export const API_BASE = '';
export const api = axios.create({
  baseURL: '/api',
  headers: { 'x-ide-key': IDE_KEY },
});
export const socket = io(window.location.origin, {
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  auth: { ideKey: IDE_KEY },
});
export default api;
APIEOF
```
- This ensures the correct api.js is ALWAYS used regardless of what AI engines do to it

### PRIORITY 3: Built-in Database Provisioning
**Why:** Any serious app needs a database. Replit gives PostgreSQL + SQLite by default.

**Task 3.1: Add database provisioning endpoint**
- File: backend/routes/database.js (NEW)
- POST /api/database/:project/create — body: {type: "sqlite" | "postgresql"}
  - For SQLite: creates workspace/{project}/data.db, returns connection string
  - For PostgreSQL: creates a new database in the VPS MySQL/PostgreSQL instance (use the existing MySQL at /home/claude-runner/mysql/run/mysqld.sock or install PostgreSQL)
  - Returns: {type, connectionString, dbName}
- GET /api/database/:project/status — returns current database info
- POST /api/database/:project/query — body: {sql} — runs a query, returns results (for debugging)
- Register in server.js

**Task 3.2: Add database panel to frontend**
- File: frontend/src/components/DatabasePanel.jsx (NEW)
- Bottom tab alongside git/env/search/packages
- Shows: database type, connection string, table list
- Simple SQL query runner with results table
- "Create Database" button if none exists

**Task 3.3: Auto-inject database connection into .env**
- When database is created, automatically add DATABASE_URL to the project's .env file
- Agent orchestrator should know about available databases and include connection setup in generated plans

### PRIORITY 4: One-Click Project Deploy
**Why:** Projects built in the IDE need their own live URLs. Currently workspace projects just sit on disk.

**Task 4.1: Add deploy endpoint**
- File: backend/routes/deploy.js (NEW)
- POST /api/deploy/:project — deploys the project:
  - For static HTML: copies to /var/www/projects/{project}/, creates nginx server block at {project}.callcommand.ai
  - For Node.js: starts with PM2, creates nginx proxy, assigns port
  - For Python: starts with gunicorn or python3, creates nginx proxy
  - Auto-generates Let's Encrypt SSL cert: `sudo certbot --nginx -d {project}.callcommand.ai --non-interactive --agree-tos`
  - Returns: {url: "https://{project}.callcommand.ai", status: "deployed"}
- GET /api/deploy/:project/status — returns deploy state
- DELETE /api/deploy/:project — tears down the deployment
- Register in server.js
- **DNS:** Requires wildcard DNS *.callcommand.ai pointing to VPS. Check if this exists, if not, add via Cloudflare API.

**Task 4.2: Add deploy button to Toolbar**
- "Deploy" button (cloud-upload icon) in Toolbar.jsx
- Shows deploy modal: project name, detected type (static/node/python), estimated URL
- Progress indicator during deploy
- After deploy: shows live URL with "Open" button

### PRIORITY 5: Responsive Preview
**Why:** Dashboards and apps need to look right on all devices.

**Task 5.1: Add device toggles to PreviewPane**
- File: frontend/src/components/PreviewPane.jsx
- Add toolbar at top of preview with device icons: Desktop (100%), Tablet (768px), Mobile (375px)
- Clicking a device sets the iframe width + adds a device frame visual
- Current device persisted to localStorage
- Also add: zoom controls (50%, 75%, 100%, 150%)

### PRIORITY 6: Visual Text Editing in Preview (Replit's killer UX)
**Why:** This is what makes Replit feel magical — click text in preview, edit it, source code updates.

**Task 6.1: Upgrade ElementInspector for direct text editing**
- File: frontend/src/components/ElementInspector.jsx
- When inspect mode is active and user clicks a text element:
  - Make the text contentEditable in the iframe
  - On blur/Enter, capture the new text
  - Find the old text in the source file using grep/search
  - Replace it via /api/files PUT
  - No AI credits consumed — this is a deterministic string replacement
- For non-text elements (images, divs): show the current CSS inspector (already built in StyleEditor.jsx)

**Task 6.2: Add image swap in preview**
- When user clicks an image in inspect mode:
  - Show an upload dialog
  - Upload new image to project assets
  - Replace the src attribute in source code
  - Preview updates immediately

### PRIORITY 7: Checkpoint/Time Travel
**Why:** If agent breaks something at step 47 of 80, you need to roll back.

**Task 7.1: Add checkpoint system**
- File: backend/routes/checkpoints.js (NEW)
- POST /api/checkpoints/:project/create — body: {label} — creates a git commit with label as message, returns {id, label, timestamp}
- GET /api/checkpoints/:project — lists all checkpoints (git log --oneline)
- POST /api/checkpoints/:project/restore/:commitHash — runs git checkout {hash} to restore
- POST /api/checkpoints/:project/preview/:commitHash — shows file list at that commit (git show --stat {hash})
- Register in server.js
- Agent orchestrator should auto-create a checkpoint before each plan execution

**Task 7.2: Add checkpoint panel to frontend**
- File: frontend/src/components/CheckpointPanel.jsx (NEW)
- Timeline view showing checkpoints with labels and timestamps
- Click to preview (shows changed files)
- "Restore" button to roll back
- "Create Checkpoint" manual button

### PRIORITY 8: Error Console Panel
**Task 8.1: Add console output capture**
- File: frontend/src/components/ConsolePanel.jsx (NEW)
- Bottom tab alongside terminal
- When preview is running, inject a script that captures console.log/warn/error via postMessage
- Display with color coding: log=gray, warn=yellow, error=red
- Also capture unhandled promise rejections and syntax errors
- Clear button, filter by level

### PRIORITY 9: Inline Code Completion (Ghostwriter equivalent)
**Task 9.1: Add Monaco autocomplete provider**
- File: frontend/src/components/CodeEditor.jsx (modify)
- Register a Monaco CompletionItemProvider that:
  - On trigger (typing or Ctrl+Space), sends current line + surrounding context (20 lines above/below) to /api/ai/complete
  - New endpoint: POST /api/ai/complete — sends context to Codex/Claude with system prompt: "Complete this code. Return ONLY the completion, no explanation."
  - Returns completion suggestions as Monaco CompletionItems
  - Use Codex (faster) for completions, Claude for chat
- Show completions inline (ghost text) like Copilot
- Tab to accept, Escape to dismiss
- Debounce: 500ms after last keystroke before triggering

---

## EXECUTION ORDER FOR NEXT SESSION

1. Fix socket.io permanently (Priority 2) — 5 minutes, unblocks testing
2. Verify App.jsx integrity (Known Broken #2) — 10 minutes
3. Agent self-testing (Priority 1) — send to Claude Code Bridge
4. Responsive preview (Priority 5) — quick win, send to Codex
5. Database provisioning (Priority 3) — send to Claude Code Bridge
6. One-click deploy (Priority 4) — send to Claude Code Bridge
7. Visual text editing (Priority 6) — send to Codex
8. Checkpoint system (Priority 7) — send to Codex
9. Error console (Priority 8) — send to Codex
10. Inline completion (Priority 9) — send to Claude Code Bridge

## RULES FOR AI ENGINES
- Backend uses ES modules (import/export, NOT require)
- All API calls need x-ide-key header (window.IDE_KEY injected by PHP)
- Dark theme: #1e1e1e bg, #252526 panels, #cccccc text, #007acc accent
- NEVER touch frontend/src/api.js — deploy.sh locks it
- ALWAYS run ./deploy.sh after completing a phase
- Codex: /usr/bin/codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral
- Claude Code: claude -p --dangerously-skip-permissions --bare --model sonnet --no-session-persistence
- Both engines run on VPS at $0 (ChatGPT account + Max plan)
- Git pushes to github.com/jstone6198/josh-ide on every deploy

## WHAT WE BEAT REPLIT ON
- $0 AI cost (they charge $25-100/mo in credits)
- Full VPS access (they sandbox everything)
- Dual engine choice (Codex GPT-5.4 + Claude Sonnet)
- No vendor lock-in (files on your VPS, not their cloud)
- Can connect to ALL existing infrastructure (JobTread, Yeti, MSC, n8n)

## END STATE DEFINITION
Josh should be able to:
1. Open ide.callcommand.ai
2. Click "Agent" (rocket icon)
3. Paste an 80-page prompt
4. Select Codex or Claude
5. Review the generated plan (editable checklist)
6. Click "Execute"
7. Watch steps complete with green checkmarks and auto-testing
8. See the built app in the live preview pane
9. Toggle between mobile/tablet/desktop views
10. Click text in preview to edit it directly
11. Click "Deploy" to get a live URL
12. Never leave the browser
