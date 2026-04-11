# JOSH IDE v5 PRD — Close All Replit Gaps
**Date:** April 11, 2026
**Author:** Josh Stone + Claude
**Status:** Ready for execution
**Live:** https://ide.callcommand.ai
**Repo:** /home/claude-runner/projects/josh-replit/

---

## OBJECTIVE

Close every meaningful feature gap between Josh IDE and Replit. After v5, Josh IDE should match or exceed Replit on every dimension that matters, while maintaining the $0 cost advantage and no vendor lock-in.

---

## EXECUTION RULES

- All Codex tasks: ES modules, dark theme, do NOT touch api.js
- Backend: spawn + stdin.end() for all codex exec calls (NEVER execFile, NEVER -o flag)
- deploy.sh after every batch (has api.js socket.io guard)
- Parallel tasks where no file overlap; sequential where files shared
- Test at https://ide.callcommand.ai after each deploy

---

## PRIORITY 1: DATABASE (PostgreSQL + GUI)
**Files:** backend/routes/database.js, frontend/src/components/DatabasePanel.jsx
**Effort:** Medium

Current state: SQLite only via better-sqlite3. Need full PostgreSQL support.

### Tasks:
1. Add PostgreSQL provisioning per project
   - Use the VPS MySQL socket or install PostgreSQL on VPS
   - POST /api/database/:project/provision - creates a new PG database for the project
   - Auto-set DATABASE_URL in project .env
   - Support both SQLite (existing) and PostgreSQL (new) via a selector

2. SQL Runner in DatabasePanel
   - Text area for SQL queries with syntax highlighting
   - Execute button that runs against the project database
   - Results displayed as a sortable table
   - Query history (last 20 queries)

3. Visual Data Browser (like Drizzle Studio)
   - Table list sidebar
   - Click a table to see rows with pagination
   - Inline edit cells
   - Add/delete rows
   - Schema viewer (columns, types, constraints)

4. Database backup/restore
   - GET /api/database/:project/backup - downloads a SQL dump
   - POST /api/database/:project/restore - uploads and restores

---

## PRIORITY 2: PARALLEL AGENT TASKS (Kanban Board)
**Files:** backend/services/agent-orchestrator.js, frontend/src/components/AgentPanel.jsx
**Effort:** High

Current state: Agent executes steps sequentially. Need parallel execution with visual Kanban.

### Tasks:
1. Modify agent-orchestrator.js:
   - Analyze plan steps for dependencies (which steps can run in parallel)
   - Group independent steps into parallel batches
   - Execute each batch concurrently using Promise.allSettled
   - Track status per step: draft, active, done, failed
   - Socket emit progress per individual step

2. Kanban board UI in AgentPanel:
   - Four columns: Draft | Active | Done | Failed
   - Step cards show: description, type icon, elapsed time
   - Cards animate from column to column
   - Active cards show spinner + live output stream
   - Failed cards show error with "Retry" button
   - Click any card to see full output

3. Agent Plan Editing:
   - Drag-and-drop to reorder steps
   - Add/remove steps before execution
   - Toggle steps on/off (skip)
   - Mark dependencies between steps

---

## PRIORITY 3: BUILT-IN AUTH SCAFFOLD
**Files:** backend/routes/auth-scaffold.js (NEW), templates/
**Effort:** Medium

Current state: IDE has its own JWT auth, but no way to add auth TO a user project.

### Tasks:
1. POST /api/auth-scaffold/:project/add - body: {provider: "google|github|email"}
   - Injects auth boilerplate into the project:
     - For Express: passport.js + express-session + login/register routes + middleware
     - For Next.js: NextAuth.js configuration
     - For static: Firebase Auth client-side
   - Creates login page component
   - Creates user model/schema
   - Updates project .env with placeholder keys

2. UI: "Add Auth" button in Toolbar
   - Opens modal with provider selection (Google, GitHub, Email/Password)
   - Framework auto-detected from package.json
   - One-click scaffold with progress indicator
   - Shows post-setup instructions ("Add your Google Client ID to .env")

---

## PRIORITY 4: OBJECT STORAGE / FILE UPLOADS
**Files:** backend/routes/storage.js (NEW), frontend/src/components/StoragePanel.jsx (NEW)
**Effort:** Medium

Current state: No blob/file storage for user projects.

### Tasks:
1. Per-project storage directory: workspace/{project}/.storage/
   - POST /api/storage/:project/upload - multipart file upload
   - GET /api/storage/:project/files - list stored files
   - GET /api/storage/:project/file/:filename - serve file
   - DELETE /api/storage/:project/file/:filename
   - GET /api/storage/:project/usage - total size

2. StoragePanel UI:
   - Drag-and-drop file upload zone
   - Grid view of stored files with thumbnails (images) or file icons
   - Click to preview (images, PDFs, text files)
   - Copy public URL button
   - Delete with confirmation
   - Usage bar showing storage used

3. Auto-integration:
   - When agent creates an app with image uploads, auto-configure multer + storage routes
   - Uploaded files accessible via /api/storage/:project/file/:filename in preview

---

## PRIORITY 5: MULTI-LANGUAGE SUPPORT
**Files:** backend/routes/execute.js, backend/routes/preview.js, templates/
**Effort:** Medium

Current state: Node.js/Python only. Need broader language support.

### Tasks:
1. Language detection from file extensions:
   - .py -> Python 3
   - .js/.ts -> Node.js
   - .go -> Go (if installed)
   - .rs -> Rust (if installed)
   - .rb -> Ruby (if installed)
   - .php -> PHP (if installed)

2. Per-language run commands:
   - Python: python3 {file}
   - Node: node {file}
   - Go: go run {file}
   - Rust: cargo run (if Cargo.toml) or rustc {file} && ./{binary}

3. New templates:
   - python-flask (exists), python-fastapi, python-django
   - go-api, go-web
   - rust-hello, rust-api
   - php-basic
   - html-tailwind (static with Tailwind CDN)

4. Monaco language modes:
   - Ensure syntax highlighting works for Go, Rust, Ruby, PHP, C, C++
   - These should already work in Monaco but verify

---

## PRIORITY 6: SECURITY SCANNER
**Files:** backend/routes/security.js (NEW), frontend/src/components/SecurityPanel.jsx (NEW)
**Effort:** Medium

Current state: No security scanning.

### Tasks:
1. POST /api/security/:project/scan
   - Scans project files for common vulnerabilities:
     - Hardcoded secrets/API keys (regex patterns)
     - Known vulnerable npm packages (npm audit)
     - SQL injection patterns
     - XSS patterns
     - Insecure HTTP usage
     - .env files committed to git
   - Returns array of {file, line, severity, message, suggestion}

2. SecurityPanel UI:
   - Scan button in Toolbar (shield icon)
   - Results grouped by severity: Critical, High, Medium, Low
   - Click a finding to jump to file:line in editor
   - "Fix with AI" button that sends the finding to AI Chat for remediation
   - Pre-deploy scan option (scan runs before every deploy)

3. npm audit integration:
   - Parse npm audit --json output
   - Show vulnerable packages with fix suggestions
   - "Auto-fix" button that runs npm audit fix

---

## PRIORITY 7: AUTOSCALE DEPLOY
**Files:** backend/routes/deploy.js (modify)
**Effort:** Low-Medium

Current state: Deploy is always-on single process. Need scale-to-zero.

### Tasks:
1. Deploy types selector in Toolbar deploy modal:
   - Always-On (current behavior - PM2 process)
   - Static (rsync HTML/CSS/JS to nginx, no server process)
   - Auto-restart (PM2 with watch mode + crash recovery)

2. Health check endpoint:
   - Deployed apps get /health auto-injected
   - Deploy dashboard shows uptime, last restart, memory usage

3. PM2 cluster mode option:
   - For high-traffic apps, deploy with PM2 cluster (multiple instances)
   - Configurable instance count (1-4)

---

## PRIORITY 8: EXTERNAL CONNECTORS / MCP
**Files:** backend/routes/connectors.js (NEW), frontend/src/components/ConnectorPanel.jsx (NEW)
**Effort:** High

Current state: No external service integrations.

### Tasks:
1. Connector framework:
   - POST /api/connectors/:project/add - body: {type: "stripe|github|slack|sheets"}
   - Each connector injects: npm package, env vars, example code
   - Connector configs stored in workspace/{project}/.connectors.json

2. Built-in connectors (start with 5):
   - **Stripe** - stripe npm package + webhook route + example checkout
   - **GitHub API** - octokit + example repo list
   - **Slack** - @slack/web-api + example message sender
   - **Google Sheets** - googleapis + example read/write
   - **SendGrid/Resend** - email sending + example transactional email

3. ConnectorPanel UI:
   - Grid of available connectors with icons
   - Click to add - shows setup wizard (enter API key, select features)
   - Active connectors list with status indicators
   - "Test Connection" button for each

---

## PRIORITY 9: VERSION HISTORY WITH PLAYBACK
**Files:** backend/routes/checkpoints.js (modify), frontend/src/components/CheckpointPanel.jsx (modify)
**Effort:** Medium

Current state: Git-based checkpoints (snapshot/restore). No timeline playback.

### Tasks:
1. Enhanced checkpoint system:
   - Auto-checkpoint every 5 minutes (configurable)
   - Auto-checkpoint on every file save (debounced 30s)
   - Each checkpoint stores: timestamp, changed files, diff summary
   - GET /api/checkpoints/:project/timeline - returns ordered list with diffs

2. Timeline UI:
   - Visual timeline slider at bottom of CheckpointPanel
   - Scrub through time to see project state at any point
   - Diff view showing what changed between any two checkpoints
   - "Restore to this point" button
   - AI-generated summaries for each checkpoint ("Added user login page")

---

## PRIORITY 10: MOBILE APP PUBLISHING
**Files:** backend/routes/mobile.js (NEW), frontend/src/components/MobilePublishPanel.jsx (NEW)
**Effort:** High

Current state: No mobile app building support.

### Tasks:
1. React Native + Expo template:
   - New template: "mobile-app" using Expo + React Native
   - Pre-configured with: expo-router, basic navigation, splash screen

2. Mobile preview:
   - QR code in preview panel for Expo Go scanning
   - Device frame mockup in preview (iPhone/Android toggle)

3. Build pipeline:
   - POST /api/mobile/:project/build - triggers EAS Build (requires expo account)
   - Build status polling with progress
   - Download .apk/.ipa when complete

4. Store submission guide:
   - Step-by-step instructions panel for App Store / Play Store
   - Asset generator (icons, splash screens via AI image gen)

---

## PRIORITY 11: DESIGN CANVAS (VISUAL UI BUILDER)
**Files:** frontend/src/components/DesignCanvas.jsx (NEW)
**Effort:** Very High

Current state: Visual text editing in preview only. No design canvas.

### Tasks:
1. Design Canvas panel (opens as full-screen overlay):
   - Infinite canvas for arranging UI components
   - Drag components from a palette (buttons, inputs, cards, navbars, etc.)
   - Property inspector on the right (colors, fonts, spacing, etc.)
   - Generate multiple design variants from a prompt
   - Side-by-side comparison of variants
   - "Apply to Project" exports components as React/HTML code

2. AI-powered design:
   - "Design this page" prompt generates 3 visual options
   - Each option is a full React component preview
   - Pick one or ask for modifications
   - Responsive preview (desktop/tablet/mobile side by side)

---

## PRIORITY 12: WEBSOCKET FIX + MISC POLISH
**Files:** nginx config, various
**Effort:** Low

### Tasks:
1. Fix nginx socket.io proxy for ide.callcommand.ai
   - StatusBar should show "Connected" not "Disconnected"
   - Terminal depends on working WebSocket

2. Vite code splitting:
   - Add manualChunks to vite.config.js
   - Split Monaco, vendor, and app code
   - Target < 300KB per chunk

3. Mobile polish:
   - Fix input clip on AI chat
   - Ensure all panels work on mobile
   - Touch-friendly context menus

4. Onboarding:
   - First-time user walkthrough (tooltip tour)
   - "Create your first project" guided flow
   - Sample project that demonstrates all features

---

## EXECUTION ORDER

Parallel Batch 1 (no file overlap):
- P1: PostgreSQL (database.js, DatabasePanel.jsx)
- P4: Object Storage (storage.js, StoragePanel.jsx)
- P6: Security Scanner (security.js, SecurityPanel.jsx)
- P12: WebSocket fix + Vite splitting (nginx, vite.config.js)

Parallel Batch 2:
- P2: Parallel Agent Kanban (agent-orchestrator.js, AgentPanel.jsx)
- P3: Auth Scaffold (auth-scaffold.js, Toolbar.jsx)
- P5: Multi-Language (execute.js, preview.js, templates/)

Parallel Batch 3:
- P7: Autoscale Deploy (deploy.js)
- P8: Connectors (connectors.js, ConnectorPanel.jsx)
- P9: Version History (checkpoints.js, CheckpointPanel.jsx)

Sequential (complex, needs iteration):
- P10: Mobile App Publishing
- P11: Design Canvas

---

## SUCCESS CRITERIA

After v5, Josh IDE should:
- Match Replit on every feature category except native mobile app and Nix ecosystem
- Beat Replit on cost ($0 vs $25-$100/mo)
- Beat Replit on AI engine flexibility (GPT-5.4 + Claude Sonnet)
- Beat Replit on editor quality (Monaco > CodeMirror 6)
- Beat Replit on data ownership (your VPS, your code, your GitHub)
- Have zero "spinning forever" bugs
- Work smoothly on mobile (no overflow, no broken tabs)

---

*Estimated total: 12 priorities, ~40 Codex tasks, 3 parallel batches + 2 sequential. At the pace of this session (43 features in one sitting), this is achievable in 1-2 sessions.*
