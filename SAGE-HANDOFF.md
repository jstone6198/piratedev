# SAGE HANDOFF: Josh IDE v3 Build
**Date:** April 10, 2026
**Priority:** HIGH - Josh wants this launched ASAP
**Source:** /home/claude-runner/projects/josh-replit/
**Production:** https://ide.callcommand.ai
**GitHub:** github.com/jstone6198/josh-ide (private)
**Deploy:** Run ./deploy.sh after every phase (git push + build + rsync + pm2 restart)

## WHAT'S DONE
- Phase 5: AI Chat upgraded (engine selector Codex/Claude, conversation history, code action buttons) - DEPLOYED
- Phase 1: Live Preview (preview.js, PreviewPane.jsx, nginx proxy, auto-reload) - DEPLOYED
- Git repo initialized and pushed to GitHub
- deploy.sh created and working
- Dual AI engines: codex exec + claude -p, both $0 on VPS

## WHAT'S LEFT (use Codex CLI for all - Claude Code hit rate limit)

### Phase 2: Agent Mode (THE BIG ONE)
Use: cd /home/claude-runner/projects/josh-replit && codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral

Task: Build agent orchestrator system:
1. backend/services/agent-orchestrator.js - generatePlan(prompt, engine) sends to AI for JSON step array, executePlan runs steps sequentially
2. backend/routes/agent.js - POST /plan, POST /execute, GET /status/:jobId, socket events for progress
3. frontend/src/components/AgentPanel.jsx - modal with textarea, plan editor, execute with live progress
4. Wire into App.jsx with rocket icon button
5. Plan persistence in .josh-ide/plans/
6. Run ./deploy.sh

### Phase 3: VPS Access + Templates
1. backend/routes/vps.js - browse/read VPS filesystem (scoped to /home/claude-runner/)
2. backend/routes/templates.js - project templates (react-app, node-api, python-script, static-html)
3. backend/routes/vault.js - API key vault from /home/claude-runner/config/ with inject-to-project
4. Wire all into server.js, add UI panels
5. Run ./deploy.sh

### Phase 6: Package Manager + Terminal
1. frontend/src/components/PackagePanel.jsx - reads package.json/requirements.txt, install/remove
2. Multiple terminal tabs (independent pty sessions)
3. Run ./deploy.sh

### Phase 4: Visual Inspector
1. Element selection overlay injected into preview iframe
2. Style editor panel with live CSS editing
3. Run ./deploy.sh

### Phase 7: Polish
1. Command palette (Ctrl+Shift+P)
2. Breadcrumb navigation
3. Split editor (Ctrl+\)
4. Minimap toggle
5. Run ./deploy.sh

## CRITICAL RULES
- Backend uses ES modules (import/export, NOT require)
- API needs x-ide-key header (window.IDE_KEY injected by PHP)
- Dark theme: #1e1e1e bg, #cccccc text, #007acc accent
- ALWAYS run ./deploy.sh after completing a phase
- Git pushes to github.com/jstone6198/josh-ide on every deploy
- Test at https://ide.callcommand.ai after each deploy

## HOW TO RUN CODEX FOR EACH PHASE
```bash
cd /home/claude-runner/projects/josh-replit
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral "[PASTE TASK DESCRIPTION HERE]"
```

## DOCUMENTING CHANGES
After each phase, append to /home/claude-runner/projects/josh-replit/BUILD-LOG.md:
```
## Phase X: [Name] - [Date/Time]
- Files created: [list]
- Files modified: [list]
- Status: deployed/failed
- Notes: [any issues]
```

Also update /home/claude-runner/docs/current-state.md with a Josh IDE section.

## FOR CLAUDE (when back online)
Read BUILD-LOG.md and SAGE-HANDOFF.md to see what Sage completed.
Check git log for commits since this handoff.
Verify each phase works at ide.callcommand.ai.
Pick up remaining phases.
