# SAGE HANDOFF: Josh IDE v5 — Production State
**Last Updated:** April 11, 2026
**Production:** https://ide.callcommand.ai
**GitHub:** github.com/jstone6198/josh-ide (private)
**Backend Port:** 3220 (PM2 ID: 5, name: replit-backend)
**Deploy:** bash deploy.sh (git push + api.js lock guard + vite build + rsync + PM2 restart + nginx reload)

---

## CURRENT STATE: v5 DEPLOYED

### What Works
- AI Chat (Codex GPT-5.4 engine, $0 cost)
- Agent Mode — generates multi-step plans, executes with progress bar
- File explorer, Monaco editor with JS/TS IntelliSense, terminal
- Project creation, templates, GitHub import
- Mobile responsive layout (4 tabs)
- Git branches, checkpoints, error boundaries
- JWT auth + IDE_KEY header auth
- Socket.io WebSocket connected (FIXED v4 path mismatch)
- 17 panels lazy-loaded via React.lazy() + Suspense
- One-click deploy to subdomains ({project}.ide.callcommand.ai)

### Architecture
**Backend:** Express + Socket.io (ES modules — NEVER use require())
**Frontend:** React + Vite, 31 components, Monaco editor
**AI:** Dual engine — Codex (GPT-5.4, $0) + Claude Code (Sonnet, $0)
**Auth:** JWT + IDE_KEY from /home/claude-runner/config/ide-secret.txt

### Backend Routes (22 total)
Original v4 (17): agent, ai, auth, checkpoints, database, deploy, env, execute, files, git, imagegen, preview, projects, search, templates, vault, vps
v5 new (5): runner, packages, diff, history, secrets
v5 F6 (1): subdomain-deploy

### Frontend Components (31 total)
Original v4 (27): AIChat, AgentPanel, CheckpointPanel, CodeEditor, CommandPalette, ConsolePanel, DatabasePanel, ElementInspector, EnvPanel, ErrorBoundary, FileExplorer, GitPanel, ImageGenPanel, LoginPage, PackagePanel, PreviewPane, ProjectSelector, SearchPanel, SettingsPanel, SharedView, StatusBar, StyleEditor, Terminal, Toolbar, UsageDashboard, VPSBrowser, VaultPanel
v5 new (4): DiffViewer (wired), FileHistory (wired), RunControls (wired), SecretsPanel (wired)

---

## CRITICAL BUG PATTERN: codex exec

`codex exec` does NOT support `-o outputfile`. Outputs to stdout only.
MUST use `spawn` with `proc.stdin.end()` or it hangs forever.
Both `backend/routes/ai.js` and `backend/services/agent-orchestrator.js` have their own `runCodex()`. Keep both in sync.

### deploy.sh Guard
api.js socket.io path gets reverted by Codex. deploy.sh has a sed guard.

---

## SUBDOMAIN DEPLOY SYSTEM (F6)

**Wildcard DNS:** *.ide.callcommand.ai -> 72.62.168.25 (Cloudflare, zone 2d256468c8eb0ac5e48860c3709bd491)
**Deploy dir:** /var/www/ide-projects/
**Nginx configs:** /etc/nginx/sites-enabled/ide-project-{name}
**Sudoers:** /etc/sudoers.d/claude-runner-nginx (NOPASSWD for nginx)

Endpoints:
- POST /api/subdomain-deploy/:project — auto-detect + deploy
- GET /api/subdomain-deploy/list — list all deployments
- DELETE /api/subdomain-deploy/:project — undeploy

Toolbar.jsx deploy button wired to these endpoints. URL pattern: http://{project}.ide.callcommand.ai
HTTP only (no SSL yet — needs certbot wildcard cert for HTTPS).

---

## WIRED (completed this session)
- **DiffViewer** — click changed file in GitPanel → opens DiffViewer over editor area
- **FileHistory** — History button in GitPanel → opens file history for active file
- **RunControls** — embedded in Toolbar center (project type detection + runner API)
- **SecretsPanel** — Secrets button in Toolbar (desktop + mobile) → renders below file explorer

## REMAINING TODO (next session)

### Must Build
1. **PackagePanel search upgrade** — Backend route exists (packages.js), frontend panel needs search bar + install/uninstall UI
2. **Per-project workspace isolation** (F2) — each project gets own node_modules, package.json. Currently shared workspace.
3. **HTTPS for subdomains** — certbot --dns-cloudflare wildcard cert for *.ide.callcommand.ai
4. **Node.js debugger** (F8) — --inspect flag, breakpoints panel, Chrome DevTools Protocol (lowest priority)

### Nice-to-Have
5. Per-project SQLite database (covers Replit DB equivalent)
6. Real-time collaborative editing (CRDT)

---

## HOW TO DEPLOY

```bash
cd /home/claude-runner/projects/josh-replit
bash deploy.sh  # full deploy (git + frontend build + rsync + PM2 + nginx)
# OR backend-only:
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

## FOR CLAUDE / SAGE
Read this file at the start of any Josh IDE session. Do NOT put IDE details in the main VPS state file (current-state.md) beyond a summary pointer. The IDE project is separate from ASS/Pooltopia/MSR business operations.

PRD: /home/claude-runner/projects/josh-replit/IDE-V5-PRD.md
