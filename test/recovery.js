// Crash-safety test: players pay, the server dies mid-game, and on restart everyone is refunded.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:TEST_TOKEN';
const PORT = 3997;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-rec-'));
const DB = path.join(tmp, 'bingo.db');
const URL = `http://localhost:${PORT}`;
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: DB, BACKUP_DIR: path.join(tmp, 'backups'),
  COUNTDOWN_SEC: '1', CALL_INTERVAL_MS: '2000', RESULT_SHOW_SEC: '1', DEV_MODE: 'false', NODE_ENV: '',
};
Object.assign(process.env, env);

function initDataFor(user) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));

function startServer() {
  const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
  return { proc, ready, log: () => out };
}
const exited = (proc) => new Promise((r) => proc.on('exit', r));

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const users = [{ id: 2001, first_name: 'Hana' }, { id: 2002, first_name: 'Yonas' }];
const init = users.map(initDataFor);

async function seatPlayers(stake, waitForPlaying) {
  const socks = [];
  for (let i = 0; i < users.length; i++) {
    const s = io(URL, { auth: { initData: init[i] }, transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    await emit(s, 'room:enter', { stake });
    const r = await emit(s, 'card:pick', { stake, card: i + 1 });
    assert.equal(r.ok, true, r.error);
    socks.push(s);
  }
  if (waitForPlaying) await new Promise((r) => socks[0].on('room', (st) => st.state === 'playing' && r()));
  return socks;
}

let srv;
try {
  const { upsertUser, credit, getUser, db } = await import('../server/db.js');
  for (const u of users) { upsertUser(u); credit(u.id, 10000, 'deposit', 'seed'); }

  console.log('Crash during a game (kill -9)');
  srv = startServer(); await srv.ready;
  let socks = await seatPlayers(5000, true);
  assert.equal(getUser(2001).balance, 5000); ok('entry fees taken, game running');
  srv.proc.kill('SIGKILL'); await exited(srv.proc);
  socks.forEach((s) => s.close());
  assert.equal(getUser(2001).balance, 5000); ok('after crash, money is still held (server dead)');

  srv = startServer(); await srv.ready;
  assert.equal(getUser(2001).balance, 10000); assert.equal(getUser(2002).balance, 10000); ok('restart refunds both players');
  assert.match(srv.log(), /refunded 2 entr/); ok('recovery logged');
  const open = db.prepare("SELECT COUNT(*) n FROM rounds WHERE status='open'").get().n;
  assert.equal(open, 0); ok('no rounds left open');

  console.log('Graceful restart while players wait (SIGTERM)');
  socks = await seatPlayers(2000, false);
  assert.equal(getUser(2001).balance, 8000);
  srv.proc.kill('SIGTERM'); await exited(srv.proc);
  socks.forEach((s) => s.close());
  assert.equal(getUser(2001).balance, 10000); ok('shutdown refunds waiting players immediately');
  assert.match(srv.log(), /refunded 2 entr/); ok('shutdown refund logged');

  console.log('Normal game still settles and closes its round');
  srv = startServer(); await srv.ready;
  assert.equal(getUser(2001).balance, 10000); ok('no double refund on next start');
  socks = await seatPlayers(1000, true);
  const finished = new Promise((r) => socks[0].on('room', (st) => st.state === 'finished' && r(st)));
  // Nobody claims → after 75 calls the server auto-awards; speed this up by claiming when possible
  const { findWin } = await import('../server/bingo.js');
  const called = new Set();
  socks[0].on('call', ({ number }) => {
    called.add(number);
    socks.forEach((s, i) => findWin(i + 1, called) && emit(s, 'bingo', { stake: 1000 }));
  });
  const st = await Promise.race([finished, sleep(200000).then(() => null)]);
  assert.ok(st, 'game finished');
  const total = getUser(2001).balance + getUser(2002).balance;
  assert.equal(total, 20000 - 2000 + st.result.amountEach * st.result.winners.length); ok('payout correct');
  srv.proc.kill('SIGKILL'); await exited(srv.proc);
  srv = startServer(); await srv.ready;
  assert.equal(getUser(2001).balance + getUser(2002).balance, total); ok('finished round is not refunded after a crash');
  socks.forEach((s) => s.close());

  console.log(`\nAll ${passed} recovery checks passed ✅`);
} catch (e) {
  console.error('\n❌ FAILED:', e.message);
  if (srv) console.error(srv.log().slice(-1500));
  process.exitCode = 1;
} finally {
  srv?.proc.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(), 300);
}
