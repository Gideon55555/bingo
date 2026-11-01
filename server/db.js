import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- Telegram user id
  username    TEXT,
  first_name  TEXT,
  balance     INTEGER NOT NULL DEFAULT 0, -- whole currency units
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL,   -- deposit | withdraw | bet | win | refund
  amount       INTEGER NOT NULL,
  status       TEXT NOT NULL,   -- pending | approved | rejected | done
  reference    TEXT,            -- payment transaction id (deposits)
  phone        TEXT,            -- payout account (withdrawals)
  note         TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  processed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deposit_ref
  ON transactions(reference) WHERE type = 'deposit' AND status != 'rejected';
CREATE INDEX IF NOT EXISTS tx_user ON transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stake       INTEGER NOT NULL,
  players     INTEGER NOT NULL,
  pot         INTEGER NOT NULL,
  payout      INTEGER NOT NULL,
  house       INTEGER NOT NULL,
  winners     TEXT,              -- JSON [{userId, card}]
  calls       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

const stmts = {
  upsertUser: db.prepare(`
    INSERT INTO users (id, username, first_name) VALUES (@id, @username, @first_name)
    ON CONFLICT(id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name
  `),
  getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
  debit: db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?'),
  credit: db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?'),
  insertTx: db.prepare(`
    INSERT INTO transactions (user_id, type, amount, status, reference, phone, note)
    VALUES (@user_id, @type, @amount, @status, @reference, @phone, @note)
  `),
  getTx: db.prepare('SELECT * FROM transactions WHERE id = ?'),
  setTxStatus: db.prepare(
    "UPDATE transactions SET status = ?, processed_at = unixepoch() WHERE id = ? AND status = 'pending'"
  ),
  history: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 30'),
  pending: db.prepare(
    "SELECT t.*, u.username, u.first_name FROM transactions t JOIN users u ON u.id = t.user_id WHERE t.status = 'pending' ORDER BY t.id"
  ),
  insertGame: db.prepare(`
    INSERT INTO games (stake, players, pot, payout, house, winners, calls)
    VALUES (@stake, @players, @pot, @payout, @house, @winners, @calls)
  `),
};

export function upsertUser(u) {
  stmts.upsertUser.run({
    id: String(u.id),
    username: u.username || null,
    first_name: u.first_name || null,
  });
  return getUser(u.id);
}

export const getUser = (id) => stmts.getUser.get(String(id));
export const getTx = (id) => stmts.getTx.get(id);
export const history = (userId) => stmts.history.all(String(userId));
export const pendingTx = () => stmts.pending.all();

const tx = ({ user_id, type, amount, status, reference = null, phone = null, note = null }) =>
  stmts.insertTx.run({ user_id: String(user_id), type, amount, status, reference, phone, note })
    .lastInsertRowid;

/** Atomically take money from a user. Returns false if balance is too low. */
export const debit = db.transaction((userId, amount, type, note) => {
  const r = stmts.debit.run(amount, String(userId), amount);
  if (r.changes === 0) return false;
  tx({ user_id: userId, type, amount: -amount, status: 'done', note });
  return true;
});

export const credit = db.transaction((userId, amount, type, note) => {
  stmts.credit.run(amount, String(userId));
  tx({ user_id: userId, type, amount, status: 'done', note });
});

// ---------- Deposits ----------
export function createDeposit(userId, amount, reference) {
  try {
    return tx({ user_id: userId, type: 'deposit', amount, status: 'pending', reference });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new Error('This transaction reference was already submitted');
    throw e;
  }
}

/** Approve: mark approved and credit balance. Returns the tx or null if already handled. */
export const approveDeposit = db.transaction((id) => {
  const t = getTx(id);
  if (!t || t.type !== 'deposit') return null;
  if (stmts.setTxStatus.run('approved', id).changes === 0) return null;
  stmts.credit.run(t.amount, t.user_id);
  return getTx(id);
});

export const rejectDeposit = db.transaction((id) => {
  const t = getTx(id);
  if (!t || t.type !== 'deposit') return null;
  if (stmts.setTxStatus.run('rejected', id).changes === 0) return null;
  return getTx(id);
});

// ---------- Withdrawals ----------
/** Money is held (debited) immediately; refunded if the admin rejects. */
export const createWithdrawal = db.transaction((userId, amount, phone) => {
  const r = stmts.debit.run(amount, String(userId), amount);
  if (r.changes === 0) throw new Error('Insufficient balance');
  return tx({ user_id: userId, type: 'withdraw', amount: -amount, status: 'pending', phone });
});

export const markWithdrawalPaid = db.transaction((id) => {
  const t = getTx(id);
  if (!t || t.type !== 'withdraw') return null;
  if (stmts.setTxStatus.run('approved', id).changes === 0) return null;
  return getTx(id);
});

export const rejectWithdrawal = db.transaction((id) => {
  const t = getTx(id);
  if (!t || t.type !== 'withdraw') return null;
  if (stmts.setTxStatus.run('rejected', id).changes === 0) return null;
  stmts.credit.run(-t.amount, t.user_id); // refund the held amount
  return getTx(id);
});

export const recordGame = (g) => stmts.insertGame.run({ ...g, winners: JSON.stringify(g.winners) });

// ---------- Admin queries ----------
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

const scalar = (sql, ...args) => Object.values(db.prepare(sql).get(...args))[0] ?? 0;

export function getStats() {
  const today = startOfToday();
  const block = (since) => ({
    deposits: scalar("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='deposit' AND status='approved' AND created_at >= ?", since),
    withdrawals: -scalar("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='withdraw' AND status='approved' AND created_at >= ?", since),
    houseEarnings: scalar('SELECT COALESCE(SUM(house),0) FROM games WHERE created_at >= ?', since),
    games: scalar('SELECT COUNT(*) FROM games WHERE created_at >= ?', since),
    totalBets: scalar('SELECT COALESCE(SUM(pot),0) FROM games WHERE created_at >= ?', since),
    activePlayers: scalar("SELECT COUNT(DISTINCT user_id) FROM transactions WHERE type='bet' AND created_at >= ?", since),
    newUsers: scalar('SELECT COUNT(*) FROM users WHERE created_at >= ?', since),
  });
  return {
    today: block(today),
    allTime: block(0),
    users: scalar('SELECT COUNT(*) FROM users'),
    playerBalances: scalar('SELECT COALESCE(SUM(balance),0) FROM users'),
    pendingDeposits: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM transactions WHERE type='deposit' AND status='pending'").get(),
    pendingWithdrawals: db.prepare("SELECT COUNT(*) n, COALESCE(-SUM(amount),0) total FROM transactions WHERE type='withdraw' AND status='pending'").get(),
  };
}

/** Find a user by Telegram id or @username */
export function findUser(q) {
  q = String(q || '').trim().replace(/^@/, '');
  if (!q) return null;
  return db.prepare('SELECT * FROM users WHERE id = ? OR lower(username) = lower(?)').get(q, q) || null;
}

export function listUsers({ search = '', limit = 50, offset = 0 } = {}) {
  const like = `%${search.replace(/^@/, '')}%`;
  const where = search ? 'WHERE id LIKE @like OR username LIKE @like OR first_name LIKE @like' : '';
  const rows = db.prepare(`
    SELECT u.*,
      (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=u.id AND type='deposit' AND status='approved') AS deposited,
      (SELECT COALESCE(-SUM(amount),0) FROM transactions WHERE user_id=u.id AND type='withdraw' AND status='approved') AS withdrawn,
      (SELECT COUNT(*) FROM transactions WHERE user_id=u.id AND type='bet') AS games_played,
      (SELECT COUNT(*) FROM transactions WHERE user_id=u.id AND type='win') AS games_won
    FROM users u ${where} ORDER BY u.created_at DESC LIMIT @limit OFFSET @offset`).all({ like, limit, offset });
  const total = db.prepare(`SELECT COUNT(*) n FROM users ${where}`).get({ like }).n;
  return { rows, total };
}

export function listTransactions({ type = '', status = '', userId = '', limit = 100 } = {}) {
  const conds = [];
  if (type) conds.push('t.type = @type');
  if (status) conds.push('t.status = @status');
  if (userId) conds.push('t.user_id = @userId');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return db.prepare(`
    SELECT t.*, u.username, u.first_name FROM transactions t JOIN users u ON u.id = t.user_id
    ${where} ORDER BY t.id DESC LIMIT @limit`).all({ type, status, userId: String(userId), limit });
}

export function listGames(limit = 50) {
  return db.prepare('SELECT * FROM games ORDER BY id DESC LIMIT ?').all(limit).map((g) => {
    const winners = JSON.parse(g.winners || '[]').map((w) => ({ ...w, ...(getUser(w.userId) || {}) }));
    return { ...g, winners: winners.map(({ userId, card, username, first_name }) => ({ userId, card, username, first_name })) };
  });
}

export const allUserIds = () => db.prepare('SELECT id FROM users').all().map((r) => r.id);

/** Manual balance change by admin. Positive adds, negative subtracts (never below 0). */
export const adjustBalance = db.transaction((userId, amount, note) => {
  const u = getUser(userId);
  if (!u) throw new Error('User not found');
  amount = Math.trunc(Number(amount));
  if (!amount) throw new Error('Amount must be a non-zero number');
  if (u.balance + amount < 0) throw new Error(`Balance would go negative (current ${u.balance})`);
  stmts.credit.run(amount, String(userId));
  tx({ user_id: userId, type: 'adjust', amount, status: 'done', note: note || 'Admin adjustment' });
  return getUser(userId);
});
