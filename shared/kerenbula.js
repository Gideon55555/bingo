// ከረንቡላ / Kerenbula — Ethiopian table bocce with pins. Shared by the server (authoritative)
// and the app (replay + aiming). Physics uses only + − × ÷ and √, so it is identical on every device.
//
// Table is vertical: every ball is rolled BY HAND from the bottom release line upward.
// Balls: 0 = blue (the jack), 1–4 = red, 5–8 = white.
// Pins: 3 small pins in a line across the centre — red in the middle, white on each side.
//
// Rules (as described by the operator):
//  • The jack must be rolled past the midline. Then players roll to get closest to the jack;
//    the player who is NOT closest keeps rolling until they are closer or out of balls.
//  • A pin knocked over by the BLUE ball (because your shot sent it there) = +PIN_POINTS for you.
//  • A pin knocked over directly by a red or white ball = −PIN_POINTS for that ball's owner
//    (so knocking an opponent's ball into the pins penalises them).
//  • When all 8 balls are rolled, the player with the closest ball scores 1 point for each of their
//    balls that is closer than the opponent's closest ball. Pins are set up again for the next frame.

export const W = 100;
export const H = 200;
export const R = 3.2;
export const PIN_R = 1.5;
export const MAX_SPEED = 330;
export const DT = 1 / 240;
const DECEL = 62;
const BALL_E = 0.9;
const RAIL_E = 0.6;
const STOP = 0.6;
const MAX_STEPS = 240 * 30;

export const RELEASE_Y = H - R - 2;          // every roll starts on this line
export const MIDLINE = H / 2;
export const PINS = [
  { x: W / 2 - 6, y: H / 2, color: 'white' },
  { x: W / 2, y: H / 2, color: 'red' },
  { x: W / 2 + 6, y: H / 2, color: 'white' },
];
export const JACK = 0;
export const RED = [1, 2, 3, 4];
export const WHITE = [5, 6, 7, 8];
export const colorOf = (n) => (n === 0 ? 'blue' : n <= 4 ? 'red' : 'white');
export const BALL_HEX = { blue: '#2563eb', red: '#dc2626', white: '#f4f1e8' };

export const freshBalls = () => Array.from({ length: 9 }, (_, n) => ({ n, x: 0, y: 0, on: false }));
export const freshPins = () => PINS.map((p) => ({ ...p, up: true, by: null, angle: 0 }));
export const dist = (a, b) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

/** Can a ball be released at x on the release line? (inside the table, not on top of a resting ball) */
export function canRelease(balls, x) {
  if (!Number.isFinite(x) || x < R || x > W - R) return false;
  return balls.every((b) => !b.on || (b.x - x) * (b.x - x) + (b.y - RELEASE_Y) * (b.y - RELEASE_Y) >= (2 * R + 0.05) * (2 * R + 0.05));
}

export class Sim {
  /** balls: resting balls; pins; roll: { n, x, dx, dy, power } */
  constructor(balls, pins, { n, x, dx, dy, power }) {
    this.balls = balls.map((b) => ({ ...b, vx: 0, vy: 0 }));
    this.pins = pins.map((p) => ({ ...p }));
    const b = this.balls[n];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = Math.max(0.03, Math.min(1, power)) * MAX_SPEED;
    Object.assign(b, { x, y: RELEASE_Y, on: true, vx: (dx / len) * speed, vy: (dy / len) * speed });
    this.rolled = n;
    this.steps = 0;
    this.done = false;
    this.knocked = []; // [{ pin, by }]
    this.events = [];
  }

  step() {
    if (this.done) return;
    const bs = this.balls;
    let moving = false;
    for (const b of bs) {
      if (!b.on) continue;
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (sp2 === 0) continue;
      const sp = Math.sqrt(sp2);
      const ns = sp - DECEL * DT;
      if (ns <= STOP) { b.vx = 0; b.vy = 0; continue; }
      b.vx = (b.vx / sp) * ns; b.vy = (b.vy / sp) * ns;
      b.x += b.vx * DT; b.y += b.vy * DT;
      moving = true;
    }
    // cushions (no pockets)
    for (const b of bs) {
      if (!b.on) continue;
      if (b.x < R && b.vx < 0) { b.x = R; b.vx = -b.vx * RAIL_E; }
      else if (b.x > W - R && b.vx > 0) { b.x = W - R; b.vx = -b.vx * RAIL_E; }
      if (b.y < R && b.vy < 0) { b.y = R; b.vy = -b.vy * RAIL_E; }
      else if (b.y > H - R && b.vy > 0) { b.y = H - R; b.vy = -b.vy * RAIL_E; }
    }
    // pins: the first ball to touch a standing pin knocks it over
    for (const p of this.pins) {
      if (!p.up) continue;
      for (const b of bs) {
        if (!b.on) continue;
        const dx = p.x - b.x, dy = p.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= (R + PIN_R) * (R + PIN_R)) continue;
        const sp2 = b.vx * b.vx + b.vy * b.vy;
        if (sp2 < 4) continue; // a ball just resting against a pin doesn't knock it
        const d = Math.sqrt(d2) || 1;
        const nx = dx / d, ny = dy / d;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) { b.vx -= 0.55 * vn * nx; b.vy -= 0.55 * vn * ny; }
        p.up = false; p.by = b.n;
        const sp = Math.sqrt(sp2);
        p.fx = b.vx / sp; p.fy = b.vy / sp; // direction it falls (for drawing)
        this.knocked.push({ pin: this.pins.indexOf(p), by: b.n });
        this.events.push({ t: this.steps, type: 'pin', by: b.n });
        break;
      }
    }
    // ball–ball
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (!a.on) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (!b.on) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const ov = (2 * R - d) / 2;
        a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel <= 0) continue;
        const imp = ((1 + BALL_E) / 2) * rel;
        a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny;
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

  run() { while (!this.done) this.step(); return this.result(); }

  result() {
    return {
      balls: this.balls.map(({ n, x, y, on }) => ({ n, x, y, on })),
      pins: this.pins.map(({ x, y, color, up, by, fx, fy }) => ({ x, y, color, up, by, fx, fy })),
      knocked: this.knocked,
      ms: Math.round(this.steps * DT * 1000),
    };
  }
}

/**
 * Points from one roll. players: ['red','white'] colour per player index; shooter = player index.
 * Returns { delta: [p0, p1], legal: n, fouls: [{ player, count }] }
 */
export function pinPoints(colors, shooter, knocked, { isJackRoll, pinPoints = 4 }) {
  const delta = [0, 0];
  let legal = 0;
  const fouls = [0, 0];
  if (isJackRoll) return { delta, legal: 0, fouls: [], reset: knocked.length > 0 };
  for (const k of knocked) {
    if (k.by === JACK) { delta[shooter] += pinPoints; legal++; }
    else { const owner = colors.indexOf(colorOf(k.by)); delta[owner] -= pinPoints; fouls[owner]++; }
  }
  return { delta, legal, fouls: fouls.map((count, player) => ({ player, count })).filter((f) => f.count), reset: false };
}

/** Which player currently has the ball closest to the jack (null if no coloured ball on the table). */
export function closestPlayer(colors, balls) {
  const jack = balls[JACK];
  let best = null;
  for (const b of balls) {
    if (b.n === JACK || !b.on) continue;
    const d = dist(b, jack);
    if (!best || d < best.d) best = { d, player: colors.indexOf(colorOf(b.n)) };
  }
  return best ? best.player : null;
}

/** End of frame: closest player scores 1 per ball closer than the opponent's closest ball. */
export function frameScore(colors, balls) {
  const jack = balls[JACK];
  const ds = [[], []];
  for (const b of balls) {
    if (b.n === JACK || !b.on) continue;
    ds[colors.indexOf(colorOf(b.n))].push(dist(b, jack));
  }
  const best = ds.map((a) => (a.length ? Math.min(...a) : Infinity));
  if (best[0] === best[1]) return { winner: null, points: 0 };
  const w = best[0] < best[1] ? 0 : 1;
  return { winner: w, points: ds[w].filter((d) => d < best[1 - w]).length };
}
