// 3-player Cutthroat pool, played to the end by bots (only runs when POOL_SIZES includes 3).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { R, POCKETS, canPlaceCue } from '../shared/pool.js';

const TOKEN = '123456:TEST_TOKEN', PORT = 3981, URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-ct-'));
const env = { ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'b.db'), BACKUP_DIR: path.join(tmp, 'bk'),
  POOL_SIZES: '2,3', POOL_STAKES: '10', POOL_SHOT_SEC: '1', POOL_DELAY_SCALE: '0.01', SOCKET_RATE: '100000',
  CRASH_ENABLED: 'false', KENO_ENABLED: 'false', LUDO_ENABLED: 'false', NODE_ENV: '', DEV_MODE: 'false' };
Object.assign(process.env, env);
const initDataFor = (u) => { const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(u) });
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  p.set('hash', crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(dcs).digest('hex')); return p.toString(); };
const emit = (s, ev, p = {}) => new Promise((r) => s.emit(ev, p, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shot(st) {
  const mine = new Set(st.players[st.me].set);
  const balls = st.balls.map((b) => ({ ...b }));
  const targets = balls.filter((b) => !b.in && b.n && !mine.has(b.n));
  let placed = null;
  if (st.ballInHand) {
    placed = st.breakShot ? { x: 50, y: 170 } : null;
    for (const tg of targets) for (const p of POCKETS) { if (placed) break; const vx = tg.x - p.x, vy = tg.y - p.y, l = Math.hypot(vx, vy); const c = { x: tg.x + vx / l * 16, y: tg.y + vy / l * 16 }; if (canPlaceCue(balls, c.x, c.y, false)) placed = c; }
    for (let k = 0; !placed && k < 500; k++) { const c = { x: 5 + Math.random() * 90, y: 5 + Math.random() * 190 }; if (canPlaceCue(balls, c.x, c.y, false)) placed = c; }
    balls[0] = { ...balls[0], ...placed, in: false };
  }
  if (st.breakShot) return { dx: 0.01, dy: -1, power: 1, cue: placed };
  const cue = balls[0]; let best = null;
  for (const tg of targets) for (const p of POCKETS) {
    const vx = p.x - tg.x, vy = p.y - tg.y, l = Math.hypot(vx, vy), gx = tg.x - vx / l * 2 * R, gy = tg.y - vy / l * 2 * R;
    const ax = gx - cue.x, ay = gy - cue.y, al = Math.hypot(ax, ay), cut = (ax * vx + ay * vy) / (al * l);
    if (cut > 0.3 && (!best || cut > best.cut)) best = { cut, dx: ax, dy: ay };
  }
  const tg = targets[0] || balls.find((b) => !b.in && b.n);
  return { ...(best || { dx: tg.x - cue.x, dy: tg.y - cue.y }), power: 0.6, cue: placed };
}

let srv, passed = 0; const ok = (n) => { passed++; console.log('  ✓', n); };
try {
  const db = await import('../server/db.js');
  const U = ['Abel', 'Beti', 'Chala'].map((n, i) => ({ id: 7001 + i, first_name: n }));
  for (const u of U) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }
  srv = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('Bingo server') && r()));
  const S = [];
  for (const u of U) { const s = io(URL, { auth: { initData: initDataFor(u) }, transports: ['websocket'] }); await new Promise((r) => s.on('connect', r)); await emit(s, 'pool:enter'); S.push(s); }
  console.log('Cutthroat (3 players)');
  const done = S.map((s) => new Promise((resolve) => s.on('pool:state', (st) => {
    if (st.phase === 'over') return resolve(st);
    if (st.phase === 'aim' && st.turn === st.me) s.emit('pool:shoot', shot(st), () => {});
  })));
  for (const s of S) await emit(s, 'pool:join', { stake: 1000, size: 3 });
  const end = await Promise.race([done[0], sleep(240000).then(() => null)]);
  assert.ok(end, 'match finished');
  assert.equal(end.mode, 'cutthroat'); assert.equal(end.players.length, 3); ok('3 players seated in one Cutthroat match');
  assert.deepEqual(end.players.map((p) => p.set.length), [5, 5, 5]); ok('each player owns 5 balls');
  const w = U.findIndex((u) => u.first_name === end.result.winnerName);
  console.log(`    ${end.result.winnerName} won (${end.result.how})`);
  assert.equal(db.getUser(String(U[w].id)).balance, 100000 - 1000 + 2700); ok('winner paid 27 ETB (3 × 10 − 10%)');
  const total = U.reduce((s, u) => s + db.getUser(String(u.id)).balance, 0);
  assert.equal(total, 300000 - 300); ok('no money lost or created (house kept 3 ETB)');
  console.log(`\nAll ${passed} Cutthroat checks passed ✅`);
} catch (e) { console.error('\n❌ FAILED:', e.message); process.exitCode = 1; }
finally { srv?.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(), 300); }
