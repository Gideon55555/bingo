// Bingo with several cards per player: pot, countdown rule, and prize split per winning card.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { findWin } from '../shared/cards.js';

const TOKEN = '123456:TEST_TOKEN';
const PORT = 3988;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-multi-'));
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  COUNTDOWN_SEC: '1', CALL_INTERVAL_MS: '20', RESULT_SHOW_SEC: '1', MIN_PLAYERS: '2', STAKES: '10', HOUSE_CUT: '0.2', BINGO_MAX_CARDS: '3',
  CRASH_ENABLED: 'false', KENO_ENABLED: 'false', LUDO_ENABLED: 'false', POOL_ENABLED: 'false', KERENBULA_ENABLED: 'false',
  DEV_MODE: 'false', NODE_ENV: '', SOCKET_RATE: '100000',
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
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };

const db = await import('../server/db.js');
const U = [{ id: 8001, first_name: 'Hana' }, { id: 8002, first_name: 'Yonas' }];
for (const u of U) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); }
const bal = (i) => db.getUser(String(U[i].id)).balance;
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  const S = [];
  for (const u of U) {
    const s = io(`http://localhost:${PORT}`, { auth: { initData: initDataFor(u) }, transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    await emit(s, 'room:enter', { stake: 1000 });
    S.push(s);
  }

  console.log('Bingo: several cards per player');
  // One player holding 3 cards is still ONE player: no countdown yet
  for (const c of [1, 2, 3]) await emit(S[0], 'card:pick', { stake: 1000, card: c });
  let st = (await emit(S[0], 'room:enter', { stake: 1000 })).room;
  assert.equal(st.state, 'waiting'); assert.equal(st.players, 1); assert.equal(st.cards, 3);
  ok('3 cards from one player don\'t start the game (needs 2 different players)');
  assert.equal(st.prize, 2400); ok('prize counts every card: 3 × 10 − 20% = 24');

  // Play several rounds: Hana has 3 cards, Yonas 1; nobody presses BINGO, so at the end
  // every card with a line is paid automatically — exercises the per-card split.
  let rounds = 0, multiWinRounds = 0, hanaWins = 0;
  for (let round = 0; round < 6; round++) {
    const cardsA = [1 + round * 4, 2 + round * 4, 3 + round * 4].map((c) => ((c - 1) % 100) + 1);
    const cardB = ((4 + round * 4 - 1) % 100) + 1;
    const before = [bal(0) + (round === 0 ? 3000 : 0), bal(1)]; // round 1: Hana already paid for cards 1–3 above
    if (round > 0) for (const c of cardsA) await emit(S[0], 'card:pick', { stake: 1000, card: c });
    const finished = new Promise((res) => S[1].on('room', function h(r) { if (r.state === 'finished') { S[1].off('room', h); res(r); } }));
    // Claim as soon as any of my cards has a line (like a real player)
    const called = new Set();
    const claimers = S.map((s, i) => {
      const mine = i === 0 ? (round > 0 ? cardsA : [1, 2, 3]) : [cardB];
      let claimed = false;
      const onCall = async ({ number }) => {
        called.add(number);
        if (!claimed && mine.some((c) => findWin(c, called))) { claimed = true; await emit(s, 'bingo', { stake: 1000 }); }
      };
      s.on('call', onCall);
      return () => s.off('call', onCall);
    });
    await emit(S[1], 'card:pick', { stake: 1000, card: cardB });
    const r = await Promise.race([finished, sleep(20000).then(() => null)]);
    claimers.forEach((off) => off());
    assert.ok(r, 'round finished');
    rounds++;
    const res = r.result;
    const pot = 4 * 1000, prize = 3200;
    assert.equal(res.pot, pot);
    const each = Math.floor(prize / res.winners.length);
    assert.equal(res.amountEach, each);
    const winsA = res.winners.filter((w) => w.userId === String(U[0].id)).length;
    const winsB = res.winners.length - winsA;
    assert.equal(bal(0), before[0] - 3000 + each * winsA, `Hana balance round ${round}`);
    assert.equal(bal(1), before[1] - 1000 + each * winsB, `Yonas balance round ${round}`);
    if (res.winners.length > 1) multiWinRounds++;
    if (winsA) hanaWins++;
    for (const w of res.winners) assert.ok(findWin(w.card, new Set(r.called)), 'every paid card really has a line');
    const g = db.db.prepare('SELECT * FROM games ORDER BY id DESC LIMIT 1').get();
    assert.equal(g.pot, pot); assert.equal(g.house, pot - each * res.winners.length);
    await sleep(1300); // result screen → next round
  }
  ok(`${rounds} full rounds (3 cards vs 1): balances exact, each winning card paid one share, house = pot − payouts`);
  ok(`the 3-card player won ${hanaWins}/${rounds} rounds; ${multiWinRounds} round(s) had a shared prize`);
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM rounds WHERE status='open' AND id IN (SELECT round_id FROM games)").get().n, 0); ok('every money round closed');
  // Deterministic shared win: build the called numbers so exactly cards 21 + 22 (Hana) and 23 (Yonas) have a line
  {
    const { Room } = await import('../server/game.js');
    const { getCard } = await import('../shared/cards.js');
    const fakeIo = { sockets: { adapter: { rooms: new Map() }, sockets: new Map() }, to: () => ({ emit() {} }) };
    const room = new Room(1000, fakeIo, () => {}, null);
    room.pick({ id: U[0].id, first_name: 'Hana' }, 21); room.pick({ id: U[0].id, first_name: 'Hana' }, 22);
    room.pick({ id: U[0].id, first_name: 'Hana' }, 24);
    room.pick({ id: U[1].id, first_name: 'Yonas' }, 23);
    clearTimeout(room.timer);
    const before = [bal(0), bal(1)];
    room.state = 'playing';
    for (const c of [21, 22, 23]) for (const n of getCard(c)[0]) if (n) room.calledSet.add(n); // top row of each
    const extra = [...room.calledSet];
    const winningCards = [21, 22, 23, 24].filter((c) => findWin(c, room.calledSet));
    room.finish([String(U[0].id)]);
    clearTimeout(room.timer);
    const each = Math.floor(3200 / winningCards.length);
    const a = winningCards.filter((c) => c !== 23).length, b = winningCards.includes(23) ? 1 : 0;
    assert.ok(a >= 2 && b === 1, `setup: ${winningCards}`);
    assert.equal(room.result.winners.length, winningCards.length);
    assert.equal(bal(0) - before[0], each * a); assert.equal(bal(1) - before[1], each * b);
    ok(`shared win on one number: Hana's ${a} winning cards get ${a} shares, Yonas's 1 card gets 1 (${(each / 100).toFixed(2)} ETB each, ${extra.length} numbers called)`);
  }
  console.log(`\nAll ${passed} multi-card bingo checks passed ✅`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  proc.kill();
  setTimeout(() => process.exit(), 300);
}
