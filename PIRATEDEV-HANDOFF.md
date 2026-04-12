# PirateDev™ IDE — Session Handoff
**Updated:** April 12, 2026  
**Previous handoff:** PIRATEDEV-HANDOFF.md (this file — overwritten each session)

---

## What Was Built This Session

This was a massive build session. Two full PRDs were written and executed:

### PRD v6 — BYOK & Settings (all 4 phases complete)

**Phase 1 — LLM Router + User Vault + Settings API**
- `backend/services/user-vault.js` — AES-256-GCM encrypted per-user vault at `/home/claude-runner/config/user-vaults/default.enc`
- `backend/services/llm-router.js` — unified `callLLM()` supporting OpenAI, Anthropic, Google Gemini, Groq, Mistral, custom OpenAI-compatible endpoints, Codex CLI, Claude Code CLI
- `backend/routes/settings.js` — 10 REST endpoints: GET/PUT/DELETE for LLM providers, connectors, editor prefs, IDE prefs, export/import, PUT /defaults
- `/api/ai/engines` now returns 8 providers with `keyConfigured` state read from vault

**Phase 2 — Agent + Completion Use Vault**
- `agent-orchestrator.js` generatePlan() reads vault `agentProvider`, routes through callLLM() for BYOK, falls back to Codex CLI
- `/api/ai/complete` reads vault `completionProvider`, uses BYOK for inline completion
- `/api/ai/engines` returns `defaultProvider`, `agentProvider`, `completionProvider` from vault
- `PUT /api/settings/defaults` saves the Use-for dropdown selections

**Phase 3 — Settings UI**
- `frontend/src/components/SettingsPanel.jsx` — 4-tab modal: AI Models, Connectors, Editor, Account
- `frontend/src/components/SettingsPanel.css`
- `frontend/src/hooks/useSettings.js`
- Gear icon (⚙) in Toolbar opens Settings
- AI Models tab: 8 providers, key input with show/hide, model selector, Test + Save per provider, Use-for selectors (Chat/Agent/Completion)
- Connectors tab: Global Keys (vault-stored, auto-injected) + Project Keys
- Editor tab: font size, tab size, toggles, theme, keybindings
- Account tab: license key, export/import settings, danger zone

**Phase 4 — 20 Connectors (up from 5)**
Original 5: Stripe, GitHub, Slack, Google Sheets, Resend
New 15: Supabase, MongoDB Atlas, Redis/Upstash, Clerk, Auth0, Twilio, SendGrid, Discord, Notion, Airtable, Linear, Lemon Squeezy, S3/Cloudflare R2, Uploadthing, PlanetScale
Each has: CONNECTORS entry, EXAMPLES code snippet, testConnector() API verification

### PRD v7 — Competitive Features (all 4 complete)

**Feature 1 — Visual Diff Before Apply**
- `backend/routes/diff.js` — POST /preview (returns before/after for each file step), POST /apply (executes only accepted steps including shell commands)
- `frontend/src/components/DiffViewer.jsx` + `DiffViewer.css` — two-column before/after modal, green/red line highlighting, file tabs, Accept/Skip per file, Accept All/Reject All
- `AgentPanel.jsx` updated — calls /diff/preview before executing, shows DiffViewer, calls /diff/apply with accepted indices. Auto-apply toggle to skip review.

**Feature 2 — Live Preview Panel**
- `backend/routes/preview.js` rewritten — POST /start (auto-detects dev command, assigns port 3400-3499), GET /status/:project, POST /stop/:project, GET /logs/:project
- nginx already had /preview/(port) proxy block
- `PreviewPane.jsx` (529 lines) already existed with device toggle (desktop/tablet/mobile), zoom levels, URL bar, auto-reload on save
- Toolbar has preview toggle button, App.jsx has resizable preview sidebar with localStorage persistence

**Feature 3 — Codebase Context + PIRATEDEV.md**
- `backend/services/context-indexer.js` — indexProject() reads PIRATEDEV.md, package.json, README, key entry files, file tree. buildContextPrompt() enriches AI prompts.
- `backend/routes/context.js` — GET/POST PIRATEDEV.md per project, mounted at /api/context
- `ai.js /chat` — enriches prompt with project context (5s timeout, 30s cache)
- `frontend/src/components/ContextIndicator.jsx` — pill toggle in chat header, pencil to edit PIRATEDEV.md inline

**Feature 4 — GitHub Bidirectional Sync**
- `backend/routes/git.js` — full set: clone (with token), status (porcelain parse), commit, push, pull, log, branches, diff, checkout, merge, branch, init
- `frontend/src/components/GitPanel.jsx` + `GitPanel.css` — branch switcher, file status list (M/A/??/D with colors), Stage All, commit textarea + Commit, Pull + Push, last 5 commits, Clone Repo modal
- GitPanel rendered in App.jsx bottom panel git tab

---

## Current Architecture State

```
/home/claude-runner/projects/josh-replit/
  backend/
    routes/
      ai.js          — chat, complete, engines (BYOK via llm-router)
      agent.js       — agent plan + execution
      connectors.js  — 20 connectors with test + examples
      context.js     — PIRATEDEV.md read/write
      diff.js        — preview + apply for agent changes
      git.js         — full git operations
      preview.js     — live preview process management
      settings.js    — user vault CRUD (LLM keys, connectors, prefs)
      [+ files, projects, execute, auth, deploy, vault, etc.]
    services/
      agent-orchestrator.js  — plan gen + execution (BYOK aware)
      context-indexer.js     — project file indexing for AI
      llm-router.js          — unified callLLM() all providers
      user-vault.js          — AES-256-GCM encrypted settings
      [+ terminal, collaboration, usage-tracker, sandbox]
  frontend/src/components/
      AIChat.jsx             — chat panel (context-aware)
      AgentPanel.jsx         — agent with diff review
      ContextIndicator.jsx   — PIRATEDEV.md toggle
      DiffViewer.jsx         — before/after diff modal
      GitPanel.jsx           — full git UI
      PreviewPane.jsx        — iframe live preview
      SettingsPanel.jsx      — 4-tab settings modal
      Toolbar.jsx            — gear(settings), preview, git buttons
      [+ CodeEditor, FileExplorer, Terminal, etc.]
  frontend/src/hooks/
      useSettings.js         — settings API hook with toasts
```

---

## Key Config

- **Backend port:** 3220
- **PM2 process:** `piratedev-backend`
- **Webroot:** `/var/www/piratedev/`
- **Workspace:** `/home/claude-runner/projects/josh-replit/workspace/`
- **User vault:** `/home/claude-runner/config/user-vaults/default.enc`
- **IDE secret:** `/home/claude-runner/config/ide-secret.txt`
- **Nginx config:** `/etc/nginx/sites-available/piratedev`
- **Domain:** piratedev.ai (Cloudflare, zone 2b13a2acbf3ac8a63ef8cf2f1674cfb6)

---

## Build & Deploy (unchanged)

```bash
# Step 1: Build frontend
cd /home/claude-runner/projects/josh-replit/frontend && npm run build

# Step 2: Deploy
cd /home/claude-runner/projects/josh-replit && \
  sudo rsync -a --exclude='auth.bak' --delete frontend/dist/ /var/www/piratedev/ && \
  rsync -a --delete frontend/dist/ backend/public/

# Step 3: Restart backend
/home/claude-runner/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2 restart piratedev-backend
```

---

## PRD Files On VPS

```
/home/claude-runner/projects/josh-replit/
  IDE-V4-PRD-ORIGINAL.md
  IDE-V4-PRD.md
  IDE-V5-PRD.md
  IDE-V6-PRD-SETTINGS-LLM.md   ← BYOK + settings (this session)
  IDE-V7-PRD-COMPETITIVE.md    ← diff/preview/context/git (this session)
  PIRATEDEV-HANDOFF.md         ← this file
  SAGE-HANDOFF.md
```

---

## What's Left / Ideas for Next Session

### High Priority
1. **Landing page** — piratedev.ai root becomes marketing site, IDE moves to app.piratedev.ai. Needs nginx reconfig + static landing page.
2. **License key system** — `license.js` route + middleware + validation server. Ties into Account tab in Settings (already has the UI input).
3. **Async agent execution** — Submit job → get ID → poll for completion. Current synchronous flow times out on large tasks. Backend needs job queue.
4. **User auth / multi-user** — JWT-based accounts so multiple users can each have their own vault. Vault already designed for this (userId param).

### Medium Priority
5. **AI cost dashboard** — usage-tracker already logs all calls. Need a UI page showing cost breakdown by provider, model, project over time.
6. **Prompt-to-full-app** — AI reads prompt, picks template, scaffolds full project, opens with preview running. One prompt → working app.
7. **Error autopilot** — Monitor terminal for errors, surface with one-click Fix button in chat.
8. **VPS provisioning API** — Hetzner auto-spin for customer environments.

### Known Issues / Tech Debt
- Agent step display still shows steps as Done instantly (cosmetic timing bug from before)
- Preview panel uses polling (2s) — could be upgraded to WebSocket for instant feedback
- BYOK vault is single-user (default.enc) — needs userId routing when auth ships
- Settings UI connector tab needs updating to show all 20 connectors (was built before Phase 4 added 15 more)

---

## Session Notes

- Most features in PRD v7 were already partially/fully built in the codebase from prior sessions — the IDE is more complete than the handoff docs suggested.
- Previous handoff doc (PIRATEDEV-HANDOFF.md) has been replaced by this one.
- SAGE-HANDOFF.md is unrelated (Sage AI agent system on Mac Mini) — don't modify.
- Total build cost this session: ~$6.65 across 7 Claude Code Executor runs.
- GitHub: all changes committed and pushed to github.com/jstone6198/piratedev

---
*PirateDev™ is a trademark of Josh Stone. Zero Markup. Zero Apologies.*
