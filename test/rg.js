// Responsible gambling: 21+ gate, deposit limits (with 24 h cooling-off for raises), self-exclusion.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:RG_TOKEN';
const PORT = 3992;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-rg-'));
const env = {
  ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', AGE_CONFIRM: 'true', CRASH_ENABLED: 'false', KENO_ENABLED: 'false', SOCKET_RATE: '100000',
  MAX_PENDING_DEPOSITS: '20', WALLET_RATE: '100',
};
Object.assign(process.env, env);
const user = { id: 7201, first_name: 'Rahel' };
const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
params.set('hash', crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(dcs).digest('hex'));
const initData = params.toString();
const H = { Authorization: `tma ${initData}`, 'Content-Type': 'application/json' };
const call = async (method, p, body) => {
  const r = await fetch(URL + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
let refN = 0;
const deposit = (etb) => call('POST', '/api/deposit', { amount: etb * 100, reference: `REF${Date.now()}${refN++}` });
const emit = (s, ev, p = {}) => new Promise((res) => s.emit(ev, p, res));
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };

const db = await import('../server/db.js');
db.upsertUser(user); db.credit(user.id, 100000, 'deposit', 'seed');
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  const s = io(URL, { auth: { initData }, transports: ['websocket'] });
  await new Promise((r) => s.on('connect', r));
  await emit(s, 'kb:enter');

  console.log('21+ confirmation');
  assert.equal((await call('GET', '/api/me')).data.user.ageConfirmed, false); ok('new player starts unconfirmed');
  let j = await emit(s, 'kb:join', { stake: 1000 });
  assert.equal(j.ok, false); assert.match(j.error, /21 or older/); ok('can\'t join a game before confirming 21+');
  assert.equal((await deposit(50)).status, 400); ok('can\'t deposit before confirming 21+');
  await call('POST', '/api/rg/age');
  assert.equal((await call('GET', '/api/me')).data.user.ageConfirmed, true);
  j = await emit(s, 'kb:join', { stake: 1000 });
  assert.equal(j.ok, true); await emit(s, 'kb:leave'); ok('after confirming, playing works');

  console.log('Deposit limits');
  let r = await call('POST', '/api/rg/limits', { day: 10000, week: null }); // 100 ETB a day
  assert.equal(r.data.day, 10000); assert.equal(r.data.pending, null); ok('setting a first limit works immediately');
  assert.equal((await deposit(80)).status, 200); ok('80 ETB deposit within the 100/day limit');
  r = await deposit(30);
  assert.equal(r.status, 400); assert.match(r.data.error, /daily deposit limit.*20\.00/); ok('30 more refused: "you can deposit 20.00 more today"');
  r = await call('POST', '/api/rg/limits', { day: 50000, week: null }); // raise to 500
  assert.equal(r.data.day, 10000); assert.equal(r.data.pending.day, 50000); ok('raising the limit doesn\'t apply yet (24 h wait)');
  assert.equal((await deposit(30)).status, 400); ok('…the old limit still applies meanwhile');
  db.db.prepare("UPDATE users SET dep_limit_pending = json_set(dep_limit_pending, '$.at', unixepoch() - 1) WHERE id = '7201'").run();
  r = await call('GET', '/api/rg');
  assert.equal(r.data.day, 50000); assert.equal(r.data.pending, null); ok('after 24 h the higher limit takes effect');
  assert.equal((await deposit(30)).status, 200); ok('…and the deposit goes through');
  r = await call('POST', '/api/rg/limits', { day: 5000, week: 20000 });
  assert.equal(r.data.day, 5000); assert.equal(r.data.week, 20000); assert.equal(r.data.pending, null); ok('lowering limits works immediately');
  r = await call('POST', '/api/rg/limits', { day: 5000, week: null });
  assert.equal(r.data.week, 20000); assert.equal(r.data.pending.week, null); ok('removing a limit also waits 24 h');
  assert.equal((await call('POST', '/api/rg/limits', { day: 50 })).status, 400); ok('limit below 1 ETB refused');

  console.log('Self-exclusion');
  assert.equal((await call('POST', '/api/rg/exclude', { days: 3 })).status, 400); ok('only 7 / 30 / 90 / 180 days allowed');
  r = await call('POST', '/api/rg/exclude', { days: 7 });
  const until = r.data.excludedUntil;
  assert.ok(until > Date.now() / 1000 + 6.9 * 86400); ok('7-day break set');
  j = await emit(s, 'kb:join', { stake: 1000 });
  assert.equal(j.ok, false); assert.match(j.error, /break until/); ok('can\'t play during the break');
  assert.equal((await deposit(10)).status, 400); ok('can\'t deposit during the break');
  db.db.prepare("UPDATE users SET dep_limit_day = NULL, dep_limit_week = NULL, dep_limit_pending = NULL WHERE id = '7201'").run();
  assert.equal((await call('POST', '/api/withdraw', { amount: 5000, phone: '0911000000' })).status, 200); ok('can still withdraw the balance');
  r = await call('POST', '/api/rg/exclude', { days: 7 });
  assert.ok(r.data.excludedUntil >= until); ok('a break can be extended but never shortened');
  r = await call('GET', '/api/rg/today');
  assert.ok('played' in r.data && 'net' in r.data); ok('today\'s summary for the play-time reminder');
  s.close();
  console.log(`\nAll ${passed} responsible-gambling checks passed ✅`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  proc.kill();
  setTimeout(() => process.exit(), 300);
}
