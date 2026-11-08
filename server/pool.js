// 8-ball pool for money, 1 vs 1. Winner takes the pot minus the house cut.
//
// Every shot is simulated here on the server with the shared deterministic physics, so the
// result can't be faked by a modified app. Clients only send: where to put the cue ball (when
// they have ball in hand), the aim direction and the power.
import crypto from 'node:crypto';
import { config } from './config.js';
import { debit, credit, openRound, refundRound, settlePool } from './db.js';
import { notifyUser } from './bot.js';
import { fmt } from '../shared/money.js';
import { rack, Sim, judge, canPlaceCue, respot, cloneBalls, SOLIDS, STRIPES } from '../shared/pool.js';

const money = (c) => `${fmt(c)} ${config.currency}`;
const d = (ms) => Math.round(ms * config.pool.delayScale);
const cryptoRand = () => crypto.randomInt(1e9) / 1e9;
let nextId = 1;

class PoolGame {
  constructor(mgr, { stake, roundId, members }) {
    this.mgr = mgr;
    this.id = nextId++;
    this.stake = stake;
    this.roundId = roundId;
    this.channel = `pool:${this.id}`;
    this.players = members.map((m) => ({ uid: m.uid, name: m.name, group: null, misses: 0, out: false }));
    this.balls = rack(cryptoRand);
    this.turn = crypto.randomInt(2); // who breaks
    this.breakShot = true;
    this.ballInHand = true;          // behind the head line on the break
    this.shots = 0;
    this.phase = 'starting';
    this.lastFoul = null;
    this.startedAt = Date.now();
    this.result = null;
  }

  get pot() { return this.stake * 2; }
  get prize() { return Math.floor(this.pot * (1 - config.pool.houseCut)); }
  indexOf(uid) { return this.players.findIndex((p) => p.uid === String(uid)); }
  io() { return this.mgr.io; }

  start() {
    this.broadcast();
    this.timer = setTimeout(() => this.setTurn(this.turn), d(1200));
  }

  setTurn(i) {
    clearTimeout(this.timer);
    this.turn = i;
    this.phase = 'aim';
    this.deadline = Date.now() + config.pool.shotSec * 1000;
    this.timer = setTimeout(() => this.onTimeout(), config.pool.shotSec * 1000);
    this.broadcast();
  }

  shoot(uid, shot) {
    const i = this.indexOf(uid);
    if (i !== this.turn || this.phase !== 'aim') throw new Error("It's not your shot");
    const dx = Number(shot?.dx), dy = Number(shot?.dy), power = Number(shot?.power);
    if (![dx, dy, power].every(Number.isFinite) || (dx === 0 && dy === 0)) throw new Error('Invalid shot');
    if (power <= 0 || power > 1) throw new Error('Invalid power');
    const before = cloneBalls(this.balls);
    if (this.ballInHand) {
      const x = Number(shot?.cue?.x), y = Number(shot?.cue?.y);
      if (!canPlaceCue(before, x, y, this.breakShot)) throw new Error(this.breakShot ? 'Place the cue ball behind the line' : 'You can’t place the cue ball there');
      Object.assign(before[0], { x, y, in: false });
    }
    clearTimeout(this.timer);
    this.players[i].misses = 0;
    this.shots++;

    const res = new Sim(before, { dx, dy, power }).run();
    const verdict = judge({ groups: this.players.map((p) => p.group), turn: i, breakShot: this.breakShot }, before, res);
    this.phase = 'shooting';
    this.io().to(this.channel).emit('pool:shot', {
      game: this.id, shooter: i, before, shot: { dx, dy, power }, after: res.balls, ms: res.ms,
      foul: verdict.foul ? verdict.reason : null, potted: res.potted,
    });
    this.timer = setTimeout(() => this.afterShot(i, res, verdict), d(res.ms + 700));
    return { ok: true };
  }

  afterShot(i, res, v) {
    this.balls = res.balls.map((b) => ({ ...b, vx: 0, vy: 0 }));
    this.breakShot = false;
    if (v.win !== null) return this.finish(v.win, v.win === i ? 'potted the 8 ball' : v.reason);
    if (v.respot8) respot(this.balls, 8);
    if (v.assign) {
      this.players[v.assign.player].group = v.assign.group;
      this.players[1 - v.assign.player].group = v.assign.group === 'solids' ? 'stripes' : 'solids';
    }
    this.lastFoul = v.foul ? { by: this.players[i].name, reason: v.reason } : null;
    if (v.foul) {
      this.ballInHand = true;
      this.balls[0].in = false; // cue ball comes back for ball in hand
      return this.setTurn(1 - i);
    }
    this.ballInHand = false;
    return this.setTurn(v.keepTurn ? i : 1 - i);
  }

  onTimeout() {
    const i = this.turn;
    const p = this.players[i];
    p.misses++;
    if (p.misses >= config.pool.maxMisses) return this.forfeit(i, 'ran out of time too many times');
    this.lastFoul = { by: p.name, reason: 'Ran out of time' };
    this.breakShot = false;
    this.ballInHand = true;
    this.balls[0].in = false;
    this.setTurn(1 - i);
  }

  forfeit(i, reason) {
    if (this.phase === 'over') return;
    this.players[i].out = true;
    this.finish(1 - i, `${this.players[i].name} ${reason}`);
  }

  finish(w, how) {
    clearTimeout(this.timer);
    this.phase = 'over';
    const winner = this.players[w];
    settlePool(this.roundId, winner.uid, this.prize, {
      stake: this.stake, pot: this.pot, payout: this.prize, house: this.pot - this.prize,
      players: this.players.map((p) => ({ userId: p.uid, name: p.name, group: p.group, out: p.out })),
      shots: this.shots, how, duration_sec: Math.round((Date.now() - this.startedAt) / 1000),
      note: `8-Ball Pool ${fmt(this.stake)} win`,
    });
    this.mgr.onBalanceChange(winner.uid);
    this.result = { winner: w, winnerName: winner.name, prize: this.prize, how };
    this.broadcast();
    for (const p of this.players) {
      this.mgr.userLoc.delete(p.uid);
      notifyUser(p.uid, p === winner
        ? `🏆 You won the pool match! +${money(this.prize)} added to your balance.`
        : `Pool match over — ${winner.name} won. Better luck next time!`);
    }
    this.mgr.emitLobby();
    setTimeout(() => this.mgr.games.delete(this.id), 60 * 1000);
  }

  resign(uid) {
    const i = this.indexOf(uid);
    if (i >= 0) this.forfeit(i, 'resigned');
  }

  stop() { clearTimeout(this.timer); }

  stateFor(uid) {
    const me = this.indexOf(uid);
    const left = (g) => (g ? (g === 'solids' ? SOLIDS : STRIPES).filter((n) => !this.balls.find((b) => b.n === n).in).length : null);
    return {
      id: this.id, stake: this.stake, pot: this.pot, prize: this.prize, phase: this.phase,
      turn: this.turn, me, balls: this.balls.map(({ n, x, y, in: inn }) => ({ n, x, y, in: inn })),
      ballInHand: this.ballInHand, breakShot: this.breakShot, lastFoul: this.lastFoul,
      deadlineLeftMs: this.phase === 'aim' ? Math.max(0, this.deadline - Date.now()) : null,
      shotSec: config.pool.shotSec, maxMisses: config.pool.maxMisses,
      players: this.players.map((p) => ({ name: p.name, group: p.group, misses: p.misses, out: p.out, left: left(p.group) })),
      result: this.result,
    };
  }

  broadcast() {
    const room = this.io().sockets.adapter.rooms.get(this.channel);
    for (const sid of room || []) {
      const sock = this.io().sockets.sockets.get(sid);
      if (sock) sock.emit('pool:state', this.stateFor(sock.data.user.id));
    }
  }

  adminInfo() {
    return {
      id: this.id, stake: this.stake, phase: this.phase, shots: this.shots,
      players: this.players.map((p) => `${p.name}${p.group ? ` (${p.group})` : ''}`).join(' vs '),
      minutes: Math.round((Date.now() - this.startedAt) / 60000),
    };
  }
}

export class PoolManager {
  constructor(io, onBalanceChange, manager) {
    this.io = io;
    this.onBalanceChange = onBalanceChange;
    this.manager = manager;
    this.tables = new Map(config.pool.stakes.map((s) => [s, { stake: s, waiting: [], roundId: null }]));
    this.games = new Map();
    this.userLoc = new Map(); // uid -> { queue: stake } | { game: id }
  }

  join(user, stake) {
    const uid = String(user.id);
    if (this.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
    if (this.userLoc.has(uid)) throw new Error('You are already at a pool table');
    const t = this.tables.get(Number(stake));
    if (!t) throw new Error('No such table');
    if (!t.roundId) t.roundId = openRound(t.stake, 'pool');
    if (!debit(uid, t.stake, 'bet', `8-Ball Pool ${fmt(t.stake)} entry`, t.roundId)) throw new Error('Insufficient balance. Please deposit first.');
    this.onBalanceChange(uid);
    t.waiting.push({ uid, name: user.first_name || user.username || 'Player' });
    this.userLoc.set(uid, { queue: t.stake });
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
    credit(uid, t.stake, 'refund', `8-Ball Pool ${fmt(t.stake)} left the table`, t.roundId);
    this.onBalanceChange(uid);
    this.userLoc.delete(uid);
    this.emitLobby();
    return null;
  }

  startGame(t) {
    const members = t.waiting.slice(0, 2);
    const game = new PoolGame(this, { stake: t.stake, roundId: t.roundId, members });
    t.waiting = t.waiting.slice(2);
    t.roundId = null;
    this.games.set(game.id, game);
    for (const m of members) {
      this.userLoc.set(m.uid, { game: game.id });
      this.io.in(`user:${m.uid}`).socketsJoin(game.channel);
      this.io.to(`user:${m.uid}`).emit('pool:me', { game: game.id });
      const other = members.find((x) => x !== m).name;
      notifyUser(m.uid, `🎱 Your pool match against ${other} has started! Open the app — the shot clock is running.`);
    }
    game.start();
    this.emitLobby();
  }

  game(uid) {
    const loc = this.userLoc.get(String(uid));
    if (!loc?.game) throw new Error('You are not in a pool match');
    return this.games.get(loc.game);
  }

  locationOf(uid) {
    const loc = this.userLoc.get(String(uid));
    if (!loc) return null;
    if (loc.game) return { game: loc.game };
    return { queue: { stake: loc.queue, waiting: this.tables.get(loc.queue).waiting.length } };
  }

  lobby() {
    return {
      tables: [...this.tables.values()].map((t) => ({ stake: t.stake, waiting: t.waiting.length, prize: Math.floor(t.stake * 2 * (1 - config.pool.houseCut)) })),
      playing: [...this.games.values()].filter((g) => g.phase !== 'over').length * 2,
      paused: !!this.manager?.paused,
    };
  }

  emitLobby() {
    this.io.to('pool-lobby').emit('pool:lobby', this.lobby());
    this.io.to('lobby').emit('pool:home', this.lobby());
    for (const [uid] of this.userLoc) this.io.to(`user:${uid}`).emit('pool:me', this.locationOf(uid));
  }

  pauseNow() {
    let any = false;
    for (const t of this.tables.values()) {
      if (t.roundId && t.waiting.length) {
        for (const { userId } of refundRound(t.roundId, `8-Ball Pool ${fmt(t.stake)}`, 'refunded (games paused)', 'cancelled')) this.onBalanceChange(userId);
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
