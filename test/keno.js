// Keno end-to-end test against a real server with signed Telegram users.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:TEST_TOKEN';
const PORT = 3990;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-keno-'));
const URL = `http://localhost:${PORT}`;
const env = {
  ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  KENO_BET_SEC: '1.5', KENO_BALL_MS: '60', KENO_RESULT_SEC: '1', KENO_MIN_BET: '5', KENO_MAX_BET: '2000',
  CRASH_ENABLED: 'false', DEV_MODE: 'false', NODE_ENV: '', ADMIN_IDS: '4001', ADMIN_PASSWORD: 'admin-password-1',
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
const waitPhase = (s, phase, ms = 30000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting for ${phase}`)), ms);
  const h = (st) => { if (st.phase === phase) { clearTimeout(t); s.off('keno:state', h); res(st); } };
  s.on('keno:state', h);
});

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const U = { A: { id: 4001, first_name: 'Almaz' }, B: { id: 4002, first_name: 'Bekele' } };
let srv;
try {
  const db = await import('../server/db.js');
  const { PAYTABLE } = await import('../shared/keno.js');
  const { drawForSeed } = await import('../server/keno.js');
  for (const u of Object.values(U)) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }

  srv = startServer(); await srv.ready;
  const s = {};
  for (const [k, u] of Object.entries(U)) {
    s[k] = io(URL, { auth: { initData: initDataFor(u) }, transports: ['websocket'] });
    await new Promise((r) => s[k].on('connect', r));
    await emit(s[k], 'keno:enter');
  }

  console.log('Keno: ticket rules');
  await waitPhase(s.A, 'betting');
  const st0 = (await emit(s.A, 'keno:enter')).state;
  assert.equal(st0.hash.length, 64); assert.equal(st0.seed, null); assert.equal(st0.revealed.length, 0); ok('hash published, seed and draw hidden during betting');
  assert.equal((await emit(s.A, 'keno:buy', { picks: [], amount: 1000 })).ok, false); ok('empty ticket rejected');
  assert.equal((await emit(s.A, 'keno:buy', { picks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], amount: 1000 })).ok, false); ok('more than 10 numbers rejected');
  assert.equal((await emit(s.A, 'keno:buy', { picks: [5, 5], amount: 1000 })).ok, false); ok('duplicate numbers rejected');
  assert.equal((await emit(s.A, 'keno:buy', { picks: [0, 81], amount: 1000 })).ok, false); ok('numbers outside 1–80 rejected');
  assert.equal((await emit(s.A, 'keno:buy', { picks: [1], amount: 100 })).ok, false); ok('below minimum stake rejected');
  const picksA = [3, 17, 22, 41, 58, 77];
  assert.equal((await emit(s.A, 'keno:buy', { picks: picksA, amount: 1000 })).ok, true);
  assert.equal(db.getUser('4001').balance, 99000); ok('ticket charges balance');
  let r2 = await emit(s.A, 'keno:buy', { picks: [1, 2], amount: 500 });
  assert.equal(r2.ok, true); assert.equal(r2.me.length, 2); assert.equal(db.getUser('4001').balance, 98500); ok('a player can buy several tickets for one draw');
  r2 = await emit(s.A, 'keno:buy', { picks: [9], amount: 500 });
  assert.equal(r2.me.length, 3); assert.equal(db.getUser('4001').balance, 98000);
  r2 = await emit(s.A, 'keno:cancel', { id: r2.me[1].id });
  assert.equal(r2.me.length, 2); assert.equal(db.getUser('4001').balance, 98500); ok('one ticket can be cancelled on its own');
  r2 = await emit(s.A, 'keno:cancel');
  assert.equal(r2.me.length, 0);
  assert.equal(db.getUser('4001').balance, 100000); ok('cancel refunds');
  await emit(s.A, 'keno:buy', { picks: picksA, amount: 1000 });
  const picksB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  await emit(s.B, 'keno:buy', { picks: picksB, amount: 500 });

  console.log('Keno: draw and payouts');
  const balls = [];
  s.B.on('keno:ball', ({ n }) => balls.push(n));
  await waitPhase(s.B, 'drawing');
  assert.equal((await emit(s.B, 'keno:buy', { picks: [1], amount: 1000 })).ok, false); ok('no tickets during the draw');
  const res = await waitPhase(s.A, 'results');
  assert.equal(balls.length, 20); assert.equal(new Set(balls).size, 20); ok('20 unique balls revealed one by one');
  assert.deepEqual(res.revealed, balls); ok('final state matches the revealed balls');
  assert.equal(crypto.createHash('sha256').update(res.seed).digest('hex'), st0.hash); ok('revealed seed matches the hash shown before');
  assert.deepEqual(drawForSeed(res.seed), balls); ok('anyone can recompute the draw from the seed');

  const hitsA = picksA.filter((n) => balls.includes(n)).length;
  const hitsB = picksB.filter((n) => balls.includes(n)).length;
  const winA = Math.floor(1000 * (PAYTABLE[6][hitsA] || 0));
  const winB = Math.floor(500 * (PAYTABLE[10][hitsB] || 0));
  await sleep(200);
  assert.equal(db.getUser('4001').balance, 99000 + winA); ok(`player A: ${hitsA}/6 hits → paid ${winA / 100} ETB (paytable)`);
  assert.equal(db.getUser('4002').balance, 99500 + winB); ok(`player B: ${hitsB}/10 hits → paid ${winB / 100} ETB (paytable)`);
  const rec = db.listKenoRounds(1)[0];
  assert.equal(rec.bets_total, 1500); assert.equal(rec.payout_total, winA + winB); assert.deepEqual(rec.drawn, balls); ok('round recorded');
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM rounds WHERE game='keno' AND status='open'").get().n, 0); ok('money round closed');

  console.log('Keno: admin, pause, restart');
  const A = (m, p) => fetch(URL + '/api/admin' + p, { method: m, headers: { 'x-admin-key': 'admin-password-1' } }).then((r) => r.json());
  const stats = await A('GET', '/stats');
  assert.equal(stats.allTime.kenoEarnings, 1500 - winA - winB); ok('stats show Keno earnings');
  assert.ok((await A('GET', '/keno-rounds')).items.length >= 1); ok('admin Keno draw history');

  await waitPhase(s.A, 'betting');
  await emit(s.A, 'keno:buy', { picks: [7, 8], amount: 2000 });
  const before = db.getUser('4001').balance;
  await A('POST', '/pause');
  await sleep(200);
  assert.equal(db.getUser('4001').balance, before + 2000); ok('pause refunds tickets in the betting phase');
  assert.equal((await emit(s.A, 'keno:enter')).state.phase, 'paused'); ok('Keno shows paused');
  await A('POST', '/resume');
  await waitPhase(s.A, 'betting', 10000); ok('resume restarts rounds');

  await emit(s.B, 'keno:buy', { picks: [11, 12, 13], amount: 1500 });
  const b2 = db.getUser('4002').balance;
  srv.proc.kill('SIGKILL'); await new Promise((r) => srv.proc.on('exit', r));
  Object.values(s).forEach((x) => x.close());
  srv = startServer(); await srv.ready;
  assert.equal(db.getUser('4002').balance, b2 + 1500); ok('server crash → Keno ticket refunded on restart');

  console.log(`\nAll ${passed} Keno checks passed ✅`);
} catch (e) {
  console.error('\n❌ FAILED:', e.message);
  if (srv) console.error(srv.log().slice(-1500));
  process.exitCode = 1;
} finally {
  srv?.proc.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(), 300);
}
