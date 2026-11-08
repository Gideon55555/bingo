#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 22.04 / 24.04 server (x86 or ARM — works on Oracle Cloud Always Free).
# Usage:  sudo bash setup-vps.sh bingo.yourdomain.com
set -euo pipefail
DOMAIN="${1:?Usage: sudo bash setup-vps.sh bingo.yourdomain.com}"
REPO="${REPO:-https://github.com/Gideon55555/bingo.git}"
APP_DIR="/opt/bingo"
SECRETS="/root/bingo-secrets.txt"

[ "$EUID" -eq 0 ] || { echo "Run with sudo:  sudo bash $0 $DOMAIN"; exit 1; }
grep -qi ubuntu /etc/os-release || echo "⚠️  This script is tested on Ubuntu. Continuing anyway…"
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing Node.js 22, git, Caddy, pm2 ($(uname -m))"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https \
  build-essential python3 sqlite3 dnsutils unattended-upgrades openssl
if ! node -v 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
command -v pm2 >/dev/null || npm install -g pm2

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo "==> Creating app user and downloading the code"
id bingo &>/dev/null || useradd --system --create-home --shell /bin/bash bingo
SRC="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -d "$APP_DIR/.git" ]; then
  if [ -d "$SRC/.git" ] && [ "$SRC" != "$APP_DIR" ]; then
    # Running from a copy you already cloned: reuse it (no second GitHub login for a private repo)
    git clone --quiet "$SRC" "$APP_DIR"
    git -C "$APP_DIR" remote set-url origin "$(git -C "$SRC" remote get-url origin)"
  else
    git clone "$REPO" "$APP_DIR"   # for a private repo you'll be asked for a GitHub token
  fi
fi
chown -R bingo:bingo "$APP_DIR"
sudo -u bingo git config --global --add safe.directory "$APP_DIR"

echo "==> Installing dependencies and building (a few minutes on a small server)"
sudo -u bingo bash -c "cd $APP_DIR && npm ci --no-audit --no-fund && npm run build"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> Creating settings file with strong random passwords"
  ADMIN_PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  BACKUP_PW="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
  sudo -u bingo cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i \
    -e "s#^WEBAPP_URL=.*#WEBAPP_URL=https://$DOMAIN#" \
    -e "s#^NODE_ENV=.*#NODE_ENV=production#" \
    -e "s#^DEV_MODE=.*#DEV_MODE=false#" \
    -e "s#^BOT_MODE=.*#BOT_MODE=polling#" \
    -e "s#^ADMIN_PASSWORD=.*#ADMIN_PASSWORD=$ADMIN_PW#" \
    -e "s#^BACKUP_PASSWORD=.*#BACKUP_PASSWORD=$BACKUP_PW#" \
    "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"; chown bingo:bingo "$APP_DIR/.env"
  umask 077
  printf 'Admin panel password: %s\nBackup password:      %s\n(Both are also in %s/.env)\n' "$ADMIN_PW" "$BACKUP_PW" "$APP_DIR" > "$SECRETS"
fi

echo "==> HTTPS reverse proxy (Caddy — gets and renews the certificate automatically)"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy localhost:3000
}
CADDY
systemctl enable --now caddy >/dev/null
systemctl reload caddy

echo "==> Firewall: allow SSH + HTTP/HTTPS only"
if [ -f /etc/iptables/rules.v4 ] && grep -q 'REJECT' /etc/iptables/rules.v4; then
  # Oracle Cloud images ship their own iptables rules that block everything except SSH.
  # Don't use ufw there (Oracle warns it can lock you out); open 80/443 in iptables instead.
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 5 -p tcp --dport $p -m state --state NEW -j ACCEPT
  done
  netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4
  ORACLE=1
else
  apt-get install -y ufw >/dev/null
  ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw --force enable >/dev/null
  ORACLE=0
fi

echo "==> Auto-start on boot"
env PATH="$PATH" pm2 startup systemd -u bingo --hp /home/bingo >/dev/null

echo "==> Checking DNS"
MYIP="$(curl -fsS4 --max-time 5 https://api.ipify.org || true)"
DNSIP="$(dig +short A "$DOMAIN" | tail -n1)"
if [ -n "$MYIP" ] && [ "$MYIP" = "$DNSIP" ]; then
  DNS_MSG="✅ $DOMAIN points to this server ($MYIP)."
else
  DNS_MSG="⚠️  $DOMAIN points to '${DNSIP:-nothing}', but this server is $MYIP.
   Add an A record in DirectAdmin → DNS Management: name = $(echo "$DOMAIN" | cut -d. -f1), value = $MYIP.
   HTTPS starts working by itself a few minutes after DNS is right."
fi

cat <<DONE

✅ Server prepared.
$DNS_MSG
$( [ "$ORACLE" = 1 ] && echo "ℹ️  Oracle Cloud: also open ports 80 and 443 in the console (Networking → your VCN → Security List → Add Ingress Rules)." )
$( [ -f "$SECRETS" ] && echo "🔑 Your generated passwords are in $SECRETS — read it once (sudo cat $SECRETS), save them in your password manager, then delete it (sudo rm $SECRETS)." )

NEXT:
  1. Fill in your settings:   sudo -u bingo nano $APP_DIR/.env
     Required: BOT_TOKEN, ADMIN_IDS, PAYMENT_INFO, SUPPORT_CONTACT
  2. Start the app:           sudo -u bingo bash $APP_DIR/deploy/start.sh
  3. Watch logs:              sudo -u bingo pm2 logs bingo

To update later:              sudo -u bingo bash $APP_DIR/deploy/update.sh
DONE
