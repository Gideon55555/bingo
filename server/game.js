import { config } from './config.js';
import { debit, credit, getUser, recordGame } from './db.js';
import { findWin, shuffledBalls } from './bingo.js';

/**
 * One Room per stake. Lifecycle:
 *   waiting   -> players pick cards (stake is charged on pick, refunded on unpick)
 *   countdown -> starts when minPlayers have picked; more can still join
 *   playing   -> server calls a number every callIntervalMs; players press BINGO
 *   finished  -> results shown for resultShowSec, then back to waiting
 */
export class Room {
  constructor(stake, io, onBalanceChange) {
    this.stake = stake;
    this.io = io;
    this.onBalanceChange = onBalanceChange;
    this.channel = `room:${stake}`;
    this.reset();
  }

  reset() {
    clearTimeout(this.timer);
    clearInterval(this.caller);
    this.state = 'waiting';
    this.players = new Map(); // userId -> { card, name, disqualified }
    this.cardOwners = new Map(); // cardId -> userId
    this.balls = [];
    this.called = [];
    this.calledSet = new Set();
    this.countdownEndsAt = null;
    this.result = null;
  }

  get pot() {
    return this.players.size * this.stake;
  }

  get prize() {
    return Math.floor(this.pot * (1 - config.houseCut));
  }

  summary() {
    return {
      stake: this.stake,
      state: this.state,
      players: this.players.size,
      prize: this.prize,
      // Send time *remaining* rather than a timestamp so client clock skew doesn't matter
      countdownLeftMs: this.countdownEndsAt ? Math.max(0, this.countdownEndsAt - Date.now()) : null,
    };
  }

  publicState(userId) {
    const me = userId ? this.players.get(String(userId)) : null;
    return {
      ...this.summary(),
      takenCards: [...this.cardOwners.keys()],
      called: this.called,
      myCard: me ? me.card : null,
      disqualified: me ? me.disqualified : false,
      result: this.result,
      callIntervalMs: config.callIntervalMs,
    };
  }

  broadcast() {
    // Each socket gets its own view (myCard differs)
    for (const s of this.io.sockets.adapter.rooms.get(this.channel) || []) {
      const sock = this.io.sockets.sockets.get(s);
      if (sock) sock.emit('room', this.publicState(sock.data.user.id));
    }
    this.io.to('lobby').emit('lobby', this.lobbyUpdate());
  }

  lobbyUpdate() {
    return this.summary();
  }

  // ---------- player actions ----------
  pick(user, cardId) {
    const uid = String(user.id);
    cardId = Number(cardId);
    if (!['waiting', 'countdown'].includes(this.state)) throw new Error('Game already started');
    if (!Number.isInteger(cardId) || cardId < 1 || cardId > config.cardCount) throw new Error('Invalid card');
    const owner = this.cardOwners.get(cardId);
    if (owner && owner !== uid) throw new Error('Card already taken');

    const existing = this.players.get(uid);
    if (existing) {
      // switching cards is free
      this.cardOwners.delete(existing.card);
      existing.card = cardId;
    } else {
      if (!debit(uid, this.stake, 'bet', `Bingo ${this.stake} entry`)) {
        throw new Error('Insufficient balance. Please deposit first.');
      }
      this.players.set(uid, { card: cardId, name: user.first_name || user.username || 'Player', disqualified: false });
      this.onBalanceChange(uid);
    }
    this.cardOwners.set(cardId, uid);
    this.maybeStartCountdown();
    this.broadcast();
  }

  unpick(user) {
    const uid = String(user.id);
    if (!['waiting', 'countdown'].includes(this.state)) throw new Error('Game already started');
    const p = this.players.get(uid);
    if (!p) return;
    this.players.delete(uid);
    this.cardOwners.delete(p.card);
    credit(uid, this.stake, 'refund', `Bingo ${this.stake} left before start`);
    this.onBalanceChange(uid);
    if (this.state === 'countdown' && this.players.size < config.minPlayers) {
      clearTimeout(this.timer);
      this.state = 'waiting';
      this.countdownEndsAt = null;
    }
    this.broadcast();
  }

  claim(user) {
    const uid = String(user.id);
    if (this.state !== 'playing') throw new Error('No game in progress');
    const p = this.players.get(uid);
    if (!p) throw new Error('You are not in this game');
    if (p.disqualified) throw new Error('You were disqualified for a false BINGO');

    const line = findWin(p.card, this.calledSet);
    if (!line) {
      p.disqualified = true;
      this.broadcast();
      return { valid: false, message: 'Not a BINGO yet — you are disqualified from this round.' };
    }
    this.finish([uid]);
    return { valid: true };
  }

  // ---------- game flow ----------
  maybeStartCountdown() {
    if (this.state !== 'waiting' || this.players.size < config.minPlayers) return;
    this.state = 'countdown';
    this.countdownEndsAt = Date.now() + config.countdownSec * 1000;
    this.timer = setTimeout(() => this.start(), config.countdownSec * 1000);
  }

  start() {
    if (this.players.size < config.minPlayers) {
      this.state = 'waiting';
      this.countdownEndsAt = null;
      this.broadcast();
      return;
    }
    this.state = 'playing';
    this.countdownEndsAt = null;
    this.balls = shuffledBalls();
    this.broadcast();
    this.caller = setInterval(() => this.callNext(), config.callIntervalMs);
  }

  callNext() {
    if (this.state !== 'playing') return;
    const n = this.balls[this.called.length];
    if (n === undefined) {
      // All 75 called and nobody claimed: auto-award everyone holding a line.
      const winners = [...this.players.entries()]
        .filter(([, p]) => !p.disqualified && findWin(p.card, this.calledSet))
        .map(([id]) => id);
      return this.finish(winners);
    }
    this.called.push(n);
    this.calledSet.add(n);
    this.io.to(this.channel).emit('call', { stake: this.stake, number: n, count: this.called.length });
  }

  finish(claimantIds) {
    clearInterval(this.caller);
    // Anyone else (not disqualified) who also has a line at this moment shares the prize,
    // so two players completing on the same ball split it fairly.
    // If there are no eligible winners (everyone disqualified), the house keeps the pot.
    const winners = new Set(claimantIds);
    for (const [id, p] of this.players) {
      if (!p.disqualified && findWin(p.card, this.calledSet)) winners.add(id);
    }
    const ids = [...winners];
    const pot = this.pot;
    const prize = this.prize;
    const each = ids.length ? Math.floor(prize / ids.length) : 0;

    for (const id of ids) {
      credit(id, each, 'win', `Bingo ${this.stake} win`);
      this.onBalanceChange(id);
    }
    const winnersInfo = ids.map((id) => {
      const p = this.players.get(id);
      return { userId: id, name: p.name, card: p.card, line: findWin(p.card, this.calledSet) };
    });
    recordGame({
      stake: this.stake,
      players: this.players.size,
      pot,
      payout: each * ids.length,
      house: pot - each * ids.length,
      winners: winnersInfo.map(({ userId, card }) => ({ userId, card })),
      calls: this.called.length,
    });

    this.state = 'finished';
    this.result = { winners: winnersInfo, amountEach: each, pot };
    this.broadcast();
    this.timer = setTimeout(() => {
      this.reset();
      this.broadcast();
    }, config.resultShowSec * 1000);
  }
}

export class GameManager {
  constructor(io, onBalanceChange) {
    this.rooms = new Map(config.stakes.map((s) => [s, new Room(s, io, onBalanceChange)]));
  }
  get(stake) {
    const r = this.rooms.get(Number(stake));
    if (!r) throw new Error('No such room');
    return r;
  }
  lobby() {
    return [...this.rooms.values()].map((r) => r.summary());
  }
}

export { getUser };
