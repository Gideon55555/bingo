#!/usr/bin/env bash
# Install the latest code from GitHub. If the new version doesn't come up healthy, it rolls back automatically.
# Run as the app user:  sudo -u bingo bash /opt/bingo/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)"; PORT="${PORT:-3000}"
DB="$(grep -E '^DB_PATH=' .env 2>/dev/null | cut -d= -f2)"; DB="${DB:-data/bingo.db}"

healthy() {
  for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}
build() { npm ci --no-audit --no-fund && npm run build; }

echo "==> Backing up the database (safe while the app is running)"
mkdir -p backups
if [ -f "$DB" ]; then
  SNAP="backups/pre-update-$(date +%Y%m%d-%H%M%S).db"
  node -e "const D=require('better-sqlite3');new D(process.argv[1],{readonly:true}).backup(process.argv[2]).then(()=>process.exit(0),e=>{console.error(e);process.exit(1)})" "$DB" "$SNAP"
  echo "    saved $SNAP"
fi

OLD="$(git rev-parse HEAD)"
git fetch --quiet origin main
NEW="$(git rev-parse origin/main)"
if [ "$OLD" = "$NEW" ]; then echo "✅ Already up to date ($(git log -1 --format='%h %s'))."; exit 0; fi
echo "==> Updating $(git log -1 --format=%h "$OLD") → $(git log -1 --format='%h %s' "$NEW")"
git merge --ff-only --quiet origin/main

if build && pm2 restart bingo --update-env >/dev/null && healthy; then
  echo "✅ Updated. Unfinished games were refunded automatically and players were told."
  exit 0
fi

echo "❌ New version failed — rolling back to $(git log -1 --format=%h "$OLD")"
git reset --hard --quiet "$OLD"
build && pm2 restart bingo --update-env >/dev/null && healthy && echo "↩️  Rolled back; the old version is running." \
  || echo "‼️  Rollback also failed — check: pm2 logs bingo   (database snapshot: ${SNAP:-none})"
exit 1
