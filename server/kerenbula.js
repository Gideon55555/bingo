// ከረንቡላ / Kerenbula for money, 1 vs 1 (red vs white, 4 balls each). Winner takes the pot minus the house cut.
//
// Every roll is simulated here with the shared deterministic physics, so results can't be faked.
// Clients only send: where on the release line they let go, the direction, and the power.
//
// A match is played in frames:
//   1. One player rolls the blue jack; it must stop past the midline, otherwise the other player rolls it.
//   2. The jack roller rolls the first coloured ball; after that whoever is NOT closest to the jack rolls,
//      until they are closest or out of balls (bocce order).
//   3. Pins: knocked by the blue ball → +pinPoints for the roller; knocked directly by a red/white ball →
//      −pinPoints for that ball's owner. Knocked pins stay down until the next frame.
//   4. When all 8 balls are rolled, the closest player scores 1 per ball closer than the opponent's best.
// First to `target` at the end of a frame wins (after `maxFrames` the leader wins; a tie plays on).
import crypto from 'node:crypto';
import { config } from './config.js';
import { debit, credit, openRound, refundRound, settleKerenbula } from './db.js';
import { notifyUser } from './bot.js';
import { fmt } from '../shared/money.js';
import {
  Sim, freshBalls, freshPins, canRelease, pinPoints, closestPlayer, frameScore, RED, WHITE, MIDLINE, JACK,
} from '../shared/kerenbula.js';
import { assertNotFrozen, assertNotSamePerson } from './risk.js';
import { tr } from './i18n.js';
import { BOT_UID, startPractice, createPrivateTable, privateTable, dropPrivateIfDone } from './social.js';
import { kerenbulaRoll } from '../shared/bots.js';

const cfg = () => config.kerenbula;
const money = (c) => `${fmt(c)} ${config.currency}`;
const d = (ms) => Math.round(ms * cfg().delayScale);
let nextId = 1;

class KerenbulaGame {
  constructor(mgr, { stake, roundId, members, practice = false }) {
    this.mgr = mgr;
    this.practice = practice;
    this.r = { ...config.kerenbula }; // rules fixed for this match (admin changes apply to the next one)
    this.id = nextId++;
    this.stake = stake;
    this.roundId = roundId;
    this.channel = `kb:${this.id}`;
    // random seat → colour
    const order = crypto.randomInt(2) ? [members[1], members[0]] : members;
    this.players = order.map((m, i) => ({ uid: m.uid, name: m.name, color: i === 0 ? 'red' : 'white', score: 0, misses: 0, out: false }));
    this.colors = ['red', 'white'];
    this.jackBy = crypto.randomInt(2);
    this.frame = 0;
    this.rolls = 0;
    this.frames = []; // [{ winner, points, scores }]
    this.phase = 'starting';
    this.lastEvent = null;
    this.frameResult = null;
    this.startedAt = Date.now();
    this.result = null;
  }

  get pot() { return this.stake * 2; }
  get prize() { return Math.floor(this.pot * (1 - this.r.houseCut)); }
  indexOf(uid) { return this.players.findIndex((p) => p.uid === String(uid)); }
  io() { return this.mgr.io; }

  start() {
    this.broadcast();
    this.timer = setTimeout(() => this.newFrame(), d(1200));
  }

  newFrame() {
    this.frame++;
    this.balls = freshBalls();
    this.pins = freshPins();
    this.left = [[...RED], [...WHITE]];
    this.frameResult = null;
    this.lastEvent = null;
    this.setTurn(this.jackBy, 'jack');
  }

  setTurn(i, phase) {
    clearTimeout(this.timer);
    this.turn = i;
    this.phase = phase;
    this.deadline = Date.now() + this.r.rollSec * 1000;
    this.timer = setTimeout(() => this.onTimeout(), this.r.rollSec * 1000);
    this.broadcast();
    if (this.players[i].uid === BOT_UID) this.botTimer = setTimeout(() => this.botRoll(), d(1500));
  }

  botRoll() {
    if ((this.phase !== 'jack' && this.phase !== 'roll') || this.players[this.turn].uid !== BOT_UID) return;
    try { this.roll(BOT_UID, kerenbulaRoll(this.stateFor(BOT_UID))); } catch {
      try { this.roll(BOT_UID, { x: 20 + Math.random() * 60, dx: 0, dy: -1, power: 0.42 }); } catch { /* clock handles it */ }
    }
  }

  roll(uid, r) {
    const i = this.indexOf(uid);
    if (i !== this.turn || (this.phase !== 'jack' && this.phase !== 'roll')) throw new Error("It's not your turn");
    const x = Number(r?.x), dx = Number(r?.dx), dy = Number(r?.dy), power = Number(r?.power);
    if (![x, dx, dy, power].every(Number.isFinite)) throw new Error('Invalid roll');
    if (dy >= 0) throw new Error('Roll the ball up the table');
    if (power <= 0 || power > 1) throw new Error('Invalid power');
    if (!canRelease(this.balls, x)) throw new Error('You can’t release the ball there');
    const isJack = this.phase === 'jack';
    const n = isJack ? JACK : this.left[i][0];
    clearTimeout(this.timer);
    this.players[i].misses = 0;
    this.rolls++;

    const before = this.balls.map((b) => ({ ...b }));
    const pinsBefore = this.pins.map((p) => ({ ...p }));
    const res = new Sim(before, pinsBefore, { n, x, dx, dy, power }).run();
    const pts = pinPoints(this.colors, i, res.knocked, { isJackRoll: isJack, pinPoints: this.r.pinPoints });
    this.phase = 'rolling';
    this.io().to(this.channel).emit('kb:roll', {
      game: this.id, roller: i, n, before, pins: pinsBefore, roll: { x, dx, dy, power }, after: res.balls, pinsAfter: res.pins, ms: res.ms,
    });
    this.timer = setTimeout(() => (isJack ? this.afterJack(i, res) : this.afterBall(i, n, res, pts)), d(res.ms + 700));
    return { ok: true };
  }

  afterJack(i, res) {
    const jack = res.balls[JACK];
    if (!(jack.on && jack.y < MIDLINE)) {
      // jack didn't pass the midline → take it back, the other player rolls the jack
      this.lastEvent = { type: 'badJack', by: i };
      this.jackBy = 1 - i;
      return this.setTurn(1 - i, 'jack');
    }
    this.balls = res.balls.map((b) => ({ ...b }));
    this.pins = freshPins(); // pins hit by the jack roll are simply stood back up
    this.lastEvent = { type: 'jack', by: i, pinsReset: res.knocked.length > 0 };
    return this.setTurn(i, 'roll'); // the jack roller rolls the first ball
  }

  afterBall(i, n, res, pts) {
    this.balls = res.balls.map((b) => ({ ...b }));
    this.pins = res.pins.map((p) => ({ ...p }));
    this.players.forEach((p, k) => { p.score += pts.delta[k]; });
    this.left[i] = this.left[i].filter((x) => x !== n);
    this.lastEvent = pts.legal || pts.fouls.length ? { type: 'pins', by: i, legal: pts.legal, fouls: pts.fouls, delta: pts.delta } : null;
    this.nextRoller(i);
  }

  /** Bocce order: the player who is not closest rolls; if they're out of balls, the other one does. */
  nextRoller(last) {
    if (!this.left[0].length && !this.left[1].length) return this.endFrame();
    const closest = closestPlayer(this.colors, this.balls);
    let next = closest === null ? 1 - last : 1 - closest;
    if (!this.left[next].length) next = 1 - next;
    this.setTurn(next, 'roll');
  }

  endFrame() {
    clearTimeout(this.timer);
    const fs = frameScore(this.colors, this.balls);
    if (fs.winner !== null) this.players[fs.winner].score += fs.points;
    this.frames.push({ winner: fs.winner, points: fs.points, scores: this.players.map((p) => p.score) });
    this.frameResult = fs;
    this.phase = 'frameEnd';
    if (fs.winner !== null) this.jackBy = fs.winner; else this.jackBy = 1 - this.jackBy;

    const [a, b] = this.players.map((p) => p.score);
    const reached = Math.max(a, b) >= this.r.target;
    const capped = this.frame >= this.r.maxFrames;
    if (a !== b && (reached || capped)) {
      const w = a > b ? 0 : 1;
      this.broadcast();
      this.timer = setTimeout(() => this.finish(w, reached ? `reached ${this.r.target} points` : `led after ${this.frame} frames`), d(2500));
      return;
    }
    this.broadcast();
    this.timer = setTimeout(() => this.newFrame(), d(3500));
  }

  onTimeout() {
    const i = this.turn;
    const p = this.players[i];
    p.misses++;
    if (p.misses >= this.r.maxMisses) return this.forfeit(i, 'ran out of time too many times');
    this.lastEvent = { type: 'timeout', by: i };
    if (this.phase === 'jack') { this.jackBy = 1 - i; return this.setTurn(1 - i, 'jack'); }
    this.left[i].shift(); // that ball is lost for this frame
    this.nextRoller(i);
  }

  forfeit(i, reason) {
    if (this.phase === 'over' || this.players[i].out) return;
    this.players[i].out = true;
    this.io().to(this.channel).emit('kb:event', { game: this.id, name: this.players[i].name, reason });
    this.finish(1 - i, `${this.players[i].name} ${reason}`);
  }

  finish(w, how) {
    clearTimeout(this.timer);
    this.phase = 'over';
    const winner = this.players[w];
    if (this.practice) {
      this.result = { winner: w, winnerName: winner.name, prize: 0, how, practice: true };
      this.broadcast();
      for (const p of this.players) this.mgr.userLoc.delete(p.uid);
      this.mgr.emitLobby();
      setTimeout(() => this.mgr.games.delete(this.id), 60 * 1000);
      return;
    }
    settleKerenbula(this.roundId, winner.uid, this.prize, {
      stake: this.stake, pot: this.pot, payout: this.prize, house: this.pot - this.prize,
      players: this.players.map((p) => ({ userId: p.uid, name: p.name, color: p.color, score: p.score, out: p.out })),
      frames: this.frame, rolls: this.rolls, how, duration_sec: Math.round((Date.now() - this.startedAt) / 1000),
      note: `Kerenbula ${fmt(this.stake)} win`,
    });
    this.mgr.onBalanceChange(winner.uid);
    this.result = { winner: w, winnerName: winner.name, prize: this.prize, how };
    this.broadcast();
    for (const p of this.players) {
      this.mgr.userLoc.delete(p.uid);
      notifyUser(p.uid, p === winner
        ? tr(p.uid, 'kbWon', { amount: money(this.prize) })
        : tr(p.uid, 'kbLost', { name: winner.name }));
    }
    this.mgr.emitLobby();
    setTimeout(() => this.mgr.games.delete(this.id), 60 * 1000);
  }

  resign(uid) {
    const i = this.indexOf(uid);
    if (i >= 0) this.forfeit(i, 'resigned');
  }

  stop() { clearTimeout(this.timer); clearTimeout(this.botTimer); }

  stateFor(uid) {
    return {
      id: this.id, stake: this.stake, pot: this.pot, prize: this.prize, phase: this.phase, practice: this.practice,
      turn: this.turn, me: this.indexOf(uid), frame: this.frame, jackBy: this.jackBy,
      target: this.r.target, maxFrames: this.r.maxFrames, pinPoints: this.r.pinPoints,
      balls: (this.balls || freshBalls()).map(({ n, x, y, on }) => ({ n, x, y, on })),
      pins: (this.pins || freshPins()).map(({ x, y, color, up, by, fx, fy }) => ({ x, y, color, up, by, fx, fy })),
      next: this.phase === 'jack' ? JACK : this.left?.[this.turn]?.[0] ?? null,
      deadlineLeftMs: this.phase === 'jack' || this.phase === 'roll' ? Math.max(0, this.deadline - Date.now()) : null,
      rollSec: this.r.rollSec, maxMisses: this.r.maxMisses,
      players: this.players.map((p, k) => ({ name: p.name, color: p.color, score: p.score, misses: p.misses, out: p.out, left: this.left ? this.left[k].length : 4 })),
      lastEvent: this.lastEvent, frameResult: this.frameResult, result: this.result,
    };
  }

  broadcast() {
    const room = this.io().sockets.adapter.rooms.get(this.channel);
    for (const sid of room || []) {
      const sock = this.io().sockets.sockets.get(sid);
      if (sock) sock.emit('kb:state', this.stateFor(sock.data.user.id));
    }
  }

  adminInfo() {
    return {
      id: this.id, stake: this.stake, phase: this.phase, frame: this.frame, rolls: this.rolls,
      players: this.players.map((p) => `${p.name} (${p.color}, ${p.score})`).join(' vs '),
      minutes: Math.round((Date.now() - this.startedAt) / 60000),
    };
  }
}

export class KerenbulaManager {
  constructor(io, onBalanceChange, manager) {
    this.io = io;
    this.onBalanceChange = onBalanceChange;
    this.manager = manager;
    this.tables = new Map(cfg().stakes.map((stake) => [stake, { stake, waiting: [], roundId: null }]));
    this.games = new Map();
    this.userLoc = new Map(); // uid -> { queue: stake } | { game: id }
  }

  practice(user) { return startPractice(this, user, { size: 2 }); }

  join(user, stake, opts = {}) {
    const uid = String(user.id);
    if (this.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
    if (this.userLoc.has(uid)) throw new Error('You are already at a Kerenbula table');
    let t = opts.code ? privateTable(this, opts.code) : this.tables.get(Number(stake));
    if (!t) throw new Error('No such table');
    if (opts.private && !opts.code) t = createPrivateTable(this, t.stake, 2);
    assertNotFrozen(uid);
    assertNotSamePerson(uid, t.waiting.map((w) => w.uid)); // no playing yourself from a second account
    if (!t.roundId) t.roundId = openRound(t.stake, 'kerenbula');
    if (!debit(uid, t.stake, 'bet', `Kerenbula ${fmt(t.stake)} entry`, t.roundId)) throw new Error('Insufficient balance. Please deposit first.');
    this.onBalanceChange(uid);
    t.waiting.push({ uid, name: user.first_name || user.username || 'Player' });
    this.userLoc.set(uid, { queue: t.key || t.stake });
    if (t.waiting.length >= 2) this.startGame(t);
    else this.emitLobby();
    return this.locationOf(uid);
  }

  leave(user) {
    const uid = String(user.id);
    const loc = this.userLoc.get(uid);
    if (!loc) return null;
    if (loc.game) { this.games.get(loc.game)?.resign(uid); return null; }
    const t = this.tables.get(loc.queue);
    t.waiting = t.waiting.filter((w) => w.uid !== uid);
    credit(uid, t.stake, 'refund', `Kerenbula ${fmt(t.stake)} left the table`, t.roundId);
    this.onBalanceChange(uid);
    this.userLoc.delete(uid);
    dropPrivateIfDone(this, t);
    this.emitLobby();
    return null;
  }

  startGame(t) {
    const members = t.waiting.slice(0, 2);
    const game = new KerenbulaGame(this, { stake: t.stake, roundId: t.roundId, members, practice: !!t.practice });
    t.waiting = t.waiting.slice(2);
    t.roundId = null;
    t.started = true;
    dropPrivateIfDone(this, t);
    this.games.set(game.id, game);
    for (const m of members) {
      if (m.bot) continue;
      this.userLoc.set(m.uid, { game: game.id });
      this.io.in(`user:${m.uid}`).socketsJoin(game.channel);
      this.io.to(`user:${m.uid}`).emit('kb:me', { game: game.id });
      const other = members.find((x) => x !== m).name;
      if (!t.practice) notifyUser(m.uid, tr(m.uid, 'kbStarted', { name: other }));
    }
    game.start();
    this.emitLobby();
  }

  game(uid) {
    const loc = this.userLoc.get(String(uid));
    if (!loc?.game) throw new Error('You are not in a Kerenbula match');
    return this.games.get(loc.game);
  }

  locationOf(uid) {
    const loc = this.userLoc.get(String(uid));
    if (!loc) return null;
    if (loc.game) return { game: loc.game };
    const t = this.tables.get(loc.queue);
    return { queue: { stake: t.stake, waiting: t.waiting.length, code: t.private || null } };
  }

  lobby() {
    return {
      tables: [...this.tables.values()].filter((t) => !t.private).map((t) => ({ stake: t.stake, waiting: t.waiting.length, prize: Math.floor(t.stake * 2 * (1 - cfg().houseCut)) })).sort((a, b) => a.stake - b.stake),
      playing: [...this.games.values()].filter((g) => g.phase !== 'over' && !g.practice).length * 2,
      paused: !!this.manager?.paused,
    };
  }

  emitLobby() {
    this.io.to('kb-lobby').emit('kb:lobby', this.lobby());
    this.io.to('lobby').emit('kb:home', this.lobby());
    for (const [uid] of this.userLoc) this.io.to(`user:${uid}`).emit('kb:me', this.locationOf(uid));
  }

  /** Entry fees changed in Admin → Settings: add new tables; close removed ones (refunding anyone waiting). */
  syncTables() {
    const want = new Map(cfg().stakes.map((stake) => ({ stake })).map((t) => [((t) => t.stake)(t), t]));
    for (const [k, t] of want) if (!this.tables.has(k)) this.tables.set(k, { ...t, waiting: [], roundId: null });
    for (const [k, t] of [...this.tables]) {
      if (t.private || want.has(k)) continue;
      for (const w of [...t.waiting]) this.leave({ id: w.uid });
      this.tables.delete(k);
    }
    this.emitLobby();
  }

  pauseNow() {
    let any = false;
    for (const t of this.tables.values()) {
      if (t.roundId && t.waiting.length) {
        for (const { userId } of refundRound(t.roundId, `Kerenbula ${fmt(t.stake)}`, 'refunded (games paused)', 'cancelled')) this.onBalanceChange(userId);
        any = true;
      }
      for (const w of t.waiting) this.userLoc.delete(w.uid);
      t.waiting = [];
      t.roundId = null;
    }
    this.emitLobby();
    return any;
  }

  stop() { for (const g of this.games.values()) g.stop(); }

  adminSnapshot() {
    return {
      waiting: [...this.tables.values()].filter((t) => t.waiting.length).map((t) => ({ stake: t.stake, waiting: t.waiting.length })),
      games: [...this.games.values()].filter((g) => g.phase !== 'over').map((g) => g.adminInfo()),
    };
  }
}
