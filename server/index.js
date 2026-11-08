import './log.js';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server } from 'socket.io';
import { config, checkConfig, ROOT } from './config.js';
import { authenticate, requireAuth, failedTooOften, recordAuthFailure } from './auth.js';
import { securityHeaders, errorHandler, publicMessage, socketIp } from './security.js';
import { serveStatic } from './static.js';
import { seen, isFrozen, assertNotFrozen } from './risk.js';
import * as rg from './rg.js';
import { startMonitor, health } from './monitor.js';
import { db, setUserLang, getUser, history, createDeposit, createWithdrawal, countPending, refundOpenRounds } from './db.js';
import { GameManager } from './game.js';
import { CrashGame } from './crash.js';
import { KenoGame } from './keno.js';
import { LudoManager } from './ludo.js';
import { PoolManager } from './pool.js';
import { KerenbulaManager } from './kerenbula.js';
import { startBot, stopBot, notifyAdmins, notifyUser, botUsername } from './bot.js';
import { createAdmin, isAdminId } from './admin.js';
import { limit, allow } from './ratelimit.js';
import { scheduleBackups } from './backup.js';
import { fmtMoney } from '../shared/money.js';
import { tr } from './i18n.js';

checkConfig();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy); // number of proxies in front (Caddy / Nginx / Passenger / Cloudflare)
app.use(securityHeaders());
const server = http.createServer(app);
// Drop slow / stuck HTTP clients (slowloris) instead of letting them hold connections open
server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 65000; // longer than typical proxy idle timeouts
const io = new Server(server, {
  cors: { origin: config.production ? config.webAppUrl : '*' },
  maxHttpBufferSize: 1e4,        // game messages are tiny; refuse anything bigger
  connectTimeout: 20000,
  pingInterval: 20000, pingTimeout: 20000,
});

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
games.pool = config.pool.enabled ? new PoolManager(io, onBalanceChange, games) : null;
games.kerenbula = config.kerenbula.enabled ? new KerenbulaManager(io, onBalanceChange, games) : null;
const admin = createAdmin({ games, onBalanceChange, io });
startMonitor({ io, games });

// ---------------- REST API ----------------
app.use(express.json({ limit: '20kb' }));
app.use('/api', limit('api', config.apiRateIp, 60 * 1000)); // per IP (generous: many phones share one carrier IP)

// Health check for uptime monitors / load balancers: 200 when healthy, 503 when not
app.get('/healthz', (_req, res) => {
  const h = health(shuttingDown);
  res.status(h.ok ? 200 : 503).set('Cache-Control', 'no-store').json(h);
});

app.use('/api/admin', admin.router);

app.get('/api/config', (_req, res) =>
  res.json({
    stakes: config.stakes,
    cardCount: config.cardCount,
    maxCards: config.maxCards,
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
    pool: config.pool.enabled
      ? { stakes: config.pool.stakes, sizes: config.pool.sizes, houseCut: config.pool.houseCut, shotSec: config.pool.shotSec, maxMisses: config.pool.maxMisses }
      : null,
    kerenbula: config.kerenbula.enabled
      ? (({ stakes, houseCut, target, maxFrames, pinPoints, rollSec, maxMisses }) => ({ stakes, houseCut, target, maxFrames, pinPoints, rollSec, maxMisses }))(config.kerenbula)
      : null,
    ludo: config.ludo.enabled
      ? { stakes: config.ludo.stakes, houseCut: config.ludo.houseCut, tokens: config.ludo.tokens, turnSec: config.ludo.turnSec,
          maxMisses: config.ludo.maxMisses, stepMs: config.ludo.stepMs }
      : null,
    keno: config.keno.enabled
      ? { minBet: config.keno.minBet, maxBet: config.keno.maxBet, maxWin: config.keno.maxWin, betSec: config.keno.betSec }
      : null,
    devMode: config.devMode,
    botUsername: botUsername(),
  }));

app.get('/api/me', requireAuth, (req, res) => {
  const l = rg.getLimits(req.user.id);
  res.json({ user: { ...req.user, isAdmin: isAdminId(req.user.id), ageConfirmed: l.ageConfirmed, excludedUntil: l.excludedUntil, reminderMin: l.reminderMin } });
});

// ---- Responsible gambling ----
const rgRoute = (fn) => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(400).json({ error: publicMessage(e) }); } };
app.get('/api/rg', requireAuth, rgRoute((req) => rg.getLimits(req.user.id)));
app.get('/api/rg/today', requireAuth, rgRoute((req) => rg.todaySummary(req.user.id)));
app.post('/api/rg/age', requireAuth, rgRoute((req) => { rg.confirmAge(req.user.id); return rg.getLimits(req.user.id); }));
app.post('/api/rg/limits', requireAuth, rgRoute((req) => rg.setLimits(req.user.id, { day: req.body.day, week: req.body.week })));
app.post('/api/rg/reminder', requireAuth, rgRoute((req) => rg.setReminder(req.user.id, req.body.minutes)));
app.post('/api/rg/exclude', requireAuth, rgRoute((req) => {
  const r = rg.selfExclude(req.user.id, req.body.days);
  console.log(`[rg] ${req.user.id} self-excluded until ${new Date(r.excludedUntil * 1000).toISOString()}`);
  return r;
}));

app.post('/api/lang', requireAuth, (req, res) => { setUserLang(req.user.id, req.body.lang); res.json({ ok: true }); });

app.get('/api/history', requireAuth, (req, res) => res.json({ items: history(req.user.id) }));

const money = (n) => fmtMoney(n, config.currency);
const perUser = (req) => req.user.id;
const walletLimit = limit('wallet', config.walletRate, 10 * 60 * 1000, perUser); // deposit/withdraw requests per 10 min per player

app.post('/api/deposit', requireAuth, walletLimit, async (req, res) => {
  const amount = Math.floor(Number(req.body.amount)); // cents
  const reference = String(req.body.reference || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!Number.isFinite(amount) || amount < config.minDeposit)
    return res.status(400).json({ error: `Minimum deposit is ${money(config.minDeposit)}` });
  if (amount > config.maxDeposit)
    return res.status(400).json({ error: `Maximum deposit is ${money(config.maxDeposit)}` });
  if (!/^[A-Z0-9\-_.]{4,64}$/.test(reference))
    return res.status(400).json({ error: 'Enter the transaction ID exactly as it appears in your payment SMS' });
  try { rg.checkDeposit(req.user.id, amount); } catch (e) { return res.status(400).json({ error: e.message, rg: true }); }
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
  if (isFrozen(req.user.id)) return res.status(403).json({ error: 'Your account is under review. Please contact support.' });
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
  const ip = socketIp(socket.handshake);
  socket.data.ip = ip;
  if (shuttingDown) return next(new Error('Server restarting'));
  if (!allow(`conn:${ip}`, config.connRateIp, 60 * 1000)) return next(new Error('Too many connections'));
  if (failedTooOften(ip)) return next(new Error('Unauthorized'));
  const { initData, devUser } = socket.handshake.auth || {};
  const user = authenticate(initData, devUser);
  if (!user) { recordAuthFailure(ip); return next(new Error('Unauthorized')); }
  socket.data.user = user;
  seen(user.id, { ip, device: socket.handshake.auth?.device });
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  // One player may have a few tabs/devices open; past the limit, the oldest connection is closed.
  const mine = io.sockets.adapter.rooms.get(`user:${user.id}`);
  if (mine && mine.size >= config.maxSocketsPerUser) {
    const oldest = io.sockets.sockets.get(mine.values().next().value);
    oldest?.emit('server:replaced');
    oldest?.disconnect(true);
  }
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
  if (games.pool) {
    socket.emit('pool:home', games.pool.lobby());
    const loc = games.pool.userLoc.get(String(user.id));
    if (loc?.game) socket.join(`pool:${loc.game}`);
  }
  if (games.kerenbula) {
    socket.emit('kb:home', games.kerenbula.lobby());
    const loc = games.kerenbula.userLoc.get(String(user.id));
    if (loc?.game) socket.join(`kb:${loc.game}`);
  }
  onBalanceChange(user.id);

  // Wrap handlers: rate-limit, and send thrown errors back to the client as ack errors
  const handle = (event, fn) =>
    socket.on(event, (payload, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!payload || typeof payload !== 'object') payload = {};
      if (!allow(`sock:${user.id}`, config.socketRate, 10 * 1000)) return ack({ ok: false, error: 'Slow down a little 🙂' });
      // Frozen accounts can look around but not put money in play
      if (/(:join|:bet|:buy|card:pick)$/.test(event)) {
        if (isFrozen(user.id)) return ack({ ok: false, error: 'Your account is under review. Please contact support.' });
        const block = rg.playBlock(user.id); // not confirmed 18+, or on a self-chosen break
        if (block) return ack({ ok: false, error: block, rg: true });
      }
      try {
        ack({ ok: true, ...(fn(payload) || {}) });
      } catch (e) {
        ack({ ok: false, error: publicMessage(e, `socket ${event}`) });
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

  handle('card:unpick', ({ stake, card }) => {
    games.get(stake).unpick(user, card);
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
  handle('ludo:join', ({ stake, size, invite, code }) => ({ me: ludo().join(getUser(user.id), stake, size, { private: !!invite, code }) }));
  handle('ludo:practice', () => ({ me: ludo().practice(getUser(user.id)) }));
  handle('ludo:leave', () => ({ me: ludo().leave(user) }));
  handle('ludo:roll', () => { ludo().game(user.id).actRoll(user.id); });
  handle('ludo:move', ({ token }) => { ludo().game(user.id).actMove(user.id, token); });
  handle('ludo:watch', ({ id }) => {
    const g = ludo().games.get(Number(id));
    if (!g) throw new Error('Game not found');
    socket.join(g.channel);
    return { game: g.stateFor(user.id) };
  });

  // ---- 8-ball pool ----
  const pool = () => {
    if (!games.pool) throw new Error('This game is not available');
    return games.pool;
  };
  handle('pool:enter', () => {
    socket.join('pool-lobby');
    const me = pool().locationOf(user.id);
    let game = null;
    if (me?.game) {
      const g = pool().games.get(me.game);
      if (g) { socket.join(g.channel); game = g.stateFor(user.id); }
    }
    return { lobby: pool().lobby(), me, game };
  });
  handle('pool:exit', () => { socket.leave('pool-lobby'); });
  handle('pool:join', ({ stake, size, invite, code }) => ({ me: pool().join(getUser(user.id), stake, size || 2, { private: !!invite, code }) }));
  handle('pool:practice', () => ({ me: pool().practice(getUser(user.id)) }));
  handle('pool:leave', () => ({ me: pool().leave(user) }));
  handle('pool:shoot', (shot) => pool().game(user.id).shoot(user.id, shot));

  // ---- ከረንቡላ Kerenbula ----
  const kb = () => {
    if (!games.kerenbula) throw new Error('This game is not available');
    return games.kerenbula;
  };
  handle('kb:enter', () => {
    socket.join('kb-lobby');
    const me = kb().locationOf(user.id);
    let game = null;
    if (me?.game) {
      const g = kb().games.get(me.game);
      if (g) { socket.join(g.channel); game = g.stateFor(user.id); }
    }
    return { lobby: kb().lobby(), me, game };
  });
  handle('kb:exit', () => { socket.leave('kb-lobby'); });
  handle('kb:join', ({ stake, invite, code }) => ({ me: kb().join(getUser(user.id), stake, { private: !!invite, code }) }));
  handle('kb:practice', () => ({ me: kb().practice(getUser(user.id)) }));
  handle('kb:leave', () => ({ me: kb().leave(user) }));
  handle('kb:roll', (r) => kb().game(user.id).roll(user.id, r));

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
const tellRefunds = (list, whyKey) =>
  Promise.all(list.map((r) => notifyUser(r.userId, tr(r.userId, 'refunded', { amount: money(r.amount), label: r.label, why: tr(r.userId, whyKey) }))));

async function main() {
  // Registers the webhook route synchronously (before the catch-all below), then connects to
  // Telegram in the background — the website starts even if Telegram is slow to answer.
  startBot({ actions: admin.actions, app });

  // Serve the built frontend (pre-compressed, cached forever for hashed files)
  serveStatic(app, path.join(ROOT, 'dist'));
  app.use(errorHandler);

  server.listen(config.port, () => {
    console.log(`Bingo server on port ${config.port} (${config.production ? 'production' : 'development'}, TZ ${config.timezone})`);
  });

  // "N online" on the home screen
  setInterval(() => {
    let n = 0;
    for (const k of io.sockets.adapter.rooms.keys()) if (k.startsWith('user:')) n++;
    io.to('lobby').emit('online', { n });
  }, 15000).unref();
  games.crash?.start();
  games.keno?.start();
  scheduleBackups();
  if (recovered.length) tellRefunds(recovered, 'whyRestart');
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
      await tellRefunds(refunds, 'whyMaintenance');
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
