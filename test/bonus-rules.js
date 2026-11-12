// Default bonus rules: 300 sign-up, 50 referral once the friend has deposited 100 in total, no withdrawal before 100 deposited.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:BONUSRULES_TOKEN';
const PORT = 3979;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-bonusrules-'));
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', CRASH_ENABLED: 'false', KENO_ENABLED: 'false',
  DAILY_REWARD: '0', BONUS_WAGER: '0', WALLET_RATE: '100', MAX_PENDING_DEPOSITS: '20', MIN_WITHDRAW: '1',
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

for (const k of ['SIGNUP_BONUS', 'REFERRAL_BONUS', 'REFERRAL_MIN_DEPOSIT', 'WITHDRAW_MIN_DEPOSIT']) { delete env[k]; delete process.env[k]; }
const db = await import('../server/db.js');
const growth = await import('../server/growth.js');
const { config } = await import('../server/config.js');
const A = { id: 7801, first_name: 'Abebe' }, N = { id: 7802, first_name: 'Nardos' };
db.upsertUser(A); db.upsertUser(N);
assert.equal(growth.recordReferral(N, '7801', { wasNew: true }), true);
const bal = (u) => db.getUser(String(u.id)).balance;
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  assert.deepEqual([config.growth.signupBonus, config.growth.referralBonus, config.growth.referralMinDeposit, config.growth.withdrawMinDeposit], [30000, 5000, 10000, 10000]);
  ok('defaults: 300 sign-up, 50 referral, friend must deposit 100, 100 deposited before withdrawing');
  const s = io(URL, { auth: { initData: sign(N), device: 'nardosphone01' }, transports: ['websocket'] });
  await new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(bal(N), 30000); ok('a new player gets the 300 ETB sign-up bonus');
  let w = await call('POST', '/api/withdraw', as(N), { amount: 10000, phone: '0911000000' });
  assert.equal(w.status, 400); assert.match(w.data.error, /first deposit at least 100 ETB in total \(100 ETB more/); ok('…but cannot withdraw it without depositing');
  const me = await call('GET', '/api/growth', as(N));
  assert.equal(me.data.wallet.needDeposit, 10000); assert.equal(me.data.wallet.withdrawable, 0); ok('the wallet shows how much is still to deposit');
  await depositApproved(N, 60);
  assert.equal(bal(A), 0); ok('friend deposited 60: inviter not paid yet');
  w = await call('POST', '/api/withdraw', as(N), { amount: 10000, phone: '0911000000' });
  assert.match(w.data.error, /40 ETB more/); ok('60 deposited: still 40 short for a withdrawal');
  await depositApproved(N, 40);
  assert.equal(bal(A), 5000); ok('friend reached 100 in total → inviter gets 50 ETB');
  await depositApproved(N, 100);
  assert.equal(bal(A), 5000); ok('…and only once');
  w = await call('POST', '/api/withdraw', as(N), { amount: 10000, phone: '0911000000' });
  assert.ok(!/first deposit/.test(w.data.error || '')); ok('after depositing 100 the deposit rule no longer blocks withdrawals');
  await call('POST', '/api/admin/settings', admin, { values: { 'growth.withdrawMinDeposit': 500, 'growth.signupBonus': 10 } });
  const st = await call('GET', '/api/admin/settings', admin);
  const f = st.data.groups.flatMap((g) => g.fields).find((x) => x.key === 'growth.withdrawMinDeposit');
  assert.ok(f); ok('all of it can be changed in Admin → Settings → Bonuses');
  s.close();
  console.log(`\nAll ${passed} bonus-rule checks passed ✅`);
} catch (e) {
  console.error(e); console.error(log.slice(-1500)); process.exitCode = 1;
} finally { proc.kill(); setTimeout(() => process.exit(), 300); }
