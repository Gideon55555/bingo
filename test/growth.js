// Referrals, daily reward, bonus play-through before withdrawal, weekly leaderboard.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const TOKEN = '123456:GROWTH_TOKEN';
const PORT = 3989;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-growth-'));
const env = {
  ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', CRASH_ENABLED: 'false', KENO_ENABLED: 'false',
  REFERRAL_BONUS: '10', REFERRAL_MIN_DEPOSIT: '50', DAILY_REWARD: '2', BONUS_WAGER: '1', WALLET_RATE: '100', MAX_PENDING_DEPOSITS: '20', MIN_WITHDRAW: '1',
};
Object.assign(process.env, env);
const sign = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  params.set('hash', crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(dcs).digest('hex'));
  return params.toString();
};
const as = (u) => ({ Authorization: `tma ${sign(u)}`, 'Content-Type': 'application/json' });
const admin = { 'x-admin-key': 'admin-password-1', 'Content-Type': 'application/json' };
const call = async (method, p, headers, body) => {
  const r = await fetch(URL + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
let refN = 0;
const depositApproved = async (u, etb) => {
  const d = await call('POST', '/api/deposit', as(u), { amount: etb * 100, reference: `G${Date.now()}${refN++}` });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  const r = await call('POST', '/api/admin/decide', admin, { kind: 'deposit', id: d.data.id, approve: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
};
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };

const db = await import('../server/db.js');
const growth = await import('../server/growth.js');
const risk = await import('../server/risk.js');
const U = { A: { id: 7401, first_name: 'Almaz' }, B: { id: 7402, first_name: 'Biniam' }, C: { id: 7403, first_name: 'Chuchu' }, D: { id: 7404, first_name: 'Derartu' }, E: { id: 7405, first_name: 'Eden' } };
db.upsertUser(U.A);
// B, C, D open the bot from Almaz's referral link as brand-new players (what the bot's /start does)
for (const k of ['B', 'C', 'D']) { db.upsertUser(U[k]); assert.equal(growth.recordReferral(U[k], '7401', { wasNew: true }), true); }
db.upsertUser(U.E);
assert.equal(growth.recordReferral(U.E, '7401', { wasNew: false }), false); // already had an account
assert.equal(growth.recordReferral(U.A, '7401', { wasNew: true }), false);   // can't refer yourself
risk.seen('7401', { device: 'almazphone001' }); risk.seen('7403', { device: 'almazphone001' }); // Chuchu = Almaz's own phone
const bal = (k) => db.getUser(String(U[k].id)).balance;
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  console.log('Referrals');
  ok('only brand-new players count as referred; you can\'t refer yourself');
  await depositApproved(U.D, 20);
  assert.equal(bal('A'), 0); ok('friend\'s deposit below 50 ETB → no bonus yet');
  await depositApproved(U.B, 60);
  assert.equal(bal('A'), 1000); ok('friend deposits 60 ETB → inviter gets 10 ETB');
  await depositApproved(U.B, 100);
  assert.equal(bal('A'), 1000); ok('paid once per friend, not per deposit');
  await depositApproved(U.C, 80);
  assert.equal(bal('A'), 1000); ok('no bonus when the "friend" used the inviter\'s own phone');
  const info = (await call('GET', '/api/growth', as(U.A))).data.referral;
  assert.equal(info.invited, 3); assert.equal(info.earned, 1000); ok(`referral stats: ${info.invited} invited, ${info.qualified} qualified, earned 10 ETB`);

  console.log('Daily reward');
  let r = await call('GET', '/api/growth', as(U.A));
  assert.equal(r.data.daily.available, false); assert.equal(r.data.daily.reason, 'deposit_first'); ok('locked until the player has deposited');
  r = await call('POST', '/api/daily', as(U.B));
  assert.equal(r.status, 200); assert.equal(r.data.amount, 200); ok('player with a deposit claims 2 ETB');
  r = await call('POST', '/api/daily', as(U.B));
  assert.equal(r.status, 400); assert.match(r.data.error, /tomorrow/); ok('only once per day');

  console.log('Bonus money must be played once');
  r = await call('POST', '/api/withdraw', as(U.A), { amount: 1000, phone: '0911000000' });
  assert.equal(r.status, 400); assert.match(r.data.error, /withdraw up to 0 ETB.*Play 10 ETB more/); ok('10 ETB referral bonus can\'t be withdrawn before playing it');
  db.debit('7401', 600, 'bet', 'test bet');
  r = await call('GET', '/api/growth', as(U.A));
  assert.equal(r.data.wallet.toPlay, 400); ok('after playing 6 ETB: 4 ETB left to play');
  db.debit('7401', 400, 'bet', 'test bet');
  db.credit('7401', 1500, 'win', 'test win');
  r = await call('POST', '/api/withdraw', as(U.A), { amount: 1500, phone: '0911000000' });
  assert.equal(r.status, 200); ok('after playing it through, everything can be withdrawn');
  const wB = (await call('GET', '/api/growth', as(U.B))).data.wallet;
  assert.equal(wB.withdrawable, wB.balance - 200); ok('a player\'s own deposits stay withdrawable; only the unplayed bonus is held');

  console.log('Weekly leaderboard');
  db.debit('7404', 1000, 'bet', 'x'); db.credit('7404', 5000, 'win', 'x');
  const lb = (await call('GET', '/api/leaderboard', as(U.E))).data.rows;
  assert.equal(lb[0].name, 'Derartu'); assert.equal(lb[0].net, 4000); assert.ok(lb.every((x, i) => i === 0 || lb[i - 1].net >= x.net));
  ok(`top winner this week: ${lb[0].name} +${lb[0].net / 100} ETB (sorted, first names only)`);
  const st = (await call('GET', '/api/admin/stats', admin)).data;
  assert.equal(st.today.bonusesPaid, 1000 + 200); ok('admin dashboard shows bonuses paid (12 ETB)');
  console.log(`\nAll ${passed} growth checks passed ✅`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  proc.kill();
  setTimeout(() => process.exit(), 300);
}
