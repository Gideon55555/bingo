// Admin → Settings: live changes to entry fees, cuts, cartelas, games on/off, wallet text, sign-up bonus;
// validation, refunds when a table is removed, persistence across restarts, reset to default.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:SET_TOKEN';
const PORT = 3976;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-settings-'));
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', SOCKET_RATE: '100000', COUNTDOWN_SEC: '60', MIN_WITHDRAW: '1',
};
Object.assign(process.env, env);
const sign = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  params.set('hash', crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(dcs).digest('hex'));
  return params.toString();
};
const admin = { 'x-admin-key': 'admin-password-1', 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = admin) => {
  const r = await fetch(URL + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const save = (values, reset) => call('POST', '/api/admin/settings', { values, reset });
const emit = (s, ev, p = {}) => new Promise((res) => s.emit(ev, p, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = async (u, device) => {
  const s = io(URL, { auth: { initData: sign(u), device }, transports: ['websocket'] });
  await new Promise((r) => s.on('connect', r));
  return s;
};
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };

const db = await import('../server/db.js');
const U = [{ id: 7601, first_name: 'Aster' }, { id: 7602, first_name: 'Bereket' }, { id: 7603, first_name: 'Old' }];
for (const u of U) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }
db.db.prepare("UPDATE users SET created_at = unixepoch() - 30 * 86400 WHERE id = '7603'").run();
const bal = (id) => db.getUser(String(id)).balance;
let proc, log = '';
const start = async () => {
  proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
};
await start();
try {
  console.log('Settings screen');
  let r = await call('GET', '/api/admin/settings');
  const keys = r.data.groups.flatMap((g) => g.fields.map((f) => f.key));
  for (const k of ['stakes', 'cardCount', 'maxCards', 'houseCut', 'paymentInfo', 'growth.signupBonus', 'growth.referralBonus', 'crash.houseEdge', 'ludo.stakes', 'pool.houseCut', 'kerenbula.enabled'])
    assert.ok(keys.includes(k), k);
  ok(`${keys.length} settings in ${r.data.groups.length} groups (entry fees, cuts, cartelas, bonuses, timers, games on/off…)`);
  assert.equal(r.data.groups.find((g) => g.id === 'general').fields.find((f) => f.key === 'minAge').value, 21); ok('minimum age is 21');
  assert.equal((await call('GET', '/api/admin/settings', null, {})).status, 401); ok('only admins can see or change settings');

  console.log('Validation');
  r = await save({ houseCut: 80 });
  assert.equal(r.status, 400); assert.match(r.data.error, /between 0 and 50/); ok('house cut of 80% refused (max 50%)');
  r = await save({ cardCount: 75, minDeposit: 5000, maxDeposit: 100 });
  assert.equal(r.status, 400);
  assert.equal((await call('GET', '/api/config', null, {})).data.cardCount, 100); ok('min deposit above max deposit → nothing saved at all (cartela count unchanged too)');
  assert.equal((await save({ stakes: 'abc' })).status, 400); ok('nonsense entry fee refused');

  console.log('Bingo: entry fees, cut, cartelas');
  const [a, b] = [await connect(U[0], 'devA0000001'), await connect(U[1], 'devB0000002')];
  let cfgChanged = 0;
  a.on('config:changed', () => cfgChanged++);
  await emit(a, 'room:enter', { stake: 5000 });
  await emit(a, 'card:pick', { stake: 5000, card: 7 });
  assert.equal(bal(7601), 95000);
  const lobbyP = new Promise((res) => a.on('lobby:all', res));
  r = await save({ stakes: '5, 10, 25', houseCut: 10, cardCount: 50, maxCards: 1 });
  assert.equal(r.status, 200);
  const lobby = await lobbyP;
  assert.deepEqual(lobby.map((x) => x.stake), [500, 1000, 2500]); ok('bingo rooms are now 5 / 10 / 25 ETB, live');
  assert.equal(bal(7601), 100000); ok('player waiting in the removed 50 ETB room was refunded');
  await sleep(200);
  assert.ok(cfgChanged >= 1); ok('phones are told to reload the settings');
  await emit(a, 'room:enter', { stake: 1000 }); await emit(b, 'room:enter', { stake: 1000 });
  assert.equal((await emit(a, 'card:pick', { stake: 1000, card: 60 })).ok, false); ok('cartela 60 no longer exists (50 cartelas)');
  assert.equal((await emit(a, 'card:pick', { stake: 1000, card: 10 })).ok, true);
  assert.equal((await emit(a, 'card:pick', { stake: 1000, card: 11 })).ok, false); ok('max 1 cartela per player now');
  r = await emit(b, 'card:pick', { stake: 1000, card: 20 });
  const room = (await emit(a, 'room:enter', { stake: 1000 })).room;
  assert.equal(room.prize, 1800); ok('2 players × 10 ETB with a 10% cut → prize 18 ETB');
  await emit(a, 'card:unpick', { stake: 1000 }); await emit(b, 'card:unpick', { stake: 1000 });

  console.log('Ludo / pool / Kerenbula');
  await emit(a, 'pool:enter');
  await emit(a, 'pool:join', { stake: 10000, size: 2 });
  assert.equal(bal(7601), 90000);
  r = await save({ 'pool.stakes': '15, 30', 'pool.houseCut': 5 });
  await sleep(200);
  const pl = (await emit(b, 'pool:enter')).lobby;
  assert.deepEqual(pl.tables.map((t) => t.stake), [1500, 3000]); assert.equal(pl.tables[0].prize, 2850);
  ok('pool tables now 15 / 30 ETB, prize uses the 5% cut (2 × 15 − 5% = 28.50)');
  assert.equal(bal(7601), 100000); ok('player waiting at the removed 100 ETB pool table was refunded');
  await emit(b, 'kb:enter');
  await emit(b, 'kb:join', { stake: 1000 });
  r = await save({ 'kerenbula.enabled': false });
  await sleep(200);
  assert.equal(bal(7602), 100000); ok('switching Kerenbula off refunds the player who was waiting');
  assert.equal((await call('GET', '/api/config', null, {})).data.kerenbula, null); ok('Kerenbula disappears from the app');
  j: { const j = await emit(b, 'kb:join', { stake: 1000 }); assert.equal(j.ok, false); assert.match(j.error, /switched off/); }
  ok('…and can\'t be joined');
  await save({ 'kerenbula.enabled': true, 'crash.enabled': false });
  assert.equal((await emit(b, 'kb:join', { stake: 1000 })).ok, true); await emit(b, 'kb:leave'); ok('switched back on → works again');
  assert.equal((await emit(b, 'crash:bet', { amount: 1000 })).ok, false); ok('Aviator switched off → bets refused');
  // Bingo can be hidden too: waiting players get their money back, and it comes back when switched on
  {
    const before = bal(7602), stake = (await call('GET', '/api/config', null, {})).data.stakes.at(-1);
    assert.equal((await emit(b, 'card:pick', { stake, card: 5 })).ok, true);
    assert.equal(bal(7602), before - stake);
    await save({ bingoEnabled: false });
    assert.equal(bal(7602), before); ok('switching Bingo off refunds the player who had bought a cartela');
    assert.equal((await call('GET', '/api/config', null, {})).data.bingo, false); ok('Bingo disappears from the app');
    assert.equal((await emit(b, 'card:pick', { stake, card: 5 })).ok, false); ok('…and cartelas can\'t be bought');
    await save({ bingoEnabled: true });
    assert.equal((await emit(b, 'card:pick', { stake, card: 5 })).ok, true); await emit(b, 'card:unpick', { stake, card: 5 });
    assert.equal(bal(7602), before); ok('Bingo switched back on → works again');
    const g = (await call('GET', '/api/admin/settings')).data.groups[0];
    assert.equal(g.id, 'games'); assert.equal(g.fields.length, 7); ok('all 7 game switches are together at the top of Settings');
  }

  console.log('Wallet text & bonuses');
  await save({ paymentInfo: 'Telebirr: 0911 22 33 44 (Gedion)', minDeposit: 20, 'growth.signupBonus': 25, 'growth.referralBonus': 15, 'growth.dailyReward': 3 });
  const c = (await call('GET', '/api/config', null, {})).data;
  assert.equal(c.paymentInfo, 'Telebirr: 0911 22 33 44 (Gedion)'); assert.equal(c.minDeposit, 2000); ok('payment details and minimum deposit updated for players');
  db.upsertUser({ id: 7610, first_name: 'Newbie' });
  const nb = io(URL, { auth: { initData: sign({ id: 7610, first_name: 'Newbie' }), device: 'devNEW000010' }, transports: ['websocket'] });
  const got = await new Promise((res) => { nb.on('bonus', res); setTimeout(() => res(null), 3000); });
  assert.equal(got?.amount, 2500); assert.equal(bal(7610), 2500); ok('new player gets the 25 ETB sign-up bonus (with a message)');
  db.upsertUser({ id: 7611, first_name: 'SecondAcct' });
  const dup = await connect({ id: 7611, first_name: 'SecondAcct' }, 'devNEW000010'); await sleep(200);
  assert.equal(bal(7611), 0); ok('a second account on the same phone gets no sign-up bonus');
  const old = await connect(U[2], 'devOLD000003'); await sleep(200);
  assert.equal(bal(7603), 100000); ok('existing (old) players don\'t get it');
  r = await call('POST', '/api/withdraw', { amount: 2500, phone: '0911000000' }, { Authorization: `tma ${sign({ id: 7610, first_name: 'Newbie' })}`, 'Content-Type': 'application/json' });
  assert.equal(r.status, 400); ok('sign-up bonus can\'t be withdrawn before it\'s played');
  for (const s of [a, b, nb, dup, old]) s.close();

  console.log('Saved & recorded');
  const logged = (await call('GET', '/api/admin/log')).data.items.filter((l) => l.action === 'change_setting').map((l) => l.target);
  for (const k of ['stakes', 'houseCut', 'pool.stakes', 'kerenbula.enabled', 'growth.signupBonus']) assert.ok(logged.includes(k), k);
  ok('every change is in the admin log (who, from → to)');
  proc.kill(); await sleep(800);
  await start();
  let cfg2 = (await call('GET', '/api/config', null, {})).data;
  assert.deepEqual(cfg2.stakes, [500, 1000, 2500]); assert.equal(cfg2.houseCut, 0.1); assert.equal(cfg2.crash, null); assert.equal(cfg2.maxCards, 1);
  ok('after a restart the settings are still in force');
  await save({}, ['stakes', 'maxCards', 'crash.enabled']);
  cfg2 = (await call('GET', '/api/config', null, {})).data;
  assert.deepEqual(cfg2.stakes, [1000, 2000, 5000, 10000]); assert.equal(cfg2.maxCards, 3); assert.ok(cfg2.crash); ok('reset puts the default back');
  console.log(`\nAll ${passed} settings checks passed ✅`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-2500));
  process.exitCode = 1;
} finally {
  proc?.kill();
  setTimeout(() => process.exit(), 300);
}
