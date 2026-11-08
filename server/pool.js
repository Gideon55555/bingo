// Pool for money. 2 players: 8-ball. 3–6 players: Cutthroat. Winner takes the pot minus the house cut.
//
// Every shot is simulated here on the server with the shared deterministic physics, so the
// result can't be faked by a modified app. Clients only send: where to put the cue ball (when
// they have ball in hand), the aim direction and the power.
import crypto from 'node:crypto';
import { config } from './config.js';
import { debit, credit, openRound, refundRound, settlePool } from './db.js';
import { notifyUser } from './bot.js';
import { fmt } from '../shared/money.js';
import {
  rack, Sim, judge, canPlaceCue, respot, cloneBalls, SOLIDS, STRIPES,
  cutthroatSets, rackCutthroat, judgeCutthroat, aliveFromBalls,
} from '../shared/pool.js';
import { assertNotFrozen, assertNotSamePerson } from './risk.js';
import { tr } from './i18n.js';
import { BOT_UID, startPractice, createPrivateTable, privateTable, dropPrivateIfDone } from './social.js';
import { poolShot } from '../shared/bots.js';

const money = (c) => `${fmt(c)} ${config.currency}`;
const d = (ms) => Math.round(ms * config.pool.delayScale);
const cryptoRand = () => crypto.randomInt(1e9) / 1e9;
let nextId = 1;

class PoolGame {
  constructor(mgr, { stake, size, roundId, members, practice = false }) {
    this.mgr = mgr;
    this.practice = practice; // free game vs the bot: no money, not recorded
    this.cut = config.pool.houseCut; // fixed for this match
    this.id = nextId++;
    this.stake = stake;
    this.size = size;
    this.mode = size === 2 ? '8ball' : 'cutthroat';
    this.roundId = roundId;
    this.channel = `pool:${this.id}`;
    const sets = this.mode === 'cutthroat' ? cutthroatSets(size) : null;
    this.players = members.map((m, i) => ({ uid: m.uid, name: m.name, group: null, set: sets ? sets[i] : null, misses: 0, out: false, eliminated: false }));
    this.balls = this.mode === 'cutthroat' ? rackCutthroat(size, cryptoRand) : rack(cryptoRand);
    this.turn = crypto.randomInt(size); // who breaks
    this.breakShot = true;
    this.ballInHand = true;          // behind the head line on the break
    this.shots = 0;
    this.phase = 'starting';
    this.lastFoul = null;
    this.startedAt = Date.now();
    this.result = null;
  }

  get pot() { return this.stake * this.size; }
  get prize() { return Math.floor(this.pot * (1 - this.cut)); }
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
    if (this.players[i].uid === BOT_UID) this.botTimer = setTimeout(() => this.botShoot(), d(1500));
  }

  botShoot() {
    if (this.phase !== 'aim' || this.players[this.turn].uid !== BOT_UID) return;
    try { this.shoot(BOT_UID, poolShot(this.stateFor(BOT_UID))); } catch {
      try { this.shoot(BOT_UID, { dx: Math.random() - 0.5, dy: -1, power: 0.6, cue: this.ballInHand ? { x: 50, y: this.breakShot ? 170 : 150 } : undefined }); } catch { /* the shot clock will handle it */ }
    }
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
    const verdict = this.mode === 'cutthroat'
      ? judgeCutthroat({ turn: i, breakShot: this.breakShot, sets: this.players.map((p) => p.set), alive: this.players.map((p) => !p.out && !p.eliminated) }, before, { ...res })
      : judge({ groups: this.players.map((p) => p.group), turn: i, breakShot: this.breakShot }, before, res);
    this.phase = 'shooting';
    this.io().to(this.channel).emit('pool:shot', {
      game: this.id, shooter: i, before, shot: { dx, dy, power }, after: res.balls, ms: res.ms,
      foul: verdict.foul ? verdict.reason : null, potted: res.potted,
    });
    this.timer = setTimeout(() => this.afterShot(i, res, verdict), d(res.ms + 700));
    return { ok: true };
  }

  /** Next player still in the game after seat i. */
  nextAlive(i) {
    for (let k = 1; k <= this.players.length; k++) {
      const j = (i + k) % this.players.length;
      if (!this.players[j].out && !this.players[j].eliminated) return j;
    }
    return i;
  }

  afterShot(i, res, v) {
    this.balls = res.balls.map((b) => ({ ...b, vx: 0, vy: 0 }));
    this.breakShot = false;
    if (this.mode === 'cutthroat') return this.afterCutthroat(i, v);
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
      return this.setTurn(this.nextAlive(i));
    }
    this.ballInHand = false;
    return this.setTurn(v.keepTurn ? i : this.nextAlive(i));
  }

  afterCutthroat(i, v) {
    for (const n of v.returnBalls) respot(this.balls, n);
    const alive = aliveFromBalls(this.players.map((p) => p.set), this.balls);
    this.players.forEach((p, k) => { if (!p.out && !alive[k] && !p.eliminated) p.eliminated = true; });
    const left = this.players.filter((p) => !p.out && !p.eliminated);
    if (left.length <= 1) {
      const w = left.length === 1 ? this.players.indexOf(left[0]) : i; // nobody left → the shooter made it
      return this.finish(w, 'last player with balls on the table');
    }
    this.lastFoul = v.foul ? { by: this.players[i].name, reason: v.reason, returned: v.returnBalls } : null;
    if (v.foul) {
      this.ballInHand = true;
      this.balls[0].in = false;
      return this.setTurn(this.nextAlive(i));
    }
    this.ballInHand = false;
    const shooterIn = !this.players[i].eliminated;
    return this.setTurn(v.keepTurn && shooterIn ? i : this.nextAlive(i));
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
    this.setTurn(this.nextAlive(i));
  }

  forfeit(i, reason) {
    if (this.phase === 'over' || this.players[i].out) return;
    this.players[i].out = true;
    this.io().to(this.channel).emit('pool:event', { game: this.id, name: this.players[i].name, reason });
    const left = this.players.filter((p) => !p.out && !p.eliminated);
    if (left.length <= 1) return this.finish(this.players.indexOf(left[0] || this.players[1 - i]), `${this.players[i].name} ${reason}`);
    if (i === this.turn) { this.ballInHand = true; this.balls[0].in = false; this.setTurn(this.nextAlive(i)); } else this.broadcast();
  }

  finish(w, how) {
    clearTimeout(this.timer);
    this.phase = 'over';
    const winner = this.players[w];
    if (this.practice) return this.finishPractice(w, how);
    settlePool(this.roundId, winner.uid, this.prize, {
      stake: this.stake, pot: this.pot, payout: this.prize, house: this.pot - this.prize,
      players: this.players.map((p) => ({ userId: p.uid, name: p.name, group: p.group || (p.set ? `${p.set[0]}–${p.set[p.set.length - 1]}` : null), out: p.out })),
      shots: this.shots, how, duration_sec: Math.round((Date.now() - this.startedAt) / 1000),
      note: `8-Ball Pool ${fmt(this.stake)} win`,
    });
    this.mgr.onBalanceChange(winner.uid);
    this.result = { winner: w, winnerName: winner.name, prize: this.prize, how };
    this.broadcast();
    for (const p of this.players) {
      this.mgr.userLoc.delete(p.uid);
      notifyUser(p.uid, p === winner
        ? tr(p.uid, 'poolWon', { amount: money(this.prize) })
        : tr(p.uid, 'poolLost', { name: winner.name }));
    }
    this.mgr.emitLobby();
    setTimeout(() => this.mgr.games.delete(this.id), 60 * 1000);
  }

  finishPractice(w, how) {
    this.result = { winner: w, winnerName: this.players[w].name, prize: 0, how, practice: true };
    this.broadcast();
    for (const p of this.players) this.mgr.userLoc.delete(p.uid);
    this.mgr.emitLobby();
    setTimeout(() => this.mgr.games.delete(this.id), 60 * 1000);
  }

  resign(uid) {
    const i = this.indexOf(uid);
    if (i >= 0) this.forfeit(i, 'resigned');
  }

  stop() { clearTimeout(this.timer); clearTimeout(this.botTimer); }

  stateFor(uid) {
    const me = this.indexOf(uid);
    const left = (g) => (g ? (g === 'solids' ? SOLIDS : STRIPES).filter((n) => !this.balls.find((b) => b.n === n).in).length : null);
    return {
      id: this.id, stake: this.stake, size: this.size, mode: this.mode, pot: this.pot, prize: this.prize, phase: this.phase, practice: this.practice,
      turn: this.turn, me, balls: this.balls.map(({ n, x, y, in: inn }) => ({ n, x, y, in: inn })),
      ballInHand: this.ballInHand, breakShot: this.breakShot, lastFoul: this.lastFoul,
      deadlineLeftMs: this.phase === 'aim' ? Math.max(0, this.deadline - Date.now()) : null,
      shotSec: config.pool.shotSec, maxMisses: config.pool.maxMisses,
      players: this.players.map((p) => ({
        name: p.name, group: p.group, set: p.set, misses: p.misses, out: p.out, eliminated: p.eliminated,
        left: p.set ? p.set.filter((n) => !this.balls.find((b) => b.n === n)?.in).length : left(p.group),
      })),
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
      size: this.size, mode: this.mode,
      players: this.players.map((p) => `${p.name}${p.group ? ` (${p.group})` : ''}${p.eliminated ? ' (out)' : ''}`).join(' vs '),
      minutes: Math.round((Date.now() - this.startedAt) / 60000),
    };
  }
}

export class PoolManager {
  constructor(io, onBalanceChange, manager) {
    this.io = io;
    this.onBalanceChange = onBalanceChange;
    this.manager = manager;
    this.tables = new Map(); // `${stake}:${size}` -> { stake, size, waiting, roundId }
    for (const stake of config.pool.stakes) for (const size of config.pool.sizes) this.tables.set(`${stake}:${size}`, { stake, size, waiting: [], roundId: null });
    this.games = new Map();
    this.userLoc = new Map(); // uid -> { queue: stake } | { game: id }
  }

  practice(user) { return startPractice(this, user, { size: 2 }); }

  /** opts.private: create a private table to invite a friend; opts.code: join a friend's private table. */
  join(user, stake, size = 2, opts = {}) {
    const uid = String(user.id);
    if (this.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
    if (this.userLoc.has(uid)) throw new Error('You are already at a pool table');
    let t = opts.code ? privateTable(this, opts.code) : this.tables.get(`${Number(stake)}:${Number(size)}`);
    if (!t) throw new Error('No such table');
    if (opts.private && !opts.code) t = createPrivateTable(this, t.stake, t.size);
    assertNotFrozen(uid);
    assertNotSamePerson(uid, t.waiting.map((w) => w.uid)); // no playing yourself from a second account
    if (!t.roundId) t.roundId = openRound(t.stake, 'pool');
    if (!debit(uid, t.stake, 'bet', `Pool ${fmt(t.stake)} entry (${t.size} players)`, t.roundId)) throw new Error('Insufficient balance. Please deposit first.');
    this.onBalanceChange(uid);
    t.waiting.push({ uid, name: user.first_name || user.username || 'Player' });
    this.userLoc.set(uid, { queue: t.key || `${t.stake}:${t.size}` });
    if (t.waiting.length >= t.size) this.startGame(t);
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
    dropPrivateIfDone(this, t);
    this.emitLobby();
    return null;
  }

  startGame(t) {
    const members = t.waiting.slice(0, t.size);
    const game = new PoolGame(this, { stake: t.stake, size: t.size, roundId: t.roundId, members, practice: !!t.practice });
    t.waiting = t.waiting.slice(t.size);
    t.roundId = null;
    t.started = true;
    dropPrivateIfDone(this, t);
    this.games.set(game.id, game);
    for (const m of members) {
      if (m.bot) continue;
      this.userLoc.set(m.uid, { game: game.id });
      this.io.in(`user:${m.uid}`).socketsJoin(game.channel);
      this.io.to(`user:${m.uid}`).emit('pool:me', { game: game.id });
      const others = members.filter((x) => x !== m).map((x) => x.name).join(', ');
      if (!t.practice) notifyUser(m.uid, tr(m.uid, 'poolStarted', { names: others }));
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
    const t = this.tables.get(loc.queue);
    return { queue: { stake: t.stake, size: t.size, waiting: t.waiting.length, code: t.private || null } };
  }

  lobby() {
    return {
      tables: [...this.tables.values()].filter((t) => !t.private).map((t) => ({ stake: t.stake, size: t.size, waiting: t.waiting.length, prize: Math.floor(t.stake * t.size * (1 - config.pool.houseCut)) })).sort((a, b) => a.stake - b.stake || a.size - b.size),
      playing: [...this.games.values()].filter((g) => g.phase !== 'over' && !g.practice).reduce((s, g) => s + g.size, 0),
      paused: !!this.manager?.paused,
    };
  }

  emitLobby() {
    this.io.to('pool-lobby').emit('pool:lobby', this.lobby());
    this.io.to('lobby').emit('pool:home', this.lobby());
    for (const [uid] of this.userLoc) this.io.to(`user:${uid}`).emit('pool:me', this.locationOf(uid));
  }

  /** Entry fees changed in Admin → Settings: add new tables; close removed ones (refunding anyone waiting). */
  syncTables() {
    const want = new Map(config.pool.stakes.flatMap((stake) => config.pool.sizes.map((size) => ({ stake, size }))).map((t) => [((t) => `${t.stake}:${t.size}`)(t), t]));
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
      waiting: [...this.tables.values()].filter((t) => t.waiting.length).map((t) => ({ stake: t.stake, size: t.size, waiting: t.waiting.length })),
      games: [...this.games.values()].filter((g) => g.phase !== 'over').map((g) => g.adminInfo()),
    };
  }
}
