# Josh IDE v5 PRD — 30% Closer to Replit
**Created:** April 11, 2026
**Goal:** Jump from ~20% to ~50% of Replit feature parity

## TIER 1 — Biggest Impact (~15%)

### F1: Monaco IntelliSense for JS/TS
- Enable TypeScript language service in Monaco
- Autocomplete, hover docs, go-to-definition, error squiggles
- Configure tsconfig.json awareness per project
- Add type acquisition for node_modules

### F2: Per-Project Isolation
- Each project gets its own dir under workspace/
- Own package.json, node_modules, .env
- `npm install` runs inside project dir
- Terminal cwd matches active project
- Project switcher shows project metadata (type, deps count)

### F3: Multi-Language Auto-Detect + Run
- Detect project type from files (package.json=Node, requirements.txt=Python, go.mod=Go, Cargo.toml=Rust)
- Auto-configure run command per project type
- "Run" button in toolbar executes correct command
- Output streams to terminal panel
- Stop button kills running process
- Support: Node, Python, Go, Rust, static HTML

## TIER 2 — Strong Value (~10%)

### F4: Git Diff Viewer
- Monaco DiffEditor for side-by-side diffs
- View uncommitted changes per file
- Click file in git panel → opens diff view
- Inline diff toggle (unified vs split)

### F5: Package Manager with Search
- npm search API integration
- Search bar in PackagePanel
- Show package name, version, description, weekly downloads
- One-click install (npm install pkg)
- Show installed packages with versions
- Uninstall button

### F6: One-Click Deploy to Subdomains
- Each project deployable to {project}.ide.callcommand.ai
- Backend: nginx vhost generator + certbot
- Deploy button in toolbar
- Deploy log streams to terminal
- Static sites: copy to /var/www/{project}/
- Node apps: PM2 process per project

### F7: Dynamic Lazy Loading
- React.lazy() + Suspense for all panels
- Split: AIChat, AgentPanel, GitPanel, Terminal, DatabasePanel, etc.
- Loading skeleton for each panel
- Target: main bundle under 200KB

## TIER 3 — Polish (~5%)

### F8: Node.js Debugger
- Launch with --inspect flag
- Breakpoints panel in UI
- Step over/into/out controls
- Variable inspector
- Call stack viewer
- Uses Chrome DevTools Protocol over WebSocket

### F9: Per-Project Secrets Vault
- Encrypted .env storage per project
- UI to add/edit/delete env vars
- Injected at runtime (not in source)
- Never exposed in git
- AES-256 encryption at rest

### F10: File History + Blame
- Git log per file
- Inline blame annotations in editor gutter
- Click commit → view that version
- Diff between any two commits
