import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { fmt } from '../shared/money.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');   // safe with WAL; far fewer disk flushes
db.pragma('busy_timeout = 5000');    // wait instead of failing if a backup holds a lock
db.pragma('foreign_keys = ON');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -20000');    // ~20 MB page cache
// The database holds balances and phone numbers: only this server's user may read it
for (const f of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) { try { fs.chmodSync(f, 0o600); } catch { /* ignore */ } }
// Refuse to run on a damaged database (restore the latest backup instead)
{
  const check = db.pragma('quick_check', { simple: true });
  if (check !== 'ok') {
    console.error(`❌ Database check failed: ${check}. Restore the latest backup (see DEPLOY.md).`);
    process.exit(1);
  }
}

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

CREATE TABLE IF NOT EXISTS rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stake       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open', -- open | finished | cancelled | refunded
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  closed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS crash_rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id     INTEGER,               -- rounds.id (only when someone bet)
  crash_point  INTEGER NOT NULL,      -- multiplier x100 (e.g. 245 = 2.45x)
  seed         TEXT NOT NULL,         -- revealed after the round
  hash         TEXT NOT NULL,         -- sha256(seed), shown before the round
  bets_total   INTEGER NOT NULL DEFAULT 0,  -- cents
  payout_total INTEGER NOT NULL DEFAULT 0,  -- cents
  players      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS keno_rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id     INTEGER,               -- rounds.id (only when someone bought a ticket)
  drawn        TEXT NOT NULL,         -- JSON array of the 20 drawn numbers, in draw order
  seed         TEXT NOT NULL,
  hash         TEXT NOT NULL,
  bets_total   INTEGER NOT NULL DEFAULT 0,
  payout_total INTEGER NOT NULL DEFAULT 0,
  players      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS ludo_games (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id     INTEGER,
  stake        INTEGER NOT NULL,        -- cents per player
  size         INTEGER NOT NULL,        -- 2 or 4 players
  pot          INTEGER NOT NULL,
  payout       INTEGER NOT NULL,
  house        INTEGER NOT NULL,
  winner_id    TEXT,
  players      TEXT NOT NULL,           -- JSON [{userId, name, color, out}]
  rolls        INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  seed         TEXT NOT NULL,
  hash         TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS kerenbula_games (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id     INTEGER,
  stake        INTEGER NOT NULL,
  pot          INTEGER NOT NULL,
  payout       INTEGER NOT NULL,
  house        INTEGER NOT NULL,
  winner_id    TEXT,
  players      TEXT NOT NULL,           -- JSON [{userId, name, color, score, out}]
  frames       INTEGER NOT NULL,
  rolls        INTEGER NOT NULL,
  how          TEXT,
  duration_sec INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS pool_games (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id     INTEGER,
  stake        INTEGER NOT NULL,
  pot          INTEGER NOT NULL,
  payout       INTEGER NOT NULL,
  house        INTEGER NOT NULL,
  winner_id    TEXT,
  players      TEXT NOT NULL,           -- JSON [{userId, name, group, out}]
  shots        INTEGER NOT NULL,
  how          TEXT,
  duration_sec INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

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

// --- migrations for databases created by older versions ---
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('transactions').includes('round_id')) db.exec('ALTER TABLE transactions ADD COLUMN round_id INTEGER');
if (!cols('games').includes('round_id')) db.exec('ALTER TABLE games ADD COLUMN round_id INTEGER');
if (!cols('users').includes('lang')) db.exec("ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'am'");
if (!cols('rounds').includes('game')) db.exec("ALTER TABLE rounds ADD COLUMN game TEXT NOT NULL DEFAULT 'bingo'");
db.exec('CREATE INDEX IF NOT EXISTS tx_round ON transactions(round_id)');
// Indexes for the admin dashboard (stats by date) and lists
db.exec(`
CREATE INDEX IF NOT EXISTS tx_type_status_time ON transactions(type, status, created_at);
CREATE INDEX IF NOT EXISTS tx_time ON transactions(created_at);
CREATE INDEX IF NOT EXISTS users_time ON users(created_at);
CREATE INDEX IF NOT EXISTS games_time ON games(created_at);
CREATE INDEX IF NOT EXISTS crash_time ON crash_rounds(created_at);
CREATE INDEX IF NOT EXISTS keno_time ON keno_rounds(created_at);
CREATE INDEX IF NOT EXISTS ludo_time ON ludo_games(created_at);
CREATE INDEX IF NOT EXISTS pool_time ON pool_games(created_at);
CREATE INDEX IF NOT EXISTS kb_time ON kerenbula_games(created_at);
CREATE INDEX IF NOT EXISTS rounds_status ON rounds(status);
`);

// --- v1 → v2: money moved from whole ETB to cents. Multiply every stored amount by 100 once. ---
if (db.pragma('user_version', { simple: true }) < 1) {
  const hadData = db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;
  db.transaction(() => {
    db.exec(`
      UPDATE users SET balance = balance * 100;
      UPDATE transactions SET amount = amount * 100;
      UPDATE games SET pot = pot * 100, payout = payout * 100, house = house * 100, stake = stake * 100;
      UPDATE rounds SET stake = stake * 100;
    `);
    db.pragma('user_version = 1');
  })();
  if (hadData) console.log('[db] migrated stored amounts from ETB to cents');
}

const stmts = {
  upsertUser: db.prepare(`
    INSERT INTO users (id, username, first_name) VALUES (@id, @username, @first_name)
    ON CONFLICT(id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name
  `),
  getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
  debit: db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?'),
  credit: db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?'),
  insertTx: db.prepare(`
    INSERT INTO transactions (user_id, type, amount, status, reference, phone, note, round_id)
    VALUES (@user_id, @type, @amount, @status, @reference, @phone, @note, @round_id)
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
    INSERT INTO games (stake, players, pot, payout, house, winners, calls, round_id)
    VALUES (@stake, @players, @pot, @payout, @house, @winners, @calls, @round_id)
  `),
  openRound: db.prepare('INSERT INTO rounds (stake, game) VALUES (?, ?)'),
  insertCrash: db.prepare(`
    INSERT INTO crash_rounds (round_id, crash_point, seed, hash, bets_total, payout_total, players)
    VALUES (@round_id, @crash_point, @seed, @hash, @bets_total, @payout_total, @players)`),
  closeRound: db.prepare("UPDATE rounds SET status = ?, closed_at = unixepoch() WHERE id = ? AND status = 'open'"),
  openRounds: db.prepare("SELECT * FROM rounds WHERE status = 'open'"),
  roundNet: db.prepare(`
    SELECT user_id, SUM(amount) AS net FROM transactions
    WHERE round_id = ? AND type IN ('bet', 'refund', 'win') GROUP BY user_id`),
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
export const setUserLang = (id, lang) => db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang === 'en' ? 'en' : 'am', String(id));
export const getTx = (id) => stmts.getTx.get(id);
export const history = (userId) => stmts.history.all(String(userId));
export const pendingTx = () => stmts.pending.all();

const tx = ({ user_id, type, amount, status, reference = null, phone = null, note = null, round_id = null }) =>
  stmts.insertTx.run({ user_id: String(user_id), type, amount, status, reference, phone, note, round_id })
    .lastInsertRowid;

/** Atomically take money from a user. Returns false if balance is too low. */
export const debit = db.transaction((userId, amount, type, note, roundId = null) => {
  const r = stmts.debit.run(amount, String(userId), amount);
  if (r.changes === 0) return false;
  tx({ user_id: userId, type, amount: -amount, status: 'done', note, round_id: roundId });
  return true;
});

export const credit = db.transaction((userId, amount, type, note, roundId = null) => {
  stmts.credit.run(amount, String(userId));
  tx({ user_id: userId, type, amount, status: 'done', note, round_id: roundId });
});

export const countPending = (userId, type) =>
  db.prepare("SELECT COUNT(*) n FROM transactions WHERE user_id = ? AND type = ? AND status = 'pending'").get(String(userId), type).n;

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

// ---------- Rounds (crash safety) ----------
// Every entry fee is tied to a round. A round is "open" until it is paid out or cancelled.
// If the server stops while a round is open, refundOpenRounds() gives everyone their entry back.

export const openRound = (stake, game = 'bingo') => Number(stmts.openRound.run(stake, game).lastInsertRowid);

/** Crash: record the finished round and close its money round (if anyone bet) atomically. */
export const settleCrashRound = db.transaction((roundId, record) => {
  stmts.insertCrash.run({ round_id: roundId, ...record });
  if (roundId) stmts.closeRound.run('finished', roundId);
});

/** Keno: pay all winning tickets, record the draw and close the money round — all or nothing. */
export const settleKenoRound = db.transaction((roundId, payouts, record) => {
  for (const { userId, amount, note } of payouts) {
    if (amount > 0) {
      stmts.credit.run(amount, String(userId));
      tx({ user_id: userId, type: 'win', amount, status: 'done', note, round_id: roundId });
    }
  }
  db.prepare(`INSERT INTO keno_rounds (round_id, drawn, seed, hash, bets_total, payout_total, players)
    VALUES (@round_id, @drawn, @seed, @hash, @bets_total, @payout_total, @players)`)
    .run({ round_id: roundId, ...record, drawn: JSON.stringify(record.drawn) });
  if (roundId) stmts.closeRound.run('finished', roundId);
});

/** Ludo: pay the winner, record the game and close the money round — all or nothing. */
export const settleLudo = db.transaction((roundId, winnerId, payout, record) => {
  if (winnerId && payout > 0) {
    stmts.credit.run(payout, String(winnerId));
    tx({ user_id: winnerId, type: 'win', amount: payout, status: 'done', note: record.note, round_id: roundId });
  }
  db.prepare(`INSERT INTO ludo_games (round_id, stake, size, pot, payout, house, winner_id, players, rolls, duration_sec, seed, hash)
    VALUES (@round_id, @stake, @size, @pot, @payout, @house, @winner_id, @players, @rolls, @duration_sec, @seed, @hash)`)
    .run({
      round_id: roundId, winner_id: winnerId ? String(winnerId) : null, stake: record.stake, size: record.size, pot: record.pot,
      payout: record.payout, house: record.house, players: JSON.stringify(record.players), rolls: record.rolls,
      duration_sec: record.duration_sec, seed: record.seed, hash: record.hash,
    });
  if (roundId) stmts.closeRound.run('finished', roundId);
});

/** Pool: pay the winner, record the match and close the money round — all or nothing. */
export const settlePool = db.transaction((roundId, winnerId, payout, record) => {
  if (winnerId && payout > 0) {
    stmts.credit.run(payout, String(winnerId));
    tx({ user_id: winnerId, type: 'win', amount: payout, status: 'done', note: record.note, round_id: roundId });
  }
  db.prepare(`INSERT INTO pool_games (round_id, stake, pot, payout, house, winner_id, players, shots, how, duration_sec)
    VALUES (@round_id, @stake, @pot, @payout, @house, @winner_id, @players, @shots, @how, @duration_sec)`).run({
    round_id: roundId, stake: record.stake, pot: record.pot, payout: record.payout, house: record.house,
    winner_id: winnerId ? String(winnerId) : null, players: JSON.stringify(record.players), shots: record.shots,
    how: record.how, duration_sec: record.duration_sec,
  });
  if (roundId) stmts.closeRound.run('finished', roundId);
});

/** Kerenbula: pay the winner, record the match and close the money round — all or nothing. */
export const settleKerenbula = db.transaction((roundId, winnerId, payout, record) => {
  if (winnerId && payout > 0) {
    stmts.credit.run(payout, String(winnerId));
    tx({ user_id: winnerId, type: 'win', amount: payout, status: 'done', note: record.note, round_id: roundId });
  }
  db.prepare(`INSERT INTO kerenbula_games (round_id, stake, pot, payout, house, winner_id, players, frames, rolls, how, duration_sec)
    VALUES (@round_id, @stake, @pot, @payout, @house, @winner_id, @players, @frames, @rolls, @how, @duration_sec)`).run({
    round_id: roundId, stake: record.stake, pot: record.pot, payout: record.payout, house: record.house,
    winner_id: winnerId ? String(winnerId) : null, players: JSON.stringify(record.players), frames: record.frames,
    rolls: record.rolls, how: record.how, duration_sec: record.duration_sec,
  });
  if (roundId) stmts.closeRound.run('finished', roundId);
});

export const listKerenbulaGames = (limit = 50) =>
  db.prepare('SELECT * FROM kerenbula_games ORDER BY id DESC LIMIT ?').all(limit)
    .map((g) => ({ ...g, players: JSON.parse(g.players) }));

export const listPoolGames = (limit = 50) =>
  db.prepare('SELECT * FROM pool_games ORDER BY id DESC LIMIT ?').all(limit)
    .map((g) => ({ ...g, players: JSON.parse(g.players) }));

export const listLudoGames = (limit = 50) =>
  db.prepare('SELECT * FROM ludo_games ORDER BY id DESC LIMIT ?').all(limit)
    .map((g) => ({ ...g, players: JSON.parse(g.players) }));

export const recentKeno = (n = 10) =>
  db.prepare('SELECT id, drawn FROM keno_rounds ORDER BY id DESC LIMIT ?').all(n)
    .map((r) => ({ id: r.id, drawn: JSON.parse(r.drawn) }));

export const listKenoRounds = (limit = 50) =>
  db.prepare('SELECT * FROM keno_rounds ORDER BY id DESC LIMIT ?').all(limit)
    .map((r) => ({ ...r, drawn: JSON.parse(r.drawn) }));

export const recentCrashes = (n = 20) =>
  db.prepare('SELECT id, crash_point, hash, seed FROM crash_rounds ORDER BY id DESC LIMIT ?').all(n);

export const listCrashRounds = (limit = 50) =>
  db.prepare('SELECT * FROM crash_rounds ORDER BY id DESC LIMIT ?').all(limit);

/** Pay winners, record the game and close the round — all or nothing. */
export const settleRound = db.transaction((roundId, payouts, game) => {
  for (const { userId, amount, note } of payouts) {
    if (amount > 0) {
      stmts.credit.run(amount, String(userId));
      tx({ user_id: userId, type: 'win', amount, status: 'done', note, round_id: roundId });
    }
  }
  stmts.insertGame.run({ ...game, winners: JSON.stringify(game.winners), round_id: roundId });
  stmts.closeRound.run('finished', roundId);
});

/** Refund everyone's net entry in one round and close it. Returns [{userId, amount}]. */
export const refundRound = db.transaction((roundId, label, reason, status = 'refunded') => {
  const refunds = [];
  for (const { user_id, net } of stmts.roundNet.all(roundId)) {
    if (net < 0) {
      stmts.credit.run(-net, user_id);
      tx({ user_id, type: 'refund', amount: -net, status: 'done', note: `${label} ${reason}`, round_id: roundId });
      refunds.push({ userId: user_id, amount: -net, label });
    }
  }
  stmts.closeRound.run(status, roundId);
  return refunds;
});

const roundLabel = (r) => (r.game === 'crash' ? config.crash.name : r.game === 'keno' ? 'Keno'
  : r.game === 'ludo' ? `Ludo ${fmt(r.stake)}` : r.game === 'pool' ? `8-Ball Pool ${fmt(r.stake)}` : r.game === 'kerenbula' ? `Kerenbula ${fmt(r.stake)}` : `Bingo ${fmt(r.stake)}`);

/** Called on startup and shutdown: refund every round that never finished. */
export function refundOpenRounds(reason = 'interrupted (server restart)') {
  const all = [];
  for (const r of stmts.openRounds.all()) all.push(...refundRound(r.id, roundLabel(r), reason));
  return all;
}

export const recordGame = (g) => stmts.insertGame.run({ round_id: null, ...g, winners: JSON.stringify(g.winners) });

// ---------- Admin queries ----------
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

const scalar = (sql, ...args) => Object.values(db.prepare(sql).get(...args))[0] ?? 0;

// The admin panel polls stats every few seconds; recompute at most every 5 s.
let statsCache = { at: 0, value: null };
export const invalidateStats = () => { statsCache = { at: 0, value: null }; };
export function getStats() {
  if (statsCache.value && Date.now() - statsCache.at < 5000) return statsCache.value;
  statsCache = { at: Date.now(), value: computeStats() };
  return statsCache.value;
}

function computeStats() {
  const today = startOfToday();
  const block = (since) => ({
    deposits: scalar("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='deposit' AND status='approved' AND created_at >= ?", since),
    withdrawals: -scalar("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='withdraw' AND status='approved' AND created_at >= ?", since),
    houseEarnings: scalar('SELECT COALESCE(SUM(house),0) FROM games WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(bets_total - payout_total),0) FROM crash_rounds WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(bets_total - payout_total),0) FROM keno_rounds WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(house),0) FROM ludo_games WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(house),0) FROM pool_games WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(house),0) FROM kerenbula_games WHERE created_at >= ?', since),
    games: scalar('SELECT COUNT(*) FROM games WHERE created_at >= ?', since),
    totalBets: scalar('SELECT COALESCE(SUM(pot),0) FROM games WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(bets_total),0) FROM crash_rounds WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(bets_total),0) FROM keno_rounds WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(pot),0) FROM ludo_games WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(pot),0) FROM pool_games WHERE created_at >= ?', since)
      + scalar('SELECT COALESCE(SUM(pot),0) FROM kerenbula_games WHERE created_at >= ?', since),
    bingoEarnings: scalar('SELECT COALESCE(SUM(house),0) FROM games WHERE created_at >= ?', since),
    crashEarnings: scalar('SELECT COALESCE(SUM(bets_total - payout_total),0) FROM crash_rounds WHERE created_at >= ?', since),
    crashRounds: scalar('SELECT COUNT(*) FROM crash_rounds WHERE players > 0 AND created_at >= ?', since),
    kenoEarnings: scalar('SELECT COALESCE(SUM(bets_total - payout_total),0) FROM keno_rounds WHERE created_at >= ?', since),
    kenoRounds: scalar('SELECT COUNT(*) FROM keno_rounds WHERE players > 0 AND created_at >= ?', since),
    ludoEarnings: scalar('SELECT COALESCE(SUM(house),0) FROM ludo_games WHERE created_at >= ?', since),
    ludoGames: scalar('SELECT COUNT(*) FROM ludo_games WHERE created_at >= ?', since),
    poolEarnings: scalar('SELECT COALESCE(SUM(house),0) FROM pool_games WHERE created_at >= ?', since),
    poolGames: scalar('SELECT COUNT(*) FROM pool_games WHERE created_at >= ?', since),
    kerenbulaEarnings: scalar('SELECT COALESCE(SUM(house),0) FROM kerenbula_games WHERE created_at >= ?', since),
    kerenbulaGames: scalar('SELECT COUNT(*) FROM kerenbula_games WHERE created_at >= ?', since),
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
