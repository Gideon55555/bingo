// Keno: one shared draw for everyone.
//   betting (KENO_BET_SEC) -> drawing (20 balls, one every KENO_BALL_MS) -> results -> betting ...
// Players buy one ticket per round: 1–10 numbers from 1–80 and a stake.
//
// Provably fair: before betting opens we publish hash = sha256(seed). After the draw we reveal the seed.
// The 20 numbers = first 20 of a Fisher–Yates shuffle of 1..80 driven by HMAC_SHA256(seed, "keno:<i>").
import crypto from 'node:crypto';
import { config } from './config.js';
import { debit, credit, openRound, settleKenoRound, recentKeno, refundRound } from './db.js';
import { KENO_NUMBERS, KENO_DRAWN, cleanPicks, countHits, payoutFor, multiplierFor } from '../shared/keno.js';
import { fmt } from '../shared/money.js';

const LABEL = 'Keno';

/** Unbiased random integer in [0, max) from a deterministic HMAC stream. */
function makeRng(seed) {
  let counter = 0;
  let buf = Buffer.alloc(0);
  const next32 = () => {
    if (buf.length < 4) buf = Buffer.concat([buf, crypto.createHmac('sha256', seed).update(`keno:${counter++}`).digest()]);
    const v = buf.readUInt32BE(0);
    buf = buf.subarray(4);
    return v;
  };
  return (max) => {
    const limit = Math.floor(0x100000000 / max) * max; // rejection sampling → no modulo bias
    let v;
    do v = next32(); while (v >= limit);
    return v % max;
  };
}

/** The 20 drawn numbers (in draw order) for a seed. */
export function drawForSeed(seed) {
  const rand = makeRng(seed);
  const nums = Array.from({ length: KENO_NUMBERS }, (_, i) => i + 1);
  for (let i = 0; i < KENO_DRAWN; i++) {
    const j = i + rand(KENO_NUMBERS - i);
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums.slice(0, KENO_DRAWN);
}

export class KenoGame {
  constructor(io, onBalanceChange, manager) {
    this.io = io;
    this.onBalanceChange = onBalanceChange;
    this.manager = manager;
    this.channel = 'keno';
    this.history = recentKeno(10);
    this.roundNo = (this.history[0]?.id || 0) + 1;
    this.phase = 'idle';
    this.tickets = new Map(); // `${uid}:${ticketId}` → ticket (a player can hold several per draw)
    this.ticketSeq = 0;
  }

  start() {
    if (this.phase === 'idle') this.startBetting();
  }

  // ---------------- lifecycle ----------------
  startBetting() {
    clearTimeout(this.timer);
    clearInterval(this.ballTimer);
    this.tickets = new Map(); // userId -> { name, picks, amount, hits, win }
    this.roundId = null;
    this.revealed = [];
    this.result = null;
    if (this.manager?.paused || !config.keno.enabled) { // paused by admin, or game switched off
      this.phase = 'paused';
      this.broadcast();
      this.timer = setTimeout(() => this.startBetting(), 2000);
      return;
    }
    this.seed = crypto.randomBytes(32).toString('hex');
    this.hash = crypto.createHash('sha256').update(this.seed).digest('hex');
    this.drawn = drawForSeed(this.seed);
    this.phase = 'betting';
    this.bettingEndsAt = Date.now() + config.keno.betSec * 1000;
    this.broadcast();
    this.io.to(this.channel).emit('keno:me', null);
    this.timer = setTimeout(() => this.startDraw(), config.keno.betSec * 1000);
  }

  startDraw() {
    this.phase = 'drawing';
    this.revealed = [];
    this.broadcast();
    // One ball at a time; the last three come slower, for suspense.
    const next = () => {
      if (this.phase !== 'drawing') return;
      const n = this.drawn[this.revealed.length];
      this.revealed.push(n);
      this.io.to(this.channel).emit('keno:ball', { n, i: this.revealed.length - 1 });
      if (this.revealed.length >= KENO_DRAWN) { this.timer = setTimeout(() => this.settle(), Math.max(800, config.keno.ballMs)); return; }
      this.ballTimer = setTimeout(next, config.keno.ballMs * (this.revealed.length >= KENO_DRAWN - 3 ? 1.7 : 1));
    };
    this.ballTimer = setTimeout(next, Math.min(900, config.keno.ballMs));
  }

  settle() {
    if (this.phase !== 'drawing') return;
    const payouts = [];
    let betsTotal = 0;
    let payoutTotal = 0;
    for (const t of this.tickets.values()) {
      const uid = t.uid;
      t.hits = countHits(t.picks, this.drawn);
      t.win = Math.min(payoutFor(t.amount, t.picks.length, t.hits), config.keno.maxWin);
      betsTotal += t.amount;
      payoutTotal += t.win;
      if (t.win > 0) payouts.push({ userId: uid, amount: t.win, note: `${LABEL} ${t.hits}/${t.picks.length} hits` });
    }
    settleKenoRound(this.roundId, payouts, {
      drawn: this.drawn, seed: this.seed, hash: this.hash,
      bets_total: betsTotal, payout_total: payoutTotal, players: this.tickets.size,
    });
    for (const { userId } of payouts) this.onBalanceChange(userId);
    for (const uid of new Set([...this.tickets.values()].map((t) => t.uid))) this.io.to(`user:${uid}`).emit('keno:me', this.myTicket(uid));

    this.phase = 'results';
    this.result = {
      winners: [...this.tickets.values()].filter((t) => t.win > 0).sort((a, b) => b.win - a.win).slice(0, 10)
        .map((t) => ({ name: t.name, picks: t.picks.length, hits: t.hits, win: t.win })),
      players: this.tickets.size,
    };
    this.history.unshift({ id: this.roundNo, drawn: this.drawn });
    this.history = this.history.slice(0, 10);
    this.roundNo++;
    this.broadcast();
    this.timer = setTimeout(() => this.startBetting(), config.keno.resultSec * 1000);
  }

  // ---------------- player actions ----------------
  buy(user, picks, amount) {
    const uid = String(user.id);
    if (this.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
    if (this.phase !== 'betting') throw new Error('Tickets are closed — wait for the next round.');
    const mine = [...this.tickets.values()].filter((t) => t.uid === uid).length;
    if (mine >= config.keno.maxTickets) throw new Error(`You can hold up to ${config.keno.maxTickets} tickets per draw`);
    picks = cleanPicks(picks);
    amount = Math.floor(Number(amount));
    const { minBet, maxBet } = config.keno;
    if (!Number.isFinite(amount) || amount < minBet) throw new Error(`Minimum ticket is ${fmt(minBet)} ${config.currency}`);
    if (amount > maxBet) throw new Error(`Maximum ticket is ${fmt(maxBet)} ${config.currency}`);

    if (!this.roundId) this.roundId = openRound(0, 'keno');
    if (!debit(uid, amount, 'bet', `${LABEL} ticket (${picks.length} numbers)`, this.roundId)) {
      throw new Error('Insufficient balance. Please deposit first.');
    }
    const id = ++this.ticketSeq;
    this.tickets.set(`${uid}:${id}`, { id, uid, name: user.first_name || user.username || 'Player', picks, amount, hits: null, win: null });
    this.onBalanceChange(uid);
    this.emitPlayersSoon();
    return this.myTicket(uid);
  }

  /** Cancel one ticket (id given) or all of the player's tickets for this draw — refunded. */
  cancel(user, id) {
    const uid = String(user.id);
    if (this.phase !== 'betting') throw new Error('Too late to cancel — the draw has started.');
    for (const [key, t] of [...this.tickets]) {
      if (t.uid !== uid || (id != null && t.id !== Number(id))) continue;
      this.tickets.delete(key);
      credit(uid, t.amount, 'refund', `${LABEL} ticket cancelled`, this.roundId);
    }
    this.onBalanceChange(uid);
    this.emitPlayersSoon();
    return this.myTicket(uid);
  }

  // ---------------- pause / shutdown ----------------
  pauseNow() {
    if (this.phase === 'betting') {
      clearTimeout(this.timer);
      let refunded = false;
      if (this.roundId) {
        for (const { userId } of refundRound(this.roundId, LABEL, 'refunded (games paused)', 'cancelled')) this.onBalanceChange(userId);
        refunded = true;
      }
      this.startBetting(); // → 'paused'
      return refunded;
    }
    return false; // a draw in progress finishes normally; the next round won't start
  }

  stop() {
    clearTimeout(this.timer);
    clearInterval(this.ballTimer);
  }

  // ---------------- state ----------------
  myTicket(uid) {
    uid = String(uid);
    return [...this.tickets.values()].filter((t) => t.uid === uid).map((t) => ({ id: t.id, picks: t.picks, amount: t.amount, hits: t.hits, win: t.win }));
  }

  publicState() {
    return {
      phase: this.phase,
      round: this.roundNo,
      hash: this.phase === 'paused' ? null : this.hash,
      bettingLeftMs: this.phase === 'betting' ? Math.max(0, this.bettingEndsAt - Date.now()) : null,
      revealed: this.phase === 'drawing' || this.phase === 'results' ? this.revealed : [],
      ballMs: config.keno.ballMs,
      seed: this.phase === 'results' ? this.seed : null,
      result: this.result,
      players: this.tickets.size,
      history: this.history.slice(0, 5),
    };
  }

  broadcast() {
    this.io.to(this.channel).emit('keno:state', this.publicState());
    this.io.to('lobby').emit('keno:lobby', this.lobbySummary());
  }

  emitPlayersSoon() {
    if (this.playersTimer) return;
    this.playersTimer = setTimeout(() => {
      this.playersTimer = null;
      this.io.to(this.channel).emit('keno:players', { players: this.tickets.size });
    }, 300);
  }

  lobbySummary() {
    return {
      phase: this.phase,
      players: this.tickets.size,
      bettingLeftMs: this.phase === 'betting' ? Math.max(0, this.bettingEndsAt - Date.now()) : null,
      last: this.history[0]?.drawn.slice(0, 10) || [],
    };
  }

  adminSnapshot() {
    const ts = [...this.tickets.values()];
    return {
      phase: this.phase,
      round: this.roundNo,
      players: ts.length,
      betsTotal: ts.reduce((s, t) => s + t.amount, 0),
      paidOut: ts.reduce((s, t) => s + (t.win || 0), 0),
    };
  }
}

export { multiplierFor };
