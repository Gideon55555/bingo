// "Rocket" crash game: one shared round for everyone.
//   betting (CRASH_BET_SEC) -> flying (multiplier climbs) -> crashed (shown 3s) -> betting ...
// The server is the only source of truth: it decides the crash point, the current multiplier
// and every cash-out. Clients only animate.
//
// Provably fair: before betting opens we publish hash = sha256(seed). After the crash we reveal
// the seed. crash point = crashPointFromHash(HMAC_SHA256(key = seed, message = "rocket")).
import crypto from 'node:crypto';
import { config } from './config.js';
import { debit, credit, openRound, settleCrashRound, recentCrashes, refundRound } from './db.js';
import { multiplierAt, msFor, crashPointFromHash, GROWTH } from '../shared/crash.js';
import { fmt } from '../shared/money.js';

const CRASHED_SHOW_MS = 3500;
const LABEL = config.crash.name;

export function crashPointForSeed(seed) {
  const h = crypto.createHmac('sha256', seed).update('rocket').digest('hex');
  return crashPointFromHash(h, config.crash.houseEdge, config.crash.maxMultiplier);
}

export class CrashGame {
  constructor(io, onBalanceChange, manager) {
    this.io = io;
    this.onBalanceChange = onBalanceChange;
    this.manager = manager;
    this.channel = 'crash';
    this.history = recentCrashes(20).map((r) => ({ id: r.id, point: r.crash_point, hash: r.hash, seed: r.seed }));
    this.roundNo = (this.history[0]?.id || 0) + 1;
    this.betsEmitTimer = null;
    this.phase = 'idle';
  }

  start() {
    if (this.phase === 'idle') this.startBetting();
  }

  // ---------------- round lifecycle ----------------
  startBetting() {
    clearTimeout(this.timer);
    clearInterval(this.ticker);
    this.bets = new Map(); // userId -> { name, amount, auto, cashedAt, win }
    this.roundId = null;
    if (this.manager?.paused) {
      this.phase = 'paused';
      this.broadcast();
      this.timer = setTimeout(() => this.startBetting(), 2000);
      return;
    }
    this.seed = crypto.randomBytes(32).toString('hex');
    this.hash = crypto.createHash('sha256').update(this.seed).digest('hex');
    this.point = crashPointForSeed(this.seed);
    this.phase = 'betting';
    this.bettingEndsAt = Date.now() + config.crash.betSec * 1000;
    this.broadcast();
    this.io.to(this.channel).emit('crash:me', null);
    this.timer = setTimeout(() => this.startFlight(), config.crash.betSec * 1000);
  }

  startFlight() {
    this.phase = 'flying';
    this.startedAt = Date.now();
    this.tickCount = 0;
    this.broadcast();
    this.ticker = setInterval(() => this.tick(), 100);
    // Crash exactly on time (the ticker handles auto cash-outs in between)
    this.timer = setTimeout(() => this.crash(), msFor(this.point));
  }

  current() {
    return Math.min(this.point, multiplierAt(Date.now() - this.startedAt));
  }

  tick() {
    if (this.phase !== 'flying') return;
    // Once a second, send the true flight time so every phone's animation stays in sync
    if (++this.tickCount % 10 === 0) this.io.to(this.channel).emit('crash:t', { e: Date.now() - this.startedAt });
    const m = this.current();
    for (const [uid, b] of this.bets) {
      if (b.cashedAt) continue;
      if (b.auto && b.auto <= m && b.auto < this.point) this.payout(uid, b.auto);
      else if (Math.floor((b.amount * m) / 100) >= config.crash.maxWin) this.payout(uid, m); // max-win protection
    }
  }

  crash() {
    if (this.phase !== 'flying') return;
    clearInterval(this.ticker);
    // Auto cash-outs at or below the crash point win (this keeps the house edge exact).
    for (const [uid, b] of this.bets) if (!b.cashedAt && b.auto && b.auto <= this.point) this.payout(uid, b.auto);

    const betsTotal = [...this.bets.values()].reduce((s, b) => s + b.amount, 0);
    const payoutTotal = [...this.bets.values()].reduce((s, b) => s + (b.win || 0), 0);
    settleCrashRound(this.roundId, {
      crash_point: this.point, seed: this.seed, hash: this.hash,
      bets_total: betsTotal, payout_total: payoutTotal, players: this.bets.size,
    });
    this.phase = 'crashed';
    this.history.unshift({ id: this.roundNo, point: this.point, hash: this.hash, seed: this.seed });
    this.history = this.history.slice(0, 20);
    this.roundNo++;
    this.broadcast();
    this.timer = setTimeout(() => this.startBetting(), CRASHED_SHOW_MS);
  }

  payout(uid, at100) {
    const b = this.bets.get(uid);
    if (!b || b.cashedAt) return null;
    const win = Math.min(Math.floor((b.amount * at100) / 100), config.crash.maxWin);
    b.cashedAt = at100;
    b.win = win;
    credit(uid, win, 'win', `${LABEL} cash-out at ${(at100 / 100).toFixed(2)}x`, this.roundId);
    this.onBalanceChange(uid);
    this.io.to(`user:${uid}`).emit('crash:me', this.myBet(uid));
    this.emitBetsSoon();
    return b;
  }

  // ---------------- player actions ----------------
  bet(user, amount, auto) {
    const uid = String(user.id);
    if (this.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
    if (this.phase !== 'betting') throw new Error('Bets are closed — wait for the next round.');
    if (this.bets.has(uid)) throw new Error('You already placed a bet this round.');
    amount = Math.floor(Number(amount));
    const { minBet, maxBet, maxMultiplier } = config.crash;
    if (!Number.isFinite(amount) || amount < minBet) throw new Error(`Minimum bet is ${fmt(minBet)} ${config.currency}`);
    if (amount > maxBet) throw new Error(`Maximum bet is ${fmt(maxBet)} ${config.currency}`);
    if (auto !== null && auto !== undefined && auto !== '') {
      auto = Math.round(Number(auto));
      if (!Number.isFinite(auto) || auto < 101 || auto > maxMultiplier) {
        throw new Error(`Auto cash-out must be between 1.01x and ${(maxMultiplier / 100).toFixed(0)}x`);
      }
    } else auto = null;

    if (!this.roundId) this.roundId = openRound(0, 'crash');
    if (!debit(uid, amount, 'bet', `${LABEL} bet`, this.roundId)) throw new Error('Insufficient balance. Please deposit first.');
    this.bets.set(uid, { name: user.first_name || user.username || 'Player', amount, auto, cashedAt: null, win: 0 });
    this.onBalanceChange(uid);
    this.emitBetsSoon();
    return this.myBet(uid);
  }

  cancel(user) {
    const uid = String(user.id);
    if (this.phase !== 'betting') throw new Error('Too late to cancel — the round has started.');
    const b = this.bets.get(uid);
    if (!b) return null;
    this.bets.delete(uid);
    credit(uid, b.amount, 'refund', `${LABEL} bet cancelled`, this.roundId);
    this.onBalanceChange(uid);
    this.emitBetsSoon();
    return null;
  }

  cashout(user) {
    const uid = String(user.id);
    if (this.phase !== 'flying') throw new Error('Nothing to cash out right now.');
    const b = this.bets.get(uid);
    if (!b) throw new Error('You have no bet in this round.');
    if (b.cashedAt) throw new Error('Already cashed out.');
    const elapsed = Date.now() - this.startedAt;
    if (elapsed >= msFor(this.point)) throw new Error('Too late — it already crashed!');
    return this.payout(uid, this.current());
  }

  // ---------------- pause / shutdown ----------------
  /** On pause: refund bets placed during the betting phase. A flight in progress finishes normally. */
  pauseNow() {
    if (this.phase === 'betting' && this.roundId) {
      clearTimeout(this.timer);
      for (const { userId } of refundRound(this.roundId, LABEL, 'refunded (games paused)', 'cancelled')) this.onBalanceChange(userId);
      this.startBetting(); // goes to 'paused' because manager.paused is set
      return true;
    }
    if (this.phase === 'betting') this.startBetting();
    return false;
  }

  stop() {
    clearTimeout(this.timer);
    clearInterval(this.ticker);
  }

  // ---------------- state for clients ----------------
  myBet(uid) {
    const b = this.bets?.get(String(uid));
    return b ? { amount: b.amount, auto: b.auto, cashedAt: b.cashedAt, win: b.win } : null;
  }

  publicState() {
    const now = Date.now();
    return {
      phase: this.phase,
      round: this.roundNo,
      hash: this.phase === 'paused' ? null : this.hash,
      growth: GROWTH,
      bettingLeftMs: this.phase === 'betting' ? Math.max(0, this.bettingEndsAt - now) : null,
      elapsedMs: this.phase === 'flying' ? now - this.startedAt : null,
      point: this.phase === 'crashed' ? this.point : null,
      seed: this.phase === 'crashed' ? this.seed : null,
      history: this.history.map((h) => ({ id: h.id, point: h.point })),
      bets: this.betsList(),
      limits: { minBet: config.crash.minBet, maxBet: config.crash.maxBet, maxWin: config.crash.maxWin },
    };
  }

  betsList() {
    return [...(this.bets?.values() || [])]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 50)
      .map(({ name, amount, cashedAt, win }) => ({ name, amount, cashedAt, win }));
  }

  broadcast() {
    this.io.to(this.channel).emit('crash:state', this.publicState());
    this.io.to('lobby').emit('crash:lobby', this.lobbySummary());
  }

  emitBetsSoon() {
    if (this.betsEmitTimer) return;
    this.betsEmitTimer = setTimeout(() => {
      this.betsEmitTimer = null;
      this.io.to(this.channel).emit('crash:bets', { bets: this.betsList(), players: this.bets?.size || 0 });
    }, 250);
  }

  lobbySummary() {
    return {
      phase: this.phase,
      players: this.bets?.size || 0,
      last: this.history.slice(0, 6).map((h) => h.point),
      paused: !!this.manager?.paused,
    };
  }

  adminSnapshot() {
    const bets = [...(this.bets?.values() || [])];
    return {
      phase: this.phase,
      round: this.roundNo,
      players: bets.length,
      betsTotal: bets.reduce((s, b) => s + b.amount, 0),
      paidOut: bets.reduce((s, b) => s + (b.win || 0), 0),
      last: this.history.slice(0, 10).map((h) => h.point),
    };
  }
}
