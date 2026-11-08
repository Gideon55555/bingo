// Admin actions shared by the Telegram bot and the web admin panel.
import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { fmtMoney, fmt, toCents } from '../shared/money.js';
import { authenticate } from './auth.js';
import {
  getStats, listCrashRounds, listKenoRounds, listLudoGames, listPoolGames, listKerenbulaGames, findUser, listUsers, listTransactions, listGames, adjustBalance, allUserIds, history,
  approveDeposit, rejectDeposit, invalidateStats, markWithdrawalPaid, rejectWithdrawal, pendingTx,
  logAdmin, listAdminLog, addWithdrawalApproval, getTx,
} from './db.js';
import { notifyUser, sendMessage } from './bot.js';
import { runBackup } from './backup.js';
import { tr } from './i18n.js';
import { publicMessage } from './security.js';
import { metrics } from './monitor.js';
import { verifyTotp } from './totp.js';
import { onDepositApproved } from './growth.js';
import { listClientErrors } from './clienterrors.js';
import { sharedDevices, suspiciousPairs, lowPlayCashouts, userFlags, linkedAccounts, setFrozen } from './risk.js';

export const isAdminId = (id) => config.adminIds.includes(String(id));
/** Normalise "who did it": { id, name, ip }. Accepts a plain name for older callers. */
const asWho = (w) => (w && typeof w === 'object' ? w : { id: String(w || 'admin'), name: String(w || 'admin') });
const twoPersonActive = () => config.adminIds.length >= 2;
const money = (n) => fmtMoney(n, config.currency);

export function createAdmin({ games, onBalanceChange }) {
  let broadcastJob = null;

  const actions = {
    stats: () => ({ ...getStats(), paused: games.paused, rooms: games.adminSnapshot(), crash: games.crash?.adminSnapshot() || null, keno: games.keno?.adminSnapshot() || null, ludo: games.ludo?.adminSnapshot() || null, pool: games.pool?.adminSnapshot() || null, kerenbula: games.kerenbula?.adminSnapshot() || null }),
    poolGames: () => listPoolGames(50),
    kerenbulaGames: () => listKerenbulaGames(50),
    ludoGames: () => listLudoGames(50),
    kenoRounds: () => listKenoRounds(50),
    crashRounds: () => listCrashRounds(50),
    pending: () => pendingTx().map((t) => (t.type === 'withdraw' ? { ...t, flags: userFlags(t.user_id) } : t)),
    risk: () => ({ sharedDevices: sharedDevices(), pairs: suspiciousPairs(), lowPlay: lowPlayCashouts() }),
    freeze: (userId, on, reason, who) => setFrozen(userId, on, reason, who),
    findUser,
    userDetail(q) {
      const u = findUser(q);
      if (!u) throw new Error('User not found');
      const { rows } = listUsers({ search: u.id, limit: 1 });
      return { user: rows.find((r) => r.id === u.id) || u, history: history(u.id), flags: userFlags(u.id), linked: linkedAccounts(u.id) };
    },
    listUsers,
    listTransactions,
    listGames,

    /**
     * Handle a deposit/withdrawal decision. kind: 'deposit'|'withdraw', approve: boolean, who: {id,name,ip}.
     * Big withdrawals (≥ WITHDRAW_SECOND_APPROVAL) need two different admins when there are 2+ admins:
     * the first approval is recorded and the request stays pending ({ awaitingSecond: true }).
     */
    async decide(kind, id, approve, whoIn) {
      const who = asWho(whoIn);
      let t;
      let msg;
      if (kind === 'deposit') {
        t = approve ? approveDeposit(id) : rejectDeposit(id);
        msg = t && (approve
          ? tr(t.user_id, 'depositApproved', { amount: money(t.amount) })
          : tr(t.user_id, 'depositRejected', { amount: money(t.amount), ref: t.reference }));
      } else {
        const cur = getTx(id);
        if (approve && cur && cur.type === 'withdraw' && cur.status === 'pending' && twoPersonActive() && -cur.amount >= config.withdrawSecondApproval) {
          const prior = cur.approvals ? JSON.parse(cur.approvals) : [];
          if (!prior.length) {
            const u = addWithdrawalApproval(id, who);
            logAdmin(who, 'withdraw_first_approval', id, { amount: -cur.amount, user: cur.user_id }, who.ip);
            console.log(`[admin] ${who.name} gave first approval to withdrawal #${id} — waiting for a second admin`);
            return { ...u, awaitingSecond: true, firstBy: who.name };
          }
          if (prior.some((p) => String(p.id) === String(who.id))) throw new Error('A different admin must give the second approval');
          addWithdrawalApproval(id, who);
        }
        t = approve ? markWithdrawalPaid(id) : rejectWithdrawal(id);
        msg = t && (approve
          ? tr(t.user_id, 'withdrawSent', { amount: money(-t.amount), phone: t.phone })
          : tr(t.user_id, 'withdrawRejected', { amount: money(-t.amount) }));
      }
      if (!t) throw new Error('Already handled (or not found)');
      invalidateStats();
      if (kind === 'deposit' && approve) {
        const ref = onDepositApproved(t); // friend's first deposit → inviter's referral bonus
        if (ref) {
          onBalanceChange(ref.inviterId);
          notifyUser(ref.inviterId, tr(ref.inviterId, 'refBonus', { amount: money(ref.amount) }));
          if (ref.friendAmount) onBalanceChange(ref.friendId);
        }
      }
      logAdmin(who, `${approve ? 'approve' : 'reject'}_${kind}`, id, { amount: Math.abs(t.amount), user: t.user_id, ref: t.reference || undefined, phone: t.phone || undefined }, who.ip);
      onBalanceChange(t.user_id);
      await notifyUser(t.user_id, msg);
      console.log(`[admin] ${who.name} ${approve ? 'approved' : 'rejected'} ${kind} #${id}`);
      return t;
    },

    async adjust(userQuery, amount, note, whoIn) {
      const who = asWho(whoIn);
      const u = findUser(userQuery);
      if (!u) throw new Error('User not found');
      const updated = adjustBalance(u.id, amount, note || `Adjusted by ${who.name}`);
      invalidateStats();
      onBalanceChange(u.id);
      const amt = Math.trunc(Number(amount)); // cents
      logAdmin(who, 'adjust_balance', u.id, { amount: amt, note: note || null, newBalance: updated.balance }, who.ip);
      await notifyUser(u.id, amt > 0
        ? tr(u.id, 'bonusAdded', { amount: money(amt), note: note ? ` (${note})` : '' })
        : tr(u.id, 'deducted', { amount: money(-amt), note: note ? ` (${note})` : '' }));
      console.log(`[admin] ${who.name} adjusted ${u.id} by ${amt}`);
      return updated;
    },

    pause(who) { const r = games.pause(); logAdmin(asWho(who), 'pause_games', null, r, asWho(who).ip); return r; },
    resume(who) { games.resume(); logAdmin(asWho(who), 'resume_games', null, null, asWho(who).ip); },
    adminLog: (q) => listAdminLog(q),

    /** Sends to every user, ~20 msgs/sec to stay under Telegram limits. Runs in background. */
    broadcast(text, who) {
      text = String(text || '').trim();
      if (!text) throw new Error('Message is empty');
      logAdmin(asWho(who), 'broadcast', null, text.slice(0, 500), asWho(who).ip);
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
    backup: (who) => { logAdmin(asWho(who), 'backup', null, null, asWho(who)?.ip); return runBackup({ sendToTelegram: true, label: 'manual' }); },
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

// Browser sessions after a successful login (password + 6-digit code when ADMIN_TOTP_SECRET is set)
const sessions = new Map(); // token -> { until }
const newSession = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { until: Date.now() + config.adminSessionHours * 3600 * 1000 });
  for (const [k, v] of sessions) if (v.until < Date.now()) sessions.delete(k);
  return token;
};
const passwordOk = (key) => {
  const pw = config.adminPassword;
  if (!pw || !key) return false;
  const a = crypto.createHash('sha256').update(String(key)).digest();
  const b = crypto.createHash('sha256').update(pw).digest();
  return crypto.timingSafeEqual(a, b);
};

/** POST /api/admin/login { password, code } → { token } */
function login(req, res) {
  if (isLocked(req.ip)) return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
  const { password, code } = req.body || {};
  if (!passwordOk(password)) {
    recordFailure(req.ip);
    logAdmin({ name: 'web-admin' }, 'login_failed', null, 'wrong password', req.ip);
    console.warn(`[security] wrong admin password from ${req.ip}`);
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (config.adminTotpSecret) {
    if (!code) return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app', needCode: true });
    if (!verifyTotp(config.adminTotpSecret, code)) {
      recordFailure(req.ip);
      logAdmin({ name: 'web-admin' }, 'login_failed', null, 'wrong 2FA code', req.ip);
      return res.status(401).json({ error: 'Wrong or expired code', needCode: true });
    }
  }
  logAdmin({ name: 'web-admin' }, 'login', null, config.adminTotpSecret ? 'password + 2FA' : 'password', req.ip);
  res.json({ token: newSession(), twoFactor: !!config.adminTotpSecret });
}

/** Admin = Telegram user in ADMIN_IDS (inside the Mini App), or a browser session (or, without 2FA, the password header). */
function requireAdmin(req, res, next) {
  const session = req.get('x-admin-session');
  if (session) {
    const s = sessions.get(session);
    if (s && s.until > Date.now()) { req.who = { id: 'web', name: 'web-admin', ip: req.ip }; return next(); }
    return res.status(401).json({ error: 'Session expired — please log in again', expired: true });
  }
  const key = req.get('x-admin-key') || '';
  if (config.adminPassword && key) {
    if (config.adminTotpSecret) return res.status(401).json({ error: 'Log in with your 2-step code', needCode: true });
    if (isLocked(req.ip)) return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
    if (passwordOk(key)) { req.who = { id: 'web', name: 'web-admin', ip: req.ip }; return next(); }
    recordFailure(req.ip);
    logAdmin({ name: 'web-admin' }, 'login_failed', null, 'wrong password', req.ip);
    console.warn(`[security] wrong admin password from ${req.ip}`);
    return res.status(401).json({ error: 'Wrong password' });
  }
  const h = req.get('authorization') || '';
  const user = authenticate(h.startsWith('tma ') ? h.slice(4) : '', req.get('x-dev-user'));
  if (user && isAdminId(user.id)) { req.who = { id: `tg:${user.id}`, name: user.first_name || user.id, ip: req.ip }; req.adminName = req.who.name; return next(); }
  res.status(401).json({ error: 'Admins only' });
}

function adminRouter(actions) {
  const r = express.Router();
  r.post('/login', login);
  r.use(requireAdmin);
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); } catch (e) { res.status(400).json({ error: publicMessage(e, `admin ${req.path}`) }); }
  };

  r.get('/stats', wrap(() => actions.stats()));
  r.get('/metrics', wrap(() => metrics()));
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
  r.get('/crash-rounds', wrap(() => ({ items: actions.crashRounds() })));
  r.get('/keno-rounds', wrap(() => ({ items: actions.kenoRounds() })));
  r.get('/ludo-games', wrap(() => ({ items: actions.ludoGames() })));
  r.get('/pool-games', wrap(() => ({ items: actions.poolGames() })));
  r.get('/kerenbula-games', wrap(() => ({ items: actions.kerenbulaGames() })));
  r.post('/decide', wrap((req) => actions.decide(String(req.body.kind), Number(req.body.id), !!req.body.approve, req.who)));
  r.post('/adjust', wrap((req) => actions.adjust(req.body.userId, req.body.amount, req.body.note, req.who)));
  r.post('/pause', wrap((req) => actions.pause(req.who)));
  r.post('/resume', wrap((req) => { actions.resume(req.who); return { ok: true }; }));
  r.post('/broadcast', wrap((req) => actions.broadcast(req.body.text, req.who)));
  r.get('/risk', wrap(() => actions.risk()));
  r.get('/client-errors', wrap(() => ({ items: listClientErrors() })));
  r.post('/freeze', wrap((req) => actions.freeze(String(req.body.userId), !!req.body.on, String(req.body.reason || '').slice(0, 200), req.who)));
  r.get('/log', wrap((req) => ({ items: actions.adminLog({ limit: Math.min(Number(req.query.limit) || 200, 500), before: Number(req.query.before) || null }) })));
  r.post('/logout', wrap((req) => { sessions.delete(req.get('x-admin-session')); return { ok: true }; }));
  r.get('/broadcast', wrap(() => actions.broadcastStatus() || {}));
  return r;
}
