// ድብብቆሽ / Dibibkosh for money: 4 players hide from the hunter on a 3×3 board.
// Last player standing takes the pot minus the house cut (the last ones caught together split it).
//
// Every move: the server decides the hunter's box FIRST (from earlier moves only), publishes a hash
// of it, gives players a 3-second count to pick a neighbouring box, then reveals everything at once.
// Anyone can check the hash: sha256("<game>:<move>:<box>:<salt>").
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, debit, credit, openRound, refundRound } from './db.js';
import { notifyUser } from './bot.js';
import { fmt } from '../shared/money.js';
import { CORNERS, CENTER, neighbors, PlayerModel, hunterPick, ctxFor, resolve, botMove } from '../shared/hunt.js';
import { tr } from './i18n.js';
import { assertNotFrozen, assertNotSamePerson } from './risk.js';
import { createPrivateTable, privateTable, dropPrivateIfDone } from './social.js';

const cfg = () => config.hunt;
const money = (c) => `${fmt(c)} ${config.currency}`;
const d = (ms) => Math.round(ms * cfg().delayScale);
const rand = () => crypto.randomInt(1e9) / 1e9;
const SIZE = 4;
let nextId = 1;

db.exec(`CREATE TABLE IF NOT EXISTS hunt_games (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id     INTEGER,
  stake        INTEGER NOT NULL,
  pot          INTEGER NOT NULL,
  payout       INTEGER NOT NULL,
  house        INTEGER NOT NULL,
  winners      TEXT NOT NULL,      -- JSON [userId]
  players      TEXT NOT NULL,      -- JSON [{userId, name, caughtAt}]
  moves        INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS hunt_time ON hunt_games(created_at);`);

/** Pay the winner(s), record the game and close the money round — all or nothing. */
const settleHunt = db.transaction((roundId, winners, each, record) => {
  for (const uid of winners) {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(each, uid);
    db.prepare("INSERT INTO transactions (user_id, type, amount, status, note, round_id) VALUES (?, 'win', ?, 'done', ?, ?)")
      .run(uid, each, `Dibibkosh ${fmt(record.stake)} win${winners.length > 1 ? ' (split)' : ''}`, roundId);
  }
  db.prepare(`INSERT INTO hunt_games (round_id, stake, pot, payout, house, winners, players, moves, duration_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(roundId, record.stake, record.pot, each * winners.length, record.pot - each * winners.length,
    JSON.stringify(winners), JSON.stringify(record.players), record.moves, record.duration_sec);
  if (roundId) db.prepare("UPDATE rounds SET status = 'finished', closed_at = unixepoch() WHERE id = ? AND status = 'open'").run(roundId);
});
export const listHuntGames = (limit = 50) => db.prepare('SELECT * FROM hunt_games ORDER BY id DESC LIMIT ?').all(limit)
  .map((g) => ({ ...g, winners: JSON.parse(g.winners), players: JSON.parse(g.players) }));

class HuntGame {
  constructor(mgr, { stake, roundId, members, practice = false }) {
    this.mgr = mgr;
    this.id = nextId++;
    this.stake = stake;
    this.roundId = roundId;
    this.practice = practice;
    this.cut = cfg().houseCut;   // fixed for this game
    this.hunterOpts = { reach: cfg().jumpAny ? 'any' : 'near', surprise: cfg().surprise };
    this.moveSec = cfg().moveSec;
    this.channel = `hunt:${this.id}`;
    this.players = members.map((m, i) => ({
      uid: m.uid, name: m.name, bot: !!m.bot, seat: i, pos: CORNERS[i], last: null, out: false, caughtAt: null,
      model: new PlayerModel(), misses: 0,
    }));
    this.hunter = CENTER;
    this.moveNo = 0;
    this.phase = 'starting';
    this.history = []; // revealed moves (for the fairness check)
    this.startedAt = Date.now();
    this.result = null;
  }

  get pot() { return this.stake * SIZE; }
  get prize() { return Math.floor(this.pot * (1 - this.cut)); }
  indexOf(uid) { return this.players.findIndex((p) => p.uid === String(uid)); }
  io() { return this.mgr.io; }
  alive() { return this.players.filter((p) => !p.out); }

  start() {
    this.broadcast();
    this.timer = setTimeout(() => this.nextMove(), d(2000));
  }

  nextMove() {
    clearTimeout(this.timer);
    this.moveNo++;
    // 1) the hunter decides first, from earlier moves only, and commits to it
    const { box } = hunterPick(this.alive(), this.hunter, rand, this.hunterOpts);
    const salt = crypto.randomBytes(8).toString('hex');
    this.pending = { box, salt, commit: crypto.createHash('sha256').update(`${this.id}:${this.moveNo}:${box}:${salt}`).digest('hex') };
    // 2) players pick during the count
    this.choices = new Map();
    for (const p of this.alive()) if (p.bot) this.choices.set(p.seat, botMove(this.players, p.seat, this.hunter, rand));
    this.phase = 'move';
    const ms = this.moveSec * 1000 + 400; // a little grace for slow phones
    this.deadline = Date.now() + ms;
    this.broadcast();
    this.timer = setTimeout(() => this.reveal(), ms);
  }

  choose(uid, box) {
    const i = this.indexOf(uid);
    const p = this.players[i];
    if (!p || p.out) throw new Error('You are out of this game');
    if (this.phase !== 'move') throw new Error('Wait for the next count');
    box = Number(box);
    if (!neighbors(p.pos).includes(box)) throw new Error('Pick a box next to yours');
    this.choices.set(i, box);
    p.misses = 0;
    this.broadcastChoices(i);
    return { ok: true };
  }

  reveal() {
    clearTimeout(this.timer);
    const alive = this.alive();
    const moves = new Map();
    for (const p of alive) {
      let to = this.choices.get(p.seat);
      if (to === undefined) { // didn't pick in time → moved for them
        const opts = neighbors(p.pos);
        to = opts[crypto.randomInt(opts.length)];
        p.misses++;
      }
      moves.set(p.seat, to);
    }
    const ctxs = new Map(alive.map((p) => [p.seat, ctxFor(this.players, p, this.hunter)]));
    const from = new Map(alive.map((p) => [p.seat, p.pos]));
    const hunterFrom = this.hunter;
    const { box, salt, commit } = this.pending;
    const res = resolve(this.players, moves, box);
    for (const [i, to] of moves) this.players[i].model.observe(from.get(i), to, ctxs.get(i)); // the hunter learns
    for (const i of res.caught) this.players[i].caughtAt = this.moveNo;
    const rec = { move: this.moveNo, hunter: { from: hunterFrom, to: box }, moves: [...moves].map(([seat, to]) => ({ seat, from: from.get(seat), to })), caught: res.caught, commit, salt };
    this.history.push(rec);
    this.phase = 'reveal';
    this.lastReveal = rec;
    this.hunter = res.caught.length ? CENTER : box; // after a catch the hunter goes back to the middle
    this.io().to(this.channel).emit('hunt:reveal', { game: this.id, ...rec, hunterNext: this.hunter });
    this.broadcast();
    if (res.winners) { this.timer = setTimeout(() => this.finish(res.winners), d(2200)); return; }
    this.timer = setTimeout(() => this.nextMove(), d(res.caught.length ? 2600 : 1600));
  }

  /** A player leaves mid-game: they're out (their entry stays in the pot). */
  resign(uid) {
    const i = this.indexOf(uid);
    const p = this.players[i];
    if (!p || p.out || this.phase === 'over') return;
    p.out = true;
    p.caughtAt = this.moveNo;
    this.io().to(this.channel).emit('hunt:event', { game: this.id, name: p.name, reason: 'resigned' });
    const left = this.alive();
    if (left.length === 1) { clearTimeout(this.timer); this.finish([left[0].seat]); } else this.broadcast();
  }

  finish(winnerSeats) {
    clearTimeout(this.timer);
    this.phase = 'over';
    const winners = winnerSeats.map((s) => this.players[s]);
    const each = this.practice ? 0 : Math.floor(this.prize / winners.length);
    if (!this.practice) {
      settleHunt(this.roundId, winners.map((w) => w.uid), each, {
        stake: this.stake, pot: this.pot, moves: this.moveNo, duration_sec: Math.round((Date.now() - this.startedAt) / 1000),
        players: this.players.map((p) => ({ userId: p.uid, name: p.name, caughtAt: p.caughtAt })),
      });
      for (const w of winners) this.mgr.onBalanceChange(w.uid);
    }
    this.result = { winners: winnerSeats, names: winners.map((w) => w.name), each, split: winners.length > 1, practice: this.practice };
    this.broadcast();
    for (const p of this.players) {
      if (p.bot) continue;
      this.mgr.userLoc.delete(p.uid);
      if (!this.practice) {
        notifyUser(p.uid, winners.includes(p)
          ? tr(p.uid, 'huntWon', { amount: money(each) })
          : tr(p.uid, 'huntLost', { name: winners.map((w) => w.name).join(' & ') }));
      }
    }
    this.mgr.emitLobby();
    setTimeout(() => this.mgr.games.delete(this.id), 60 * 1000);
  }

  stop() { clearTimeout(this.timer); }

  stateFor(uid) {
    const me = this.indexOf(uid);
    const mine = this.players[me];
    return {
      id: this.id, stake: this.stake, pot: this.pot, prize: this.prize, practice: this.practice, phase: this.phase, moveNo: this.moveNo,
      me, hunter: this.hunter, commit: this.phase === 'move' ? this.pending?.commit : null,
      deadlineLeftMs: this.phase === 'move' ? Math.max(0, this.deadline - Date.now()) : null, moveSec: this.moveSec,
      myChoice: me >= 0 ? this.choices?.get(me) ?? null : null,
      legal: me >= 0 && !mine.out && this.phase === 'move' ? neighbors(mine.pos) : [],
      players: this.players.map((p) => ({ name: p.name, seat: p.seat, pos: p.pos, out: p.out, bot: p.bot, caughtAt: p.caughtAt, chose: this.phase === 'move' && this.choices?.has(p.seat) })),
      lastReveal: this.lastReveal || null, result: this.result,
    };
  }

  broadcast() {
    const room = this.io().sockets.adapter.rooms.get(this.channel);
    for (const sid of room || []) {
      const sock = this.io().sockets.sockets.get(sid);
      if (sock) sock.emit('hunt:state', this.stateFor(sock.data.user.id));
    }
  }

  /** Others only see THAT you picked, never where. */
  broadcastChoices() { this.io().to(this.channel).emit('hunt:picked', { game: this.id, seats: [...this.choices.keys()] }); }

  adminInfo() {
    return { id: this.id, stake: this.stake, phase: this.phase, moves: this.moveNo, practice: this.practice,
      players: this.players.map((p) => `${p.name}${p.out ? ' (out)' : ''}`).join(', '), minutes: Math.round((Date.now() - this.startedAt) / 60000) };
  }
}

export class HuntManager {
  constructor(io, onBalanceChange, manager) {
    this.io = io;
    this.onBalanceChange = onBalanceChange;
    this.manager = manager;
    this.tables = new Map(cfg().stakes.map((stake) => [stake, { stake, size: SIZE, waiting: [], roundId: null }]));
    this.games = new Map();
    this.userLoc = new Map();
  }

  /** Free practice: you + 3 bots. */
  practice(user) {
    const uid = String(user.id);
    if (this.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
    if (this.userLoc.has(uid)) throw new Error('Finish or leave your current game first');
    const bots = [1, 2, 3].map((k) => ({ uid: `bot:${k}`, name: `🤖 ${k}`, bot: true }));
    this.startGame({ stake: 0, size: SIZE, waiting: [{ uid, name: user.first_name || user.username || 'Player' }, ...bots], roundId: null, practice: true });
    return this.locationOf(uid);
  }

  join(user, stake, opts = {}) {
    const uid = String(user.id);
    if (this.manager?.paused) throw new Error('Games are paused for maintenance. Please try again later.');
    if (this.userLoc.has(uid)) throw new Error('You are already at a Dibibkosh table');
    let t = opts.code ? privateTable(this, opts.code) : this.tables.get(Number(stake));
    if (!t) throw new Error('No such table');
    if (opts.private && !opts.code) t = createPrivateTable(this, t.stake, SIZE);
    assertNotFrozen(uid);
    assertNotSamePerson(uid, t.waiting.map((w) => w.uid));
    if (!t.roundId) t.roundId = openRound(t.stake, 'hunt');
    if (!debit(uid, t.stake, 'bet', `Dibibkosh ${fmt(t.stake)} entry`, t.roundId)) throw new Error('Insufficient balance. Please deposit first.');
    this.onBalanceChange(uid);
    t.waiting.push({ uid, name: user.first_name || user.username || 'Player' });
    this.userLoc.set(uid, { queue: t.key || t.stake });
    if (t.waiting.length >= SIZE) this.startGame(t);
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
    credit(uid, t.stake, 'refund', `Dibibkosh ${fmt(t.stake)} left the table`, t.roundId);
    this.onBalanceChange(uid);
    this.userLoc.delete(uid);
    dropPrivateIfDone(this, t);
    this.emitLobby();
    return null;
  }

  startGame(t) {
    const members = t.waiting.slice(0, SIZE);
    const game = new HuntGame(this, { stake: t.stake, roundId: t.roundId, members, practice: !!t.practice });
    t.waiting = t.waiting.slice(SIZE);
    t.roundId = null;
    t.started = true;
    dropPrivateIfDone(this, t);
    this.games.set(game.id, game);
    for (const m of members) {
      if (m.bot) continue;
      this.userLoc.set(m.uid, { game: game.id });
      this.io.in(`user:${m.uid}`).socketsJoin(game.channel);
      this.io.to(`user:${m.uid}`).emit('hunt:me', { game: game.id });
      if (!t.practice) notifyUser(m.uid, tr(m.uid, 'huntStarted'));
    }
    game.start();
    this.emitLobby();
  }

  game(uid) {
    const loc = this.userLoc.get(String(uid));
    if (!loc?.game) throw new Error('You are not in a Dibibkosh game');
    return this.games.get(loc.game);
  }

  locationOf(uid) {
    const loc = this.userLoc.get(String(uid));
    if (!loc) return null;
    if (loc.game) return { game: loc.game };
    const t = this.tables.get(loc.queue);
    return { queue: { stake: t.stake, waiting: t.waiting.length, size: SIZE, code: t.private || null } };
  }

  lobby() {
    return {
      tables: [...this.tables.values()].filter((t) => !t.private).map((t) => ({ stake: t.stake, waiting: t.waiting.length, size: SIZE,
        prize: Math.floor(t.stake * SIZE * (1 - cfg().houseCut)) })).sort((a, b) => a.stake - b.stake),
      playing: [...this.games.values()].filter((g) => g.phase !== 'over' && !g.practice).length * SIZE,
      paused: !!this.manager?.paused,
    };
  }

  emitLobby() {
    this.io.to('hunt-lobby').emit('hunt:lobby', this.lobby());
    this.io.to('lobby').emit('hunt:home', this.lobby());
    for (const [uid] of this.userLoc) this.io.to(`user:${uid}`).emit('hunt:me', this.locationOf(uid));
  }

  syncTables() {
    for (const stake of cfg().stakes) if (!this.tables.has(stake)) this.tables.set(stake, { stake, size: SIZE, waiting: [], roundId: null });
    for (const [k, t] of [...this.tables]) {
      if (t.private || cfg().stakes.includes(k)) continue;
      for (const w of [...t.waiting]) this.leave({ id: w.uid });
      this.tables.delete(k);
    }
    this.emitLobby();
  }

  pauseNow() {
    let any = false;
    for (const t of this.tables.values()) {
      if (t.roundId && t.waiting.length) {
        for (const { userId } of refundRound(t.roundId, `Dibibkosh ${fmt(t.stake)}`, 'refunded (games paused)', 'cancelled')) this.onBalanceChange(userId);
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
