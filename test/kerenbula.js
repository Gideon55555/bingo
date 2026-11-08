// Kerenbula end-to-end: real server, two bots that pick rolls by simulating candidates, full matches.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { W, R, RELEASE_Y, MIDLINE, Sim, canRelease, dist, pinPoints } from '../shared/kerenbula.js';

const TOKEN = '123456:TEST_TOKEN';
const PORT = 3986;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-kb-'));
const URL = `http://localhost:${PORT}`;
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  KERENBULA_ROLL_SEC: '1', KERENBULA_DELAY_SCALE: '0.01', KERENBULA_STAKES: '10,20', SOCKET_RATE: '100000',
  CRASH_ENABLED: 'false', KENO_ENABLED: 'false', LUDO_ENABLED: 'false', POOL_ENABLED: 'false', DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1',
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

const colors = ['red', 'white'];
/** Try a handful of rolls with the shared physics and keep the best one for us. */
function chooseRoll(st) {
  const balls = st.balls.map((b) => ({ ...b }));
  const pins = st.pins.map((p) => ({ ...p }));
  const n = st.next;
  let best = null;
  for (let k = 0; k < 60; k++) {
    let x = 8 + Math.random() * (W - 16);
    if (!canRelease(balls, x)) continue;
    let tx, ty, power;
    if (n === 0) { tx = 20 + Math.random() * 60; ty = 80; power = 0.34 + Math.random() * 0.12; }
    else {
      const j = balls[0];
      tx = j.x + (Math.random() - 0.5) * 6; ty = j.y + (Math.random() - 0.5) * 6;
      let want = dist({ x, y: RELEASE_Y }, j);
      const kind = k % 4; // 0,1 straight · 2 bank off a side cushion · 3 hard combo at the jack
      if (kind === 2) { const left = Math.random() < 0.5; tx = left ? 2 * R - tx : 2 * (W - R) - tx; want *= 1.4; }
      power = Math.min(1, Math.sqrt(2 * 62 * want * (0.9 + Math.random() * 0.3)) / 330 + (kind === 3 ? 0.2 + Math.random() * 0.4 : 0));
    }
    const roll = { x, dx: tx - x, dy: ty - RELEASE_Y, power };
    if (roll.dy >= 0) continue;
    const res = new Sim(balls, pins, { n, ...roll }).run();
    let score;
    if (n === 0) score = res.balls[0].y < MIDLINE ? -Math.abs(res.balls[0].y - 88) - Math.abs(res.balls[0].x - 50) / 3 : -999; // jack just past the pins
    else {
      const pts = pinPoints(colors, st.me, res.knocked, { isJackRoll: false, pinPoints: st.pinPoints });
      const mine = res.balls.filter((b) => b.on && b.n !== 0 && (st.me === 0 ? b.n <= 4 : b.n >= 5)).map((b) => dist(b, res.balls[0]));
      const theirs = res.balls.filter((b) => b.on && b.n !== 0 && (st.me === 0 ? b.n >= 5 : b.n <= 4)).map((b) => dist(b, res.balls[0]));
      score = (pts.delta[st.me] - pts.delta[1 - st.me]) * 6 - Math.min(60, ...mine) + Math.min(60, ...theirs) * 0.5;
    }
    if (!best || score > best.score) best = { score, roll };
  }
  return best?.roll || { x: W / 2, dx: 0, dy: -1, power: 0.4 };
}

function bot(sock, { idle = false } = {}) {
  const stats = { rolls: 0, pinsLegal: 0, fouls: 0, badJacks: 0, frames: 0 };
  let lastEvt = null;
  const done = new Promise((resolve) => {
    sock.on('kb:state', (st) => {
      if (st.lastEvent && st.lastEvent !== lastEvt && JSON.stringify(st.lastEvent) !== JSON.stringify(lastEvt)) {
        lastEvt = st.lastEvent;
        if (st.lastEvent.type === 'pins') { stats.pinsLegal += st.lastEvent.legal; stats.fouls += st.lastEvent.fouls.reduce((s, f) => s + f.count, 0); }
        if (st.lastEvent.type === 'badJack') stats.badJacks++;
      }
      if (st.phase === 'frameEnd') stats.frames = st.frame;
      if (st.phase === 'over') return resolve({ st, stats });
      if (idle || (st.phase !== 'jack' && st.phase !== 'roll') || st.turn !== st.me) return;
      stats.rolls++;
      sock.emit('kb:roll', chooseRoll(st), (r) => { if (!r.ok && process.env.DBG) console.log('    roll rejected:', r.error); });
    });
  });
  return { done, stats };
}

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const U = ['Abel', 'Beti', 'Chala', 'Dagi'].map((n, i) => ({ id: 7001 + i, first_name: n }));
const bal = (db, i) => db.getUser(String(U[i].id)).balance;
let srv;
try {
  const db = await import('../server/db.js');
  for (const u of U) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }
  srv = startServer(); await srv.ready;
  const S = [];
  for (const u of U) {
    const s = io(URL, { auth: { initData: initDataFor(u) }, transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    await emit(s, 'kb:enter');
    S.push(s);
  }

  console.log('Kerenbula: tables');
  assert.equal((await emit(S[0], 'kb:join', { stake: 777 })).ok, false); ok('unknown table rejected');
  await emit(S[0], 'kb:join', { stake: 1000 });
  assert.equal(bal(db, 0), 99000); ok('joining charges the entry fee');
  assert.equal((await emit(S[0], 'kb:join', { stake: 2000 })).ok, false); ok('can\'t sit at two tables');
  await emit(S[0], 'kb:leave');
  assert.equal(bal(db, 0), 100000); ok('leaving before the match refunds');

  console.log('Kerenbula: cheating attempts');
  {
    const states = [null, null];
    S[0].on('kb:state', (s) => { states[0] = s; }); S[1].on('kb:state', (s) => { states[1] = s; });
    await emit(S[0], 'kb:join', { stake: 1000 }); await emit(S[1], 'kb:join', { stake: 1000 });
    for (let k = 0; k < 200 && !(states[0]?.phase === 'jack'); k++) await sleep(5);
    const t = states[0].turn === states[0].me ? 0 : 1, roller = S[t], other = S[1 - t]; // socket index of the jack roller
    assert.equal((await emit(other, 'kb:roll', { x: 50, dx: 0, dy: -1, power: 0.4 })).ok, false); ok('rolling out of turn is rejected');
    assert.equal((await emit(roller, 'kb:roll', { x: 50, dx: 0, dy: 1, power: 0.4 })).ok, false); ok('rolling backwards is rejected');
    assert.equal((await emit(roller, 'kb:roll', { x: 500, dx: 0, dy: -1, power: 0.4 })).ok, false); ok('releasing off the table is rejected');
    assert.equal((await emit(roller, 'kb:roll', { x: 50, dx: 0, dy: -1, power: 5 })).ok, false); ok('impossible power is rejected');
    // a weak jack that doesn't pass the midline → the other player rolls the jack
    assert.equal((await emit(roller, 'kb:roll', { x: 20, dx: 0, dy: -1, power: 0.1 })).ok, true);
    for (let k = 0; k < 300 && !(states[0]?.lastEvent?.type === 'badJack'); k++) await sleep(5);
    assert.equal(states[0].lastEvent.type, 'badJack'); assert.equal(states[1 - t].turn, states[1 - t].me); assert.equal(states[0].phase, 'jack'); ok('jack short of the midline → opponent rolls the jack');
    S[0].removeAllListeners('kb:state'); S[1].removeAllListeners('kb:state');
    const before = bal(db, 1 - t);
    await emit(roller, 'kb:leave');
    for (let k = 0; k < 200 && bal(db, 1 - t) === before; k++) await sleep(5);
    assert.equal(bal(db, 1 - t), before + 1800); ok('resigning hands the opponent the prize (18 of 20)');
  }

  console.log('Kerenbula: full matches between two bots');
  let totals = { rolls: 0, legal: 0, fouls: 0, frames: 0 }, reached = 0;
  for (let m = 0; m < 3; m++) {
    for (const s of S) s.removeAllListeners('kb:state');
    const b0 = bot(S[0]), b1 = bot(S[1]);
    const before0 = bal(db, 0), before1 = bal(db, 1);
    await emit(S[0], 'kb:join', { stake: 1000 });
    await emit(S[1], 'kb:join', { stake: 1000 });
    const r = await Promise.race([b0.done, sleep(240000).then(() => null)]);
    assert.ok(r, 'match finished');
    await b1.done;
    const st = r.st;
    const w = st.result.winnerName === 'Abel' ? 0 : 1;
    console.log(`    match ${m + 1}: ${st.result.winnerName} won ${st.players.map((p) => p.score).join('–')} in ${st.frame} frames (${st.result.how}); pins by blue ball: ${b0.stats.pinsLegal}, pin fouls: ${b0.stats.fouls}, short jacks: ${b0.stats.badJacks}`);
    assert.equal(bal(db, w), (w === 0 ? before0 : before1) - 1000 + 1800);
    assert.equal(bal(db, 1 - w), (w === 0 ? before1 : before0) - 1000);
    const ws = st.players[st.result.winner].score, ls = st.players[1 - st.result.winner].score;
    assert.ok(ws > ls, 'winner has more points');
    assert.ok(ws >= st.target || st.frame >= st.maxFrames, 'ended by target or frame cap');
    if (ws >= st.target) reached++;
    totals.rolls += b0.stats.rolls + b1.stats.rolls; totals.legal += b0.stats.pinsLegal; totals.fouls += b0.stats.fouls; totals.frames += st.frame;
  }
  ok(`3 complete matches played (${totals.frames} frames, ${totals.rolls} rolls); winner paid 18 ETB each time`);
  ok(`pins counted: ${totals.legal} by the blue ball (+4), ${totals.fouls} direct fouls (−4); ${reached}/3 reached the target`);
  const rec = db.listKerenbulaGames(1)[0];
  assert.equal(rec.pot, 2000); assert.equal(rec.house, 200); ok('match recorded (pot 20, house 2)');
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM rounds WHERE game='kerenbula' AND status='open'").get().n, 0); ok('money rounds closed');

  console.log('Kerenbula: two matches at once + idle player');
  {
    for (const s of S) s.removeAllListeners('kb:state');
    const a = bot(S[0]), b = bot(S[1]), c = bot(S[2]), dIdle = bot(S[3], { idle: true });
    await emit(S[0], 'kb:join', { stake: 1000 }); await emit(S[1], 'kb:join', { stake: 1000 });
    await emit(S[2], 'kb:join', { stake: 2000 }); await emit(S[3], 'kb:join', { stake: 2000 });
    const [r1, r2] = await Promise.all([a.done, c.done]);
    assert.ok(r1.st.id !== r2.st.id); ok('two matches ran side by side');
    assert.equal(r2.st.result.winnerName, 'Chala'); assert.match(r2.st.result.how, /out of time/); ok('a player who never rolls forfeits after 3 missed turns');
    await Promise.all([b.done, dIdle.done]);
  }
  console.log(`\nAll ${passed} Kerenbula end-to-end checks passed ✅`);
} catch (e) {
  console.error(e);
  if (srv) console.error(srv.log().slice(-3000));
  process.exitCode = 1;
} finally {
  srv?.proc.kill();
  setTimeout(() => process.exit(), 300);
}
