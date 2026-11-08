#!/usr/bin/env bash
# Check the settings, then start the app with pm2 and confirm it's healthy.
# Run as the app user:  sudo -u bingo bash /opt/bingo/deploy/start.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "❌ No .env file. Copy .env.example to .env and fill it in."; exit 1; }

get() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
problems=0
need() { if [ -z "$(get "$1")" ] || [ "$(get "$1")" = "$2" ]; then echo "❌ $1 is not set in .env — $3"; problems=1; fi; }
# the second value is the placeholder from .env.example, which also counts as "not set"
need BOT_TOKEN "123456:ABC-your-bot-token" "get a NEW token from @BotFather (/revoke the old one)"
need ADMIN_IDS "123456789" "your Telegram id (open @userinfobot in Telegram, it replies with your id)"
need ADMIN_PASSWORD "change-me-to-something-long" "use a long random password"
need PAYMENT_INFO "Telebirr: 0911000000 (Your Name) | CBE: 1000000000000 (Your Name)" "your real Telebirr / bank details"
need SUPPORT_CONTACT "@your_support" "where players can reach you, e.g. @yoursupport"
[ "$(get NODE_ENV)" = "production" ] || { echo "❌ NODE_ENV must be production"; problems=1; }
[ "$(get DEV_MODE)" != "true" ] || { echo "❌ DEV_MODE must be false"; problems=1; }
case "$(get WEBAPP_URL)" in https://*) ;; *) echo "❌ WEBAPP_URL must start with https://"; problems=1 ;; esac
pw="$(get ADMIN_PASSWORD)"; [ ${#pw} -ge 16 ] || { echo "❌ ADMIN_PASSWORD must be at least 16 characters"; problems=1; }
[ -n "$(get BACKUP_PASSWORD)" ] || echo "⚠️  BACKUP_PASSWORD is empty — backups sent to Telegram won't be encrypted."
[ "$problems" = 0 ] || { echo; echo "Fix the lines above:  nano $(pwd)/.env"; exit 1; }

[ -d dist ] || npm run build
if pm2 describe bingo >/dev/null 2>&1; then pm2 restart bingo --update-env; else pm2 start ecosystem.config.cjs; fi
pm2 save >/dev/null

PORT="$(get PORT)"; PORT="${PORT:-3000}"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "✅ Running. Public check:  curl $(get WEBAPP_URL)/healthz"
    echo "   Then open your bot in Telegram and send /start."
    exit 0
  fi
  sleep 1
done
echo "❌ The app did not become healthy. Last log lines:"
pm2 logs bingo --lines 40 --nostream
exit 1
