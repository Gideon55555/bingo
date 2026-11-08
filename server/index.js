import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server } from 'socket.io';
import { config, checkConfig, ROOT } from './config.js';
import { authenticate, requireAuth } from './auth.js';
import { db, getUser, history, createDeposit, createWithdrawal, countPending, refundOpenRounds } from './db.js';
import { GameManager } from './game.js';
import { CrashGame } from './crash.js';
import { KenoGame } from './keno.js';
import { LudoManager } from './ludo.js';
import { startBot, stopBot, notifyAdmins, notifyUser } from './bot.js';
import { createAdmin, isAdminId } from './admin.js';
import { limit, allow } from './ratelimit.js';
import { scheduleBackups } from './backup.js';
import { fmtMoney } from '../shared/money.js';

checkConfig();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Nginx / Caddy / Cloudflare / Passenger
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.production ? config.webAppUrl : '*' }, maxHttpBufferSize: 1e4 });

// Push fresh balance to every open socket of this user.
function onBalanceChange(userId) {
  const u = getUser(userId);
  if (u) io.to(`user:${userId}`).emit('balance', { balance: u.balance });
}

// ---------------- Crash recovery ----------------
// Any round that was open when the server last stopped (crash, restart, deploy) is refunded.
const recovered = refundOpenRounds('refunded (game interrupted by server restart)');
if (recovered.length) console.log(`[recovery] refunded ${recovered.length} entr(ies) from interrupted rounds`);

const games = new GameManager(io, onBalanceChange);
games.crash = config.crash.enabled ? new CrashGame(io, onBalanceChange, games) : null;
games.keno = config.keno.enabled ? new KenoGame(io, onBalanceChange, games) : null;
games.ludo = config.ludo.enabled ? new LudoManager(io, onBalanceChange, games) : null;
const admin = createAdmin({ games, onBalanceChange });

// ---------------- REST API ----------------
app.use(express.json({ limit: '20kb' }));
app.use('/api', limit('api', 300, 60 * 1000)); // 300 req/min per IP overall

app.get('/healthz', (_req, res) =>
  res.json({ ok: true, uptime: Math.round(process.uptime()), rooms: games.lobby().map((r) => `${r.stake}:${r.state}`) }));

app.use('/api/admin', admin.router);

app.get('/api/config', (_req, res) =>
  res.json({
    stakes: config.stakes,
    cardCount: config.cardCount,
    currency: config.currency,
    paymentInfo: config.paymentInfo,
    minDeposit: config.minDeposit,
    maxDeposit: config.maxDeposit,
    minWithdraw: config.minWithdraw,
    houseCut: config.houseCut,
    minPlayers: config.minPlayers,
    callIntervalMs: config.callIntervalMs,
    supportContact: config.supportContact,
    appName: config.appName,
    minAge: config.minAge,
    crash: config.crash.enabled
      ? { minBet: config.crash.minBet, maxBet: config.crash.maxBet, maxWin: config.crash.maxWin,
          houseEdge: config.crash.houseEdge, maxMultiplier: config.crash.maxMultiplier, betSec: config.crash.betSec,
          name: config.crash.name }
      : null,
    ludo: config.ludo.enabled
      ? { stakes: config.ludo.stakes, houseCut: config.ludo.houseCut, tokens: config.ludo.tokens, turnSec: config.ludo.turnSec,
          maxMisses: config.ludo.maxMisses, stepMs: config.ludo.stepMs }
      : null,
    keno: config.keno.enabled
      ? { minBet: config.keno.minBet, maxBet: config.keno.maxBet, maxWin: config.keno.maxWin, betSec: config.keno.betSec }
      : null,
    devMode: config.devMode,
  }));

app.get('/api/me', requireAuth, (req, res) => res.json({ user: { ...req.user, isAdmin: isAdminId(req.user.id) } }));

app.get('/api/history', requireAuth, (req, res) => res.json({ items: history(req.user.id) }));

const money = (n) => fmtMoney(n, config.currency);
const perUser = (req) => req.user.id;
const walletLimit = limit('wallet', 5, 10 * 60 * 1000, perUser); // 5 requests / 10 min / user

app.post('/api/deposit', requireAuth, walletLimit, async (req, res) => {
  const amount = Math.floor(Number(req.body.amount)); // cents
  const reference = String(req.body.reference || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!Number.isFinite(amount) || amount < config.minDeposit)
    return res.status(400).json({ error: `Minimum deposit is ${money(config.minDeposit)}` });
  if (amount > config.maxDeposit)
    return res.status(400).json({ error: `Maximum deposit is ${money(config.maxDeposit)}` });
  if (!/^[A-Z0-9\-_.]{4,64}$/.test(reference))
    return res.status(400).json({ error: 'Enter the transaction ID exactly as it appears in your payment SMS' });
  if (countPending(req.user.id, 'deposit') >= config.maxPendingDeposits)
    return res.status(400).json({ error: 'You already have deposits waiting for approval. Please wait for them first.' });
  try {
    const id = createDeposit(req.user.id, amount, reference);
    notifyAdmins(id);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/withdraw', requireAuth, walletLimit, (req, res) => {
  const amount = Math.floor(Number(req.body.amount)); // cents
  const phone = String(req.body.phone || '').replace(/[\s-]/g, '');
  if (!Number.isFinite(amount) || amount < config.minWithdraw)
    return res.status(400).json({ error: `Minimum withdrawal is ${money(config.minWithdraw)}` });
  if (!/^\+?\d{9,15}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number' });
  if (countPending(req.user.id, 'withdraw') >= config.maxPendingWithdrawals)
    return res.status(400).json({ error: 'You already have withdrawals being processed. Please wait for them first.' });
  try {
    const id = createWithdrawal(req.user.id, amount, phone);
    onBalanceChange(req.user.id);
    notifyAdmins(id);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------- Realtime ----------------
io.use((socket, next) => {
  const { initData, devUser } = socket.handshake.auth || {};
  const user = authenticate(initData, devUser);
  if (!user) return next(new Error('Unauthorized'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  socket.join(`user:${user.id}`);
  socket.join('lobby');
  socket.emit('lobby:all', games.lobby());
  if (games.crash) socket.emit('crash:lobby', games.crash.lobbySummary());
  if (games.keno) socket.emit('keno:lobby', games.keno.lobbySummary());
  if (games.ludo) {
    socket.emit('ludo:home', games.ludo.lobby());
    // Reconnecting player who is in a game: rejoin the game channel
    const loc = games.ludo.userLoc.get(String(user.id));
    if (loc?.game) socket.join(`ludo:${loc.game}`);
  }
  onBalanceChange(user.id);

  // Wrap handlers: rate-limit, and send thrown errors back to the client as ack errors
  const handle = (event, fn) =>
    socket.on(event, (payload, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!payload || typeof payload !== 'object') payload = {};
      if (!allow(`sock:${user.id}`, config.socketRate, 10 * 1000)) return ack({ ok: false, error: 'Slow down a little 🙂' });
      try {
        ack({ ok: true, ...(fn(payload) || {}) });
      } catch (e) {
        ack({ ok: false, error: e.message });
      }
    });

  handle('room:enter', ({ stake }) => {
    for (const r of socket.rooms) if (r.startsWith('room:')) socket.leave(r);
    const room = games.get(stake);
    socket.join(room.channel);
    return { room: room.publicState(user.id) };
  });

  handle('room:exit', ({ stake }) => {
    socket.leave(games.get(stake).channel);
  });

  handle('card:pick', ({ stake, card }) => {
    games.get(stake).pick(getUser(user.id), card);
  });

  handle('card:unpick', ({ stake }) => {
    games.get(stake).unpick(user);
  });

  handle('bingo', ({ stake }) => games.get(stake).claim(user));

  // ---- Rocket (crash game) ----
  const crash = () => {
    if (!games.crash) throw new Error('This game is not available');
    return games.crash;
  };
  handle('crash:enter', () => {
    socket.join(crash().channel);
    return { state: crash().publicState(), me: crash().myBet(user.id) };
  });
  handle('crash:exit', () => { socket.leave('crash'); });
  handle('crash:bet', ({ amount, auto }) => ({ me: crash().bet(getUser(user.id), amount, auto) }));
  handle('crash:cancel', () => ({ me: crash().cancel(user) }));
  // ---- Ludo ----
  const ludo = () => {
    if (!games.ludo) throw new Error('This game is not available');
    return games.ludo;
  };
  handle('ludo:enter', () => {
    socket.join('ludo-lobby');
    const me = ludo().locationOf(user.id);
    let game = null;
    if (me?.game) {
      const g = ludo().games.get(me.game);
      if (g) { socket.join(g.channel); game = g.stateFor(user.id); }
    }
    return { lobby: ludo().lobby(), me, game };
  });
  handle('ludo:exit', () => { socket.leave('ludo-lobby'); });
  handle('ludo:join', ({ stake, size }) => ({ me: ludo().join(getUser(user.id), stake, size) }));
  handle('ludo:leave', () => ({ me: ludo().leave(user) }));
  handle('ludo:roll', () => { ludo().game(user.id).actRoll(user.id); });
  handle('ludo:move', ({ token }) => { ludo().game(user.id).actMove(user.id, token); });
  handle('ludo:watch', ({ id }) => {
    const g = ludo().games.get(Number(id));
    if (!g) throw new Error('Game not found');
    socket.join(g.channel);
    return { game: g.stateFor(user.id) };
  });

  // ---- Keno ----
  const keno = () => {
    if (!games.keno) throw new Error('This game is not available');
    return games.keno;
  };
  handle('keno:enter', () => {
    socket.join(keno().channel);
    return { state: keno().publicState(), me: keno().myTicket(user.id) };
  });
  handle('keno:exit', () => { socket.leave('keno'); });
  handle('keno:buy', ({ picks, amount }) => ({ me: keno().buy(getUser(user.id), picks, amount) }));
  handle('keno:cancel', () => ({ me: keno().cancel(user) }));

  handle('crash:cashout', () => ({ me: crash().myBet(user.id), cashed: !!crash().cashout(user) }));
});

// ---------------- Startup ----------------
const tellRefunds = (list, why) =>
  Promise.all(list.map((r) => notifyUser(r.userId, `↩️ Your ${money(r.amount)} entry (${r.label}) was refunded — ${why}.`)));

async function main() {
  // Registers the webhook route synchronously (before the catch-all below), then connects to
  // Telegram in the background — the website starts even if Telegram is slow to answer.
  startBot({ actions: admin.actions, app });

  // Serve the built frontend
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.use('/assets', (_req, res) => res.status(404).end());
    app.get(/^\/(?!api|socket\.io|tg-webhook).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    console.warn('⚠️  dist/ not found — run "npm run build" to build the frontend.');
  }

  server.listen(config.port, () => {
    console.log(`Bingo server on port ${config.port} (${config.production ? 'production' : 'development'}, TZ ${config.timezone})`);
  });

  games.crash?.start();
  games.keno?.start();
  scheduleBackups();
  if (recovered.length) tellRefunds(recovered, 'the game was interrupted by a server restart');
}

// ---------------- Shutdown ----------------
let shuttingDown = false;
async function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — refunding unfinished rounds and closing…`);
  const force = setTimeout(() => process.exit(code), 8000);
  try {
    games.stopAll();
    io.emit('server:restart');
    const refunds = refundOpenRounds('refunded (server maintenance)');
    if (refunds.length) {
      console.log(`[shutdown] refunded ${refunds.length} entr(ies)`);
      await tellRefunds(refunds, 'the server is restarting for maintenance');
    }
    await stopBot();
    io.close();
    server.close();
    db.close();
  } catch (e) {
    console.error('[shutdown] error:', e);
  }
  clearTimeout(force);
  process.exit(code);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e);
  shutdown('uncaughtException', 1); // pm2 / Passenger will restart us
});

main();
