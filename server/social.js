// Shared by the Ludo, pool and Kerenbula managers:
//  • Practice: a free game against a bot (no money, not recorded, not counted in stats).
//  • Private tables: create a table with a code and invite a friend by Telegram link.
//    The table isn't listed in the lobby; it's refunded if nobody joins within 30 minutes.
import crypto from 'node:crypto';

export const BOT_UID = 'bot';
export const BOT_MEMBER = { uid: BOT_UID, name: '🤖 Bot', bot: true };
const PRIVATE_TTL_MS = Number(process.env.PRIVATE_TABLE_MIN || 30) * 60 * 1000;

/** Start a practice game for `user` against the bot. */
export function startPractice(mgr, user, { size = 2 } = {}) {
  const uid = String(user.id);
  if (mgr.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
  if (mgr.userLoc.has(uid)) throw new Error('Finish or leave your current game first');
  mgr.startGame({ stake: 0, size, waiting: [{ uid, name: user.first_name || user.username || 'Player' }, BOT_MEMBER], roundId: null, practice: true });
  return mgr.locationOf(uid);
}

const newCode = () => crypto.randomBytes(4).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase().padEnd(6, 'X');

/** Create a private table and return it (the caller then seats the host like a normal join). */
export function createPrivateTable(mgr, stake, size) {
  let code;
  do code = newCode(); while (mgr.tables.has(`p:${code}`));
  const key = `p:${code}`;
  const t = { stake, size, waiting: [], roundId: null, private: code, key, createdAt: Date.now() };
  mgr.tables.set(key, t);
  // Nobody came: refund and remove
  t.expiry = setTimeout(() => {
    if (mgr.tables.get(key) !== t) return;
    for (const w of [...t.waiting]) { try { mgr.leave({ id: w.uid }); } catch { /* ignore */ } }
    mgr.tables.delete(key);
  }, PRIVATE_TTL_MS);
  t.expiry.unref?.();
  return t;
}

export function privateTable(mgr, code) {
  const t = mgr.tables.get(`p:${String(code || '').toUpperCase()}`);
  if (!t) throw new Error('This invite has expired or the game already started');
  return t;
}

/** After a private table starts or empties, forget it. */
export function dropPrivateIfDone(mgr, t) {
  if (t?.private && (!t.waiting.length || t.started)) { clearTimeout(t.expiry); mgr.tables.delete(t.key); }
}
