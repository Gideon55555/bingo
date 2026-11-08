// ድብብቆሽ / Dibibkosh (hide and seek) — shared rules + the hunter's prediction model.
//
// Board: 3×3 boxes, numbered 0–8 (row by row); 4 is the middle.
//   0 1 2
//   3 4 5
//   6 7 8
// Players start in the four corners, the hunter in the middle. Every move (a 3-second count):
//  • each player moves to a NEIGHBOURING box (diagonals count) — nobody may stand still;
//  • the hunter moves to any OTHER box;
//  • players who end in the hunter's box are out. Players may share a box with each other.
// After a catch the hunter goes back to the middle; the others stay where they are.
// Last player standing wins; if the last players are caught together they split the win.
//
// Fairness: the hunter picks its box from what players did in EARLIER moves only, and the server
// publishes a hash of its pick before players choose (revealed after), so it can't react to anyone's choice.

export const SIZE = 3;
export const CELLS = 9;
export const CENTER = 4;
export const CORNERS = [0, 2, 6, 8];
const rc = (i) => [Math.floor(i / SIZE), i % SIZE];
export const cheb = (a, b) => { const [r1, c1] = rc(a), [r2, c2] = rc(b); return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)); };
/** Boxes a player may move to from box i (all 8 directions, never staying). */
export const neighbors = (i) => Array.from({ length: CELLS }, (_, j) => j).filter((j) => j !== i && cheb(i, j) === 1);
export const isCorner = (i) => CORNERS.includes(i);
export const dir = (a, b) => { const [r1, c1] = rc(a), [r2, c2] = rc(b); return [Math.sign(r2 - r1), Math.sign(c2 - c1)]; };

// ---------------- the hunter's model of one player ----------------
// A small choice model: each possible move gets a score from a few habits, turned into probabilities
// (softmax). The weights start from how people usually play and are adjusted after every move this
// player makes, so the hunter "learns" each opponent during the match.
const FEATURES = ['flee', 'corner', 'center', 'repeat', 'back', 'crowd'];
export const PRIOR = { flee: 0.9, corner: 0.35, center: -0.5, repeat: 0.2, back: -0.2, crowd: 0.1 };

/** ctx = { hunter, last (box before `from`, or null), others: [boxes of other players] } */
function feats(from, to, ctx) {
  const d = ctx.last != null ? dir(ctx.last, from) : null;
  const nd = dir(from, to);
  return {
    flee: cheb(to, ctx.hunter) - cheb(from, ctx.hunter), // moving away from the hunter
    corner: isCorner(to) ? 1 : 0,
    center: to === CENTER ? 1 : 0,
    repeat: d && d[0] === nd[0] && d[1] === nd[1] ? 1 : 0,  // same direction as last time
    back: ctx.last === to ? 1 : 0,                           // straight back where they came from
    crowd: ctx.others.includes(to) ? 1 : 0,                  // joining another player
  };
}

export class PlayerModel {
  constructor(w = PRIOR) { this.w = { ...w }; this.seen = 0; }
  /** Probability of each legal move from `from`. */
  probs(from, ctx) {
    const opts = neighbors(from);
    const scores = opts.map((to) => { const f = feats(from, to, ctx); return FEATURES.reduce((s, k) => s + this.w[k] * f[k], 0); });
    const m = Math.max(...scores);
    const ex = scores.map((s) => Math.exp(s - m));
    const z = ex.reduce((a, b) => a + b, 0);
    return new Map(opts.map((to, k) => [to, ex[k] / z]));
  }
  /** Learn from a move the player actually made (one step of gradient ascent on its likelihood). */
  observe(from, to, ctx, lr = 0.35) {
    const p = this.probs(from, ctx);
    const expected = Object.fromEntries(FEATURES.map((k) => [k, 0]));
    for (const [opt, pr] of p) { const f = feats(from, opt, ctx); for (const k of FEATURES) expected[k] += pr * f[k]; }
    const actual = feats(from, to, ctx);
    for (const k of FEATURES) this.w[k] += lr * (actual[k] - expected[k]);
    this.seen++;
  }
}

/**
 * The hunter's pick: the box (other than where it stands) with the highest expected number of
 * players, using each player's model. Usually the best box; sometimes (surprise%) a box chosen in
 * proportion to its chance, so players can't count on it always going for the "obvious" box.
 * players: [{ pos, last, model }], rand(): number in [0,1)
 */
export function hunterPick(players, hunter, rand, { surprise = 0.15, reach = 'any', position = reach === 'any' ? 0 : 0.35 } = {}) {
  const mass = new Array(CELLS).fill(0);
  for (const p of players) {
    const ctx = { hunter, last: p.last, others: players.filter((q) => q !== p).map((q) => q.pos) };
    for (const [to, pr] of p.model.probs(p.pos, ctx)) mass[to] += pr;
  }
  const options = reach === 'any' ? Array.from({ length: CELLS }, (_, i) => i).filter((i) => i !== hunter) : neighbors(hunter);
  if (rand() < surprise) {
    const total = options.reduce((s, i) => s + mass[i] + 0.02, 0);
    let x = rand() * total;
    for (const i of options) { x -= mass[i] + 0.02; if (x <= 0) return { box: i, mass }; }
  }
  // A one-step cop also thinks one move ahead: boxes it can reach more of next time are worth more
  // (the middle touches all 9, a corner only 4), scaled by how many players are still in.
  const score = (i) => mass[i] + position * players.length * (neighbors(i).length + 1) / CELLS;
  const best = Math.max(...options.map(score));
  const top = options.filter((i) => Math.abs(score(i) - best) < 1e-9);
  return { box: top[Math.floor(rand() * top.length)], mass };
}

/** Context the model needs for a player (so server and tests compute it identically). */
export const ctxFor = (players, p, hunter) => ({ hunter, last: p.last, others: players.filter((q) => q !== p && !q.out).map((q) => q.pos) });

/** Apply one move. moves: Map(playerIndex → box). Returns { caught: [indexes], winners: [indexes] | null }. */
export function resolve(players, moves, hunterBox) {
  for (const [i, to] of moves) {
    const p = players[i];
    if (p.out) continue;
    if (!neighbors(p.pos).includes(to)) throw new Error(`illegal move ${p.pos}→${to}`);
    p.last = p.pos;
    p.pos = to;
  }
  const alive = players.map((p, i) => i).filter((i) => !players[i].out);
  const caught = alive.filter((i) => players[i].pos === hunterBox);
  for (const i of caught) players[i].out = true;
  const left = alive.filter((i) => !caught.includes(i));
  if (left.length === 1) return { caught, winners: left };
  if (left.length === 0) return { caught, winners: caught }; // the last ones were caught together → split
  return { caught, winners: null };
}

/** A simple practice opponent: mostly runs away from the hunter, a bit random. */
export function botMove(players, i, hunter, rand) {
  const p = players[i];
  const opts = neighbors(p.pos);
  const scored = opts.map((to) => ({ to, s: cheb(to, hunter) * 1.2 + (isCorner(to) ? 0.4 : 0) + rand() * 1.6 }));
  return scored.sort((a, b) => b.s - a.s)[0].to;
}
