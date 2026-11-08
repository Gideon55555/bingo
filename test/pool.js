// 8-ball pool end-to-end: real server, two bots that aim with ghost-ball geometry and play full matches.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { R, POCKETS, SOLIDS, STRIPES, canPlaceCue, Sim } from '../shared/pool.js';

const TOKEN = '123456:TEST_TOKEN';
const PORT = 3984;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-pool-'));
const URL = `http://localhost:${PORT}`;
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  POOL_SHOT_SEC: '1', POOL_DELAY_SCALE: '0.01', POOL_STAKES: '10,20', SOCKET_RATE: '100000',
  CRASH_ENABLED: 'false', KENO_ENABLED: 'false', LUDO_ENABLED: 'false', DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1',
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

/** Pick a shot like a decent amateur: best ghost-ball shot at one of our balls into any pocket. */
function chooseShot(st) {
  const me = st.players[st.me];
  const balls = st.balls.map((b) => ({ ...b }));
  const targets = balls.filter((b) => !b.in && b.n !== 0 && (me.group
    ? (me.left > 0 ? (me.group === 'solids' ? SOLIDS : STRIPES).includes(b.n) : b.n === 8)
    : b.n !== 8));
  let cue = balls[0];
  let placed = null;
  if (st.ballInHand) {
    if (st.breakShot) placed = { x: 50, y: 170 };
    else {
      // put the cue ball 18 units behind a target, in line with a pocket
      for (const t of targets) for (const p of POCKETS) {
        const vx = t.x - p.x, vy = t.y - p.y, l = Math.hypot(vx, vy);
        const cand = { x: t.x + (vx / l) * 18, y: t.y + (vy / l) * 18 };
        if (canPlaceCue(balls, cand.x, cand.y, false)) { placed = cand; break; }
      }
      if (!placed) for (let k = 0; k < 500 && !placed; k++) { const c = { x: 5 + Math.random() * 90, y: 5 + Math.random() * 190 }; if (canPlaceCue(balls, c.x, c.y, false)) placed = c; }
    }
    cue = { ...cue, ...placed, in: false };
    balls[0] = cue;
  }
  if (st.breakShot) return { dx: (Math.random() - 0.5) * 0.04, dy: -1, power: 1, cue: placed };
  let best = null;
  for (const t of targets) for (const p of POCKETS) {
    const vx = p.x - t.x, vy = p.y - t.y, l = Math.hypot(vx, vy);
    const gx = t.x - (vx / l) * 2 * R, gy = t.y - (vy / l) * 2 * R;
    const ax = gx - cue.x, ay = gy - cue.y, al = Math.hypot(ax, ay);
    const cut = (ax / al) * (vx / l) + (ay / al) * (vy / l); // 1 = straight
    if (cut < 0.3) continue;
    const score = cut * 2 - l / 200 - al / 300;
    if (!best || score > best.score) best = { score, dx: ax, dy: ay, power: Math.min(1, 0.35 + (l + al) / 400) };
  }
  if (!best) { const t = targets[0] || balls.find((b) => !b.in && b.n !== 0); best = { dx: t.x - cue.x, dy: t.y - cue.y, power: 0.6 }; }
  return { dx: best.dx, dy: best.dy, power: best.power, cue: placed };
}

function bot(sock, { idle = false } = {}) {
  const shots = { taken: 0, fouls: [] };
  const done = new Promise((resolve) => {
    sock.on('pool:shot', (s) => { if (s.foul) shots.fouls.push(s.foul); });
    sock.on('pool:state', (st) => {
      if (st.phase === 'over') return resolve({ st, shots });
      if (idle || st.phase !== 'aim' || st.turn !== st.me) return;
      shots.taken++;
      sock.emit('pool:shoot', chooseShot(st), (r) => { if (!r.ok && process.env.DBG) console.log('    shot rejected:', r.error); });
    });
  });
  return { done, shots };
}

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const U = ['Abel', 'Beti', 'Chala', 'Dagi'].map((n, i) => ({ id: 6001 + i, first_name: n }));
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
    await emit(s, 'pool:enter');
    S.push(s);
  }

  console.log('Pool: tables');
  assert.equal((await emit(S[0], 'pool:join', { stake: 777 })).ok, false); ok('unknown table rejected');
  await emit(S[0], 'pool:join', { stake: 1000 });
  assert.equal(bal(db, 0), 99000); ok('joining charges the entry fee');
  await emit(S[0], 'pool:leave');
  assert.equal(bal(db, 0), 100000); ok('leaving before the match refunds');

  console.log('Pool: full matches between two bots');
  let decided = 0, by8 = 0, totalShots = 0;
  for (let m = 0; m < 3; m++) {
    for (const s of S) { s.removeAllListeners('pool:state'); s.removeAllListeners('pool:shot'); }
    const b0 = bot(S[0]), b1 = bot(S[1]);
    const before0 = bal(db, 0), before1 = bal(db, 1);
    await emit(S[0], 'pool:join', { stake: 1000 });
    await emit(S[1], 'pool:join', { stake: 1000 });
    const r = await Promise.race([b0.done, sleep(180000).then(() => null)]);
    assert.ok(r, 'match finished');
    const shots = b0.shots.taken + b1.shots.taken;
    totalShots += shots;
    const winnerIdx = r.st.result.winnerName === 'Abel' ? 0 : 1;
    console.log(`    match ${m + 1}: ${r.st.result.winnerName} won (${r.st.result.how}) after ${shots} shots, fouls: ${[...b0.shots.fouls, ...b1.shots.fouls].length}`);
    assert.equal(bal(db, winnerIdx), (winnerIdx === 0 ? before0 : before1) - 1000 + 1800);
    assert.equal(bal(db, 1 - winnerIdx), (winnerIdx === 0 ? before1 : before0) - 1000);
    decided++;
    if (/8 ball/.test(r.st.result.how)) by8++;
  }
  ok(`3 complete matches decided at the table; winner paid 18 ETB each time (${totalShots} shots total)`);
  assert.ok(by8 >= 1, 'at least one match decided by the 8 ball'); ok(`${by8} of 3 decided by the 8 ball (others by fouls/time)`);
  const rec = db.listPoolGames(1)[0];
  assert.equal(rec.pot, 2000); assert.equal(rec.house, 200); ok('match recorded (pot 20, house 2)');
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM rounds WHERE game='pool' AND status='open'").get().n, 0); ok('money rounds closed');

  console.log('Pool: several matches at the same time');
  {
    const extra = ['Eyob', 'Feven', 'Gelila', 'Hagos', 'Iman', 'Jemal'].map((n, i) => ({ id: 6101 + i, first_name: n }));
    for (const u of extra) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }
    const socks = [];
    for (const u of extra) {
      const s = io(URL, { auth: { initData: initDataFor(u) }, transports: ['websocket'] });
      await new Promise((r) => s.on('connect', r));
      await emit(s, 'pool:enter');
      socks.push(s);
    }
    const bots = socks.map((s) => bot(s));
    // 6 players join the same 10 ETB table → 3 separate matches run at once
    await Promise.all(socks.map((s) => emit(s, 'pool:join', { stake: 1000 })));
    const ids = new Set();
    await sleep(100);
    const results = await Promise.race([Promise.all(bots.map((b) => b.done)), sleep(240000).then(() => null)]);
    assert.ok(results, 'all concurrent matches finished');
    results.forEach((r) => ids.add(r.st.id));
    assert.equal(ids.size, 3); ok('6 players at one table → 3 separate matches ran at the same time');
    const total = extra.reduce((sum, u) => sum + db.getUser(String(u.id)).balance, 0);
    assert.equal(total, 6 * 100000 - 3 * 200); ok('every match paid out correctly (3 × 2 ETB house cut, nothing lost)');
    socks.forEach((s) => s.close());
  }

  console.log('Pool: shot validation');
  for (const s of S) { s.removeAllListeners('pool:state'); s.removeAllListeners('pool:shot'); }
  let st2 = null; S[2].on('pool:state', (st) => { st2 = st; });
  let st3 = null; S[3].on('pool:state', (st) => { st3 = st; });
  await emit(S[2], 'pool:join', { stake: 2000 });
  await emit(S[3], 'pool:join', { stake: 2000 });
  while (!st2 || st2.phase !== 'aim') await sleep(10);
  const shooter = st2.turn === st2.me ? S[2] : S[3];
  const waiter = shooter === S[2] ? S[3] : S[2];
  assert.equal((await emit(waiter, 'pool:shoot', { dx: 0, dy: -1, power: 1, cue: { x: 50, y: 170 } })).ok, false); ok('only the player whose turn it is can shoot');
  assert.equal((await emit(shooter, 'pool:shoot', { dx: 0, dy: -1, power: 1, cue: { x: 50, y: 60 } })).ok, false); ok('break: cue ball must be behind the line');
  assert.equal((await emit(shooter, 'pool:shoot', { dx: 0, dy: -1, power: 5, cue: { x: 50, y: 170 } })).ok, false); ok('impossible power rejected');

  console.log('Pool: timeouts, resign, restart');
  // Nobody shoots: the shot clock (1s) passes the turn with ball in hand; 3 misses in a row forfeits
  const over = await new Promise((r) => S[2].on('pool:state', (st) => st.phase === 'over' && r(st)));
  assert.match(over.result.how, /ran out of time/); ok('3 timeouts in a row → forfeit');

  for (const s of S) s.removeAllListeners('pool:state');
  const c0 = bal(db, 2);
  await emit(S[2], 'pool:join', { stake: 1000 });
  await emit(S[3], 'pool:join', { stake: 1000 });
  await sleep(50);
  const ov = new Promise((r) => S[2].on('pool:state', (st) => st.phase === 'over' && r(st)));
  await emit(S[3], 'pool:leave');
  const o = await ov;
  assert.equal(o.result.winnerName, 'Chala'); assert.equal(bal(db, 2), c0 + 800); ok('leaving mid-match = resign; opponent paid');

  const f0 = bal(db, 0), f1 = bal(db, 1);
  await emit(S[0], 'pool:join', { stake: 2000 });
  await emit(S[1], 'pool:join', { stake: 2000 });
  await sleep(50);
  assert.equal(bal(db, 0), f0 - 2000);
  srv.proc.kill('SIGKILL'); await new Promise((r) => srv.proc.on('exit', r));
  S.forEach((s) => s.close());
  srv = startServer(); await srv.ready;
  assert.equal(bal(db, 0), f0); assert.equal(bal(db, 1), f1); ok('server crash mid-match → both refunded on restart');

  const stats = await (await fetch(URL + '/api/admin/stats', { headers: { 'x-admin-key': 'admin-password-1' } })).json();
  assert.equal(stats.allTime.poolGames, 8); ok('admin stats count pool matches');

  console.log(`\nAll ${passed} pool checks passed ✅`);
} catch (e) {
  console.error('\n❌ FAILED:', e.message);
  if (srv) console.error(srv.log().slice(-1500));
  process.exitCode = 1;
} finally {
  srv?.proc.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(), 300);
}
