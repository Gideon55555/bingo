# 🚀 Going live

Three ways to host. All of them use your own domain from DirectAdmin, for example `bingo.yourdomain.com`.

| | **0. Oracle Cloud — free** | **A. Paid VPS** | **B. Your DirectAdmin hosting** |
|---|---|---|---|
| Cost | **$0** (Always Free: 2 ARM cores, 12 GB RAM, 10 TB traffic) | about $5/month | already paid |
| Reliability | ✅ Always on, real-time WebSockets | ✅ Always on | ⚠️ Host may sleep or restart the app |
| Catch | Needs a Visa/Mastercard to sign up; no support or uptime promise | Costs money | **Many shared hosts forbid gambling** |
| Gambling allowed? | Oracle's rules ban illegal use; you need your Ethiopian licence | Check the provider's terms | Check your terms |

Free app platforms (Render, Koyeb, Railway trial, Vercel…) **don't work for this app**. They sleep when idle,
have no permanent disk (the database would be wiped) or time out live connections.

Your players' money is never lost on a crash or restart. Unfinished games are refunded automatically and players are notified.

---

## 0. Oracle Cloud Always Free (recommended while you have no budget)

Everything below happens in your web browser, including the server's terminal (Oracle's **Cloud Shell**).
Plan about an hour.

### 1. Create the account
1. Go to **oracle.com/cloud/free** → *Start for free*.
2. **Home region:** pick one close to Ethiopia, such as **Saudi Arabia West (Jeddah)** or **UAE East (Dubai)**.
   ⚠️ You can never change it later, and the free server can only be created there.
3. A **Visa/Mastercard** is needed to verify you're a real person. A small amount is held for a moment and returned.
   If an Ethiopian bank card is refused, use a card that works for online payments abroad.
4. **Strongly recommended — upgrade to "Pay As You Go"** (Billing → Upgrade and Manage Payment). It's still **$0** as long as
   you stay inside the Always Free limits, but: Oracle doesn't stop "idle" servers on paid accounts (a quiet week with few
   players could otherwise get the server stopped), and it's easier to get a free ARM server.
   Then add a **budget alert** (Billing → Budgets → $1) so you're emailed if anything would ever cost money.

### 2. Make an SSH key in Cloud Shell
Click the **>_ Cloud Shell** icon (top right of the console) and run:
```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
```
Copy the line it prints (starts with `ssh-ed25519`). Also download `~/.ssh/id_ed25519` (Cloud Shell menu → Download)
and keep it safe, because it's the key to your server.

### 3. Create the server
Menu → **Compute → Instances → Create instance**:
- **Image:** Canonical **Ubuntu 24.04** (not "Minimal").
- **Shape:** *Ampere* → **VM.Standard.A1.Flex**, **2 OCPU, 12 GB** (1 OCPU / 6 GB is also plenty). Make sure it says *Always Free-eligible*.
- **Networking:** create a new virtual cloud network with a **public subnet**, and keep **Assign a public IPv4 address** on.
- **SSH keys:** *Paste public keys* → paste the line from step 2.
- Create. If you see **"Out of capacity"**, try another *availability domain* in the same screen, or try again later.

Write down the **Public IP address** shown on the instance page.

### 4. Open the web ports in Oracle's network firewall
Instance page → click the **subnet** → **Security** (or *Security Lists*) → *Default Security List* → **Add Ingress Rules**:
- Source CIDR `0.0.0.0/0`, IP protocol **TCP**, Destination port range **`80,443`** → Add.

### 5. Point your subdomain at it (in DirectAdmin)
DirectAdmin → **DNS Management** → **Add Record**: Type `A`, Name `bingo`, Value *your Oracle public IP*.

### 6. Install the app (in Cloud Shell)
```bash
ssh ubuntu@YOUR_PUBLIC_IP
git clone https://github.com/Gideon55555/bingo.git /tmp/bingo
sudo bash /tmp/bingo/deploy/setup-vps.sh bingo.yourdomain.com
```
The script installs everything (Node.js, HTTPS certificate, firewall, auto-restart, automatic security updates),
opens ports 80/443 in Oracle's own server firewall, creates strong random admin and backup passwords, and checks your DNS.
It takes about 5–10 minutes.

### 7. Your settings, then start
```bash
sudo cat /root/bingo-secrets.txt          # your generated passwords: save them in a password manager
sudo rm /root/bingo-secrets.txt
sudo -u bingo nano /opt/bingo/.env        # BOT_TOKEN, ADMIN_IDS, PAYMENT_INFO, SUPPORT_CONTACT
sudo -u bingo bash /opt/bingo/deploy/start.sh
```
`start.sh` refuses to start if a required setting is missing or still the example value, and tells you which.
In nano: edit, then **Ctrl+O, Enter** to save and **Ctrl+X** to exit.

Open `https://bingo.yourdomain.com/healthz` in your browser. It should show `{"ok":true,…}`. Then send `/start` to your bot.

### Day-to-day (Cloud Shell → `ssh ubuntu@YOUR_PUBLIC_IP`)
```bash
sudo -u bingo pm2 logs bingo                     # live logs
sudo -u bingo bash /opt/bingo/deploy/update.sh   # install the latest code from GitHub
sudo -u bingo pm2 restart bingo                  # restart (players in unfinished games are refunded)
```
`update.sh` backs up the database first, and if the new version doesn't start healthy it **rolls back automatically**.

---

## A. Paid VPS

### 1. Get a server
Any Ubuntu 22.04 or 24.04 VPS (x86 or ARM) with 2 GB RAM works (1 GB is fine for a start): Hetzner, DigitalOcean, Vultr, Contabo and so on. Load test: one 2-core server handled 2,000 players online at once (~400 MB RAM).
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
git clone https://github.com/Gideon55555/bingo.git /tmp/bingo
sudo bash /tmp/bingo/deploy/setup-vps.sh bingo.yourdomain.com
```
If you make the GitHub repo private, `git clone` asks for your GitHub username and a
[token](https://github.com/settings/tokens) (read-only "Contents" permission) as the password. Updates ask for it again.

The script installs Node.js, HTTPS (Caddy, with automatic certificates), a firewall and auto-restart (pm2).

### 4. Fill in your settings and start
```bash
sudo cat /root/bingo-secrets.txt && sudo rm /root/bingo-secrets.txt   # generated passwords: save them first
sudo -u bingo nano /opt/bingo/.env        # BOT_TOKEN, ADMIN_IDS, PAYMENT_INFO, SUPPORT_CONTACT
sudo -u bingo bash /opt/bingo/deploy/start.sh
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
- [ ] `ADMIN_IDS` set to your real Telegram id(s) (@userinfobot shows yours).
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
