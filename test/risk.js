// Fraud & collusion: same-phone accounts, one-sided pairs, cash-out without playing, freezing.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:RISK_TOKEN';
const PORT = 3993;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-risk-'));
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', CRASH_ENABLED: 'false', KENO_ENABLED: 'false', SOCKET_RATE: '100000',
};
Object.assign(process.env, env);
const sign = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
};
const admin = { 'x-admin-key': 'admin-password-1', 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = admin) => {
  const r = await fetch(URL + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const emit = (s, ev, p = {}) => new Promise((res) => s.emit(ev, p, res));
const connect = async (user, device) => {
  const s = io(URL, { auth: { initData: sign(user), device }, transports: ['websocket'] });
  await new Promise((r) => s.on('connect', r));
  return s;
};
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };

const db = await import('../server/db.js');
const U = { A: { id: 7101, first_name: 'Alem' }, B: { id: 7102, first_name: 'Bekele' }, C: { id: 7103, first_name: 'Chaltu' }, D: { id: 7104, first_name: 'Dawit' } };
for (const u of Object.values(U)) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }
// Alem keeps beating Bekele at pool: 8 matches, 8 wins
for (let i = 0; i < 8; i++) {
  db.db.prepare(`INSERT INTO pool_games (stake, pot, payout, house, winner_id, players, shots, how, duration_sec) VALUES (2000, 4000, 3600, 400, '7101', ?, 3, 'potted the 8 ball', 40)`)
    .run(JSON.stringify([{ userId: '7101', name: 'Alem' }, { userId: '7102', name: 'Bekele' }]));
}
// Chaltu: deposits 500, asks to withdraw 450 without playing
const dep = db.createDeposit('7103', 50000, 'CHALTU123'); db.approveDeposit(dep);
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  console.log('Same phone');
  const a = await connect(U.A, 'phoneAAAA1111');
  const b = await connect(U.B, 'phoneAAAA1111'); // Bekele logs in on Alem's phone
  const d = await connect(U.D, 'phoneDDDD4444');
  await new Promise((r) => setTimeout(r, 200));
  await emit(a, 'pool:enter'); await emit(b, 'pool:enter'); await emit(d, 'pool:enter');
  assert.equal((await emit(a, 'pool:join', { stake: 2000, size: 2 })).ok, true);
  const before = db.getUser('7102').balance;
  const r1 = await emit(b, 'pool:join', { stake: 2000, size: 2 });
  assert.equal(r1.ok, false); assert.match(r1.error, /same phone/); ok('an account that used the same phone can\'t sit at your table');
  assert.equal(db.getUser('7102').balance, before); ok('…and isn\'t charged');
  assert.equal((await emit(d, 'pool:join', { stake: 2000, size: 2 })).ok, true); ok('a player on a different phone joins normally (match starts)');
  assert.equal((await emit(b, 'kb:join', { stake: 1000 })).ok, true); ok('the blocked player can still play other people');
  await emit(b, 'kb:leave');

  console.log('Reports');
  let r = await call('GET', '/api/admin/risk');
  const dev = r.data.sharedDevices.find((x) => x.users.some((u) => u.id === '7101'));
  assert.ok(dev && dev.users.some((u) => u.id === '7102')); ok('Risk tab: Alem and Bekele listed as one phone');
  const pair = r.data.pairs.find((p) => p.winner.id === '7101');
  assert.ok(pair && pair.games === 8 && pair.winnerShare === 100 && pair.samePhone); ok('Risk tab: Alem won 8/8 against Bekele — flagged, same phone');
  const wd = await call('POST', '/api/withdraw', { amount: 45000, phone: '0911223344' }, { Authorization: `tma ${sign(U.C)}`, 'Content-Type': 'application/json' });
  assert.equal(wd.status, 200);
  r = await call('GET', '/api/admin/risk');
  assert.ok(r.data.lowPlay.some((x) => x.user.id === '7103')); ok('Risk tab: Chaltu deposited 500 and asked for 450 back without playing');
  const wdA = await call('POST', '/api/withdraw', { amount: 10000, phone: '0911000001' }, { Authorization: `tma ${sign(U.A)}`, 'Content-Type': 'application/json' });
  const pend = (await call('GET', '/api/admin/pending')).data.items;
  const fa = pend.find((t) => t.id === wdA.data.id).flags.join(' | ');
  assert.match(fa, /Same phone as Bekele/); assert.match(fa, /Won 100% of 8 matches vs Bekele/);
  ok(`Alem's withdrawal shows warnings: "${fa}"`);
  assert.match(pend.find((t) => t.id === wd.data.id).flags.join(' '), /Played only 0%/); ok('Chaltu\'s withdrawal shows "played only 0% of what they deposited"');
  const det = (await call('GET', '/api/admin/users/7101')).data;
  assert.ok(det.linked.some((l) => l.id === '7102' && l.via === 'device')); ok('player page lists other accounts on the same phone');

  console.log('Freezing');
  r = await call('POST', '/api/admin/freeze', { userId: '7103', on: true, reason: 'cash-out without play' });
  assert.equal(r.status, 200);
  const c = await connect(U.C, 'phoneCCCC3333');
  await emit(c, 'kb:enter');
  const j = await emit(c, 'kb:join', { stake: 1000 });
  assert.equal(j.ok, false); assert.match(j.error, /under review/); ok('frozen account can\'t join games');
  const w2 = await call('POST', '/api/withdraw', { amount: 1000, phone: '0911223344' }, { Authorization: `tma ${sign(U.C)}`, 'Content-Type': 'application/json' });
  assert.equal(w2.status, 403); ok('frozen account can\'t withdraw');
  await call('POST', '/api/admin/freeze', { userId: '7103', on: false });
  assert.equal((await emit(c, 'kb:join', { stake: 1000 })).ok, true); ok('un-freezing restores play');
  const lg = (await call('GET', '/api/admin/log')).data.items.map((l) => l.action);
  assert.ok(lg.includes('freeze_user') && lg.includes('unfreeze_user')); ok('freeze and un-freeze recorded in the admin log');
  for (const s of [a, b, c, d]) s.close();
  console.log(`\nAll ${passed} fraud & collusion checks passed ✅`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  proc.kill();
  setTimeout(() => process.exit(), 300);
}
