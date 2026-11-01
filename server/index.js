import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { config } from './config.js';
import { authenticate, requireAuth } from './auth.js';
import { getUser, history, createDeposit, createWithdrawal } from './db.js';
import { GameManager } from './game.js';
import { startBot, notifyAdmins } from './bot.js';
import { createAdmin, isAdminId } from './admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

if (config.devMode) console.warn('⚠️  DEV_MODE is ON — anyone can log in as any user. Disable in production!');

// Push fresh balance to every open socket of this user.
function onBalanceChange(userId) {
  const u = getUser(userId);
  if (u) io.to(`user:${userId}`).emit('balance', { balance: u.balance });
}

const games = new GameManager(io, onBalanceChange);
const admin = createAdmin({ games, onBalanceChange });

// ---------------- REST API ----------------
app.use(express.json());
app.use('/api/admin', admin.router);

app.get('/api/config', (_req, res) =>
  res.json({
    stakes: config.stakes,
    cardCount: config.cardCount,
    currency: config.currency,
    paymentInfo: config.paymentInfo,
    minDeposit: config.minDeposit,
    minWithdraw: config.minWithdraw,
    houseCut: config.houseCut,
    minPlayers: config.minPlayers,
    devMode: config.devMode,
  }));

app.get('/api/me', requireAuth, (req, res) => res.json({ user: { ...req.user, isAdmin: isAdminId(req.user.id) } }));

app.get('/api/history', requireAuth, (req, res) => res.json({ items: history(req.user.id) }));

app.post('/api/deposit', requireAuth, async (req, res) => {
  const amount = Math.floor(Number(req.body.amount));
  const reference = String(req.body.reference || '').trim().toUpperCase();
  if (!Number.isFinite(amount) || amount < config.minDeposit)
    return res.status(400).json({ error: `Minimum deposit is ${config.minDeposit} ${config.currency}` });
  if (reference.length < 4 || reference.length > 64)
    return res.status(400).json({ error: 'Enter the transaction ID from your payment SMS' });
  try {
    const id = createDeposit(req.user.id, amount, reference);
    notifyAdmins(id);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/withdraw', requireAuth, (req, res) => {
  const amount = Math.floor(Number(req.body.amount));
  const phone = String(req.body.phone || '').trim();
  if (!Number.isFinite(amount) || amount < config.minWithdraw)
    return res.status(400).json({ error: `Minimum withdrawal is ${config.minWithdraw} ${config.currency}` });
  if (!/^\+?\d{9,15}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number' });
  try {
    const id = createWithdrawal(req.user.id, amount, phone);
    onBalanceChange(req.user.id);
    notifyAdmins(id);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Serve the built frontend
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

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
  onBalanceChange(user.id);

  // Wrap handlers so thrown errors go back to the client as ack errors
  const handle = (event, fn) =>
    socket.on(event, (payload = {}, ack = () => {}) => {
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
});

server.listen(config.port, () => {
  console.log(`Bingo server on http://localhost:${config.port}`);
  startBot({ actions: admin.actions });
});
