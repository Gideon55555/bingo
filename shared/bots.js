// Practice-mode opponents. They aim like a decent amateur, with a little random error so they
// can be beaten. Used only for free practice games (no money is ever involved).
import { R as PR, POCKETS, SOLIDS, STRIPES, canPlaceCue } from './pool.js';
import { W as KW, RELEASE_Y, MIDLINE, Sim as KbSim, canRelease, dist, pinPoints } from './kerenbula.js';

const noise = (deg) => ((Math.random() - 0.5) * 2 * deg * Math.PI) / 180;
const rotate = (dx, dy, a) => ({ dx: dx * Math.cos(a) - dy * Math.sin(a), dy: dx * Math.sin(a) + dy * Math.cos(a) });

/** 8-ball: st = pool state as seen by the bot (players, me, balls, ballInHand, breakShot). */
export function poolShot(st, { skill = 0.75 } = {}) {
  const me = st.players[st.me];
  const balls = st.balls.map((b) => ({ ...b }));
  const targets = balls.filter((b) => !b.in && b.n !== 0 && (me.group
    ? (me.left > 0 ? (me.group === 'solids' ? SOLIDS : STRIPES).includes(b.n) : b.n === 8)
    : b.n !== 8));
  let cue = balls[0];
  let placed = null;
  if (st.ballInHand) {
    if (st.breakShot) placed = { x: 50, y: 170 };
    else {
      for (const t of targets) for (const p of POCKETS) {
        if (placed) break;
        const vx = t.x - p.x, vy = t.y - p.y, l = Math.hypot(vx, vy);
        const cand = { x: t.x + (vx / l) * 18, y: t.y + (vy / l) * 18 };
        if (canPlaceCue(balls, cand.x, cand.y, false)) placed = cand;
      }
      for (let k = 0; k < 500 && !placed; k++) { const c = { x: 5 + Math.random() * 90, y: 5 + Math.random() * 190 }; if (canPlaceCue(balls, c.x, c.y, false)) placed = c; }
    }
    cue = { ...cue, ...placed, in: false };
  }
  if (st.breakShot) return { dx: (Math.random() - 0.5) * 0.04, dy: -1, power: 1, cue: placed };
  let best = null;
  for (const t of targets) for (const p of POCKETS) {
    const vx = p.x - t.x, vy = p.y - t.y, l = Math.hypot(vx, vy);
    const gx = t.x - (vx / l) * 2 * PR, gy = t.y - (vy / l) * 2 * PR;
    const ax = gx - cue.x, ay = gy - cue.y, al = Math.hypot(ax, ay);
    const cut = (ax / al) * (vx / l) + (ay / al) * (vy / l);
    if (cut < 0.3) continue;
    const score = cut * 2 - l / 200 - al / 300;
    if (!best || score > best.score) best = { score, dx: ax, dy: ay, power: Math.min(1, 0.35 + (l + al) / 400) };
  }
  if (!best) { const t = targets[0] || balls.find((b) => !b.in && b.n !== 0); best = { dx: t.x - cue.x, dy: t.y - cue.y, power: 0.6 }; }
  const aim = rotate(best.dx, best.dy, noise((1 - skill) * 6)); // a few degrees of error
  return { dx: aim.dx, dy: aim.dy, power: best.power, cue: placed };
}

/** Kerenbula: try a handful of rolls with the shared physics and keep the best (with some error). */
export function kerenbulaRoll(st, { tries = 30, skill = 0.75 } = {}) {
  const balls = st.balls.map((b) => ({ ...b }));
  const pins = st.pins.map((p) => ({ ...p }));
  const n = st.next;
  const colors = ['red', 'white'];
  let best = null;
  for (let k = 0; k < tries; k++) {
    const x = 8 + Math.random() * (KW - 16);
    if (!canRelease(balls, x)) continue;
    let tx, ty, power;
    if (n === 0) { tx = 20 + Math.random() * 60; ty = 80; power = 0.34 + Math.random() * 0.12; }
    else {
      const j = balls[0];
      tx = j.x + (Math.random() - 0.5) * 6; ty = j.y + (Math.random() - 0.5) * 6;
      let want = dist({ x, y: RELEASE_Y }, j);
      const kind = k % 4;
      if (kind === 2) { const left = Math.random() < 0.5; tx = left ? -tx : 2 * KW - tx; want *= 1.4; }
      power = Math.min(1, Math.sqrt(2 * 62 * want * (0.9 + Math.random() * 0.3)) / 330 + (kind === 3 ? 0.2 + Math.random() * 0.4 : 0));
    }
    const roll = { x, dx: tx - x, dy: ty - RELEASE_Y, power };
    if (roll.dy >= 0) continue;
    const res = new KbSim(balls, pins, { n, ...roll }).run();
    let score;
    if (n === 0) score = res.balls[0].y < MIDLINE ? -Math.abs(res.balls[0].y - 85) : -999;
    else {
      const pts = pinPoints(colors, st.me, res.knocked, { isJackRoll: false, pinPoints: st.pinPoints });
      const mineN = (b) => (st.me === 0 ? b.n >= 1 && b.n <= 4 : b.n >= 5);
      const mine = res.balls.filter((b) => b.on && b.n !== 0 && mineN(b)).map((b) => dist(b, res.balls[0]));
      const theirs = res.balls.filter((b) => b.on && b.n !== 0 && !mineN(b)).map((b) => dist(b, res.balls[0]));
      score = (pts.delta[st.me] - pts.delta[1 - st.me]) * 6 - Math.min(60, ...mine) + Math.min(60, ...theirs) * 0.5;
    }
    if (!best || score > best.score) best = { score, roll };
  }
  const roll = best?.roll || { x: KW / 2, dx: 0, dy: -1, power: 0.4 };
  const a = rotate(roll.dx, roll.dy, noise((1 - skill) * 5));
  return { ...roll, dx: a.dx, dy: Math.min(-0.01, a.dy), power: Math.min(1, roll.power * (1 + (Math.random() - 0.5) * (1 - skill) * 0.3)) };
}
