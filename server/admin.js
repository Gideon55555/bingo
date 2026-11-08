// Admin actions shared by the Telegram bot and the web admin panel.
import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { fmtMoney, fmt, toCents } from '../shared/money.js';
import { authenticate } from './auth.js';
import {
  getStats, findUser, listUsers, listTransactions, listGames, adjustBalance, allUserIds, history,
  approveDeposit, rejectDeposit, markWithdrawalPaid, rejectWithdrawal, pendingTx,
} from './db.js';
import { notifyUser, sendMessage } from './bot.js';
import { runBackup } from './backup.js';

export const isAdminId = (id) => config.adminIds.includes(String(id));
const money = (n) => fmtMoney(n, config.currency);

export function createAdmin({ games, onBalanceChange }) {
  let broadcastJob = null;

  const actions = {
    stats: () => ({ ...getStats(), paused: games.paused, rooms: games.adminSnapshot() }),
    pending: () => pendingTx(),
    findUser,
    userDetail(q) {
      const u = findUser(q);
      if (!u) throw new Error('User not found');
      const { rows } = listUsers({ search: u.id, limit: 1 });
      return { user: rows.find((r) => r.id === u.id) || u, history: history(u.id) };
    },
    listUsers,
    listTransactions,
    listGames,

    /** Handle a deposit/withdrawal decision. kind: 'deposit'|'withdraw', approve: boolean */
    async decide(kind, id, approve, adminName = 'admin') {
      let t;
      let msg;
      if (kind === 'deposit') {
        t = approve ? approveDeposit(id) : rejectDeposit(id);
        msg = t && (approve
          ? `✅ Your deposit of ${money(t.amount)} was approved. Good luck!`
          : `❌ Your deposit of ${money(t.amount)} (ref ${t.reference}) was rejected. Contact support if this is a mistake.`);
      } else {
        t = approve ? markWithdrawalPaid(id) : rejectWithdrawal(id);
        msg = t && (approve
          ? `✅ Your withdrawal of ${money(-t.amount)} has been sent to ${t.phone}.`
          : `❌ Your withdrawal of ${money(-t.amount)} was rejected and refunded to your balance.`);
      }
      if (!t) throw new Error('Already handled (or not found)');
      onBalanceChange(t.user_id);
      await notifyUser(t.user_id, msg);
      console.log(`[admin] ${adminName} ${approve ? 'approved' : 'rejected'} ${kind} #${id}`);
      return t;
    },

    async adjust(userQuery, amount, note, adminName = 'admin') {
      const u = findUser(userQuery);
      if (!u) throw new Error('User not found');
      const updated = adjustBalance(u.id, amount, note || `Adjusted by ${adminName}`);
      onBalanceChange(u.id);
      const amt = Math.trunc(Number(amount)); // cents
      await notifyUser(u.id, amt > 0
        ? `🎁 ${money(amt)} was added to your balance.${note ? ` (${note})` : ''}`
        : `ℹ️ ${money(-amt)} was deducted from your balance.${note ? ` (${note})` : ''}`);
      console.log(`[admin] ${adminName} adjusted ${u.id} by ${amt}`);
      return updated;
    },

    pause() { return games.pause(); },
    resume() { games.resume(); },

    /** Sends to every user, ~20 msgs/sec to stay under Telegram limits. Runs in background. */
    broadcast(text) {
      text = String(text || '').trim();
      if (!text) throw new Error('Message is empty');
      if (broadcastJob?.running) throw new Error('A broadcast is already running');
      const ids = allUserIds();
      const job = { running: true, total: ids.length, sent: 0, failed: 0 };
      broadcastJob = job;
      (async () => {
        for (const id of ids) {
          (await sendMessage(id, text)) ? job.sent++ : job.failed++;
          await new Promise((r) => setTimeout(r, 50));
        }
        job.running = false;
        console.log(`[admin] broadcast done: ${job.sent} sent, ${job.failed} failed`);
      })();
      return job;
    },
    broadcastStatus: () => broadcastJob,
    backup: () => runBackup({ sendToTelegram: true, label: 'manual' }),
  };

  return { actions, router: adminRouter(actions) };
}

// ---------------- Web admin API ----------------

// Wrong-password tracking per IP: 10 failures → locked for 15 minutes
const failures = new Map();
const LOCK_MS = 15 * 60 * 1000;
const isLocked = (ip) => {
  const f = failures.get(ip);
  if (f && Date.now() - f.first > LOCK_MS) { failures.delete(ip); return false; }
  return !!f && f.count >= 10;
};
const recordFailure = (ip) => {
  const f = failures.get(ip) || { count: 0, first: Date.now() };
  f.count++;
  failures.set(ip, f);
};

/** Admin = Telegram user in ADMIN_IDS (inside the Mini App), or ADMIN_PASSWORD (browser). */
function requireAdmin(req, res, next) {
  const key = req.get('x-admin-key') || '';
  const pw = config.adminPassword;
  if (pw && key) {
    if (isLocked(req.ip)) return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
    const a = crypto.createHash('sha256').update(key).digest();
    const b = crypto.createHash('sha256').update(pw).digest();
    if (crypto.timingSafeEqual(a, b)) { req.adminName = 'web-admin'; return next(); }
    recordFailure(req.ip);
    console.warn(`[admin] wrong admin password from ${req.ip}`);
    return res.status(401).json({ error: 'Wrong password' });
  }
  const h = req.get('authorization') || '';
  const user = authenticate(h.startsWith('tma ') ? h.slice(4) : '', req.get('x-dev-user'));
  if (user && isAdminId(user.id)) { req.adminName = user.first_name || user.id; return next(); }
  res.status(401).json({ error: 'Admins only' });
}

function adminRouter(actions) {
  const r = express.Router();
  r.use(requireAdmin);
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); } catch (e) { res.status(400).json({ error: e.message }); }
  };

  r.get('/stats', wrap(() => actions.stats()));
  r.get('/pending', wrap(() => ({ items: actions.pending() })));
  r.get('/users', wrap((req) => actions.listUsers({
    search: String(req.query.search || ''), limit: Math.min(Number(req.query.limit) || 50, 200), offset: Number(req.query.offset) || 0,
  })));
  r.get('/users/:id', wrap((req) => actions.userDetail(req.params.id)));
  r.get('/transactions', wrap((req) => ({ items: actions.listTransactions({
    type: String(req.query.type || ''), status: String(req.query.status || ''), userId: String(req.query.userId || ''),
    limit: Math.min(Number(req.query.limit) || 100, 500),
  }) })));
  r.get('/games', wrap(() => ({ items: actions.listGames(50) })));
  r.post('/decide', wrap((req) => actions.decide(req.body.kind, Number(req.body.id), !!req.body.approve, req.adminName)));
  r.post('/adjust', wrap((req) => actions.adjust(req.body.userId, req.body.amount, req.body.note, req.adminName)));
  r.post('/pause', wrap(() => actions.pause()));
  r.post('/resume', wrap(() => { actions.resume(); return { ok: true }; }));
  r.post('/broadcast', wrap((req) => actions.broadcast(req.body.text)));
  r.get('/broadcast', wrap(() => actions.broadcastStatus() || {}));
  return r;
}
