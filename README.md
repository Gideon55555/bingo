# 🎱 Telegram Bingo Mini App

A multiplayer 75-ball bingo game that runs inside Telegram, with a player wallet.
Players send you money (Telebirr, bank and so on), submit the transaction ID in the app,
and you approve it from the bot with one tap. Their balance updates instantly.

## How it works

```
Telegram ──/start──> Bot (grammY) ──"Play" button──> Mini App (React, in Telegram's WebView)
                                                          │  REST + WebSocket (Socket.IO)
                                                          ▼
                                   Node server: game rooms · wallet · SQLite DB
                                                          │
                       Admins get deposit/withdraw requests in Telegram ──> ✅ / ❌ buttons
```

**Game flow**
1. Rooms exist for each stake (10 / 20 / 50 / 100 ETB, configurable).
2. Players pick a card number (1–100). Each number always maps to the same card.
   The stake is taken from the player's balance. Players can switch cards for free,
   or leave before the start and get a refund.
3. When at least 2 players have joined, a 30 s countdown starts.
4. The server calls a random number every 3.5 s, using a cryptographically secure shuffle.
5. A player presses **BINGO!** when they have a full row, column, diagonal or the four corners.
   The **server checks the claim** against the called numbers, so the client can't cheat.
   A false claim disqualifies that player for the round.
6. The winner gets the pot minus the house cut (20% by default). If several players complete
   a line on the same ball, they split the prize. The room then resets.

**Wallet flow**
- **Deposit:** the player sends money to your account, then enters the amount and transaction ID.
  All admins get a bot message with **Approve / Reject** buttons. Approving credits the balance.
  Each transaction ID can only be used once.
- **Withdraw:** the player enters an amount and a phone number. The amount is held right away.
  You send the money manually, then tap **Mark paid**. **Reject** refunds the player.
- You can approve from the **bot** or from the **web admin panel**. Whichever you click first counts.

## Admin tools

**In the bot** (only for ids in `ADMIN_IDS`; send `/help` to see them):

| Command | What it does |
|---|---|
| `/stats` | Today's and all-time games, bets, house earnings, deposits, withdrawals |
| `/pending` | All deposits/withdrawals waiting for you, with buttons |
| `/user 123456` or `/user @name` | A player's balance, totals and last transactions |
| `/addbalance @name 50 welcome bonus` | Add balance. Use `-50` to subtract. The player is notified. |
| `/broadcast Your message` | Send a message to every player |
| `/pause` / `/resume` | Stop/allow new games. Unstarted rounds are refunded; running games finish. |
| `/backup` | Sends you a copy of the database right now |
| `/admin` | Opens the admin panel inside Telegram |

**Web admin panel**, in two places:
- **Inside Telegram:** admins see a 🛠 **Admin** tab at the bottom of the Mini App, or can send `/admin`.
- **In any browser:** go to `https://your-app-url/admin` and log in with `ADMIN_PASSWORD` from `.env`.

The panel has:
- **Overview:** earnings, deposits, withdrawals, games, active players, total player balances,
  live rooms, and pause/resume
- **Requests:** pending deposits and withdrawals with Approve/Reject, plus a filterable log of every transaction
- **Players:** search, balances and stats. Tap a player to see their history and add or subtract balance.
- **Games:** every finished game with the pot, payout, house cut and winners
- **Broadcast:** message all players

## Setup

### 1. Create the bot
1. In Telegram, open **@BotFather** and send `/newbot`. Copy the token.
2. Optional: `/setdescription`, `/setuserpic`.
3. Optional direct link: `/newapp` gives you a link like `t.me/yourbot/bingo`.

### 2. Configure
```bash
cp .env.example .env
```
Fill in `BOT_TOKEN`, `WEBAPP_URL` (your public HTTPS address), `ADMIN_IDS`, `ADMIN_PASSWORD` and `PAYMENT_INFO`.
To find your id, start the bot and send `/id`, then put that number in `ADMIN_IDS` and restart.

### 3. Run locally
```bash
npm install
npm run build        # builds the React app into dist/
npm start            # server + bot on http://localhost:3000
```
Telegram needs HTTPS, so expose the local server with a tunnel:
```bash
npx ngrok http 3000      # or: cloudflared tunnel --url http://localhost:3000
```
Put the https URL in `WEBAPP_URL` and restart. Then send `/start` to your bot and tap **Play Bingo**.

**Browser testing without Telegram:** set `DEV_MODE=true`, run `npm run dev:server` and
`npm run dev:client`, then open `http://localhost:5173/?dev_user=1` in one tab and
`?dev_user=2` in another. Give the dev users balance by submitting deposits and approving
them from the bot, or with a quick SQL update. **Never enable DEV_MODE in production.**

### 4. Tests
```bash
npm test
```
This runs a full simulated game with real signed Telegram auth (41 checks): auth forgery,
deposits, duplicate references, entry fees, refunds, false BINGO, payouts, house cut,
withdrawals and every admin feature. A second test (10 checks) kills the server mid-game
and checks that every player is refunded on restart.

## Deploying

See **[DEPLOY.md](DEPLOY.md)** for step-by-step guides (VPS, or DirectAdmin Node.js hosting) and the go-live checklist.

## Production safety built in
- **Crash-safe money:** every entry fee belongs to a saved round. If the server crashes or restarts
  mid-game, all unfinished rounds are refunded on startup and players get a Telegram message.
  Payouts, the game record and closing the round happen in one database transaction.
- **Daily backups:** kept on the server (last 14) and sent to admins on Telegram. `/backup` makes one on demand.
- **Rate limits:** on the API, wallet requests, game actions and wrong admin passwords
  (10 failures → 15-minute lockout). Players can have at most 3 deposits / 2 withdrawals pending at once.
- **Startup checks:** in production, the server refuses to run with `DEV_MODE`, a missing token or a non-https URL.
- **Timezone:** stats and backups use `TIMEZONE` (default Africa/Addis_Ababa), not the server clock.
- **Rules screen:** shown on first open, with the 18+ notice and support contact.
- **Health check** at `/healthz`. The bot runs in polling or webhook mode (`BOT_MODE`).

## Project layout
```
server/
  index.js    Express API + Socket.IO + static hosting
  game.js     Room state machine (picking → countdown → playing → finished)
  bingo.js    secure number shuffle
  db.js       SQLite schema + atomic wallet operations
  auth.js     Telegram initData HMAC validation
  bot.js      /start, menu button, admin commands + approve/reject buttons
  admin.js    admin actions (shared by bot + web panel) and /api/admin routes
  backup.js   daily backups
  ratelimit.js
app.cjs           startup file for shared hosting (Passenger)
ecosystem.config.cjs  pm2 config for a VPS
deploy/           VPS setup + update scripts, Caddy config
shared/cards.js   deterministic card generation + win check (used by server and client)
client/src/       React mini app (Lobby, Room, Card, Wallet, Admin)
test/simulate.js  end-to-end test
```

## Customize
- Stakes, countdown, call speed, house cut, minimums: `.env`
- Win patterns: `LINES` in `shared/cards.js`
- Look and feel: `client/src/styles.css`. It follows the user's Telegram theme automatically.

## Before going live
- Real-money games usually need a gaming/lottery license. In Ethiopia, check with the
  National Lottery Administration. Know your legal position before taking deposits.
- Always confirm the money arrived in your account **before** approving a deposit.
  The transaction ID alone proves nothing.
- Back up `data/bingo.db` regularly.
- Use a long, unique `ADMIN_PASSWORD`. Anyone who has it can approve deposits and change balances.
- Ideas for next steps: auto-verify Telebirr/Chapa payments through their API,
  referral bonuses, Amharic translation.
