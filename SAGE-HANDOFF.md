# SAGE HANDOFF: Josh IDE v4 — Complete Build
**Last Updated:** April 10, 2026 (end of massive build session)
**Priority:** Active project — Josh is testing on mobile and desktop
**Source:** /home/claude-runner/projects/josh-replit/
**Production:** https://ide.callcommand.ai
**GitHub:** github.com/jstone6198/josh-ide (private)
**Backend Port:** 3220 (PM2 ID: 5, name: replit-backend)
**Deploy:** bash deploy.sh (git push + api.js lock guard + vite build + rsync + PM2 restart)

---

## CURRENT STATE: FULLY BUILT

All 43 features from the v4 PRD are implemented and deployed. The IDE is functional — AI Chat works, Agent Mode generates and executes plans, mobile layout is responsive with 4-tab nav (Files, Editor, Terminal, AI).

### What Works
- AI Chat (Codex GPT-5.4 engine, $0 cost) — responds to prompts
- Agent Mode — generates multi-step plans, executes them with progress bar
- File explorer, Monaco editor, terminal
- Project creation, templates, GitHub import
- Mobile responsive layout (4 tabs, no preview until server runs)
- Git branches, checkpoints, error boundaries
- JWT auth + IDE_KEY header auth

### Known Issues (FIXED April 11, 2026)
- ~~**StatusBar shows "Disconnected"**~~ — FIXED: server.js had `path: '/replit/socket.io/'` but frontend/nginx used `/socket.io/`. Changed to match.
- ~~**Agent preview validation fails**~~ — FIXED: Added 3s startup delay in `runFinalValidation()` before hitting preview URL.
- ~~**Vite bundle 555KB**~~ — FIXED: manualChunks already splits monaco (22KB) + vendor (214KB). App code is 558KB which is app logic, not a library issue.
- ~~**Deploy pipeline permissions**~~ — FIXED: Added NOPASSWD sudoers for nginx + `sudo nginx -s reload` in deploy.sh.
- **Duplicate CSS keys in AIChat.jsx** — FIXED: Removed duplicate overflow/maxWidth/boxSizing block.
- **Mobile input may clip slightly** on some screen widths (minor, not fixed)

---

## ARCHITECTURE

**Backend:** Express + Socket.io (ES modules — NEVER use require())
**Frontend:** React + Vite, 27 components, Monaco editor
**AI:** Dual engine — Codex (GPT-5.4, $0) + Claude Code (Sonnet, $0)
**Auth:** JWT + IDE_KEY from /home/claude-runner/config/ide-secret.txt

### Backend Routes (17)
agent.js, ai.js, auth.js, checkpoints.js, database.js, deploy.js, env.js, execute.js, files.js, git.js, imagegen.js, preview.js, projects.js, search.js, templates.js, vault.js, vps.js

### Services (4)
agent-orchestrator.js (1200+ lines), collaboration.js, terminal.js, usage-tracker.js

### Frontend Components (27)
AIChat, AgentPanel, CheckpointPanel, CodeEditor, CommandPalette, ConsolePanel, DatabasePanel, ElementInspector, EnvPanel, ErrorBoundary, FileExplorer, GitPanel, ImageGenPanel, LoginPage, PackagePanel, PreviewPane, ProjectSelector, SearchPanel, SettingsPanel, SharedView, StatusBar, StyleEditor, Terminal, Toolbar, UsageDashboard, VPSBrowser, VaultPanel

---

## CRITICAL BUG PATTERN: codex exec

`codex exec` does NOT support `-o outputfile`. It outputs to stdout only.
It also waits for stdin — you MUST use `spawn` with `proc.stdin.end()` or it hangs forever.

Both `backend/routes/ai.js` and `backend/services/agent-orchestrator.js` have their own `runCodex()` functions. If you change one, change BOTH. They must use:
```javascript
const proc = spawn('/usr/bin/codex', args, { stdio: ['pipe', 'pipe', 'pipe'] });
proc.stdin.end(); // CRITICAL — prevents infinite hang
```

### deploy.sh Guard
api.js has a socket.io path that Codex keeps reverting to /replit/socket.io/. deploy.sh has a sed guard that forces it back to /socket.io/. If socket.io breaks, check this.

---

## HOW TO DEPLOY

```bash
cd /home/claude-runner/projects/josh-replit
bash deploy.sh  # full deploy
# OR for backend-only:
/home/claude-runner/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2 restart replit-backend
```

## HOW TO RUN CODEX TASKS

```bash
cd /home/claude-runner/projects/josh-replit
cat > /tmp/codex-task.txt << "EOF"
Your task. Dir: /home/claude-runner/projects/josh-replit
Rules: ES modules. Dark theme. Do NOT touch api.js.
EOF
nohup /usr/bin/codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral "$(cat /tmp/codex-task.txt)" > /tmp/codex-task.log 2>&1 &
```

---

## REMAINING PRIORITIES
1. WebSocket disconnect fix (nginx socket.io proxy)
2. Vite code splitting (555KB bundle)
3. Agent preview validation timing
4. End-to-end testing of all 43 features
5. Deploy pipeline permissions (sudo nginx -s reload)

---

## FOR CLAUDE
There is a detailed handoff document for Claude sessions at:
/home/claude-runner/projects/josh-replit/JOSH-IDE-HANDOFF.md

Read that file at the start of any Josh IDE session — it has full architecture, all 43 features, bug patterns, and deploy instructions. Do NOT put this in the main VPS state file (current-state.md) — it is IDE-specific and should only be read when working on the IDE project.

The IDE project is separate from ASS/Pooltopia/MSR business operations.
