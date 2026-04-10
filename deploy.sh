#!/bin/bash
set -e
cd /home/claude-runner/projects/josh-replit
git add -A && git commit -m "auto: build $(date +%Y%m%d-%H%M%S)" --allow-empty && git push origin main
cd frontend && npm run build
rsync -av --delete --exclude=index.php --exclude='*.bak' dist/ /var/www/replit/
/home/claude-runner/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2 restart replit-backend
echo "Deployed at $(date)"
