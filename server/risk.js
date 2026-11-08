// Fraud & collusion signals.
//  • Which device (random id kept on the phone) and IP each account uses.
//  • Accounts that ever used the same phone can't be seated at the same 1v1/Ludo table.
//  • Reports for admins: shared phones, pairs who keep playing each other with one-sided results,
//    and deposit → withdraw without really playing (using the site to move money).
//  • Frozen accounts can't play or withdraw until an admin un-freezes them.
// Shared IPs alone are NOT treated as suspicious: Ethiopian carriers put many phones behind one IP.
import { db, logAdmin } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS user_seen (
  user_id   TEXT NOT NULL,
  kind      TEXT NOT NULL,          -- 'device' | 'ip'
  value     TEXT NOT NULL,
  first_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  last_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  hits      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, kind, value)
);
CREATE INDEX IF NOT EXISTS user_seen_value ON user_seen(kind, value);
`);
const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!cols.includes('frozen')) db.exec('ALTER TABLE users ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0');
if (!cols.includes('frozen_reason')) db.exec('ALTER TABLE users ADD COLUMN frozen_reason TEXT');

const upsertSeen = db.prepare(`INSERT INTO user_seen (user_id, kind, value) VALUES (?, ?, ?)
  ON CONFLICT(user_id, kind, value) DO UPDATE SET last_at = unixepoch(), hits = hits + 1`);
const recent = new Map(); // throttle writes: key -> time
const frozen = new Set(db.prepare('SELECT id FROM users WHERE frozen = 1').all().map((r) => r.id));

const cleanDevice = (d) => (typeof d === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(d) ? d : null);

/** Remember that this user was seen on this device / IP (at most one write per 10 min per pair). */
export function seen(userId, { ip, device } = {}) {
  const uid = String(userId);
  const now = Date.now();
  for (const [kind, value] of [['ip', ip], ['device', cleanDevice(device)]]) {
    if (!value) continue;
    const key = `${uid}|${kind}|${value}`;
    if (now - (recent.get(key) || 0) < 10 * 60 * 1000) continue;
    recent.set(key, now);
    try { upsertSeen.run(uid, kind, String(value).slice(0, 80)); } catch { /* never block a login */ }
  }
  if (recent.size > 50000) for (const [k, t] of recent) if (now - t > 10 * 60 * 1000) recent.delete(k);
}

const devicesOf = db.prepare("SELECT value FROM user_seen WHERE user_id = ? AND kind = 'device'");
const sharedDeviceStmt = db.prepare(`SELECT 1 FROM user_seen a JOIN user_seen b ON a.kind = 'device' AND b.kind = 'device'
  AND a.value = b.value WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`);
/** Have these two accounts ever used the same phone? */
export const shareDevice = (a, b) => String(a) !== String(b) && !!sharedDeviceStmt.get(String(a), String(b));

/** Throws if `uid` may not sit with any of `others` (same phone = same person playing both sides). */
export function assertNotSamePerson(uid, others) {
  for (const o of others) {
    if (shareDevice(uid, o)) {
      console.warn(`[risk] blocked ${uid} from sitting with ${o} (same phone)`);
      throw new Error('You can’t play against an account that uses the same phone.');
    }
  }
}

// ---------------- freezing ----------------
export const isFrozen = (uid) => frozen.has(String(uid));
export function assertNotFrozen(uid) {
  if (frozen.has(String(uid))) throw new Error('Your account is under review. Please contact support.');
}
export function setFrozen(uid, on, reason, who) {
  uid = String(uid);
  const r = db.prepare('UPDATE users SET frozen = ?, frozen_reason = ? WHERE id = ?').run(on ? 1 : 0, on ? (reason || null) : null, uid);
  if (!r.changes) throw new Error('User not found');
  if (on) frozen.add(uid); else frozen.delete(uid);
  logAdmin(who, on ? 'freeze_user' : 'unfreeze_user', uid, reason || null, who?.ip);
  return { userId: uid, frozen: !!on };
}

// ---------------- reports ----------------
const nameOf = db.prepare('SELECT id, first_name, username, frozen FROM users WHERE id = ?');
const person = (id) => { const u = nameOf.get(String(id)); return u ? { id: u.id, name: u.first_name || u.username || u.id, username: u.username, frozen: !!u.frozen } : { id, name: id }; };

/** Accounts that used the same phone. */
export function sharedDevices() {
  return db.prepare(`SELECT value, GROUP_CONCAT(DISTINCT user_id) AS users, MAX(last_at) AS last_at
    FROM user_seen WHERE kind = 'device' GROUP BY value HAVING COUNT(DISTINCT user_id) > 1 ORDER BY last_at DESC LIMIT 100`).all()
    .map((r) => ({ device: r.value.slice(0, 8), lastAt: r.last_at, users: r.users.split(',').map(person) }));
}

/** 1v1 matches between the same two people in the last `days`, where one side keeps winning. */
export function suspiciousPairs({ days = 30, minGames = 5, minShare = 0.8 } = {}) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const pairs = new Map();
  const add = (game, rows) => {
    for (const g of rows) {
      const ps = JSON.parse(g.players);
      if (ps.length !== 2) continue;
      const [a, b] = ps.map((p) => String(p.userId)).sort();
      const key = `${a}|${b}`;
      const p = pairs.get(key) || { a, b, games: 0, winsA: 0, winsB: 0, moved: 0, byGame: {} };
      p.games++;
      p.byGame[game] = (p.byGame[game] || 0) + 1;
      if (String(g.winner_id) === a) p.winsA++; else if (String(g.winner_id) === b) p.winsB++;
      p.moved += g.stake;
      pairs.set(key, p);
    }
  };
  add('pool', db.prepare('SELECT players, winner_id, stake FROM pool_games WHERE created_at >= ?').all(since));
  add('kerenbula', db.prepare('SELECT players, winner_id, stake FROM kerenbula_games WHERE created_at >= ?').all(since));
  add('ludo', db.prepare('SELECT players, winner_id, stake FROM ludo_games WHERE created_at >= ?').all(since));
  return [...pairs.values()]
    .filter((p) => p.games >= minGames && Math.max(p.winsA, p.winsB) / p.games >= minShare)
    .map((p) => {
      const winner = p.winsA >= p.winsB ? p.a : p.b;
      return {
        winner: person(winner), loser: person(winner === p.a ? p.b : p.a), games: p.games,
        winnerShare: Math.round((Math.max(p.winsA, p.winsB) / p.games) * 100), staked: p.moved, byGame: p.byGame,
        samePhone: shareDevice(p.a, p.b),
      };
    })
    .sort((x, y) => Number(y.samePhone) - Number(x.samePhone) || y.games - x.games)
    .slice(0, 100);
}

/** Deposited, withdrew (or asked to) most of it, but barely played. */
export function lowPlayCashouts({ wagerRatio = 0.5 } = {}) {
  return db.prepare(`SELECT u.id,
      (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=u.id AND type='deposit' AND status='approved') AS deposited,
      (SELECT COALESCE(-SUM(amount),0) FROM transactions WHERE user_id=u.id AND type='withdraw' AND status IN ('approved','pending')) AS withdrawn,
      (SELECT COALESCE(-SUM(amount),0) FROM transactions WHERE user_id=u.id AND type='bet') AS wagered
    FROM users u WHERE EXISTS (SELECT 1 FROM transactions WHERE user_id=u.id AND type='withdraw')`).all()
    .filter((r) => r.deposited > 0 && r.withdrawn >= r.deposited * 0.5 && r.wagered < r.deposited * wagerRatio)
    .map((r) => ({ user: person(r.id), deposited: r.deposited, withdrawn: r.withdrawn, wagered: r.wagered }))
    .slice(0, 100);
}

/** Short warnings for one user, shown next to their withdrawal requests. */
export function userFlags(uid) {
  uid = String(uid);
  const flags = [];
  if (isFrozen(uid)) flags.push('Account is frozen');
  const others = new Set();
  for (const { value } of devicesOf.all(uid)) {
    for (const r of db.prepare("SELECT DISTINCT user_id FROM user_seen WHERE kind='device' AND value = ? AND user_id != ?").all(value, uid)) others.add(r.user_id);
  }
  if (others.size) flags.push(`Same phone as ${[...others].slice(0, 3).map((o) => person(o).name).join(', ')}${others.size > 3 ? ` +${others.size - 3}` : ''}`);
  const pairs = suspiciousPairs().filter((p) => p.winner.id === uid);
  for (const p of pairs.slice(0, 2)) flags.push(`Won ${p.winnerShare}% of ${p.games} matches vs ${p.loser.name}${p.samePhone ? ' (same phone!)' : ''}`);
  const low = lowPlayCashouts().find((r) => r.user.id === uid);
  if (low) flags.push(`Played only ${Math.round((low.wagered / Math.max(1, low.deposited)) * 100)}% of what they deposited`);
  return flags;
}

/** Other accounts seen on this user's devices and IPs (for the player detail page). */
export function linkedAccounts(uid) {
  uid = String(uid);
  const rows = db.prepare(`SELECT b.user_id, a.kind, COUNT(*) n FROM user_seen a JOIN user_seen b ON a.kind = b.kind AND a.value = b.value
    WHERE a.user_id = ? AND b.user_id != ? GROUP BY b.user_id, a.kind ORDER BY a.kind, n DESC LIMIT 50`).all(uid, uid);
  return rows.map((r) => ({ ...person(r.user_id), via: r.kind }));
}
