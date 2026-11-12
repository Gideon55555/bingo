// Growth features with abuse protection built in:
//  • Referrals: the inviter gets REFERRAL_BONUS when a NEW player who opened their link makes a first
//    approved deposit ≥ REFERRAL_MIN_DEPOSIT. Not paid if the two accounts used the same phone.
//  • Daily reward: DAILY_REWARD once per day, only for players who have deposited before
//    (so fake accounts can't farm it).
//  • Bonus money must be played through BONUS_WAGER times before it can be withdrawn
//    (deposits and winnings are always withdrawable).
//  • Weekly leaderboard of top winners (since Monday 00:00 local time).
import { config } from './config.js';
import { db, getUser, logAdmin } from './db.js';
import { shareDevice } from './risk.js';

const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!cols.includes('referred_by')) db.exec('ALTER TABLE users ADD COLUMN referred_by TEXT');
if (!cols.includes('ref_paid')) db.exec('ALTER TABLE users ADD COLUMN ref_paid INTEGER NOT NULL DEFAULT 0');
if (!cols.includes('last_daily')) db.exec('ALTER TABLE users ADD COLUMN last_daily TEXT');
if (!cols.includes('signup_bonus')) db.exec('ALTER TABLE users ADD COLUMN signup_bonus TEXT'); // given | denied
db.exec('CREATE INDEX IF NOT EXISTS users_ref ON users(referred_by)');

const g = () => config.growth;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const credit = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
const insertTx = db.prepare("INSERT INTO transactions (user_id, type, amount, status, note) VALUES (?, 'bonus', ?, 'done', ?)");

/**
 * Sign-up bonus for a brand-new account (created in the last hour), once per phone:
 * if another account already used this phone, no bonus. Returns the amount given (cents) or 0.
 */
export const maybeSignupBonus = db.transaction((uid, device) => {
  uid = String(uid);
  const amount = g().signupBonus;
  if (!amount || !device) return 0;
  const u = db.prepare('SELECT created_at, signup_bonus FROM users WHERE id = ?').get(uid);
  if (!u || u.signup_bonus || Date.now() / 1000 - u.created_at > 3600) return 0;
  const otherOnPhone = db.prepare("SELECT 1 FROM user_seen WHERE kind = 'device' AND value = ? AND user_id != ? LIMIT 1").get(String(device), uid);
  if (otherOnPhone) {
    db.prepare("UPDATE users SET signup_bonus = 'denied' WHERE id = ?").run(uid);
    return 0;
  }
  db.prepare("UPDATE users SET signup_bonus = 'given' WHERE id = ?").run(uid);
  credit.run(amount, uid);
  insertTx.run(uid, amount, 'Sign-up bonus');
  return amount;
});

/** Opened the bot from a referral link. Only counts for brand-new players. */
export function recordReferral(newUser, inviterId, { wasNew }) {
  const uid = String(newUser.id);
  inviterId = String(inviterId);
  if (!wasNew || uid === inviterId || !getUser(inviterId)) return false;
  return db.prepare('UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL').run(inviterId, uid).changes > 0;
}

/** All of a player's approved deposits, in cents. */
export const depositedTotal = (uid) =>
  db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'approved'").get(String(uid)).s;

/**
 * After a deposit is approved: pay the inviter once, when the friend's deposits add up to the required amount.
 * Returns { inviterId, amount } when a bonus was paid.
 */
export const onDepositApproved = db.transaction((tx) => {
  if (!g().referralBonus) return null;
  const u = db.prepare('SELECT id, referred_by, ref_paid FROM users WHERE id = ?').get(String(tx.user_id));
  if (!u?.referred_by || u.ref_paid || Math.max(tx.amount, depositedTotal(u.id)) < g().referralMinDeposit) return null;
  db.prepare('UPDATE users SET ref_paid = 1 WHERE id = ?').run(u.id);
  if (shareDevice(u.id, u.referred_by)) {
    logAdmin({ name: 'system' }, 'referral_blocked', u.id, `same phone as inviter ${u.referred_by}`);
    return null;
  }
  credit.run(g().referralBonus, u.referred_by);
  insertTx.run(u.referred_by, g().referralBonus, `Referral bonus (friend ${u.id})`);
  if (g().referralFriendBonus) {
    credit.run(g().referralFriendBonus, u.id);
    insertTx.run(u.id, g().referralFriendBonus, 'Welcome bonus (joined with a friend’s link)');
  }
  return { inviterId: u.referred_by, friendId: u.id, amount: g().referralBonus, friendAmount: g().referralFriendBonus };
});

const hasDeposited = db.prepare("SELECT 1 FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'approved' LIMIT 1");

export function dailyStatus(uid) {
  const u = db.prepare('SELECT last_daily FROM users WHERE id = ?').get(String(uid));
  if (!g().dailyReward) return { amount: 0, available: false, reason: 'off' };
  if (!hasDeposited.get(String(uid))) return { amount: g().dailyReward, available: false, reason: 'deposit_first' };
  if (u?.last_daily === today()) return { amount: g().dailyReward, available: false, reason: 'claimed' };
  return { amount: g().dailyReward, available: true };
}

export const claimDaily = db.transaction((uid) => {
  uid = String(uid);
  const s = dailyStatus(uid);
  if (!s.available) throw new Error(s.reason === 'claimed' ? 'Already claimed today — come back tomorrow' : s.reason === 'deposit_first' ? 'Make your first deposit to unlock daily rewards' : 'Daily rewards are off');
  if (db.prepare('UPDATE users SET last_daily = ? WHERE id = ? AND (last_daily IS NULL OR last_daily != ?)').run(today(), uid, today()).changes === 0) throw new Error('Already claimed today — come back tomorrow');
  credit.run(s.amount, uid);
  insertTx.run(uid, s.amount, 'Daily reward');
  return { amount: s.amount, balance: getUser(uid).balance };
});

/** How much of the balance can be withdrawn: bonus money not yet played through stays locked. */
export function withdrawable(uid) {
  uid = String(uid);
  const r = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='bonus' THEN amount END),0) AS bonus,
      COALESCE(-SUM(CASE WHEN type='bet' THEN amount END),0) - COALESCE(SUM(CASE WHEN type='refund' THEN amount END),0) AS wagered
    FROM transactions WHERE user_id = ?`).get(uid);
  const balance = getUser(uid)?.balance || 0;
  const toPlay = Math.max(0, r.bonus * g().bonusWager - Math.max(0, r.wagered));
  const locked = Math.min(r.bonus, toPlay, balance);
  const needDeposit = Math.max(0, g().withdrawMinDeposit - depositedTotal(uid));   // still to deposit before any withdrawal
  return { balance, locked, withdrawable: needDeposit ? 0 : balance - locked, toPlay, needDeposit, minDeposit: g().withdrawMinDeposit };
}

export function referralInfo(uid) {
  uid = String(uid);
  const r = db.prepare('SELECT COUNT(*) invited, COALESCE(SUM(ref_paid),0) paid FROM users WHERE referred_by = ?').get(uid);
  const earned = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE user_id = ? AND type = 'bonus' AND note LIKE 'Referral bonus%'").get(uid).s;
  return { code: `ref_${uid}`, invited: r.invited, qualified: r.paid, earned, bonus: g().referralBonus, minDeposit: g().referralMinDeposit, friendBonus: g().referralFriendBonus };
}

/** Start of this week (Monday 00:00, local time). */
function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Math.floor(d.getTime() / 1000);
}

let lbCache = { at: 0, value: null };
/** Top winners this week by net winnings (won − staked); first names only. Cached 60 s. */
export function leaderboard() {
  if (lbCache.value && Date.now() - lbCache.at < 60000) return lbCache.value;
  const since = weekStart();
  const rows = db.prepare(`SELECT t.user_id, u.first_name,
      COALESCE(SUM(CASE WHEN t.type='win' THEN t.amount END),0) won,
      COALESCE(-SUM(CASE WHEN t.type='bet' THEN t.amount END),0) - COALESCE(SUM(CASE WHEN t.type='refund' THEN t.amount END),0) staked,
      COUNT(CASE WHEN t.type='win' THEN 1 END) wins
    FROM transactions t JOIN users u ON u.id = t.user_id
    WHERE t.created_at >= ? AND t.type IN ('win','bet','refund') GROUP BY t.user_id`).all(since)
    .map((r) => ({ id: r.user_id, name: (r.first_name || 'Player').slice(0, 14), net: r.won - r.staked, won: r.won, wins: r.wins }))
    .filter((r) => r.net > 0)
    .sort((a, b) => b.net - a.net)
    .slice(0, 20);
  lbCache = { at: Date.now(), value: { since, rows } };
  return lbCache.value;
}

export const bonusesPaidSince = (since) =>
  db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type = 'bonus' AND created_at >= ?").get(since).s;
