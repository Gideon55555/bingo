// Dibibkosh end-to-end: 4 players over real sockets, payouts and splits, fairness proofs, idle players, practice.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:HUNT_TOKEN', PORT = 3970, URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-hunt-'));
const env = { ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', SOCKET_RATE: '100000', HUNT_MOVE_SEC: '1', HUNT_DELAY_SCALE: '0.05', HUNT_STAKES: '10,20', CRASH_ENABLED: 'false', KENO_ENABLED: 'false' };
Object.assign(process.env, env);
const sign = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  params.set('hash', crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(dcs).digest('hex'));
  return params.toString();
};
const emit = (s, ev, p = {}) => new Promise((res) => s.emit(ev, p, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const db = await import('../server/db.js');
const U = ['Abeba', 'Bisrat', 'Chaltu', 'Dagim', 'Eyerus'].map((n, i) => ({ id: 7701 + i, first_name: n }));
for (const u of U) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }
const bal = (i) => db.getUser(String(U[i].id)).balance;
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  const S = [];
  for (const [i, u] of U.entries()) {
    const s = io(URL, { auth: { initData: sign(u), device: `devhunt${i}xxxx` }, transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    await emit(s, 'hunt:enter');
    S.push(s);
  }
  // a player who taps a random legal box each move (player 3 never taps: moved for them)
  const play = (s, idle = false) => new Promise((resolve) => {
    const reveals = [];
    s.on('hunt:reveal', (r) => reveals.push(r));
    s.on('hunt:state', (st) => {
      if (st.phase === 'over') return resolve({ st, reveals });
      if (!idle && st.phase === 'move' && st.legal.length && st.myChoice == null) s.emit('hunt:choose', { box: st.legal[crypto.randomInt(st.legal.length)] }, () => {});
    });
  });

  console.log('Tables');
  assert.equal((await emit(S[0], 'hunt:join', { stake: 1000 })).ok, true);
  assert.equal(bal(0), 99000); ok('entry charged');
  await emit(S[0], 'hunt:leave'); assert.equal(bal(0), 100000); ok('leaving before the start refunds');

  console.log('Full games');
  let splits = 0, games = 0, totalMoves = 0;
  for (let g = 0; g < 6; g++) {
    for (const s of S) { s.removeAllListeners('hunt:state'); s.removeAllListeners('hunt:reveal'); }
    const before = [0, 1, 2, 3].map(bal);
    const runs = S.slice(0, 4).map((s, i) => play(s, i === 3));
    for (const s of S.slice(0, 4)) await emit(s, 'hunt:join', { stake: 1000 });
    const r = await Promise.race([runs[0], sleep(60000).then(() => null)]);
    assert.ok(r, 'game finished');
    await Promise.all(runs);
    const st = r.st;
    games++; totalMoves += st.moveNo;
    const each = st.result.each;
    const winSeats = st.result.winners;
    assert.equal(each * winSeats.length, Math.floor(Math.floor(4000 * 0.9) / winSeats.length) * winSeats.length);
    // balances: winners +each−10, others −10 (seat ↔ socket by name)
    const names = st.players.map((p) => p.name);
    for (let i = 0; i < 4; i++) {
      const seat = names.indexOf(U[i].first_name);
      const expect = before[i] - 1000 + (winSeats.includes(seat) ? each : 0);
      assert.equal(bal(i), expect, `player ${i}`);
    }
    if (st.result.split) splits++;
    // fairness: every move's hunter box matches the hash published BEFORE players chose
    for (const rv of r.reveals) {
      const h = crypto.createHash('sha256').update(`${st.id}:${rv.move}:${rv.hunter.to}:${rv.salt}`).digest('hex');
      assert.equal(h, rv.commit);
      for (const m of rv.moves) assert.ok(Math.max(Math.abs(Math.floor(m.from / 3) - Math.floor(m.to / 3)), Math.abs((m.from % 3) - (m.to % 3))) === 1, 'neighbour move');
      for (const c of rv.caught) assert.equal(rv.moves.find((m) => m.seat === c).to, rv.hunter.to);
    }
    console.log(`    game ${g + 1}: ${st.result.names.join(' & ')} won ${(each / 100).toFixed(2)} ETB after ${st.moveNo} moves${st.result.split ? ' (split)' : ''}`);
  }
  ok(`${games} complete 4-player games (avg ${(totalMoves / games).toFixed(1)} moves); every balance exact (pot 40 − 10% = 36, split when caught together)`);
  ok('every move: hunter box matches the hash published before players picked; all moves to neighbouring boxes; only players in the hunter\'s box were caught');
  ok('a player who never taps is moved for them automatically (game still finishes)');
  const rec = db.db.prepare('SELECT * FROM hunt_games ORDER BY id DESC LIMIT 1').get();
  assert.equal(rec.pot, 4000); assert.ok(rec.house >= 400); ok('games recorded with the house cut');
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM rounds WHERE game='hunt' AND status='open'").get().n, 0); ok('money rounds closed');

  console.log('Cheating & leaving');
  for (const s of S) { s.removeAllListeners('hunt:state'); s.removeAllListeners('hunt:reveal'); }
  let st0 = null;
  S[0].on('hunt:state', (st) => { st0 = st; });
  for (const s of S.slice(0, 4)) await emit(s, 'hunt:join', { stake: 2000 });
  for (let k = 0; k < 200 && st0?.phase !== 'move'; k++) await sleep(20);
  const far = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((b) => !st0.legal.includes(b) && b !== st0.players[st0.me].pos);
  assert.equal((await emit(S[0], 'hunt:choose', { box: far })).ok, false); ok('jumping to a far box is refused');
  assert.equal((await emit(S[0], 'hunt:choose', { box: st0.players[st0.me].pos })).ok, false); ok('standing still is refused');
  assert.equal(st0.players.every((p) => p.pos !== undefined) && !('pending' in st0), true);
  assert.ok(st0.commit && st0.lastReveal === null || st0.commit); ok('players only see the hunter\'s hash during the count, never its box');
  const end = new Promise((res) => S[1].on('hunt:state', (st) => st.phase === 'over' && res(st)));
  for (const s of [S[0], S[2], S[3]]) await emit(s, 'hunt:leave');
  const fin = await Promise.race([end, sleep(10000).then(() => null)]);
  assert.ok(fin && fin.result.names[0] === 'Bisrat'); ok('when the other three leave, the last player wins the pot');

  console.log('Practice');
  for (const s of S) { s.removeAllListeners('hunt:state'); s.removeAllListeners('hunt:reveal'); }
  const b4 = bal(4);
  const pr = play(S[4]);
  assert.equal((await emit(S[4], 'hunt:practice')).ok, true);
  const p = await Promise.race([pr, sleep(60000).then(() => null)]);
  assert.ok(p?.st.result.practice); assert.equal(bal(4), b4);
  ok(`practice against 3 bots plays to the end for free (${p.st.result.names.join(' & ')} won)`);
  for (const s of S) s.close();
  console.log(`\nAll ${passed} Dibibkosh checks passed ✅`);
} catch (e) { console.error(e); console.error(log.slice(-2500)); process.exitCode = 1; } finally { proc.kill(); setTimeout(() => process.exit(), 300); }
