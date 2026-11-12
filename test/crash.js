// Rocket (crash game) end-to-end test against a real server with signed Telegram users.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:TEST_TOKEN';
const PORT = 3994;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-crash-'));
const DB = path.join(tmp, 'bingo.db');
const URL = `http://localhost:${PORT}`;
const env = {
  ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: DB, BACKUP_DIR: path.join(tmp, 'b'),
  CRASH_BET_SEC: '1.5', CRASH_MIN_BET: '5', CRASH_MAX_BET: '1000', CRASH_MAX_WIN: '100000',
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_IDS: '3001', ADMIN_PASSWORD: 'admin-password-1',
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
const waitPhase = (s, phase, ms = 120000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting for ${phase}`)), ms);
  const h = (st) => { if (st.phase === phase) { clearTimeout(t); s.off('crash:state', h); res(st); } };
  s.on('crash:state', h);
});

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const U = { A: { id: 3001, first_name: 'Abel' }, B: { id: 3002, first_name: 'Bona' }, C: { id: 3003, first_name: 'Ciru' } };
let srv;
try {
  const db = await import('../server/db.js');
  for (const u of Object.values(U)) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); } // 1000 ETB

  console.log('Rocket: money safety at DB level');
  {
    const r = db.openRound(0, 'crash');
    db.debit('3001', 1000, 'bet', 't', r); db.debit('3002', 1000, 'bet', 't', r);
    db.credit('3001', 1500, 'win', 'cashed 1.5x', r); // A cashed out before the "crash"
    const refunds = db.refundOpenRounds('test');
    assert.deepEqual(refunds.map((x) => x.userId), ['3002']); ok('server dies mid-flight: only players who had NOT cashed out are refunded');
    assert.equal(db.getUser('3001').balance, 100500); assert.equal(db.getUser('3002').balance, 100000); ok('balances correct after refund');
    db.adjustBalance('3001', -500, 'reset');
  }

  srv = startServer(); await srv.ready;
  const s = {};
  for (const [k, u] of Object.entries(U)) {
    s[k] = io(URL, { auth: { initData: initDataFor(u) }, transports: ['websocket'] });
    await new Promise((r) => s[k].on('connect', r));
  }

  console.log('Rocket: betting rules');
  const enter = await emit(s.A, 'crash:enter');
  assert.equal(enter.ok, true); assert.ok(enter.state.hash?.length === 64 || enter.state.phase !== 'betting'); ok('enter returns state with fairness hash');
  for (const k of ['B', 'C']) await emit(s[k], 'crash:enter');
  await waitPhase(s.A, 'betting');
  const st0 = (await emit(s.A, 'crash:enter')).state;
  assert.equal(st0.point, null); assert.equal(st0.seed, null); ok('crash point and seed are hidden during betting');

  assert.equal((await emit(s.A, 'crash:bet', { amount: 100 })).ok, false); ok('below minimum bet rejected');
  assert.equal((await emit(s.A, 'crash:bet', { amount: 200000 })).ok, false); ok('above maximum bet rejected');
  assert.equal((await emit(s.A, 'crash:bet', { amount: 1000, auto: 100 })).ok, false); ok('auto cash-out below 1.01x rejected');
  assert.equal((await emit(s.C, 'crash:bet', { amount: 2000 })).ok, true);
  assert.equal(db.getUser('3003').balance, 98000); ok('bet charges balance');
  assert.equal((await emit(s.C, 'crash:bet', { amount: 2000 })).ok, false); ok('only one bet per round');
  await emit(s.C, 'crash:cancel');
  assert.equal(db.getUser('3003').balance, 100000); ok('cancel during betting refunds');

  assert.equal((await emit(s.A, 'crash:bet', { amount: 1000, auto: 101 })).ok, true);   // A: auto 1.01x
  assert.equal((await emit(s.B, 'crash:bet', { amount: 2000 })).ok, true);              // B: manual
  const hash = st0.hash;

  const flying = await waitPhase(s.B, 'flying');
  assert.equal(flying.point, null); ok('crash point still hidden while flying');
  assert.equal((await emit(s.C, 'crash:bet', { amount: 1000 })).ok, false); ok('cannot bet after take-off');
  const co = await emit(s.B, 'crash:cashout');
  const crashed = await waitPhase(s.A, 'crashed');
  const P = crashed.point;
  console.log(`    (round crashed at ${(P / 100).toFixed(2)}x)`);

  // Provable fairness: sha256(seed) == hash shown before betting, and point recomputes from seed
  assert.equal(crypto.createHash('sha256').update(crashed.seed).digest('hex'), hash); ok('revealed seed matches the hash shown before the round');
  const { crashPointFromHash } = await import('../shared/crash.js');
  const h = crypto.createHmac('sha256', crashed.seed).update('rocket').digest('hex');
  assert.equal(crashPointFromHash(h, 0.03, 100000), P); ok('anyone can recompute the crash point from the seed');

  const a = db.getUser('3001').balance, b = db.getUser('3002').balance;
  if (P >= 101) { assert.equal(a, 100000 - 1000 + 1010); ok('auto cash-out at 1.01x paid exactly 10.10'); }
  else { assert.equal(a, 99000); ok('instant crash: auto 1.01x lost'); }
  if (co.ok && co.cashed) {
    const won = b - 98000;
    assert.ok(won >= 2000 && won <= Math.floor(2000 * P / 100)); ok(`manual cash-out paid ${won / 100} ETB (≤ crash point)`);
  } else {
    assert.equal(b, 98000); ok('manual cash-out too late → bet lost');
  }
  await sleep(300);
  const rec = db.listCrashRounds(1)[0];
  assert.equal(rec.crash_point, P); assert.equal(rec.bets_total, 3000);
  assert.equal(rec.payout_total, (a - 99000) + (b - 98000)); ok('round recorded with bets and payouts');
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM rounds WHERE game='crash' AND status='open'").get().n, 0); ok('money round closed');

  console.log('Rocket: admin + pause');
  const A = (m, p) => fetch(URL + '/api/admin' + p, { method: m, headers: { 'x-admin-key': 'admin-password-1' } }).then((r) => r.json());
  const stats = await A('GET', '/stats');
  assert.equal(stats.allTime.crashEarnings, rec.bets_total - rec.payout_total); ok('stats show Rocket earnings');
  assert.ok(stats.crash && stats.crash.phase); ok('admin sees live Rocket state');
  assert.equal((await A('GET', '/crash-rounds')).items.length >= 1, true); ok('admin Rocket round history');

  await waitPhase(s.C, 'betting');
  await emit(s.C, 'crash:bet', { amount: 1500 });
  assert.equal(db.getUser('3003').balance, 98500);
  await A('POST', '/pause');
  await sleep(200);
  assert.equal(db.getUser('3003').balance, 100000); ok('pause refunds bets placed in the betting phase');
  const pst = (await emit(s.C, 'crash:enter')).state;
  assert.equal(pst.phase, 'paused'); ok('Rocket shows paused');
  assert.equal((await emit(s.C, 'crash:bet', { amount: 1000 })).ok, false); ok('no betting while paused');
  await A('POST', '/resume');
  await waitPhase(s.C, 'betting', 10000); ok('resume restarts rounds');

  console.log('Rocket: restart during betting');
  await emit(s.C, 'crash:bet', { amount: 3000 });
  srv.proc.kill('SIGKILL'); await new Promise((r) => srv.proc.on('exit', r));
  Object.values(s).forEach((x) => x.close());
  assert.equal(db.getUser('3003').balance, 97000);
  srv = startServer(); await srv.ready;
  assert.equal(db.getUser('3003').balance, 100000); ok('crash of the server refunds Rocket bets on restart');

  console.log(`\nAll ${passed} crash-game checks passed ✅`);
} catch (e) {
  console.error('\n❌ FAILED:', e.message);
  if (srv) console.error(srv.log().slice(-1500));
  process.exitCode = 1;
} finally {
  srv?.proc.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(), 300);
}
