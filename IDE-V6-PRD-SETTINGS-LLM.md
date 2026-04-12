# PirateDev™ IDE — PRD v6: Settings, API Key Manager & Multi-LLM Backend
**Status:** Draft  
**Author:** Claude (Josh Stone session)  
**Date:** April 11, 2026  
**Depends on:** IDE-V5-PRD.md, current backend audit

---

## Executive Summary

Two related gaps are blocking PirateDev™ from being a true BYOK (Bring Your Own Key) product:

1. **No settings system** — users have nowhere to register their API keys at the account level. Keys are buried in per-project `.env` files and the UI has no way to manage them.
2. **No multi-LLM backend** — `backend/routes/ai.js` currently only supports two hardcoded engines (`codex` via CLI binary, `claude` via Claude Code CLI). Both use Josh's own accounts on the VPS — not user-provided keys. There is zero support for direct API calls to OpenAI, Anthropic, Google, Groq, Mistral, or any other provider.

This PRD covers the full Settings + API Key Manager system and the backend LLM abstraction layer needed to make BYOK real.

---

## Problem Statements

### P1: Users Can't Bring Their Own AI Keys
The zero-markup pricing promise only works if users can actually wire in their own keys. Right now it's fiction — every AI call uses Josh's CLI accounts. When we move to hosted/multi-user, this breaks immediately.

### P2: No Global Key Storage
`connectors.js` stores integration credentials per-project in `.env` files. If a user has 10 projects and wants to use Stripe in all of them, they enter their key 10 times. There's no user-level vault.

### P3: AI Engine List Is Hardcoded and Tiny
`GET /api/ai/engines` returns exactly 2 options. The BYOK multi-model pitch needs: OpenAI API, Anthropic API, Google Gemini, Groq, Mistral, Together AI, and a custom OpenAI-compatible endpoint option.

### P4: Connectors Are Project-Scoped Only
Stripe, GitHub, Slack, Sheets, Resend exist but only at the project level. No way to set a key globally once and have it available across all projects.

---

## Architecture

Settings Panel (UI) with 4 tabs: AI Models, Connectors, Account, Editor
→ /api/settings routes (new)
→ User Vault Service (AES-256-GCM encrypted, per user)
→ LLM Abstraction Layer: services/llm-router.js
→ OpenAI API | Anthropic API | Google AI | Groq | Mistral | Custom

---

## Feature Specs

### Feature 1: Global User Vault

File: backend/services/user-vault.js (new)

Storage: /home/claude-runner/config/user-vaults/{userId}.enc
Single-user mode: default.enc
Multi-user (future): keyed by JWT sub claim

Vault stores: llmProviders (with apiKey + model per provider), defaultProvider, agentProvider, completionProvider, globalConnectors (Stripe/GitHub/etc keys), editorPrefs, idePrefs.

Encryption: AES-256-GCM, key derived from sha256(IDE_KEY + ':user:' + userId). Vault never leaves server. Frontend only sees masked keys.

API Endpoints (new backend/routes/settings.js):
- GET /api/settings — masked vault
- PUT /api/settings/llm/:provider — save LLM provider key + model
- DELETE /api/settings/llm/:provider — remove provider
- POST /api/settings/llm/:provider/test — validate key
- PUT /api/settings/connectors/:id — save global connector key
- DELETE /api/settings/connectors/:id — remove global connector
- PUT /api/settings/editor — save editor prefs
- PUT /api/settings/ide — save IDE prefs
- GET /api/settings/export — encrypted export blob
- POST /api/settings/import — import encrypted blob

### Feature 2: LLM Abstraction Layer

File: backend/services/llm-router.js (new)

callLLM({ provider, model, apiKey, messages, systemPrompt, maxTokens, temperature, stream, baseUrl }) → Promise<string>

Providers:
- openai: POST https://api.openai.com/v1/chat/completions (Authorization: Bearer)
- anthropic: POST https://api.anthropic.com/v1/messages (x-api-key header)
- google: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
- groq: Same as OpenAI format, base URL api.groq.com
- mistral: POST https://api.mistral.ai/v1/chat/completions (OpenAI format)
- custom: Any OpenAI-compatible base URL
- codex / claude-code: Existing CLI fallback (free tier, Josh's accounts)

Updated /api/ai/engines returns 8 options: codex (free), claude-code (free), openai, anthropic, google, groq, mistral, custom. Each includes keyConfigured boolean and models array.

Agent orchestrator update: generatePlan() checks user vault for agentProvider, uses callLLM() if configured, falls back to Codex CLI.

### Feature 3: Expanded Connector Library

Add to connectors.js (15 new connectors):

AI/LLM (auto-populate from vault): OpenAI, Anthropic, Google AI
Database: Supabase, PlanetScale, MongoDB Atlas, Redis/Upstash
Auth: Clerk, Auth0
Communication: Twilio, SendGrid, Discord
Productivity: Notion, Airtable, Linear
Payments: Lemon Squeezy
Storage: Cloudflare R2/S3, Uploadthing

Key design change: When user has global connector key in vault and opens a project, backend auto-injects those keys into project .env (non-destructively). UI shows 'Global Key' badge with link icon.

### Feature 4: Settings UI Panel

File: frontend/src/components/SettingsPanel.jsx (new)

Full-screen modal, dark theme, left nav + content area.

Tab 1 - AI Models:
- Provider cards with status badge (Configured / Not configured / Free shared)
- API key input (masked, show/hide toggle)
- Model selector dropdown
- Set as default radio
- Test connection button
- Cost per 1M tokens estimate
- Separate providers for: Chat, Agent planning, Inline completion

Tab 2 - Connectors:
- Global Keys section (vault-stored, auto-injected)
- Project Connectors section (existing per-project)
- Shows Global vs project-override status

Tab 3 - Editor:
- Font size slider (10-20px)
- Tab size (2/4/8)
- Word wrap, minimap toggles
- Theme (dark/darker/terminal green)
- Key bindings (Default/Vim/Emacs)
- Format on save

Tab 4 - Account:
- Username/display name
- License key entry
- Export/import settings
- Reset all settings

### Feature 5: Model Selector in Chat Header

File: frontend/src/components/AIChat.jsx (update)

Compact model selector in chat header: [⚡ GPT-4o ▾]
Shows configured providers and models. Switching takes effect on next message.
Stores per-project in localStorage. Resets to account default when cleared.

---

## Backend Changes

Create:
- backend/services/llm-router.js
- backend/services/user-vault.js
- backend/routes/settings.js

Modify:
- backend/routes/ai.js — route chat/complete through llm-router.js
- backend/routes/connectors.js — add 15 connectors + global key injection
- backend/services/agent-orchestrator.js — use vault agentProvider
- backend/server.js — mount settingsRouter

## Frontend Changes

Create:
- frontend/src/components/SettingsPanel.jsx
- frontend/src/components/SettingsPanel.css
- frontend/src/hooks/useSettings.js

Modify:
- frontend/src/components/Toolbar.jsx — settings gear icon
- frontend/src/components/AIChat.jsx — model selector
- frontend/src/App.jsx — mount SettingsPanel

---

## Security

- Keys never logged (add sanitizer middleware)
- GET /api/settings returns masked values only (sk-ant-...****)
- No key transmission to frontend — backend writes .env directly
- Vault backup (.enc.bak) before every write
- Rate limit test endpoints: 10 calls/min per user

---

## Implementation Phases

Phase 1 - Backend Foundation (1-2 sessions):
1. user-vault.js service
2. settings.js routes
3. llm-router.js with all providers
4. Wire ai.js /chat through llm-router
5. Update /engines endpoint

Phase 2 - Agent + Completion Integration (1 session):
1. agent-orchestrator.js uses vault agentProvider
2. /complete uses vault completionProvider
3. Global connector key injection on project open

Phase 3 - Settings UI (1-2 sessions):
1. SettingsPanel.jsx — all 4 tabs
2. Model selector in AIChat
3. Settings gear in Toolbar

Phase 4 - Expanded Connectors (1 session):
1. Add 15 new connectors
2. Test functions for each
3. Example files for each

---

## Success Metrics

- User configures OpenAI key in Settings, uses GPT-4o in chat immediately — no .env editing
- User switches model per conversation via chat header dropdown
- Agent uses user's configured provider, falls back to Codex CLI if none set
- Global connector key entered once, auto-present in all projects
- Zero raw API keys in any frontend network response
- GET /api/ai/engines returns 7+ providers with accurate keyConfigured state

---

## Notes

1. Custom Ollama/local model support covered by 'custom' provider type (OpenAI-compatible)
2. Multi-user key isolation: current uses default.enc, future uses {userId}.enc — no schema changes needed
3. Provider model list: consider JSON config file instead of hardcoded for easier updates
4. Codex CLI future: llm-router abstraction lets us swap CLI backend without touching callers
5. Cost tracking: add estimatedCost to usage-tracker entries once pricing config is added

---

PirateDev™ is a trademark of Josh Stone. Zero Markup. Zero Apologies.