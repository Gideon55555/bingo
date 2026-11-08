// 8-ball pool: physics + rules, shared by the server (authoritative) and the app (replay + aiming).
//
// The physics only uses + − × ÷ and Math.sqrt, which give bit-identical results on every
// JavaScript engine. So the app can replay a shot from its parameters and see exactly what the
// server computed (the app still snaps to the server's final positions to be 100% safe).
//
// Table is vertical: x across (0..W), y along the length (0..H). The break is taken from the
// bottom (large y); the rack sits near the top.

export const W = 100;
export const H = 200;
export const R = 2.6;                 // ball radius
export const MAX_SPEED = 400;         // units/second at full power
const DECEL = 48;                      // rolling friction (units/s²)
const BALL_E = 0.96;                  // ball–ball restitution
const RAIL_E = 0.75;                  // cushion restitution
export const DT = 1 / 240;            // physics step
const MAX_STEPS = 240 * 30;           // safety cap: 30 seconds
const STOP = 0.6;

export const POCKETS = [
  { x: 0, y: 0, r: 6.2 }, { x: W, y: 0, r: 6.2 },
  { x: 0, y: H / 2, r: 5.2 }, { x: W, y: H / 2, r: 5.2 },
  { x: 0, y: H, r: 6.2 }, { x: W, y: H, r: 6.2 },
];
const CORNER_MOUTH = 8.2;  // along each rail from a corner, there's no cushion (the pocket opening)
const SIDE_MOUTH = 5.6;    // half-width of the side pocket opening

export const HEAD_LINE = H * 0.75;    // cue ball must be placed below this line on the break
export const FOOT_SPOT = { x: W / 2, y: H * 0.25 };

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];
export const groupOf = (n) => (n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : null);
export const BALL_COLORS = {
  1: '#f5c400', 2: '#1d4ed8', 3: '#dc2626', 4: '#6d28d9', 5: '#ea580c', 6: '#15803d', 7: '#7f1d1d', 8: '#111111',
  9: '#f5c400', 10: '#1d4ed8', 11: '#dc2626', 12: '#6d28d9', 13: '#ea580c', 14: '#15803d', 15: '#7f1d1d',
};

/** A fresh rack. rand() is used only to shuffle the non-fixed ball positions. */
export function rack(rand = Math.random) {
  const dx = 2 * R + 0.02;
  const dy = Math.sqrt(3) * R + 0.02;
  const spots = [];
  for (let k = 0; k < 5; k++) for (let j = 0; j <= k; j++) spots.push({ x: W / 2 + (j - k / 2) * dx, y: FOOT_SPOT.y - k * dy, k, j });
  // fixed: 8 in the middle of row 3; back corners one solid + one stripe
  const eightIdx = spots.findIndex((s) => s.k === 2 && s.j === 1);
  const cornerA = spots.findIndex((s) => s.k === 4 && s.j === 0);
  const cornerB = spots.findIndex((s) => s.k === 4 && s.j === 4);
  const pool = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const solid = pool.find((n) => n < 8);
  const stripe = pool.find((n) => n > 8);
  const rest = pool.filter((n) => n !== solid && n !== stripe);
  const flip = rand() < 0.5;
  const balls = [{ n: 0, x: W / 2, y: H * 0.8, vx: 0, vy: 0, in: false }];
  spots.forEach((s, i) => {
    const n = i === eightIdx ? 8 : i === cornerA ? (flip ? solid : stripe) : i === cornerB ? (flip ? stripe : solid) : rest.shift();
    balls.push({ n, x: s.x, y: s.y, vx: 0, vy: 0, in: false });
  });
  return balls.sort((a, b) => a.n - b.n);
}

export const cloneBalls = (balls) => balls.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: 0, vy: 0, in: b.in }));

/** Is (x,y) a legal cue-ball spot? (inside the cushions, not touching a ball, optionally behind the head line) */
export function canPlaceCue(balls, x, y, breakShot) {
  if (!(Number.isFinite(x) && Number.isFinite(y))) return false;
  if (x < R || x > W - R || y < R || y > H - R) return false;
  if (breakShot && y < HEAD_LINE) return false;
  return balls.every((b) => b.n === 0 || b.in || (b.x - x) ** 2 + (b.y - y) ** 2 >= (2 * R + 0.05) ** 2);
}

/**
 * Simulator. Create with the balls (positions at rest) and a shot, then call step() repeatedly
 * (the app does that in real time) or run() (the server does it in one go).
 */
export class Sim {
  constructor(balls, { dx, dy, power }) {
    this.balls = balls.map((b) => ({ ...b, vx: 0, vy: 0 }));
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = Math.max(0.03, Math.min(1, power)) * MAX_SPEED;
    const cue = this.balls[0];
    cue.vx = (dx / len) * speed;
    cue.vy = (dy / len) * speed;
    this.steps = 0;
    this.done = false;
    this.firstHit = null;          // number of the first ball the cue ball touched
    this.potted = [];              // numbers, in order
    this.railAfterHit = false;     // did any ball touch a cushion after the first contact?
    this.events = [];              // { t, type: 'hit'|'rail'|'pot', n, speed }
  }

  pot(b) {
    b.in = true; b.vx = 0; b.vy = 0;
    this.potted.push(b.n);
    this.events.push({ t: this.steps, type: 'pot', n: b.n });
  }

  step() {
    if (this.done) return;
    const bs = this.balls;
    let moving = false;
    // move + friction
    for (const b of bs) {
      if (b.in) continue;
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (sp2 === 0) continue;
      const sp = Math.sqrt(sp2);
      const ns = sp - DECEL * DT;
      if (ns <= STOP) { b.vx = 0; b.vy = 0; continue; }
      b.vx = (b.vx / sp) * ns;
      b.vy = (b.vy / sp) * ns;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      moving = true;
    }
    // pockets
    for (const b of bs) {
      if (b.in) continue;
      for (const p of POCKETS) {
        const ddx = b.x - p.x, ddy = b.y - p.y;
        if (ddx * ddx + ddy * ddy < p.r * p.r) { this.pot(b); break; }
      }
      if (!b.in && (b.x < -R || b.x > W + R || b.y < -R || b.y > H + R)) this.pot(b); // fell through an opening
    }
    // cushions (none across the pocket openings)
    for (const b of bs) {
      if (b.in) continue;
      const nearCornerY = b.y < CORNER_MOUTH || b.y > H - CORNER_MOUTH;
      const nearSideY = Math.abs(b.y - H / 2) < SIDE_MOUTH;
      const nearCornerX = b.x < CORNER_MOUTH || b.x > W - CORNER_MOUTH;
      let hit = false;
      if (!nearCornerY && !nearSideY) {
        if (b.x < R && b.vx < 0) { b.x = R; b.vx = -b.vx * RAIL_E; b.vy *= 0.98; hit = true; }
        else if (b.x > W - R && b.vx > 0) { b.x = W - R; b.vx = -b.vx * RAIL_E; b.vy *= 0.98; hit = true; }
      }
      if (!nearCornerX) {
        if (b.y < R && b.vy < 0) { b.y = R; b.vy = -b.vy * RAIL_E; b.vx *= 0.98; hit = true; }
        else if (b.y > H - R && b.vy > 0) { b.y = H - R; b.vy = -b.vy * RAIL_E; b.vx *= 0.98; hit = true; }
      }
      if (hit) {
        if (this.firstHit !== null) this.railAfterHit = true;
        this.events.push({ t: this.steps, type: 'rail', n: b.n, speed: Math.sqrt(b.vx * b.vx + b.vy * b.vy) });
      }
    }
    // ball–ball collisions
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.in) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.in) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        // push apart
        const overlap = (2 * R - d) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel <= 0) continue;
        const imp = ((1 + BALL_E) / 2) * rel;
        a.vx -= imp * nx; a.vy -= imp * ny;
        b.vx += imp * nx; b.vy += imp * ny;
        if (a.n === 0 && this.firstHit === null) this.firstHit = b.n;
        else if (b.n === 0 && this.firstHit === null) this.firstHit = a.n;
        this.events.push({ t: this.steps, type: 'hit', n: a.n, m: b.n, speed: rel });
        moving = true;
      }
    }
    this.steps++;
    if (!moving || this.steps >= MAX_STEPS) {
      this.done = true;
      for (const b of bs) { b.vx = 0; b.vy = 0; }
    }
  }

  run() {
    while (!this.done) this.step();
    return this.result();
  }

  result() {
    return {
      balls: this.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, in: b.in })),
      firstHit: this.firstHit, potted: this.potted, railAfterHit: this.railAfterHit,
      ms: Math.round(this.steps * DT * 1000),
    };
  }
}

/**
 * Apply the 8-ball rules to a finished shot.
 * game = { groups: [g0, g1] (null|'solids'|'stripes'), turn: 0|1, breakShot }
 * Returns { foul, reason, keepTurn, assign: {player, group}|null, win: playerIndex|null, respot8 }
 */
export function judge(game, ballsBefore, res) {
  const me = game.turn;
  const opp = 1 - me;
  const out = { foul: false, reason: null, keepTurn: false, assign: null, win: null, respot8: false };
  const myGroup = game.groups[me];
  const groupBalls = (g) => (g === 'solids' ? SOLIDS : STRIPES);
  const remainingBefore = (g) => groupBalls(g).filter((n) => !ballsBefore.find((b) => b.n === n).in);
  const onEight = myGroup && remainingBefore(myGroup).length === 0;
  const cuePotted = res.potted.includes(0);
  const eightPotted = res.potted.includes(8);
  const objectPotted = res.potted.filter((n) => n !== 0 && n !== 8);

  // --- fouls ---
  if (cuePotted) { out.foul = true; out.reason = 'Cue ball potted'; }
  else if (res.firstHit === null) { out.foul = true; out.reason = 'No ball hit'; }
  else if (!game.breakShot) {
    if (onEight && res.firstHit !== 8) { out.foul = true; out.reason = 'Must hit the 8 ball first'; }
    else if (myGroup && !onEight && groupOf(res.firstHit) !== myGroup) { out.foul = true; out.reason = `Must hit your own balls (${myGroup}) first`; }
    else if (!myGroup && res.firstHit === 8) { out.foul = true; out.reason = 'Hit the 8 ball first on an open table'; }
    else if (!res.railAfterHit && res.potted.length === 0) { out.foul = true; out.reason = 'No ball touched a cushion after contact'; }
  }

  // --- the 8 ball ---
  if (eightPotted) {
    if (game.breakShot) {
      out.respot8 = true; // potted on the break: put it back on the foot spot, play on
    } else if (onEight && !out.foul) {
      out.win = me;
      return out;
    } else {
      out.win = opp;
      out.reason = onEight ? `8 ball potted with a foul (${out.reason})` : '8 ball potted too early';
      return out;
    }
  }

  // --- groups (assigned on the first legal pot after the break) ---
  let group = myGroup;
  if (!myGroup && !game.breakShot && !out.foul && objectPotted.length) {
    group = groupOf(objectPotted[0]);
    out.assign = { player: me, group };
  }

  // --- does the shooter keep the table? ---
  if (!out.foul) {
    if (game.breakShot) out.keepTurn = objectPotted.length > 0;
    else if (!group) out.keepTurn = false;
    else out.keepTurn = objectPotted.some((n) => groupOf(n) === group);
  }
  return out;
}

/** Put a ball on the foot spot (or the nearest free spot above it). */
export function respot(balls, n) {
  const b = balls.find((x) => x.n === n);
  b.in = false;
  for (let k = 0; k < 200; k++) {
    const y = FOOT_SPOT.y - k * 0.5;
    if (balls.every((o) => o === b || o.in || (o.x - FOOT_SPOT.x) ** 2 + (o.y - y) ** 2 >= (2 * R + 0.05) ** 2)) {
      b.x = FOOT_SPOT.x; b.y = y; return;
    }
  }
}

/**
 * Aiming guide: from the cue ball in direction (dx,dy), find the first ball it would hit
 * (ghost-ball position) or the first cushion. Used to draw the aim line in the app.
 */
export function aimGuide(balls, dx, dy) {
  const cue = balls[0];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  let best = null;
  for (const b of balls) {
    if (b.n === 0 || b.in) continue;
    const ox = b.x - cue.x, oy = b.y - cue.y;
    const t = ox * ux + oy * uy;
    if (t <= 0) continue;
    const perp2 = ox * ox + oy * oy - t * t;
    const rr = 4 * R * R;
    if (perp2 > rr) continue;
    const dist = t - Math.sqrt(rr - perp2);
    if (!best || dist < best.dist) best = { dist, ball: b };
  }
  // distance to cushion
  const tx = ux > 0 ? (W - R - cue.x) / ux : ux < 0 ? (R - cue.x) / ux : Infinity;
  const ty = uy > 0 ? (H - R - cue.y) / uy : uy < 0 ? (R - cue.y) / uy : Infinity;
  const railDist = Math.min(tx, ty);
  if (best && best.dist < railDist) {
    const gx = cue.x + ux * best.dist, gy = cue.y + uy * best.dist;
    const nx = (best.ball.x - gx) / (2 * R), ny = (best.ball.y - gy) / (2 * R);
    // cue ball deflects along the tangent
    const dot = ux * nx + uy * ny;
    return { ghost: { x: gx, y: gy }, ball: best.ball.n, objDir: { x: nx, y: ny }, cueDir: { x: ux - dot * nx, y: uy - dot * ny }, dot };
  }
  return { end: { x: cue.x + ux * railDist, y: cue.y + uy * railDist } };
}

// ======================= Cutthroat (3–6 players) =======================
// Each player owns a set of balls. Pot your OPPONENTS' balls; the last player with
// any of their own balls left on the table wins.
//  • Keep shooting as long as you legally pot any ball.
//  • Foul (cue ball potted, no ball hit, no cushion after contact): the next player gets
//    ball in hand, and every opponent still in the game gets one of their potted balls back.
//  • A player whose balls are all potted is out.

/** Ball sets for n players: 3 → 1–5, 6–10, 11–15; 4 → 1–3, 4–6, 7–9, 10–12; … */
export function cutthroatSets(n) {
  const per = Math.floor(15 / n);
  return Array.from({ length: n }, (_, i) => Array.from({ length: per }, (_, k) => i * per + k + 1));
}

/** Rack for cutthroat: only the balls in play, shuffled, apex first. */
export function rackCutthroat(n, rand = Math.random) {
  const count = Math.floor(15 / n) * n;
  const dx = 2 * R + 0.02;
  const dy = Math.sqrt(3) * R + 0.02;
  const spots = [];
  for (let k = 0; k < 5; k++) for (let j = 0; j <= k; j++) spots.push({ x: W / 2 + (j - k / 2) * dx, y: FOOT_SPOT.y - k * dy });
  const nums = Array.from({ length: count }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [nums[i], nums[j]] = [nums[j], nums[i]]; }
  const balls = [{ n: 0, x: W / 2, y: H * 0.8, vx: 0, vy: 0, in: false }];
  nums.forEach((num, i) => balls.push({ n: num, x: spots[i].x, y: spots[i].y, vx: 0, vy: 0, in: false }));
  return balls.sort((a, b) => a.n - b.n);
}

/**
 * game = { turn, breakShot, sets: [[...], ...], alive: [bool, ...] }
 * Returns { foul, reason, keepTurn, returnBalls: [n...] }
 */
export function judgeCutthroat(game, ballsBefore, res) {
  const out = { foul: false, reason: null, keepTurn: false, returnBalls: [] };
  if (res.potted.includes(0)) { out.foul = true; out.reason = 'Cue ball potted'; }
  else if (res.firstHit === null) { out.foul = true; out.reason = 'No ball hit'; }
  else if (!game.breakShot && !res.railAfterHit && res.potted.length === 0) { out.foul = true; out.reason = 'No ball touched a cushion after contact'; }

  if (out.foul) {
    // penalty: each opponent still in the game gets one potted ball back (lowest number first)
    const after = new Map(res.balls.map((b) => [b.n, b]));
    game.sets.forEach((set, i) => {
      if (i === game.turn || !game.alive[i]) return;
      const back = set.find((n) => after.get(n)?.in);
      if (back !== undefined) out.returnBalls.push(back);
    });
  } else {
    out.keepTurn = res.potted.some((n) => n !== 0);
  }
  return out;
}

/** Which players still have balls on the table. */
export const aliveFromBalls = (sets, balls) => sets.map((set) => set.some((n) => !balls.find((b) => b.n === n)?.in));
