#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 22.04 / 24.04 VPS.
# Usage (as root):  bash setup-vps.sh bingo.yourdomain.com
set -euo pipefail
DOMAIN="${1:?Usage: bash setup-vps.sh bingo.yourdomain.com}"
REPO="https://github.com/Gideon55555/bingo.git"
APP_DIR="/opt/bingo"

echo "==> Installing Node.js 22, git, Caddy, pm2"
apt-get update -y
apt-get install -y curl git debian-keyring debian-archive-keyring apt-transport-https ufw build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy
npm install -g pm2

echo "==> Creating app user and downloading the code"
id bingo &>/dev/null || useradd --system --create-home --shell /bin/bash bingo
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"   # for a private repo you'll be asked for a GitHub token
fi
chown -R bingo:bingo "$APP_DIR"

echo "==> Installing dependencies and building"
sudo -u bingo bash -c "cd $APP_DIR && npm ci && npm run build"

if [ ! -f "$APP_DIR/.env" ]; then
  sudo -u bingo cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s#^WEBAPP_URL=.*#WEBAPP_URL=https://$DOMAIN#" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

echo "==> HTTPS reverse proxy (Caddy)"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy localhost:3000
}
CADDY
systemctl reload caddy

echo "==> Firewall: allow SSH + HTTP/HTTPS only"
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

echo "==> Auto-start on boot"
env PATH=$PATH pm2 startup systemd -u bingo --hp /home/bingo >/dev/null

cat <<DONE

✅ Server prepared.

NEXT:
  1. Edit your settings:      nano $APP_DIR/.env
     (BOT_TOKEN, ADMIN_IDS, ADMIN_PASSWORD, PAYMENT_INFO, SUPPORT_CONTACT)
  2. Start the app:           sudo -u bingo bash -c "cd $APP_DIR && pm2 start ecosystem.config.cjs && pm2 save"
  3. Check it:                curl https://$DOMAIN/healthz
  4. Watch logs:              sudo -u bingo pm2 logs bingo

To update later:              sudo -u bingo bash $APP_DIR/deploy/update.sh
DONE
