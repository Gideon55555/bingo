import { config } from './config.js';
import { debit, credit, getUser, openRound, settleRound, refundRound } from './db.js';
import { findWin, shuffledBalls } from './bingo.js';
import { fmt } from '../shared/money.js';

/**
 * One Room per stake. Lifecycle:
 *   waiting   -> players pick up to BINGO_MAX_CARDS cards; each card costs one stake
 *                (charged on pick, refunded when the card is dropped before the start)
 *   countdown -> starts when minPlayers have picked; more can still join
 *   playing   -> server calls a number every callIntervalMs; players press BINGO
 *   finished  -> results shown for resultShowSec, then back to waiting
 */
export class Room {
  constructor(stake, io, onBalanceChange, manager) {
    this.manager = manager;
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
    this.players = new Map(); // userId -> { cards: [cardId…], name, disqualified }
    this.cardOwners = new Map(); // cardId -> userId
    this.balls = [];
    this.called = [];
    this.calledSet = new Set();
    this.countdownEndsAt = null;
    this.result = null;
    this.roundId = null; // DB round, created when the first player pays
  }

  get cardsInPlay() {
    let n = 0;
    for (const p of this.players.values()) n += p.cards.length;
    return n;
  }

  get pot() {
    return this.cardsInPlay * this.stake; // every card is one entry
  }

  get prize() {
    return Math.floor(this.pot * (1 - config.houseCut));
  }

  summary() {
    return {
      stake: this.stake,
      state: this.state,
      paused: this.manager?.paused || false,
      players: this.players.size,
      cards: this.cardsInPlay,
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
      myCards: me ? me.cards : [],
      maxCards: config.maxCards,
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
  /** Add a card (charged one stake). A player may hold up to config.maxCards cards. */
  pick(user, cardId) {
    const uid = String(user.id);
    cardId = Number(cardId);
    if (this.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
    if (!['waiting', 'countdown'].includes(this.state)) throw new Error('Game already started');
    if (!Number.isInteger(cardId) || cardId < 1 || cardId > config.cardCount) throw new Error('Invalid card');
    const owner = this.cardOwners.get(cardId);
    if (owner === uid) return; // already yours
    if (owner) throw new Error('Card already taken');
    const existing = this.players.get(uid);
    if (existing && existing.cards.length >= config.maxCards) throw new Error(`You can hold up to ${config.maxCards} cards`);

    if (!this.roundId) this.roundId = openRound(this.stake);
    if (!debit(uid, this.stake, 'bet', `Bingo ${fmt(this.stake)} card #${cardId}`, this.roundId)) {
      throw new Error('Insufficient balance. Please deposit first.');
    }
    if (existing) existing.cards.push(cardId);
    else this.players.set(uid, { cards: [cardId], name: user.first_name || user.username || 'Player', disqualified: false });
    this.cardOwners.set(cardId, uid);
    this.onBalanceChange(uid);
    this.maybeStartCountdown();
    this.broadcast();
  }

  /** Drop one card (cardId given) or all of them (no cardId) before the game starts — refunded. */
  unpick(user, cardId) {
    const uid = String(user.id);
    if (!['waiting', 'countdown'].includes(this.state)) throw new Error('Game already started');
    const p = this.players.get(uid);
    if (!p) return;
    const drop = cardId === undefined || cardId === null ? [...p.cards] : p.cards.filter((c) => c === Number(cardId));
    for (const c of drop) {
      p.cards = p.cards.filter((x) => x !== c);
      this.cardOwners.delete(c);
      credit(uid, this.stake, 'refund', `Bingo ${fmt(this.stake)} card #${c} returned before start`, this.roundId);
    }
    if (!p.cards.length) this.players.delete(uid);
    this.onBalanceChange(uid);
    if (this.state === 'countdown' && this.players.size < config.minPlayers) {
      clearTimeout(this.timer);
      this.state = 'waiting';
      this.countdownEndsAt = null;
    }
    this.broadcast();
  }

  /** First winning line among a player's cards: { card, line } or null. */
  winningCards(p) {
    return p.cards.map((card) => ({ card, line: findWin(card, this.calledSet) })).filter((w) => w.line);
  }

  claim(user) {
    const uid = String(user.id);
    if (this.state !== 'playing') throw new Error('No game in progress');
    const p = this.players.get(uid);
    if (!p) throw new Error('You are not in this game');
    if (p.disqualified) throw new Error('You were disqualified for a false BINGO');

    if (!this.winningCards(p).length) {
      p.disqualified = true;
      this.broadcast();
      return { valid: false, message: 'Not a BINGO yet — you are disqualified from this round.' };
    }
    this.finish([uid]);
    return { valid: true };
  }

  /** Cancel a round that hasn't started yet and refund everyone. Returns refunded count. */
  cancelAndRefund(reason = 'cancelled') {
    if (!['waiting', 'countdown'].includes(this.state)) return 0;
    const n = this.players.size;
    if (this.roundId) {
      for (const { userId } of refundRound(this.roundId, `Bingo ${fmt(this.stake)}`, reason, 'cancelled')) this.onBalanceChange(userId);
    }
    this.reset();
    this.broadcast();
    return n;
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
        .filter(([, p]) => !p.disqualified && this.winningCards(p).length)
        .map(([id]) => id);
      return this.finish(winners);
    }
    this.called.push(n);
    this.calledSet.add(n);
    this.io.to(this.channel).emit('call', { stake: this.stake, number: n, count: this.called.length });
  }

  finish(claimantIds) {
    clearInterval(this.caller);
    // Everyone (not disqualified) with a line at this moment shares the prize — per winning CARD,
    // since each card was a separate entry. Two winning cards = two shares.
    // If there are no eligible winners (everyone disqualified), the house keeps the pot.
    const winners = new Set(claimantIds);
    for (const [id, p] of this.players) if (!p.disqualified && this.winningCards(p).length) winners.add(id);
    const winningCards = [];
    for (const id of winners) {
      const p = this.players.get(id);
      for (const w of this.winningCards(p)) winningCards.push({ userId: id, name: p.name, card: w.card, line: w.line });
    }
    const pot = this.pot;
    const prize = this.prize;
    const each = winningCards.length ? Math.floor(prize / winningCards.length) : 0;
    const perUser = new Map();
    for (const w of winningCards) perUser.set(w.userId, (perUser.get(w.userId) || 0) + each);

    // Payouts + game record + closing the round happen in one DB transaction
    settleRound(
      this.roundId,
      [...perUser].map(([userId, amount]) => ({ userId, amount, note: `Bingo ${fmt(this.stake)} win` })),
      {
        stake: this.stake,
        players: this.players.size,
        pot,
        payout: each * winningCards.length,
        house: pot - each * winningCards.length,
        winners: winningCards.map(({ userId, card }) => ({ userId, card })),
        calls: this.called.length,
      },
    );
    for (const id of perUser.keys()) this.onBalanceChange(id);
    const winnersInfo = winningCards;

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
    this.io = io;
    this.paused = false;
    this.rooms = new Map(config.stakes.map((s) => [s, new Room(s, io, onBalanceChange, this)]));
  }

  /** Stop new games. Rounds not yet started are refunded; running games finish normally. */
  pause() {
    this.paused = true;
    let refunded = 0;
    for (const r of this.rooms.values()) refunded += r.cancelAndRefund('paused by admin');
    if (this.crash) refunded += this.crash.pauseNow() ? 1 : 0;
    if (this.keno) refunded += this.keno.pauseNow() ? 1 : 0;
    if (this.ludo) refunded += this.ludo.pauseNow() ? 1 : 0;
    if (this.pool) refunded += this.pool.pauseNow() ? 1 : 0;
    if (this.kerenbula) refunded += this.kerenbula.pauseNow() ? 1 : 0;
    this.io.emit('lobby:all', this.lobby());
    return { refunded };
  }

  resume() {
    this.paused = false;
    this.io.emit('lobby:all', this.lobby());
  }

  /** Stop all timers (used on shutdown; open rounds are then refunded from the DB). */
  stopAll() {
    for (const r of this.rooms.values()) {
      clearTimeout(r.timer);
      clearInterval(r.caller);
    }
    this.crash?.stop();
    this.keno?.stop();
    this.ludo?.stop();
    this.pool?.stop();
    this.kerenbula?.stop();
  }

  /** Live snapshot for the admin panel */
  adminSnapshot() {
    return [...this.rooms.values()].map((r) => ({
      ...r.summary(),
      called: r.called.length,
      cards: [...r.players.entries()].flatMap(([userId, p]) => p.cards.map((card) => ({ userId, name: p.name, card, disqualified: p.disqualified }))),
    }));
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

