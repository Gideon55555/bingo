// Admin-editable settings. Every value here can be changed from Admin → Settings while the app runs.
// Values start from .env (the "default"); changes are stored in the database and win over .env.
//
// Units shown to the admin are human ones (ETB, %, seconds); internally money is cents and cuts are fractions.
import { config } from './config.js';
import { db, logAdmin } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by  TEXT
)`);

const F = (key, label, type, opts = {}) => ({ key, label, type, ...opts });
/** group → fields. key = path inside `config` (dots for nested). */
export const SCHEMA = [
  { id: 'general', label: '🏠 General', fields: [
    F('appName', 'App name (top of the screen)', 'text', { max: 30, help: 'Empty = "Games"' }),
    F('supportContact', 'Support contact', 'text', { max: 80, help: 'e.g. @YourSupport or a phone number' }),
    F('minAge', 'Minimum age', 'int', { min: 18, max: 30 }),
  ] },
  { id: 'wallet', label: '💰 Deposits & withdrawals', fields: [
    F('paymentInfo', 'Where players send money', 'textarea', { max: 400, help: 'Shown on the deposit screen, e.g. "Telebirr: 0911… (Name) · CBE: 1000… (Name)"' }),
    F('minDeposit', 'Minimum deposit', 'money', { min: 1, max: 100000 }),
    F('maxDeposit', 'Maximum deposit', 'money', { min: 1, max: 10000000 }),
    F('minWithdraw', 'Minimum withdrawal', 'money', { min: 1, max: 100000 }),
    F('maxPendingDeposits', 'Deposits a player can have waiting at once', 'int', { min: 1, max: 20 }),
    F('maxPendingWithdrawals', 'Withdrawals a player can have waiting at once', 'int', { min: 1, max: 20 }),
    F('withdrawSecondApproval', 'Withdrawals needing a 2nd admin (from this amount)', 'money', { min: 1, max: 10000000, help: 'Only when 2 or more admins are set' }),
  ] },
  { id: 'bonus', label: '🎁 Bonuses', fields: [
    F('growth.signupBonus', 'Sign-up bonus (new players)', 'money', { min: 0, max: 10000, help: '0 = off. Once per phone.' }),
    F('growth.referralBonus', 'Referral bonus (to the inviter)', 'money', { min: 0, max: 10000, help: '0 = off' }),
    F('growth.referralFriendBonus', 'Referral bonus (to the new friend)', 'money', { min: 0, max: 10000 }),
    F('growth.referralMinDeposit', 'Friend\'s first deposit must be at least', 'money', { min: 0, max: 100000 }),
    F('growth.dailyReward', 'Daily reward', 'money', { min: 0, max: 10000, help: '0 = off. Only after a first deposit.' }),
    F('growth.bonusWager', 'Bonus must be played … times before withdrawal', 'int', { min: 0, max: 20 }),
  ] },
  { id: 'bingo', label: '🔢 Bingo', fields: [
    F('stakes', 'Room entry fees (one per room)', 'moneyList', { min: 1, max: 100000, maxItems: 8 }),
    F('cardCount', 'Number of cartelas (cards) to choose from', 'int', { min: 10, max: 400 }),
    F('maxCards', 'Cartelas one player may hold', 'int', { min: 1, max: 10 }),
    F('houseCut', 'House cut from the prize', 'percent', { min: 0, max: 50 }),
    F('minPlayers', 'Players needed to start', 'int', { min: 2, max: 100 }),
    F('countdownSec', 'Countdown before the game (seconds)', 'int', { min: 5, max: 300 }),
    F('callIntervalMs', 'Seconds between called numbers', 'seconds', { min: 1, max: 15 }),
    F('resultShowSec', 'Results shown for (seconds)', 'int', { min: 3, max: 60 }),
  ] },
  { id: 'crash', label: '✈️ Aviator', fields: [
    F('crash.enabled', 'Game is on', 'bool'),
    F('crash.name', 'Name', 'text', { max: 20 }),
    F('crash.houseEdge', 'House edge', 'percent', { min: 0, max: 20, help: '3% = players get back 97% on average' }),
    F('crash.minBet', 'Minimum bet', 'money', { min: 1, max: 100000 }),
    F('crash.maxBet', 'Maximum bet', 'money', { min: 1, max: 1000000 }),
    F('crash.maxWin', 'Maximum win per bet', 'money', { min: 1, max: 10000000 }),
    F('crash.betSec', 'Betting time (seconds)', 'int', { min: 3, max: 60 }),
    F('crash.maxMultiplier', 'Highest multiplier', 'mult', { min: 2, max: 10000 }),
  ] },
  { id: 'keno', label: '🎯 Keno', fields: [
    F('keno.enabled', 'Game is on', 'bool'),
    F('keno.minBet', 'Minimum ticket', 'money', { min: 1, max: 100000 }),
    F('keno.maxBet', 'Maximum ticket', 'money', { min: 1, max: 1000000 }),
    F('keno.maxWin', 'Maximum win per ticket', 'money', { min: 1, max: 10000000 }),
    F('keno.betSec', 'Ticket sales time (seconds)', 'int', { min: 10, max: 300 }),
    F('keno.ballMs', 'Seconds between drawn numbers', 'seconds', { min: 0.3, max: 5 }),
  ] },
  { id: 'ludo', label: '🎲 Ludo', fields: [
    F('ludo.enabled', 'Game is on', 'bool'),
    F('ludo.stakes', 'Table entry fees', 'moneyList', { min: 1, max: 100000, maxItems: 8 }),
    F('ludo.houseCut', 'House cut from the pot', 'percent', { min: 0, max: 50 }),
    F('ludo.tokens', 'Tokens per player', 'int', { min: 1, max: 4 }),
    F('ludo.turnSec', 'Seconds per turn', 'int', { min: 5, max: 120 }),
    F('ludo.maxMisses', 'Missed turns before forfeit', 'int', { min: 1, max: 10 }),
  ] },
  { id: 'pool', label: '🎱 8-Ball Pool', fields: [
    F('pool.enabled', 'Game is on', 'bool'),
    F('pool.stakes', 'Table entry fees', 'moneyList', { min: 1, max: 100000, maxItems: 8 }),
    F('pool.houseCut', 'House cut from the pot', 'percent', { min: 0, max: 50 }),
    F('pool.shotSec', 'Seconds per shot', 'int', { min: 10, max: 120 }),
    F('pool.maxMisses', 'Timeouts before forfeit', 'int', { min: 1, max: 10 }),
  ] },
  { id: 'hunt', label: '👮 Dibibkosh', fields: [
    F('hunt.enabled', 'Game is on', 'bool'),
    F('hunt.stakes', 'Table entry fees', 'moneyList', { min: 1, max: 100000, maxItems: 8 }),
    F('hunt.houseCut', 'House cut from the pot', 'percent', { min: 0, max: 50 }),
    F('hunt.moveSec', 'Seconds to pick each move', 'int', { min: 2, max: 10 }),
    F('hunt.jumpAny', 'Cop can jump to any box (off = only to boxes next to it, longer games)', 'bool'),
    F('hunt.surprise', 'How often the cop guesses at random instead of predicting', 'percent', { min: 0, max: 100 }),
  ] },
  { id: 'kerenbula', label: '🔴 Kerenbula', fields: [
    F('kerenbula.enabled', 'Game is on', 'bool'),
    F('kerenbula.stakes', 'Table entry fees', 'moneyList', { min: 1, max: 100000, maxItems: 8 }),
    F('kerenbula.houseCut', 'House cut from the pot', 'percent', { min: 0, max: 50 }),
    F('kerenbula.target', 'Points to win', 'int', { min: 3, max: 50 }),
    F('kerenbula.maxFrames', 'Maximum frames', 'int', { min: 1, max: 30 }),
    F('kerenbula.pinPoints', 'Points per pin', 'int', { min: 1, max: 20 }),
    F('kerenbula.rollSec', 'Seconds per roll', 'int', { min: 10, max: 120 }),
    F('kerenbula.maxMisses', 'Timeouts before forfeit', 'int', { min: 1, max: 10 }),
  ] },
];
const FIELDS = new Map(SCHEMA.flatMap((g) => g.fields.map((f) => [f.key, { ...f, group: g.id }])));

const getPath = (key) => key.split('.').reduce((o, k) => o?.[k], config);
const setPath = (key, v) => { const parts = key.split('.'); const last = parts.pop(); parts.reduce((o, k) => o[k], config)[last] = v; };
const clone = (v) => (Array.isArray(v) ? [...v] : v);

// .env values, remembered before any override (for "reset to default")
const DEFAULTS = new Map([...FIELDS.keys()].map((k) => [k, clone(getPath(k))]));

// ---- units: stored value <-> what the admin sees ----
const toUi = (f, v) => {
  switch (f.type) {
    case 'money': return v / 100;
    case 'moneyList': return v.map((x) => x / 100);
    case 'percent': return Math.round(v * 10000) / 100;
    case 'seconds': return v / 1000;
    case 'mult': return v / 100;
    default: return v;
  }
};
function fromUi(f, raw) {
  const num = (x) => {
    const n = Number(String(x).replace(/,/g, '').trim());
    if (!Number.isFinite(n)) throw new Error(`${f.label}: enter a number`);
    if (n < f.min || n > f.max) throw new Error(`${f.label}: must be between ${f.min} and ${f.max}`);
    return n;
  };
  switch (f.type) {
    case 'bool': return raw === true || raw === 'true' || raw === 1;
    case 'text': case 'textarea': {
      const s = String(raw ?? '').trim();
      if (s.length > f.max) throw new Error(`${f.label}: at most ${f.max} characters`);
      return s;
    }
    case 'int': { const n = num(raw); if (!Number.isInteger(n)) throw new Error(`${f.label}: whole number please`); return n; }
    case 'money': return Math.round(num(raw) * 100);
    case 'percent': return num(raw) / 100;
    case 'seconds': return Math.round(num(raw) * 1000);
    case 'mult': return Math.round(num(raw) * 100);
    case 'moneyList': {
      const list = (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/)).filter((x) => String(x).trim() !== '').map((x) => Math.round(num(x) * 100));
      const uniq = [...new Set(list)].sort((a, b) => a - b);
      if (!uniq.length) throw new Error(`${f.label}: add at least one amount`);
      if (uniq.length > f.maxItems) throw new Error(`${f.label}: at most ${f.maxItems} amounts`);
      return uniq;
    }
    default: throw new Error(`Unknown setting type ${f.type}`);
  }
}

/** Checks that involve two settings at once. */
function crossCheck() {
  const pairs = [['minDeposit', 'maxDeposit'], ['crash.minBet', 'crash.maxBet'], ['keno.minBet', 'keno.maxBet']];
  for (const [a, b] of pairs) {
    if (getPath(a) > getPath(b)) throw new Error(`${FIELDS.get(a).label} can't be more than ${FIELDS.get(b).label}`);
  }
  if (config.crash.maxWin < config.crash.maxBet) throw new Error('Aviator: maximum win must be at least the maximum bet');
}

// ---- load saved values on startup ----
for (const r of db.prepare('SELECT key, value FROM settings').all()) {
  const f = FIELDS.get(r.key);
  if (!f) continue;
  try { setPath(r.key, JSON.parse(r.value)); } catch { /* ignore a bad row */ }
}

const listeners = new Set();
/** Called with the list of changed keys after every save (to rebuild tables, refresh phones…). */
export const onSettingsChanged = (fn) => listeners.add(fn);

/** For the admin screen: every setting with its current and default value, in admin units. */
export function settingsView() {
  const saved = new Map(db.prepare('SELECT key, updated_at, updated_by FROM settings').all().map((r) => [r.key, r]));
  return SCHEMA.map((g) => ({
    id: g.id, label: g.label,
    fields: g.fields.map((f) => ({
      key: f.key, label: f.label, help: f.help || null, type: f.type, min: f.min ?? null, max: f.max ?? null,
      value: toUi(f, getPath(f.key)), default: toUi(f, DEFAULTS.get(f.key)),
      changed: saved.has(f.key), updatedAt: saved.get(f.key)?.updated_at || null, updatedBy: saved.get(f.key)?.updated_by || null,
    })),
  }));
}

const upsert = db.prepare(`INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch(), updated_by = excluded.updated_by`);

/**
 * Save settings from the admin screen. values: { key: adminValue }. All-or-nothing: if one value is
 * invalid nothing changes. reset: [keys] to go back to the .env default.
 */
export function saveSettings({ values = {}, reset = [] }, who) {
  const before = new Map();
  const changed = [];
  try {
    for (const [key, raw] of Object.entries(values)) {
      const f = FIELDS.get(key);
      if (!f) throw new Error(`Unknown setting: ${key}`);
      const v = fromUi(f, raw);
      if (JSON.stringify(v) === JSON.stringify(getPath(key))) continue;
      before.set(key, clone(getPath(key)));
      setPath(key, v);
      changed.push(key);
    }
    for (const key of reset) {
      if (!FIELDS.has(key)) throw new Error(`Unknown setting: ${key}`);
      before.set(key, clone(getPath(key)));
      setPath(key, clone(DEFAULTS.get(key)));
      changed.push(key);
    }
    crossCheck();
  } catch (e) {
    for (const [k, v] of before) setPath(k, v); // undo everything
    throw e;
  }
  db.transaction(() => {
    for (const key of changed) {
      if (reset.includes(key)) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      else upsert.run(key, JSON.stringify(getPath(key)), who?.name || 'admin');
    }
  })();
  for (const key of changed) {
    const f = FIELDS.get(key);
    logAdmin(who, 'change_setting', key, { from: toUi(f, before.get(key)), to: toUi(f, getPath(key)) }, who?.ip);
  }
  if (changed.length) for (const fn of listeners) { try { fn(changed); } catch (e) { console.error('[settings] apply failed:', e); } }
  return { changed, settings: settingsView() };
}
