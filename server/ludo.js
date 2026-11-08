// Ludo for money: 2- or 4-player tables, winner takes the pot minus the house cut.
//
// Flow: a player picks a table (stake + size) and pays the entry fee → waits until the table fills
// (can leave for a full refund) → the game starts → first player to bring all tokens home wins.
//
// Fair play:
//  • Dice are rolled on the server from a per-game secret seed. Its hash is shown when the game
//    starts and the seed is revealed at the end, so every roll can be checked:
//    roll #n = first byte < 252 of HMAC_SHA256(seed, "ludo:n"), mapped to 1–6.
//  • Each turn has a timer. If it runs out, the server plays for you; after LUDO_MAX_MISSES
//    missed turns in a row you forfeit (so nobody can stall a game).
import crypto from 'node:crypto';
import { config } from './config.js';
import { debit, credit, openRound, refundRound, settleLudo } from './db.js';
import { notifyUser } from './bot.js';
import { tr } from './i18n.js';
import { fmt } from '../shared/money.js';
import { COLORS, SEATS_FOR, legalMoves, applyMove, hasWon, bestMove } from '../shared/ludo.js';

const money = (c) => `${fmt(c)} ${config.currency}`;
// Pauses between actions (dice animation etc.). LUDO_DELAY_SCALE < 1 only for automated tests.
const d = (ms) => Math.round(ms * config.ludo.delayScale);
let nextGameId = 1;

function makeDice(seed) {
  let n = 0;
  return () => {
    for (;;) {
      const bytes = crypto.createHmac('sha256', seed).update(`ludo:${n++}`).digest();
      for (const b of bytes) if (b < 252) return 1 + (b % 6); // 252 = 6*42 → no bias
    }
  };
}

class LudoGame {
  constructor(mgr, { stake, size, roundId, members }) {
    this.mgr = mgr;
    this.id = nextGameId++;
    this.stake = stake;
    this.size = size;
    this.roundId = roundId;
    this.channel = `ludo:${this.id}`;
    const seats = SEATS_FOR[size];
    this.players = members.map((m, i) => ({
      uid: m.uid, name: m.name, seat: seats[i], color: COLORS[seats[i]],
      tokens: Array(config.ludo.tokens).fill(-1), misses: 0, out: false,
    }));
    this.seed = crypto.randomBytes(32).toString('hex');
    this.hash = crypto.createHash('sha256').update(this.seed).digest('hex');
    this.dice = makeDice(this.seed);
    this.rolls = 0;
    this.turn = 0;
    this.sixes = 0;
    this.phase = 'starting';
    this.startedAt = Date.now();
    this.result = null;
  }

  get pot() { return this.stake * this.size; }
  get prize() { return Math.floor(this.pot * (1 - config.ludo.houseCut)); }
  indexOf(uid) { return this.players.findIndex((p) => p.uid === String(uid)); }

  start() {
    this.broadcast();
    this.timer = setTimeout(() => this.setTurn(0), d(1500));
  }

  // ---------------- turn flow ----------------
  setTurn(i) {
    clearTimeout(this.timer);
    this.turn = i;
    this.phase = 'roll';
    this.roll = null;
    this.legal = [];
    this.deadline = Date.now() + config.ludo.turnSec * 1000;
    this.timer = setTimeout(() => this.onTimeout(), config.ludo.turnSec * 1000);
    this.broadcast();
  }

  nextTurn() {
    this.sixes = 0;
    let i = this.turn;
    for (let k = 0; k < this.players.length; k++) {
      i = (i + 1) % this.players.length;
      if (!this.players[i].out) return this.setTurn(i);
    }
  }

  doRoll(auto) {
    clearTimeout(this.timer);
    const p = this.players[this.turn];
    if (!auto) p.misses = 0;
    const value = this.dice();
    this.rolls++;
    this.roll = value;
    this.sixes = value === 6 ? this.sixes + 1 : 0;
    this.phase = 'rolled';
    this.io().to(this.channel).emit('ludo:roll', { game: this.id, seat: p.seat, value });

    if (this.sixes === 3) { // third six in a row: turn is lost
      this.legal = [];
      this.broadcast();
      this.timer = setTimeout(() => this.nextTurn(), d(1300));
      return;
    }
    this.legal = legalMoves(p.tokens, value);
    if (this.legal.length === 0) {
      this.broadcast();
      this.timer = setTimeout(() => this.nextTurn(), d(1200));
    } else if (this.legal.length === 1 || auto) {
      // Only one possible move (or the player ran out of time): play it automatically
      const t = this.legal.length === 1 ? this.legal[0] : bestMove(this.players, this.turn, value);
      this.broadcast();
      this.timer = setTimeout(() => this.doMove(t), d(750));
    } else {
      this.phase = 'move';
      this.deadline = Date.now() + config.ludo.turnSec * 1000;
      this.broadcast();
      this.timer = setTimeout(() => this.onTimeout(), config.ludo.turnSec * 1000);
    }
  }

  doMove(tokenIndex) {
    clearTimeout(this.timer);
    const p = this.players[this.turn];
    const res = applyMove(this.players, this.turn, tokenIndex, this.roll);
    this.phase = 'anim';
    this.legal = [];
    this.io().to(this.channel).emit('ludo:move', {
      game: this.id, seat: p.seat, token: tokenIndex, from: res.from, to: res.to, home: res.home,
      captured: res.captured.map((c) => ({ seat: this.players[c.player].seat, token: c.token, from: c.from })),
    });
    const steps = res.from < 0 ? 1 : res.to - res.from;
    const animMs = steps * config.ludo.stepMs + (res.captured.length ? 650 : 0) + 300;
    this.timer = setTimeout(() => {
      if (hasWon(p.tokens)) return this.finish(this.turn, 'all tokens home');
      if (res.extraTurn && this.sixes < 3) return this.setTurn(this.turn);
      return this.nextTurn();
    }, d(animMs));
  }

  onTimeout() {
    const p = this.players[this.turn];
    p.misses++;
    if (p.misses >= config.ludo.maxMisses) return this.forfeit(this.turn, 'missed too many turns');
    if (this.phase === 'roll') return this.doRoll(true);
    if (this.phase === 'move') return this.doMove(bestMove(this.players, this.turn, this.roll));
  }

  forfeit(i, reason) {
    const p = this.players[i];
    if (p.out || this.phase === 'over') return;
    p.out = true;
    p.outReason = reason;
    p.tokens = p.tokens.map(() => -1);
    this.io().to(this.channel).emit('ludo:event', { game: this.id, text: `${p.name} left the game (${reason})` });
    const left = this.players.filter((x) => !x.out);
    if (left.length === 1) return this.finish(this.players.indexOf(left[0]), `${p.name} ${reason}`);
    if (i === this.turn) this.nextTurn();
    else this.broadcast();
  }

  finish(winnerIndex, how) {
    clearTimeout(this.timer);
    this.phase = 'over';
    const w = this.players[winnerIndex];
    const payout = this.prize;
    settleLudo(this.roundId, w.uid, payout, {
      stake: this.stake, size: this.size, pot: this.pot, payout, house: this.pot - payout,
      players: this.players.map((p) => ({ userId: p.uid, name: p.name, color: p.color, out: p.out })),
      rolls: this.rolls, duration_sec: Math.round((Date.now() - this.startedAt) / 1000),
      seed: this.seed, hash: this.hash, note: `Ludo ${fmt(this.stake)} win`,
    });
    this.mgr.onBalanceChange(w.uid);
    this.result = { winnerSeat: w.seat, winnerName: w.name, prize: payout, how };
    this.broadcast();
    for (const p of this.players) {
      this.mgr.userLoc.delete(p.uid);
      notifyUser(p.uid, p === w ? tr(p.uid, 'ludoWon', { amount: money(payout) }) : tr(p.uid, 'ludoLost', { name: w.name }));
    }
    this.mgr.emitLobby();
    // keep the finished game visible for a minute, then forget it
    setTimeout(() => this.mgr.games.delete(this.id), 60 * 1000);
  }

  // ---------------- player actions ----------------
  actRoll(uid) {
    const i = this.indexOf(uid);
    if (i !== this.turn || this.phase !== 'roll') throw new Error("It's not your turn to roll");
    this.doRoll(false);
  }

  actMove(uid, token) {
    const i = this.indexOf(uid);
    if (i !== this.turn || this.phase !== 'move') throw new Error("It's not your turn to move");
    token = Number(token);
    if (!this.legal.includes(token)) throw new Error('That token can’t move');
    this.players[i].misses = 0;
    this.doMove(token);
  }

  resign(uid) {
    const i = this.indexOf(uid);
    if (i >= 0) this.forfeit(i, 'resigned');
  }

  stop() { clearTimeout(this.timer); }

  // ---------------- state ----------------
  io() { return this.mgr.io; }

  stateFor(uid) {
    const me = this.indexOf(uid);
    return {
      id: this.id, stake: this.stake, size: this.size, pot: this.pot, prize: this.prize,
      phase: this.phase, turnSeat: this.players[this.turn]?.seat, roll: this.roll,
      legal: me === this.turn ? this.legal : [],
      deadlineLeftMs: ['roll', 'move'].includes(this.phase) ? Math.max(0, this.deadline - Date.now()) : null,
      turnSec: config.ludo.turnSec,
      mySeat: me >= 0 ? this.players[me].seat : null,
      players: this.players.map((p) => ({ name: p.name, seat: p.seat, color: p.color, tokens: p.tokens, out: p.out, misses: p.misses })),
      hash: this.hash,
      seed: this.phase === 'over' ? this.seed : null,
      result: this.result,
      maxMisses: config.ludo.maxMisses,
    };
  }

  broadcast() {
    const room = this.io().sockets.adapter.rooms.get(this.channel);
    for (const sid of room || []) {
      const sock = this.io().sockets.sockets.get(sid);
      if (sock) sock.emit('ludo:state', this.stateFor(sock.data.user.id));
    }
  }

  adminInfo() {
    return {
      id: this.id, stake: this.stake, size: this.size, phase: this.phase,
      players: this.players.map((p) => `${p.name} (${p.color}${p.out ? ', out' : ''})`).join(', '),
      rolls: this.rolls, minutes: Math.round((Date.now() - this.startedAt) / 60000),
    };
  }
}

export class LudoManager {
  constructor(io, onBalanceChange, manager) {
    this.io = io;
    this.onBalanceChange = onBalanceChange;
    this.manager = manager;
    this.tables = new Map(); // `${stake}:${size}` -> { stake, size, waiting: [{uid,name}], roundId }
    for (const stake of config.ludo.stakes) for (const size of [2, 4]) this.tables.set(`${stake}:${size}`, { stake, size, waiting: [], roundId: null });
    this.games = new Map();
    this.userLoc = new Map(); // uid -> { queue: key } | { game: id }
  }

  table(stake, size) {
    const t = this.tables.get(`${Number(stake)}:${Number(size)}`);
    if (!t) throw new Error('No such table');
    return t;
  }

  join(user, stake, size) {
    const uid = String(user.id);
    if (this.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
    if (this.userLoc.has(uid)) throw new Error('You are already at a Ludo table');
    const t = this.table(stake, size);
    if (!t.roundId) t.roundId = openRound(t.stake, 'ludo');
    if (!debit(uid, t.stake, 'bet', `Ludo ${fmt(t.stake)} entry (${t.size} players)`, t.roundId)) {
      throw new Error('Insufficient balance. Please deposit first.');
    }
    this.onBalanceChange(uid);
    t.waiting.push({ uid, name: user.first_name || user.username || 'Player' });
    this.userLoc.set(uid, { queue: `${t.stake}:${t.size}` });
    if (t.waiting.length >= t.size) this.startGame(t);
    else this.emitLobby();
    return this.locationOf(uid);
  }

  leave(user) {
    const uid = String(user.id);
    const loc = this.userLoc.get(uid);
    if (!loc) return null;
    if (loc.game) {
      this.games.get(loc.game)?.resign(uid);
      return null;
    }
    const t = this.tables.get(loc.queue);
    t.waiting = t.waiting.filter((w) => w.uid !== uid);
    credit(uid, t.stake, 'refund', `Ludo ${fmt(t.stake)} left the table`, t.roundId);
    this.onBalanceChange(uid);
    this.userLoc.delete(uid);
    this.emitLobby();
    return null;
  }

  startGame(t) {
    const members = t.waiting.slice(0, t.size);
    const game = new LudoGame(this, { stake: t.stake, size: t.size, roundId: t.roundId, members });
    t.waiting = t.waiting.slice(t.size);
    t.roundId = null;
    this.games.set(game.id, game);
    for (const m of members) {
      this.userLoc.set(m.uid, { game: game.id });
      this.io.in(`user:${m.uid}`).socketsJoin(game.channel);
      this.io.to(`user:${m.uid}`).emit('ludo:me', { game: game.id });
      const others = members.filter((x) => x !== m).map((x) => x.name).join(', ');
      notifyUser(m.uid, tr(m.uid, 'ludoStarted', { names: others }));
    }
    game.start();
    this.emitLobby();
  }

  game(uid) {
    const loc = this.userLoc.get(String(uid));
    if (!loc?.game) throw new Error('You are not in a Ludo game');
    return this.games.get(loc.game);
  }

  locationOf(uid) {
    const loc = this.userLoc.get(String(uid));
    if (!loc) return null;
    if (loc.game) return { game: loc.game };
    const t = this.tables.get(loc.queue);
    return { queue: { stake: t.stake, size: t.size, waiting: t.waiting.length } };
  }

  lobby() {
    return {
      tables: [...this.tables.values()].map((t) => ({ stake: t.stake, size: t.size, waiting: t.waiting.length,
        prize: Math.floor(t.stake * t.size * (1 - config.ludo.houseCut)) })),
      playing: this.games.size ? [...this.games.values()].filter((g) => g.phase !== 'over').reduce((s, g) => s + g.size, 0) : 0,
      paused: !!this.manager?.paused,
    };
  }

  emitLobby() {
    this.io.to('ludo-lobby').emit('ludo:lobby', this.lobby());
    this.io.to('lobby').emit('ludo:home', this.lobby());
    for (const [uid] of this.userLoc) this.io.to(`user:${uid}`).emit('ludo:me', this.locationOf(uid));
  }

  /** Pause: refund everyone waiting at a table. Games in progress finish normally. */
  pauseNow() {
    let any = false;
    for (const t of this.tables.values()) {
      if (t.roundId && t.waiting.length) {
        for (const { userId } of refundRound(t.roundId, `Ludo ${fmt(t.stake)}`, 'refunded (games paused)', 'cancelled')) this.onBalanceChange(userId);
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
