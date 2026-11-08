# 🎱 Telegram Bingo + ✈️ Aviator + 🎯 Keno + 🎲 Ludo + 🎱 8-Ball Pool Mini App

A multiplayer 75-ball bingo game that runs inside Telegram, with a player wallet.
Players send you money (Telebirr, bank and so on), submit the transaction ID in the app,
and you approve it from the bot with one tap. Their balance updates instantly.

## Languages
The app is in **Amharic (default) and English**. Players switch with the **አማ | EN** button at the top, and the choice
is remembered. The bot then messages each player in their language too (deposit approvals, game starts, wins).
Translations are in `client/src/i18n.js` (app) and `server/i18n.js` (bot messages). The admin panel stays in English.
**Have a native speaker review the Amharic before launch.**

## Home screen and rules
Games appear as square tiles with their own illustration (`client/src/GameArt.jsx`). The first time a player opens
a game, they see its **rules: how to play, how to win, penalties and payouts** (`client/src/GameRules.jsx`).
A 📖 button shows the rules again at any time.

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

**✈️ Aviator (crash game)** (rename it with `CRASH_NAME`; note: "Aviator" is a trademark of Spribe — consider your own name for a public launch)
1. One shared round for everyone. Players bet during a 7-second betting window.
2. The plane takes off and the multiplier climbs from 1.00x. Players press **CASH OUT** to win bet × multiplier,
   or set **auto cash out** (for example 2.00x).
3. When the plane flies away, every bet that wasn't cashed out is lost. Then the next round opens.
4. **House edge 3%** (`CRASH_HOUSE_EDGE`): players get back 97% of bets on average, whatever strategy they use.
   About 4% of rounds crash instantly at 1.00x.
5. **Provably fair:** each round's result is fixed before betting opens. Players see its hash (fingerprint)
   up front, and the seed is revealed after the crash so anyone can check it.
6. Limits: min/max bet and a **max win per bet** (`CRASH_MAX_WIN`) protect you from huge payouts.
7. Server restart mid-flight: anyone who already cashed out keeps the win, and everyone else is refunded.

**🎯 Keno**
1. One shared draw about every minute. Tickets are open for 40 seconds (`KENO_BET_SEC`).
2. Players pick 1–10 numbers from 1–80 (or tap Quick pick) and a stake.
3. 20 numbers are drawn one by one, live. The payout depends on how many of the player's numbers hit
   (see `shared/keno.js` for the full paytable, also shown in the app).
4. **Return to players ≈ 94%** for every ticket size, so the house edge is ≈ 6%. Checked exactly in `test/keno-rtp.js`.
5. Provably fair: the draw's hash is shown before tickets close, and the seed is revealed after.
6. Max win per ticket (`KENO_MAX_WIN`). If a draw is interrupted, all tickets are refunded.

**🎲 Ludo (player vs player)**
1. Tables per stake (`LUDO_STAKES`), each as **1 vs 1** or **4 players**. Players pay the entry fee when joining
   and can leave for a full refund until the table fills. Everyone gets a Telegram message when the game starts.
2. Quick mode: **2 tokens each** (`LUDO_TOKENS`). Classic rules: a 6 to leave base, a 6 rolls again (a third 6 ends
   the turn), landing on an opponent sends it home, star and start squares are safe, exact roll to finish.
3. **Winner takes the pot minus 10%** (`LUDO_HOUSE_CUT`). No risk to you, because players win each other's money.
4. **Turn timer** (`LUDO_TURN_SEC`, 15s): if it runs out, the server plays a sensible move for you.
   After 3 missed turns in a row (`LUDO_MAX_MISSES`) the player forfeits, so nobody can stall a game.
   Leaving mid-game counts as resigning.
5. Fair dice: rolled on the server from a per-game seed. Its hash is shown at the start and the seed is revealed
   at the end, so every roll can be checked.
6. A server restart mid-game refunds everyone at that table.

**🎱 8-Ball Pool (1 vs 1, skill)** · any number of matches run at the same time
1. Tables per stake (`POOL_STAKES`). The winner takes the pot minus 10% (`POOL_HOUSE_CUT`).
2. Standard online 8-ball rules: open table after the break, groups (solids/stripes) are assigned on the first
   legal pot, pot your group and then the 8. Fouls (scratch, no ball hit, wrong ball first, no cushion after
   contact) give the opponent **ball in hand**. Potting the 8 early, or with a foul, loses. An 8 on the break is re-spotted.
3. Controls: touch the table to aim (aim line with ghost ball and deflection), fine-tune buttons,
   pull the cue bar down and release to shoot. With ball in hand, drag the white ball.
4. **Server-side physics:** every shot is simulated on the server. The physics uses only + − × ÷ and √, so it gives
   identical results on every phone, and both players watch exactly the same shot.
5. 30-second shot clock (`POOL_SHOT_SEC`): running out is a foul (ball in hand). 3 in a row forfeits.
6. A server restart mid-match refunds both players.
7. Optional multi-player tables: `POOL_SIZES=2,3,4` adds **Cutthroat** for 3–6 players (each player owns a set of
   balls; last one with balls left wins). Off by default, because players can secretly team up against a third
   player in real-money Cutthroat.

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
This runs, with real signed Telegram auth: a full Bingo game (41 checks): auth forgery,
deposits, duplicate references, entry fees, refunds, false BINGO, payouts, house cut,
withdrawals and every admin feature. crash recovery (10 checks), Aviator end-to-end (26 checks: bets, cash-outs, fairness, pause, restart),
a statistical check of the crash game's house edge over 200,000 simulated rounds,
Keno end-to-end (24 checks), Keno math (exact paytable returns + draw fairness over 100,000 draws),
Ludo rules (17 checks), Ludo end-to-end (21 checks: bots play full 2- and 4-player games, timeouts, forfeits, refunds),
pool physics + rules (22 checks) pool end-to-end (16 checks: bots play complete matches with real aiming, several matches at once),
and a 3-player Cutthroat match.

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
  game.js     Bingo room state machine (picking → countdown → playing → finished)
  crash.js    Aviator crash game (betting → flying → crashed), provably fair
  keno.js     Keno shared draws (betting → drawing → results), provably fair
  ludo.js     Ludo tables, matchmaking, turns/timers, forfeits, payouts
  pool.js     8-ball pool tables, server-simulated shots, shot clock, payouts
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
shared/crash.js   multiplier curve + crash-point formula (server and client)
client/src/flight.js  60fps canvas animation (plane, curve, stars, fly-away)
shared/keno.js    Keno paytable + ticket rules (server and client)
shared/ludo.js    Ludo board geometry + rules (server and client)
shared/pool.js    pool physics (deterministic) + 8-ball rules + aiming guide
shared/money.js   all money is stored in cents; helpers to convert/format
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
