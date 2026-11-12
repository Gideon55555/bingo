// Ludo end-to-end: real server, signed Telegram users, bots that play complete games.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:TEST_TOKEN';
const PORT = 3987;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-ludo-'));
const URL = `http://localhost:${PORT}`;
const env = {
  ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  LUDO_TURN_SEC: '1', LUDO_DELAY_SCALE: '0.02', LUDO_STEP_MS: '2', LUDO_STAKES: '10,20', LUDO_HOUSE_CUT: '0.1',
  CRASH_ENABLED: 'false', KENO_ENABLED: 'false', SOCKET_RATE: '100000', DEV_MODE: 'false', NODE_ENV: '', ADMIN_IDS: '5001', ADMIN_PASSWORD: 'admin-password-1',
};
Object.assign(process.env, env);
const initDataFor = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
};
const emit = (s, ev, p = {}) => new Promise((res) => s.emit(ev, p, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function startServer() {
  const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
  return { proc, ready, log: () => out };
}

/** A bot plays whenever it's its turn (unless `idle`), and resolves with the final state. */
function bot(sock, { idle = false } = {}) {
  const rolls = [];
  let last = null;
  const done = new Promise((resolve) => {
    sock.on('ludo:roll', ({ value }) => rolls.push(value));
    sock.on('ludo:state', (st) => {
      last = st;
      if (st.phase === 'over') return resolve(st);
      if (idle || st.turnSeat !== st.mySeat) return;
      if (st.phase === 'roll') sock.emit('ludo:roll', {}, (r) => { if (process.env.DBG && !r.ok) console.log('    roll rejected:', r.error, st.mySeat); });
      if (st.phase === 'move' && st.legal.length) sock.emit('ludo:move', { token: st.legal[Math.floor(Math.random() * st.legal.length)] }, () => {});
    });
  });
  return { done, rolls, last: () => last };
}
function diceFromSeed(seed, n) {
  const out = []; let i = 0;
  while (out.length < n) {
    const bytes = crypto.createHmac('sha256', seed).update(`ludo:${i++}`).digest();
    for (const b of bytes) if (b < 252) { out.push(1 + (b % 6)); break; }
  }
  return out;
}

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const names = ['Abel', 'Bethi', 'Chala', 'Dawit', 'Eden', 'Fikru'];
const U = names.map((n, i) => ({ id: 5001 + i, first_name: n }));
let srv;
const connect = async (u) => {
  const s = io(URL, { auth: { initData: initDataFor(u) }, transports: ['websocket'] });
  await new Promise((r) => s.on('connect', r));
  await emit(s, 'ludo:enter');
  return s;
};
const bal = (db, i) => db.getUser(String(U[i].id)).balance;

try {
  const db = await import('../server/db.js');
  for (const u of U) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }
  srv = startServer(); await srv.ready;
  let S = await Promise.all(U.map(connect));

  console.log('Ludo: tables');
  assert.equal((await emit(S[0], 'ludo:join', { stake: 999, size: 2 })).ok, false); ok('unknown table rejected');
  const j = await emit(S[0], 'ludo:join', { stake: 1000, size: 2 });
  assert.equal(j.ok, true); assert.equal(j.me.queue.waiting, 1); assert.equal(bal(db, 0), 99000); ok('joining a table charges the entry fee');
  assert.equal((await emit(S[0], 'ludo:join', { stake: 2000, size: 4 })).ok, false); ok('only one table at a time');
  await emit(S[0], 'ludo:leave');
  assert.equal(bal(db, 0), 100000); ok('leaving before the game starts refunds');

  console.log('Ludo: full 2-player game');
  const b0 = bot(S[0]), b1 = bot(S[1]);
  await emit(S[0], 'ludo:join', { stake: 1000, size: 2 });
  await emit(S[1], 'ludo:join', { stake: 1000, size: 2 });
  const end2 = await Promise.race([Promise.all([b0.done, b1.done]), sleep(120000).then(() => null)]);
  assert.ok(end2, 'game finished'); const st2 = end2[0];
  const w = st2.result.winnerName === 'Abel' ? 0 : 1, l = 1 - w;
  console.log(`    (${st2.result.winnerName} won after ${b0.rolls.length} rolls)`);
  assert.equal(st2.prize, 1800); ok('prize = 2 × 10 − 10% = 18 ETB');
  assert.equal(bal(db, w), 100000 - 1000 + 1800); assert.equal(bal(db, l), 99000); ok('winner paid, loser charged');
  const winnerTokens = st2.players.find((p) => p.name === st2.result.winnerName).tokens;
  assert.ok(winnerTokens.every((t) => t === 56)); ok('winner has every token home');
  assert.equal(crypto.createHash('sha256').update(st2.seed).digest('hex'), st2.hash); ok('revealed seed matches the hash shown at the start');
  assert.deepEqual(b0.rolls, diceFromSeed(st2.seed, b0.rolls.length)); ok(`all ${b0.rolls.length} dice rolls can be recomputed from the seed`);
  const rec = db.listLudoGames(1)[0];
  assert.equal(rec.pot, 2000); assert.equal(rec.house, 200); assert.equal(rec.winner_id, String(U[w].id)); ok('game recorded (pot 20, house 2)');
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM rounds WHERE game='ludo' AND status='open'").get().n, 0); ok('money round closed');

  console.log('Ludo: full 4-player game');
  const bots4 = [2, 3, 4, 5].map((i) => bot(S[i]));
  for (const i of [2, 3, 4, 5]) await emit(S[i], 'ludo:join', { stake: 2000, size: 4 });
  const end4 = await Promise.race([Promise.all(bots4.map((b) => b.done)), sleep(240000).then(() => null)]);
  assert.ok(end4, '4-player game finished');
  const st4 = end4[0];
  assert.equal(st4.players.length, 4); assert.deepEqual(st4.players.map((p) => p.color), ['red', 'green', 'yellow', 'blue']); ok('4 players seated in four colours');
  const wi = names.indexOf(st4.result.winnerName);
  assert.equal(bal(db, wi), 100000 - 2000 + 7200); ok(`${st4.result.winnerName} won 72 ETB (4 × 20 − 10%)`);
  assert.equal([2, 3, 4, 5].filter((i) => i !== wi).every((i) => bal(db, i) === 98000), true); ok('other three players charged');

  console.log('Ludo: timeouts, resign, pause, restart');
  // Player who never plays: auto-play kicks in, then forfeits after 3 missed turns
  for (const s of S) { s.removeAllListeners('ludo:state'); s.removeAllListeners('ludo:roll'); }
  const active = bot(S[0]); const afk = bot(S[1], { idle: true });
  const a0 = bal(db, 0), a1 = bal(db, 1);
  await emit(S[0], 'ludo:join', { stake: 1000, size: 2 });
  await emit(S[1], 'ludo:join', { stake: 1000, size: 2 });
  const endAfk = await Promise.race([active.done, sleep(60000).then(() => null)]);
  assert.ok(endAfk); assert.equal(endAfk.result.winnerName, 'Abel'); assert.match(endAfk.result.how, /missed/); ok('inactive player forfeits after 3 missed turns');
  assert.equal(bal(db, 0), a0 + 800); assert.equal(bal(db, 1), a1 - 1000); ok('active player wins the pot');

  // Resign
  for (const s of [S[2], S[3]]) s.removeAllListeners('ludo:state');
  const c0 = bal(db, 2);
  await emit(S[2], 'ludo:join', { stake: 1000, size: 2 });
  await emit(S[3], 'ludo:join', { stake: 1000, size: 2 });
  await sleep(100);
  const over = new Promise((r) => S[2].on('ludo:state', (st) => st.phase === 'over' && r(st)));
  await emit(S[3], 'ludo:leave'); // leaving during a game = resign
  const rs = await over;
  assert.equal(rs.result.winnerName, 'Chala'); assert.equal(bal(db, 2), c0 + 800); ok('leaving mid-game counts as resigning; opponent wins');

  // Pause refunds waiting players
  const e0 = bal(db, 4);
  await emit(S[4], 'ludo:join', { stake: 2000, size: 4 });
  assert.equal(bal(db, 4), e0 - 2000);
  await fetch(URL + '/api/admin/pause', { method: 'POST', headers: { 'x-admin-key': 'admin-password-1' } });
  await sleep(150);
  assert.equal(bal(db, 4), e0); ok('pause refunds players waiting at tables');
  assert.equal((await emit(S[4], 'ludo:join', { stake: 2000, size: 4 })).ok, false); ok('no joining while paused');
  await fetch(URL + '/api/admin/resume', { method: 'POST', headers: { 'x-admin-key': 'admin-password-1' } });

  // Server crash mid-game refunds both players
  for (const s of S) s.removeAllListeners('ludo:state');
  const f0 = bal(db, 4), f1 = bal(db, 5);
  await emit(S[4], 'ludo:join', { stake: 2000, size: 2 });
  await emit(S[5], 'ludo:join', { stake: 2000, size: 2 });
  await sleep(100);
  assert.equal(bal(db, 4), f0 - 2000);
  srv.proc.kill('SIGKILL'); await new Promise((r) => srv.proc.on('exit', r));
  S.forEach((s) => s.close());
  srv = startServer(); await srv.ready;
  assert.equal(bal(db, 4), f0); assert.equal(bal(db, 5), f1); ok('server crash mid-game → both players refunded on restart');

  const stats = await (await fetch(URL + '/api/admin/stats', { headers: { 'x-admin-key': 'admin-password-1' } })).json();
  assert.equal(stats.allTime.ludoGames, 4); assert.equal(stats.allTime.ludoEarnings, 200 + 800 + 200 + 200); ok('admin stats count Ludo games and earnings');

  console.log(`\nAll ${passed} Ludo checks passed ✅`);
} catch (e) {
  console.error('\n❌ FAILED:', e.message);
  if (srv) console.error(srv.log().slice(-1500));
  process.exitCode = 1;
} finally {
  srv?.proc.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(), 300);
}
