// Practice vs bot (pool, Kerenbula, Ludo), private invite tables, online counter.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { poolShot, kerenbulaRoll } from '../shared/bots.js';

const TOKEN = '123456:SOCIAL_TOKEN';
const PORT = 3994;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-social-'));
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', SOCKET_RATE: '100000', CRASH_ENABLED: 'false', KENO_ENABLED: 'false',
  POOL_DELAY_SCALE: '0.01', KERENBULA_DELAY_SCALE: '0.01', LUDO_DELAY_SCALE: '0.01', LUDO_STEP_MS: '1', POOL_STAKES: '10', KERENBULA_STAKES: '10', LUDO_STAKES: '10',
  PRIVATE_TABLE_MIN: '0.02',
};
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
const U = [{ id: 7301, first_name: 'Abebe' }, { id: 7302, first_name: 'Birtukan' }, { id: 7303, first_name: 'Chernet' }];
for (const u of U) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }
const bal = (i) => db.getUser(String(U[i].id)).balance;
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  const S = [];
  for (const [i, u] of U.entries()) {
    const s = io(URL, { auth: { initData: sign(u), device: `devsocial${i}xx` }, transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    S.push(s);
  }
  const s = S[0];
  const before = bal(0);

  console.log('Practice vs bot');
  // ---- pool ----
  await emit(s, 'pool:enter');
  let botShots = 0, myShots = 0;
  s.on('pool:shot', (x) => { if (x.shooter !== undefined) botShots++; });
  const poolDone = new Promise((resolve) => s.on('pool:state', (st) => {
    if (st.phase === 'over') return resolve(st);
    if (st.phase === 'aim' && st.turn === st.me) { myShots++; s.emit('pool:shoot', poolShot(st, { skill: 0.9 }), () => {}); }
  }));
  const pr = await emit(s, 'pool:practice');
  assert.ok(pr.ok && pr.me.game); ok('pool practice starts instantly against the bot');
  const pst = await Promise.race([poolDone, sleep(120000).then(() => null)]);
  assert.ok(pst?.result && pst.practice); assert.ok(botShots - myShots > 0, 'bot took shots');
  ok(`pool practice played to the end (${pst.result.winnerName} won, ${myShots} of my shots, ${botShots - myShots} by the bot)`);
  s.removeAllListeners('pool:state'); s.removeAllListeners('pool:shot');

  // ---- kerenbula ----
  await emit(s, 'kb:enter');
  let kbRolls = 0;
  const kbDone = new Promise((resolve) => s.on('kb:state', (st) => {
    if (st.phase === 'over') return resolve(st);
    if ((st.phase === 'jack' || st.phase === 'roll') && st.turn === st.me) { kbRolls++; s.emit('kb:roll', kerenbulaRoll(st), () => {}); }
  }));
  assert.ok((await emit(s, 'kb:practice')).ok);
  const kst = await Promise.race([kbDone, sleep(240000).then(() => null)]);
  assert.ok(kst?.result && kst.practice);
  ok(`Kerenbula practice played to the end (${kst.players.map((p) => `${p.name} ${p.score}`).join(' – ')}, ${kst.frame} frames)`);
  s.removeAllListeners('kb:state');

  // ---- ludo ----
  await emit(s, 'ludo:enter');
  const ludoDone = new Promise((resolve) => s.on('ludo:state', (st) => {
    if (st.phase === 'over') return resolve(st);
    if (st.turnSeat === st.mySeat && st.phase === 'roll') s.emit('ludo:roll', {}, () => {});
    if (st.turnSeat === st.mySeat && st.phase === 'move' && st.legal.length) s.emit('ludo:move', { token: st.legal[0] }, () => {});
  }));
  assert.ok((await emit(s, 'ludo:practice')).ok);
  const lst = await Promise.race([ludoDone, sleep(180000).then(() => null)]);
  assert.ok(lst?.result && lst.practice); ok(`Ludo practice played to the end (${lst.result.winnerName} won)`);
  s.removeAllListeners('ludo:state');

  assert.equal(bal(0), before); ok('practice never touches the balance');
  for (const tbl of ['pool_games', 'kerenbula_games', 'ludo_games']) assert.equal(db.db.prepare(`SELECT COUNT(*) n FROM ${tbl}`).get().n, 0);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM rounds').get().n, 0); ok('practice games aren\'t recorded or counted in earnings');

  console.log('Invite a friend (private table)');
  const [a, b, c] = S;
  for (const x of S) await emit(x, 'pool:enter');
  let r = await emit(a, 'pool:join', { stake: 1000, size: 2, invite: true });
  const code = r.me.queue.code;
  assert.match(code, /^[A-Z0-9]{6}$/); assert.equal(bal(0), before - 1000); ok(`private table created (code ${code}), entry paid`);
  const lobby = (await emit(c, 'pool:enter')).lobby;
  assert.ok(lobby.tables.every((t) => t.waiting === 0)); ok('private table isn\'t shown in the public lobby');
  r = await emit(c, 'pool:join', { stake: 1000, size: 2 });
  assert.equal(r.me.queue.waiting, 1); await emit(c, 'pool:leave'); ok('a stranger at the public table is not matched with the private one');
  r = await emit(b, 'pool:join', { code: code.toLowerCase() });
  assert.ok(r.ok && r.me.game); ok('friend joins with the code → the match starts between the two of them');
  assert.equal((await emit(c, 'pool:join', { code })).ok, false); ok('the code stops working once the match has started');
  await emit(a, 'pool:leave'); // resign → B wins
  await sleep(300);
  assert.equal(bal(1), 100000 - 1000 + 1800); ok('it\'s a normal money match (friend won 18 ETB when the host resigned)');
  r = await emit(c, 'kb:join', { stake: 1000, invite: true });
  const before2 = bal(2);
  await emit(c, 'kb:leave');
  assert.equal(bal(2), before2 + 1000); ok('leaving your private table refunds you');
  r = await emit(c, 'ludo:join', { stake: 1000, size: 2, invite: true });
  const lcode = r.me.queue.code;
  await sleep(2500); // PRIVATE_TABLE_MIN is ~1 s in this test
  assert.equal(bal(2), before2 + 1000); assert.equal((await emit(a, 'ludo:join', { code: lcode })).ok, false);
  ok('nobody came → the private table expires and the host is refunded');

  console.log('Online counter');
  const online = await new Promise((res) => { a.emit('ludo:exit'); a.once('online', res); });
  assert.ok(online.n >= 3); ok(`home screen gets "${online.n} online"`);
  for (const x of S) x.close();
  console.log(`\nAll ${passed} practice / invite checks passed ✅`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-2500));
  process.exitCode = 1;
} finally {
  proc.kill();
  setTimeout(() => process.exit(), 300);
}
