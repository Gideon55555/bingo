// Responsible gambling: age (21+) confirmation, self-set deposit limits, self-exclusion, play summary.
//
// • Lowering a deposit limit works immediately; raising or removing one only takes effect after
//   24 hours (a "cooling-off" period, so a limit can't be lifted in the heat of the moment).
// • Self-exclusion (7 / 30 / 90 / 180 days) can't be undone early. Excluded players can still
//   log in and withdraw their balance, but can't deposit or play.
import { config } from './config.js';
import { db } from './db.js';

const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
const add = (c, def) => { if (!cols.includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${def}`); };
add('age_ok_at', 'INTEGER');
add('dep_limit_day', 'INTEGER');        // cents, NULL = no limit
add('dep_limit_week', 'INTEGER');
add('dep_limit_pending', 'TEXT');       // JSON { day, week, at } — a raise waiting for its 24 h
add('excluded_until', 'INTEGER');       // unix seconds
add('reminder_min', 'INTEGER NOT NULL DEFAULT 60');

const COOL_OFF_SEC = 24 * 3600;
const EXCLUSION_DAYS = [7, 30, 90, 180];
const now = () => Math.floor(Date.now() / 1000);

// In-memory views so every game action doesn't need a database read
const excluded = new Map(db.prepare('SELECT id, excluded_until FROM users WHERE excluded_until > unixepoch()').all().map((r) => [r.id, r.excluded_until]));
const ageOk = new Set(db.prepare('SELECT id FROM users WHERE age_ok_at IS NOT NULL').all().map((r) => r.id));

export const ageRequired = () => config.requireAgeConfirm;
export const excludedUntil = (uid) => {
  const u = excluded.get(String(uid));
  if (u && u > now()) return u;
  if (u) excluded.delete(String(uid));
  return null;
};

/** Reason the player may not put money in play right now, or null. */
export function playBlock(uid) {
  uid = String(uid);
  if (ageRequired() && !ageOk.has(uid)) return `Please confirm you are ${config.minAge} or older first.`;
  const until = excludedUntil(uid);
  if (until) return `You chose to take a break until ${new Date(until * 1000).toLocaleDateString('en-GB')}. You can still withdraw your balance.`;
  return null;
}

export function confirmAge(uid) {
  uid = String(uid);
  db.prepare('UPDATE users SET age_ok_at = COALESCE(age_ok_at, unixepoch()) WHERE id = ?').run(uid);
  ageOk.add(uid);
}

/** Apply a pending limit raise once its 24 h are over. */
function settlePending(uid) {
  const u = db.prepare('SELECT dep_limit_pending FROM users WHERE id = ?').get(uid);
  if (!u?.dep_limit_pending) return;
  const p = JSON.parse(u.dep_limit_pending);
  if (p.at <= now()) {
    db.prepare('UPDATE users SET dep_limit_day = ?, dep_limit_week = ?, dep_limit_pending = NULL WHERE id = ?').run(p.day, p.week, uid);
  }
}

export function getLimits(uid) {
  uid = String(uid);
  settlePending(uid);
  const u = db.prepare('SELECT age_ok_at, dep_limit_day, dep_limit_week, dep_limit_pending, excluded_until, reminder_min FROM users WHERE id = ?').get(uid) || {};
  const used = depositedSince(uid);
  return {
    ageConfirmed: !!u.age_ok_at || !ageRequired(),
    day: u.dep_limit_day ?? null,
    week: u.dep_limit_week ?? null,
    pending: u.dep_limit_pending ? JSON.parse(u.dep_limit_pending) : null,
    usedDay: used.day,
    usedWeek: used.week,
    excludedUntil: excludedUntil(uid),
    reminderMin: u.reminder_min ?? 60,
    exclusionDays: EXCLUSION_DAYS,
  };
}

const cleanLimit = (v) => {
  if (v === null || v === undefined || v === '' || v === 0) return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 100) throw new Error('A limit must be at least 1 ETB');
  return n;
};
const looser = (newV, oldV) => (oldV !== null && (newV === null || newV > oldV));

/** Set daily/weekly deposit limits (cents; null = none). Tighter = now, looser = in 24 h. */
export function setLimits(uid, { day, week }) {
  uid = String(uid);
  settlePending(uid);
  day = cleanLimit(day); week = cleanLimit(week);
  const cur = db.prepare('SELECT dep_limit_day d, dep_limit_week w FROM users WHERE id = ?').get(uid);
  const raise = looser(day, cur.d) || looser(week, cur.w);
  if (raise) {
    // Tighten what can be tightened now; the rest waits
    const nowDay = looser(day, cur.d) ? cur.d : day;
    const nowWeek = looser(week, cur.w) ? cur.w : week;
    db.prepare('UPDATE users SET dep_limit_day = ?, dep_limit_week = ?, dep_limit_pending = ? WHERE id = ?')
      .run(nowDay, nowWeek, JSON.stringify({ day, week, at: now() + COOL_OFF_SEC }), uid);
  } else {
    db.prepare('UPDATE users SET dep_limit_day = ?, dep_limit_week = ?, dep_limit_pending = NULL WHERE id = ?').run(day, week, uid);
  }
  return getLimits(uid);
}

export function setReminder(uid, minutes) {
  const m = Math.floor(Number(minutes));
  if (![0, 30, 60, 120].includes(m)) throw new Error('Invalid reminder');
  db.prepare('UPDATE users SET reminder_min = ? WHERE id = ?').run(m, String(uid));
  return getLimits(uid);
}

export function selfExclude(uid, days) {
  days = Math.floor(Number(days));
  if (!EXCLUSION_DAYS.includes(days)) throw new Error('Choose 7, 30, 90 or 180 days');
  const cur = excludedUntil(uid) || 0;
  const until = Math.max(cur, now() + days * 86400); // can be extended, never shortened
  db.prepare('UPDATE users SET excluded_until = ? WHERE id = ?').run(until, String(uid));
  excluded.set(String(uid), until);
  return getLimits(uid);
}

const sumDeposits = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE user_id = ? AND type = 'deposit' AND status IN ('pending','approved') AND created_at >= ?");
function depositedSince(uid) {
  const t = now();
  return { day: sumDeposits.get(uid, t - 86400).s, week: sumDeposits.get(uid, t - 7 * 86400).s };
}

/** Throws if this deposit would break the player's own limits (or they're excluded). */
export function checkDeposit(uid, amount) {
  uid = String(uid);
  const block = playBlock(uid);
  if (block) throw new Error(block);
  const l = getLimits(uid);
  const left = (lim, used) => Math.max(0, lim - used);
  if (l.day !== null && l.usedDay + amount > l.day) throw new Error(`This is over your daily deposit limit. You can deposit ${(left(l.day, l.usedDay) / 100).toFixed(2)} ${config.currency} more today.`);
  if (l.week !== null && l.usedWeek + amount > l.week) throw new Error(`This is over your weekly deposit limit. You can deposit ${(left(l.week, l.usedWeek) / 100).toFixed(2)} ${config.currency} more this week.`);
}

/** Today's play for the time reminder: amount played, won and the difference. */
export function todaySummary(uid) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const since = Math.floor(d.getTime() / 1000);
  const r = db.prepare(`SELECT
      COALESCE(-SUM(CASE WHEN type='bet' THEN amount END),0) bets,
      COALESCE(SUM(CASE WHEN type='win' THEN amount END),0) wins,
      COALESCE(SUM(CASE WHEN type='refund' THEN amount END),0) refunds
    FROM transactions WHERE user_id = ? AND created_at >= ?`).get(String(uid), since);
  return { played: r.bets - r.refunds, won: r.wins, net: r.wins + r.refunds - r.bets };
}
