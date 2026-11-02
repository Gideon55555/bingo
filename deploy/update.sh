#!/usr/bin/env bash
# Pull the latest code, rebuild and restart. Run as the app user:  bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> Backing up database first"
mkdir -p backups && [ -f data/bingo.db ] && cp data/bingo.db "backups/pre-update-$(date +%Y%m%d-%H%M).db" || true
git pull --ff-only
npm ci
npm run build
# Restart (unfinished rounds are refunded automatically, players are notified)
pm2 restart bingo --update-env
echo "✅ Updated."
