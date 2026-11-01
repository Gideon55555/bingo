// End-to-end simulation: starts the server, creates players with *real signed*
// Telegram initData, deposits, plays a full game, checks balances and payouts.
// Run: npm test
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:TEST_TOKEN';
const PORT = 3999;
const DB = path.join(os.tmpdir(), `bingo-test-${Date.now()}.db`);
const URL = `http://localhost:${PORT}`;
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: DB,
  COUNTDOWN_SEC: '2', CALL_INTERVAL_MS: '40', RESULT_SHOW_SEC: '1', HOUSE_CUT: '0.2',
  MIN_DEPOSIT: '10', MIN_WITHDRAW: '50', DEV_MODE: 'false',
};
Object.assign(process.env, env); // so the imported db module uses the same DB

function initDataFor(user, token = TOKEN) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAH' + user.id,
    user: JSON.stringify(user),
  });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

const call = async (method, p, init, body) => {
  const r = await fetch(URL + p, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `tma ${init}` },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));

const server = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));

const { approveDeposit, rejectWithdrawal, getUser, db } = await import('../server/db.js');
const { findWin } = await import('../server/bingo.js');

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

try {
  const users = {
    A: { id: 1001, first_name: 'Abebe' },
    B: { id: 1002, first_name: 'Bethel' },
    C: { id: 1003, first_name: 'Chala' },
    D: { id: 1004, first_name: 'Dawit' },
  };
  const init = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, initDataFor(u)]));

  console.log('Auth');
  assert.equal((await call('GET', '/api/me', '')).status, 401); ok('no initData → 401');
  assert.equal((await call('GET', '/api/me', initDataFor(users.A, '999:WRONG'))).status, 401); ok('forged signature → 401');
  const tampered = init.A.replace('Abebe', 'Hacker');
  assert.equal((await call('GET', '/api/me', tampered)).status, 401); ok('tampered user → 401');
  assert.equal((await call('GET', '/api/me', init.A)).body.user.first_name, 'Abebe'); ok('valid initData → user');

  console.log('Deposits');
  for (const k of ['A', 'B', 'C']) {
    const r = await call('POST', '/api/deposit', init[k], { amount: 100, reference: `REF${k}123` });
    assert.equal(r.status, 200);
    approveDeposit(r.body.id);
  }
  await call('GET', '/api/me', init.D);
  assert.equal(getUser(1001).balance, 100); ok('approved deposit credits balance');
  assert.equal((await call('POST', '/api/deposit', init.D, { amount: 50, reference: 'refa123' })).status, 400);
  ok('duplicate transaction reference rejected');
  assert.equal((await call('POST', '/api/deposit', init.D, { amount: 5, reference: 'XYZ999' })).status, 400);
  ok('below minimum deposit rejected');
  assert.equal(approveDeposit(1), null); ok('double-approve is a no-op');
  assert.equal(getUser(1001).balance, 100);

  console.log('Lobby & picking');
  const sock = {};
  for (const k of Object.keys(users)) {
    sock[k] = io(URL, { auth: { initData: init[k] }, transports: ['websocket'] });
    await new Promise((r) => sock[k].on('connect', r));
    await emit(sock[k], 'room:enter', { stake: 10 });
  }
  assert.equal((await emit(sock.A, 'card:pick', { stake: 10, card: 1 })).ok, true);
  assert.equal(getUser(1001).balance, 90); ok('picking a card charges the stake');
  const taken = await emit(sock.B, 'card:pick', { stake: 10, card: 1 });
  assert.equal(taken.ok, false); ok(`taken card rejected ("${taken.error}")`);
  const broke = await emit(sock.D, 'card:pick', { stake: 10, card: 9 });
  assert.equal(broke.ok, false); ok('zero-balance player cannot join');
  await emit(sock.C, 'card:pick', { stake: 10, card: 3 });
  await emit(sock.C, 'card:unpick', { stake: 10 });
  assert.equal(getUser(1003).balance, 100); ok('leaving before start refunds');
  await emit(sock.A, 'card:pick', { stake: 10, card: 5 });
  assert.equal(getUser(1001).balance, 90); ok('switching card is free');

  // Pick B's card so that B is guaranteed to differ from A; then start
  await emit(sock.B, 'card:pick', { stake: 10, card: 2 });

  console.log('Gameplay');
  const called = new Set();
  let finalRoom = null;
  let falseClaim = null;
  let bClaimed = false;
  const done = new Promise((resolve) => {
    sock.B.on('room', (r) => { if (r.state === 'finished') { finalRoom = r; resolve(); } });
  });
  sock.B.on('call', async ({ number }) => {
    called.add(number);
    if (called.size === 1) falseClaim = await emit(sock.A, 'bingo', { stake: 10 }); // A cheats
    if (!bClaimed && findWin(2, called)) { bClaimed = true; await emit(sock.B, 'bingo', { stake: 10 }); }
  });
  await Promise.race([done, sleep(15000)]);
  assert.ok(finalRoom, 'game finished');
  assert.equal(falseClaim.valid, false); ok('false BINGO → disqualified');
  assert.deepEqual(finalRoom.result.winners.map((w) => w.userId), ['1002']); ok(`B won after ${called.size} calls`);
  assert.equal(finalRoom.result.amountEach, 16); ok('prize = pot 20 − 20% house = 16');
  assert.equal(getUser(1002).balance, 106); ok('winner credited (100 − 10 + 16)');
  assert.equal(getUser(1001).balance, 90); ok('loser charged');
  const g = db.prepare('SELECT * FROM games').get();
  assert.equal(g.house, 4); ok('game recorded with house cut 4');

  await sleep(1300);
  const r = await emit(sock.A, 'room:enter', { stake: 10 });
  assert.equal(r.room.state, 'waiting'); ok('room resets for next round');

  console.log('Withdrawals');
  const w = await call('POST', '/api/withdraw', init.B, { amount: 50, phone: '0911223344' });
  assert.equal(w.status, 200);
  assert.equal(getUser(1002).balance, 56); ok('withdrawal holds funds');
  assert.equal((await call('POST', '/api/withdraw', init.A, { amount: 500, phone: '0911223344' })).status, 400);
  ok('cannot withdraw more than balance');
  rejectWithdrawal(w.body.id);
  assert.equal(getUser(1002).balance, 106); ok('rejected withdrawal refunds');

  console.log(`\nAll ${passed} checks passed ✅`);
  for (const s of Object.values(sock)) s.close();
} catch (e) {
  console.error('\n❌ FAILED:', e.message);
  process.exitCode = 1;
} finally {
  server.kill();
  fs.rmSync(DB, { force: true });
  setTimeout(() => process.exit(), 200);
}
