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
const BACKUPS = path.join(os.tmpdir(), `bingo-test-backups-${Date.now()}`);
const URL = `http://localhost:${PORT}`;
const env = {
  ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: DB,
  BACKUP_DIR: BACKUPS, COUNTDOWN_SEC: '2', CALL_INTERVAL_MS: '40', RESULT_SHOW_SEC: '1', HOUSE_CUT: '0.2',
  MIN_DEPOSIT: '10', MIN_WITHDRAW: '50', DEV_MODE: 'false',
  ADMIN_IDS: '1001', ADMIN_PASSWORD: 'super-secret-pw',
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

const call = async (method, p, init, body, extra = {}) => {
  const r = await fetch(URL + p, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `tma ${init}`, ...extra },
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
    const r = await call('POST', '/api/deposit', init[k], { amount: 10000, reference: `REF${k}123` });
    assert.equal(r.status, 200);
    approveDeposit(r.body.id);
  }
  await call('GET', '/api/me', init.D);
  assert.equal(getUser(1001).balance, 10000); ok('approved deposit credits balance');
  assert.equal((await call('POST', '/api/deposit', init.D, { amount: 5000, reference: 'refa123' })).status, 400);
  ok('duplicate transaction reference rejected');
  assert.equal((await call('POST', '/api/deposit', init.D, { amount: 500, reference: 'XYZ999' })).status, 400);
  ok('below minimum deposit rejected');
  assert.equal(approveDeposit(1), null); ok('double-approve is a no-op');
  assert.equal(getUser(1001).balance, 10000);

  console.log('Lobby & picking');
  const sock = {};
  for (const k of Object.keys(users)) {
    sock[k] = io(URL, { auth: { initData: init[k] }, transports: ['websocket'] });
    await new Promise((r) => sock[k].on('connect', r));
    await emit(sock[k], 'room:enter', { stake: 1000 });
  }
  assert.equal((await emit(sock.A, 'card:pick', { stake: 1000, card: 1 })).ok, true);
  assert.equal(getUser(1001).balance, 9000); ok('picking a card charges the stake');
  const taken = await emit(sock.B, 'card:pick', { stake: 1000, card: 1 });
  assert.equal(taken.ok, false); ok(`taken card rejected ("${taken.error}")`);
  const broke = await emit(sock.D, 'card:pick', { stake: 1000, card: 9 });
  assert.equal(broke.ok, false); ok('zero-balance player cannot join');
  await emit(sock.C, 'card:pick', { stake: 1000, card: 3 });
  await emit(sock.C, 'card:unpick', { stake: 1000 });
  assert.equal(getUser(1003).balance, 10000); ok('leaving before start refunds');
  // Multiple cards: each costs a stake, max 3, removing one refunds it
  await emit(sock.C, 'card:pick', { stake: 1000, card: 11 });
  await emit(sock.C, 'card:pick', { stake: 1000, card: 12 });
  await emit(sock.C, 'card:pick', { stake: 1000, card: 13 });
  assert.equal(getUser(1003).balance, 7000); ok('3 cards cost 3 stakes');
  const fourth = await emit(sock.C, 'card:pick', { stake: 1000, card: 14 });
  assert.equal(fourth.ok, false); assert.match(fourth.error, /up to 3 cards/); ok('a 4th card is refused');
  await emit(sock.C, 'card:unpick', { stake: 1000, card: 12 });
  assert.equal(getUser(1003).balance, 8000); ok('removing one card refunds just that card');
  const snap = await emit(sock.C, 'room:enter', { stake: 1000 });
  assert.deepEqual(snap.room.myCards, [11, 13]); assert.ok(snap.room.takenCards.includes(13) && !snap.room.takenCards.includes(12)); ok('player sees their remaining cards; the removed one is free again');
  await emit(sock.C, 'card:unpick', { stake: 1000 });
  assert.equal(getUser(1003).balance, 10000); ok('leaving refunds every card');
  await emit(sock.A, 'card:unpick', { stake: 1000, card: 1 });
  await emit(sock.A, 'card:pick', { stake: 1000, card: 5 });
  assert.equal(getUser(1001).balance, 9000); ok('switching = remove + pick, costs nothing extra');

  // Pick B's card so that B is guaranteed to differ from A; then start
  await emit(sock.B, 'card:pick', { stake: 1000, card: 2 });

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
    if (called.size === 1) falseClaim = await emit(sock.A, 'bingo', { stake: 1000 }); // A cheats
    if (!bClaimed && findWin(2, called)) { bClaimed = true; await emit(sock.B, 'bingo', { stake: 1000 }); }
  });
  await Promise.race([done, sleep(15000)]);
  assert.ok(finalRoom, 'game finished');
  assert.equal(falseClaim.valid, false); ok('false BINGO → disqualified');
  assert.deepEqual(finalRoom.result.winners.map((w) => w.userId), ['1002']); ok(`B won after ${called.size} calls`);
  assert.equal(finalRoom.result.amountEach, 1600); ok('prize = pot 20 − 20% house = 16');
  assert.equal(getUser(1002).balance, 10600); ok('winner credited (100 − 10 + 16)');
  assert.equal(getUser(1001).balance, 9000); ok('loser charged');
  const g = db.prepare('SELECT * FROM games').get();
  assert.equal(g.house, 400); ok('game recorded with house cut 4');

  await sleep(1300);
  const r = await emit(sock.A, 'room:enter', { stake: 1000 });
  assert.equal(r.room.state, 'waiting'); ok('room resets for next round');

  console.log('Withdrawals');
  const w = await call('POST', '/api/withdraw', init.B, { amount: 5000, phone: '0911223344' });
  assert.equal(w.status, 200);
  assert.equal(getUser(1002).balance, 5600); ok('withdrawal holds funds');
  assert.equal((await call('POST', '/api/withdraw', init.A, { amount: 50000, phone: '0911223344' })).status, 400);
  ok('cannot withdraw more than balance');
  rejectWithdrawal(w.body.id);
  assert.equal(getUser(1002).balance, 10600); ok('rejected withdrawal refunds');

  console.log('Admin');
  const PW = { 'x-admin-key': 'super-secret-pw' };
  const A = (method, p, body) => call(method, '/api/admin' + p, '', body, PW);
  assert.equal((await call('GET', '/api/admin/stats', '')).status, 401); ok('admin API without auth → 401');
  assert.equal((await call('GET', '/api/admin/stats', '', null, { 'x-admin-key': 'wrong-password' })).status, 401); ok('wrong admin password → 401');
  assert.equal((await call('GET', '/api/admin/stats', init.B)).status, 401); ok('non-admin Telegram user → 401');
  assert.equal((await call('GET', '/api/admin/stats', init.A)).status, 200); ok('admin Telegram user (in ADMIN_IDS) → 200');
  assert.equal((await call('GET', '/api/me', init.A)).body.user.isAdmin, true); ok('/api/me reports isAdmin');
  const st = (await A('GET', '/stats')).body;
  assert.equal(st.allTime.games, 1); assert.equal(st.allTime.houseEarnings, 400); assert.equal(st.allTime.deposits, 30000);
  assert.equal(st.rooms.length, 4); ok('stats: games, house earnings, deposits, rooms');

  const dep = await call('POST', '/api/deposit', init.D, { amount: 5000, reference: 'WEBDEP777' });
  assert.equal((await A('GET', '/pending')).body.items.length, 1); ok('pending list shows new deposit');
  assert.equal((await A('POST', '/decide', { kind: 'deposit', id: dep.body.id, approve: true })).status, 200);
  assert.equal(getUser(1004).balance, 5000); ok('web approve credits player');
  assert.equal((await A('POST', '/decide', { kind: 'deposit', id: dep.body.id, approve: false })).status, 400); ok('cannot decide twice');

  assert.equal((await A('POST', '/adjust', { userId: '1004', amount: 2500, note: 'bonus' })).body.balance, 7500); ok('add balance');
  assert.equal((await A('POST', '/adjust', { userId: '1004', amount: -10000 })).status, 400); ok('cannot subtract below zero');
  assert.equal((await A('GET', '/transactions?type=adjust')).body.items.length, 1); ok('transaction filter');
  assert.equal((await A('GET', '/users?search=Bethel')).body.total, 1); ok('player search');
  const detail = (await A('GET', '/users/1002')).body;
  assert.equal(detail.user.games_won, 1); assert.ok(detail.history.length > 0); ok('player detail with history');
  assert.equal((await A('GET', '/games')).body.items[0].winners[0].first_name, 'Bethel'); ok('games list with winner names');

  await emit(sock.D, 'room:enter', { stake: 2000 });
  await emit(sock.D, 'card:pick', { stake: 2000, card: 4 });
  assert.equal(getUser(1004).balance, 5500);
  assert.equal((await A('POST', '/pause')).body.refunded, 1);
  assert.equal(getUser(1004).balance, 7500); ok('pause refunds waiting players');
  assert.equal((await emit(sock.D, 'card:pick', { stake: 2000, card: 4 })).ok, false); ok('cannot join while paused');
  await A('POST', '/resume');
  assert.equal((await emit(sock.D, 'card:pick', { stake: 2000, card: 4 })).ok, true); ok('resume reopens rooms');
  await emit(sock.D, 'card:unpick', { stake: 2000 });

  console.log(`\nAll ${passed} checks passed ✅`);
  for (const s of Object.values(sock)) s.close();
} catch (e) {
  console.error('\n❌ FAILED:', e.message);
  process.exitCode = 1;
} finally {
  server.kill();
  fs.rmSync(DB, { force: true });
  fs.rmSync(BACKUPS, { recursive: true, force: true });
  setTimeout(() => process.exit(), 200);
}
