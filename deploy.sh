#!/bin/bash
set -e
cd /home/claude-runner/projects/josh-replit
git add -A && git commit -m "auto: build $(date +%Y%m%d-%H%M%S)" --allow-empty && git push origin main
# === SOCKET PATH GUARD — DO NOT REMOVE ===
cat > frontend/src/api.js << 'APIEOF'
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
echo "api.js locked to /socket.io/"
# === END SOCKET PATH GUARD ===
cd frontend && npm run build
rsync -av --delete --exclude=index.php --exclude='*.bak' dist/ /var/www/replit/ || true
/home/claude-runner/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2 restart replit-backend
echo "Deployed at $(date)"
