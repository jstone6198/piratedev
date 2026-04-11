# PirateDev License Key System — Architecture

## How It Works

### Boot Sequence
1. IDE frontend loads in browser
2. On mount, App.jsx calls `GET /api/license/validate`
3. Backend checks license key against PirateDev license server
4. Response: `{valid: true, tier: 'pro', expires: '2027-04-11', features: [...]}`
5. If invalid/expired: IDE enters read-only mode with upgrade banner

### License Key Format
`PD-{tier}-{random32hex}` e.g. `PD-PRO-a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4`

### Storage
- Key stored in `/home/{user}/.piratedev/license.key` on customer VPS
- Also cached in backend memory (refreshed every 24h)
- Never sent to browser — backend validates and returns tier/features only

### Tiers
| Tier | Price | Features |
|------|-------|----------|
| Trial | $0 (14 days) | Full features, 1 project, no deploy |
| Solo | $29/mo | 5 projects, subdomain deploy, 10GB storage |
| Pro | $49/mo | Unlimited projects, custom domains, 50GB storage |
| Team | $149/mo | 5 seats, shared workspaces, priority support |

### Validation Endpoint (License Server)
- Hosted at: `https://api.piratedev.ai/license/validate`
- POST body: `{key: string, machineId: string}`
- machineId = SHA256 of hostname + MAC address (prevents key sharing)
- Response: `{valid, tier, expires, features, maxProjects, maxStorage}`
- Caches validation for 24h (works offline after first check)
- Grace period: 72h if license server unreachable

### Enforcement Points
1. **Project creation** — check maxProjects before allowing new project
2. **Deploy** — check if tier allows deployment
3. **Storage upload** — check against maxStorage
4. **Agent execution** — check if tier includes AI agent features
5. **Mobile build** — Pro+ only

### What Read-Only Mode Looks Like
- Can view existing files
- Cannot create projects, edit files, run terminal, deploy
- Banner: "Your PirateDev trial has expired. Upgrade at piratedev.ai"
- All API routes return 403 with `{error: 'license_expired', upgradeUrl: '...'}`

## Backend Implementation (Next Session)

### New files needed:
- `backend/routes/license.js` — validate, activate, deactivate endpoints
- `backend/middleware/license-check.js` — Express middleware for all routes
- `backend/services/license-server.js` — HTTP client to api.piratedev.ai

### License Server (Separate Service)
- Simple Express app at api.piratedev.ai
- PostgreSQL: licenses table (key, tier, user_email, machine_id, expires, active)
- Stripe webhook: auto-create license on subscription, deactivate on cancel
- Admin dashboard: manual key generation, usage stats

## Anti-Piracy (Practical, Not Paranoid)
- Machine binding prevents casual key sharing
- License check is server-side (can't be bypassed by editing frontend JS)
- AGPL means forks must be open-source (visible, auditable)
- If someone fully reverse-engineers the backend: they weren't a customer
- Focus energy on shipping features, not DRM. Speed is the real moat.
