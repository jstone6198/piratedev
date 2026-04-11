# PirateDev Licensing

## Dual License Structure

PirateDev uses a **dual license model**:

### Frontend (IDE UI) — AGPL-3.0
The browser-based IDE interface, React components, and client-side code
are licensed under the GNU Affero General Public License v3.0.

You may:
- Use, modify, and distribute the frontend code
- Run it for personal or commercial use
- Fork and contribute improvements

You must:
- Open-source any modifications if you run them as a network service
- Retain the PirateDev attribution
- Not use PirateDev trademarks without permission

### Backend (Platform Infrastructure) — Proprietary
The following components are proprietary and NOT open-source:
- VPS provisioning engine
- Container isolation layer
- Deploy pipeline (subdomain routing, nginx, PM2)
- Database provisioning system
- Billing and metering
- Agent orchestration service
- Customer onboarding automation
- License key validation system

These components are only available through a paid PirateDev subscription.

## License Key
The IDE frontend requires a valid license key to operate beyond a 14-day
trial period. License keys are issued upon subscription at piratedev.ai.

## Trademarks
"PirateDev", the PirateDev logo, and the skull-and-code-brackets mark
are trademarks of Josh Stone. USPTO application pending.
