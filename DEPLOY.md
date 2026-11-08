# 🚀 Going live

There are two ways to host. Both use your own domain, for example `bingo.yourdomain.com`.

| | **A. VPS** (recommended) | **B. Your DirectAdmin hosting** |
|---|---|---|
| Cost | about $5/month extra | already paid |
| Reliability | ✅ App always running, real-time WebSockets | ⚠️ Host may sleep or restart the app; slower updates |
| Control | Full | Limited by your host |
| Gambling allowed? | Check the provider's terms | **Many shared hosts forbid it**, so check your terms |
| Needs | DNS record in DirectAdmin | "Setup Node.js App" in DirectAdmin |

Your players' money is never lost on a crash or restart either way. Unfinished games are refunded
automatically and players are notified. On shared hosting that happens more often, which annoys players.

---

## A. VPS (recommended)

### 1. Get a server
Any Ubuntu 22.04 or 24.04 VPS with 2 GB RAM works (1 GB is fine for a start): Hetzner, DigitalOcean, Vultr, Contabo and so on. Load test: one 2-core server handled 2,000 players online at once (~400 MB RAM).
Note its **IP address**.

### 2. Point your subdomain at it (in DirectAdmin)
DirectAdmin → **DNS Management** → **Add Record**:
- Type: `A`
- Name: `bingo`
- Value: *your VPS IP*

Wait 5–30 minutes. You can check with `ping bingo.yourdomain.com`.

### 3. Run the setup script on the VPS
```bash
ssh root@YOUR_VPS_IP
curl -fsSL https://raw.githubusercontent.com/Gideon55555/bingo/main/deploy/setup-vps.sh -o setup.sh
bash setup.sh bingo.yourdomain.com
```
If the repo is private, the curl command above won't work. Copy the script over instead, or run
`git clone https://github.com/Gideon55555/bingo.git /opt/bingo` with a
[GitHub token](https://github.com/settings/tokens) as the password, then `bash /opt/bingo/deploy/setup-vps.sh bingo.yourdomain.com`.

The script installs Node.js, HTTPS (Caddy, with automatic certificates), a firewall and auto-restart (pm2).

### 4. Fill in your settings and start
```bash
nano /opt/bingo/.env        # BOT_TOKEN, ADMIN_IDS, ADMIN_PASSWORD, PAYMENT_INFO, SUPPORT_CONTACT
sudo -u bingo bash -c "cd /opt/bingo && pm2 start ecosystem.config.cjs && pm2 save"
curl https://bingo.yourdomain.com/healthz    # should print {"ok":true,...}
```
Keep `BOT_MODE=polling` on a VPS.

### Day-to-day
```bash
sudo -u bingo pm2 logs bingo                     # live logs
sudo -u bingo pm2 restart bingo                  # restart (players in unfinished games are refunded)
sudo -u bingo bash /opt/bingo/deploy/update.sh   # install the latest code from GitHub
```

---

## B. DirectAdmin "Setup Node.js App"

Only works if your host has **Setup Node.js App** in DirectAdmin, with Node.js 18 or newer.

1. **Create a subdomain:** DirectAdmin → Subdomain Management → add `bingo`.
   Then turn on SSL for it (SSL Certificates → Let's Encrypt).
2. **Upload the code:** put the project in a folder outside `public_html`, for example `/home/USER/bingo`.
   Use File Manager (upload the zip and extract it) or `git clone` over SSH if your host allows it.
3. **Create the app:** DirectAdmin → Setup Node.js App → Create Application:
   - Node.js version: **20 or 22** (at least 18)
   - Application mode: **Production**
   - Application root: `bingo` (the folder from step 2)
   - Application URL: `bingo.yourdomain.com`
   - Application startup file: **`app.cjs`**
4. **Install:** click **Run NPM Install**, then run the build. If there's an SSH or terminal option:
   ```bash
   source /home/USER/nodevenv/bingo/22/bin/activate && cd ~/bingo
   npm install && npm run build
   ```
   If your host has no terminal, build on your PC (`npm run build`) and upload the `dist` folder.
5. **Settings:** create `.env` in the app folder (copy `.env.example`) and set:
   ```
   NODE_ENV=production
   BOT_MODE=webhook
   WEBAPP_URL=https://bingo.yourdomain.com
   ```
   plus your token, admin ids, password and payment info. **`BOT_MODE=webhook` is required here.**
6. Click **Restart** on the app and open `https://bingo.yourdomain.com/healthz`.
7. **Keep it awake:** DirectAdmin → Cron Jobs → add a job that runs every minute:
   ```
   curl -s https://bingo.yourdomain.com/healthz > /dev/null
   ```
   Without this, the host may put the app to sleep and stop the games.

**Limits of shared hosting:**
- If the host runs **two copies** of the app under heavy traffic, the game will act strangely,
  because each copy has its own rooms. Ask your host to limit the app to 1 instance.
  If you see this happen, move to a VPS.
- Live updates use a slightly slower method if the host blocks WebSockets. It still works.

---

## ✅ Go-live checklist

- [ ] **License** confirmed for real-money games (National Lottery Administration).
- [ ] **New bot token:** `/revoke` in @BotFather, because the old one was shared. Put the new one only in `.env`.
- [ ] `NODE_ENV=production` and `DEV_MODE=false`. The server refuses to start otherwise.
- [ ] `ADMIN_IDS` set to your real Telegram id(s). Send `/id` to the bot.
- [ ] `ADMIN_PASSWORD`: long and unique (16+ characters).
- [ ] `PAYMENT_INFO`: your real Telebirr / bank details.
- [ ] `SUPPORT_CONTACT`: where players can reach you.
- [ ] `https://bingo.yourdomain.com/healthz` responds.
- [ ] In Telegram: `/start` opens the game, and `/stats` and `/admin` work for you.
- [ ] `/backup`: you receive the database file in Telegram.
- [ ] **Uptime monitor:** add `https://bingo.yourdomain.com/healthz` to a free monitor (UptimeRobot, Better Stack).
      It returns 200 when healthy and 503 when the database or server isn't — you get an SMS/email if the site goes down.
- [ ] **`TRUST_PROXY`** matches your setup: `1` behind Caddy/Nginx/Passenger (default), `2` if Cloudflare is also in front.
      Wrong values make rate limits see the wrong visitor IP.
- [ ] **Firewall (VPS):** only ports 22, 80 and 443 open (`sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable`).
      Port 3000 must not be reachable from outside — Caddy talks to it locally.
- [ ] **SSH:** log in with a key, not a password (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
- [ ] **`BACKUP_PASSWORD`** set, so backups sent to Telegram are encrypted. Test once: `npm run backup:decrypt -- <file>.enc`.
- [ ] **2-step admin login:** `npm run admin:2fa`, scan the QR, put `ADMIN_TOTP_SECRET` in `.env`.
- [ ] **Chapa (optional, needs your license for Chapa to approve you):** put `CHAPA_SECRET_KEY` in `.env`, set the
      webhook URL `https://bingo.yourdomain.com/api/chapa/webhook` in the Chapa dashboard, test with Chapa's test keys first.
      Start with `CHAPA_AUTO_PAYOUT_MAX=0` (admins approve payouts) and raise it once you trust it.
- [ ] **Bot username** for invite/referral links is read from Telegram automatically (or set `BOT_USERNAME`).
- [ ] **Voice:** optionally regenerate the bingo caller with `scripts/voice/make-azure.js` for a natural Amharic voice.
- [ ] **Private trial:** 5–10 friends, small amounts. Do a full deposit → play → win → withdraw cycle.
- [ ] Daily habit: check `/pending`. Only approve deposits after the money shows in your account.

## 🔒 Security & performance built in
- **Headers:** strict Content-Security-Policy (only this site and Telegram's script may run; only Telegram may embed the app),
  HSTS, no-sniff, referrer and permissions policies.
- **Logins:** every request and socket is checked against Telegram's signature (HMAC) and its age (`INITDATA_MAX_AGE_HOURS`).
  Repeated failures from one IP are blocked for a minute (`AUTH_FAIL_RATE_IP`).
- **Rate limits** per player (`API_RATE_USER`, `SOCKET_RATE`) and generous per-IP limits (`API_RATE_IP`, `CONN_RATE_IP`),
  because Ethio telecom / Safaricom put many phones behind one IP. At most `MAX_SOCKETS_PER_USER` open connections per player.
- **Errors** never show internals to players — they get a plain message, the details go to the log.
- **Files:** the database and backups are readable only by the app's user; every backup is integrity-checked before it's kept.
  The server refuses to start on a damaged database.
- **Speed:** each game loads separately (the home screen downloads ~84 KB), files are pre-compressed (brotli/gzip) and
  cached by phones until the next update; the Amharic font is self-hosted. The database is tuned (WAL, indexes, cached stats).
- **Admin → Overview** shows server health: response time, players online, memory, database size.
- **Load-tested:** `N=1000 npm run load` simulates 1,000 players betting at once.

## If something goes wrong
- **Restore a backup:** stop the app, copy a backup file over `data/bingo.db` (and delete `data/bingo.db-wal` / `-shm` if present), then start the app.
  Backups are in `backups/` on the server and in your Telegram chat with the bot.
- **The bot doesn't answer:** check the logs. On shared hosting, check that `BOT_MODE=webhook` is set and the app is running.
- **Players see "Server is restarting":** this is normal during updates. Unfinished games are refunded automatically.
