// Canvas renderer for the Kerenbula table. Own animation loop; reads a plain `view` object so
// React doesn't re-render every frame.
import { W, H, R, PIN_R, DT, MAX_SPEED, MIDLINE, RELEASE_Y, BALL_HEX, colorOf, Sim } from '../../shared/kerenbula.js';

export const RAIL = 6;
export const TW = W + RAIL * 2;
export const TH = H + RAIL * 2;
const DECEL = 62; // same as the shared physics

function drawBall(ctx, b, alpha = 1) {
  const { x, y } = b;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(x + 0.45, y + 0.8, R * 0.95, R * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  const col = BALL_HEX[colorOf(b.n)];
  const g = ctx.createRadialGradient(x - R * 0.4, y - R * 0.45, R * 0.1, x, y, R * 1.05);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.18, col);
  g.addColorStop(1, colorOf(b.n) === 'white' ? '#b9b3a2' : 'rgba(0,0,0,.85)');
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = alpha * 0.75;
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPin(ctx, p) {
  const col = p.color === 'red' ? '#e23b3b' : '#f6f3ea';
  if (p.up) {
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(p.x + 0.5, p.y + 0.7, PIN_R, PIN_R * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, PIN_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.2; ctx.stroke();
    ctx.fillStyle = p.color === 'red' ? '#ffb4b4' : '#ffffff';
    ctx.beginPath(); ctx.arc(p.x - 0.3, p.y - 0.3, PIN_R * 0.45, 0, Math.PI * 2); ctx.fill();
    return;
  }
  // knocked over: lying along the direction it was hit
  const fx = p.fx ?? 0, fy = p.fy ?? -1;
  const len = 5;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(fy, fx));
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.roundRect(0.3, -PIN_R * 0.7 + 0.5, len, PIN_R * 1.4, PIN_R * 0.7); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.roundRect(0, -PIN_R * 0.7, len, PIN_R * 1.4, PIN_R * 0.7); ctx.fill();
  ctx.beginPath(); ctx.arc(len, 0, PIN_R * 0.85, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.2; ctx.stroke();
  ctx.restore();
}

function drawTable(ctx) {
  const wood = ctx.createLinearGradient(-RAIL, 0, W + RAIL, 0);
  wood.addColorStop(0, '#6b3f1a'); wood.addColorStop(0.5, '#8c5626'); wood.addColorStop(1, '#6b3f1a');
  ctx.fillStyle = wood;
  ctx.beginPath(); ctx.roundRect(-RAIL, -RAIL, TW, TH, 3); ctx.fill();
  // wood grain
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 0.25;
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-RAIL + 1 + i * 0.8, -RAIL); ctx.lineTo(-RAIL + 1 + i * 0.8, H + RAIL); ctx.stroke(); ctx.beginPath(); ctx.moveTo(W + 1 + i * 0.8, -RAIL); ctx.lineTo(W + 1 + i * 0.8, H + RAIL); ctx.stroke(); }
  ctx.fillStyle = '#0c5a33';
  ctx.fillRect(-1.3, -1.3, W + 2.6, H + 2.6);
  const felt = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, H * 0.7);
  felt.addColorStop(0, '#17914f'); felt.addColorStop(1, '#0d7240');
  ctx.fillStyle = felt;
  ctx.fillRect(0, 0, W, H);
  // midline + release line
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 0.35; ctx.setLineDash([1.6, 1.6]);
  ctx.beginPath(); ctx.moveTo(0, MIDLINE); ctx.lineTo(W, MIDLINE); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.beginPath(); ctx.moveTo(0, RELEASE_Y - R - 1); ctx.lineTo(W, RELEASE_Y - R - 1); ctx.stroke();
  ctx.setLineDash([]);
  // a painted circle around the pins
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 0.4;
  ctx.beginPath(); ctx.arc(W / 2, MIDLINE, 12, 0, Math.PI * 2); ctx.stroke();
}

/** First thing a ball rolled from (x, y) along (ux, uy) would touch: a ball, a standing pin, or a cushion. */
function ray(balls, pins, x, y, ux, uy, skip) {
  let best = { t: Infinity };
  const hit = (cx, cy, rr, what) => {
    const ox = x - cx, oy = y - cy;
    const b = ox * ux + oy * uy, c = ox * ox + oy * oy - rr * rr;
    const disc = b * b - c;
    if (disc < 0) return;
    const t = -b - Math.sqrt(disc);
    if (t > 0.01 && t < best.t) best = { t, what, cx, cy };
  };
  for (const o of balls) if (o.on && o.n !== skip) hit(o.x, o.y, 2 * R, 'ball');
  for (const p of pins) if (p.up) hit(p.x, p.y, R + PIN_R, 'pin');
  const walls = [ux < 0 ? (R - x) / ux : ux > 0 ? (W - R - x) / ux : Infinity, uy < 0 ? (R - y) / uy : uy > 0 ? (H - R - y) / uy : Infinity];
  const tw = Math.min(...walls);
  if (tw < best.t) best = { t: tw, what: 'wall' };
  return { ...best, x: x + ux * best.t, y: y + uy * best.t };
}

/**
 * view = {
 *   balls, pins,                       // resting state from the server
 *   replay: { sim, start, after, pinsAfter } | null,
 *   canRoll, next (ball number to roll), handX, aim: {dx,dy}, power
 * }
 */
export function startKbRender(canvas, view) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, raf;
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const frame = (now) => {
    const scale = w / TW;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * RAIL * scale, dpr * RAIL * scale);
    ctx.clearRect(-RAIL, -RAIL, TW, TH);
    drawTable(ctx);

    let balls = view.balls, pins = view.pins;
    if (view.replay) {
      const rp = view.replay;
      const target = Math.floor((now - rp.start) / (DT * 1000));
      let guard = 0;
      while (rp.sim.steps < target && !rp.sim.done && guard++ < 400) {
        const k = rp.sim.knocked.length;
        const e = rp.sim.events.length;
        rp.sim.step();
        if (rp.sim.knocked.length > k) rp.onPin?.(rp.sim.knocked[rp.sim.knocked.length - 1]);
        else if (rp.sim.events.length > e) rp.onHit?.();
      }
      balls = rp.sim.balls; pins = rp.sim.pins;
      if (rp.sim.done) { balls = rp.after; pins = rp.pinsAfter; if (!rp.finished) { rp.finished = true; rp.onDone?.(); } }
    }

    for (const p of pins) if (!p.up) drawPin(ctx, p);
    for (const b of balls) if (b.on) drawBall(ctx, b);
    for (const p of pins) if (p.up) drawPin(ctx, p);

    // my roll: ball in hand on the release line, aim line, and where it would stop on its own
    if (view.canRoll && !view.replay && view.next != null) {
      const x = view.handX, y = RELEASE_Y;
      const { dx, dy } = view.aim;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const r = ray(balls, pins, x, y, ux, uy, view.next);
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 0.35; ctx.setLineDash([1.2, 1]);
      ctx.beginPath(); ctx.moveTo(x + ux * R, y + uy * R); ctx.lineTo(r.x, r.y); ctx.stroke(); ctx.setLineDash([]);
      if (r.what !== 'wall') {
        ctx.strokeStyle = r.what === 'pin' ? '#ff6b6b' : 'rgba(255,255,255,.85)';
        ctx.beginPath(); ctx.arc(r.x, r.y, R, 0, Math.PI * 2); ctx.stroke();
      }
      if (view.power > 0) {
        // free-rolling stop distance: v² / 2a (ignores collisions and cushions)
        const v = view.power * MAX_SPEED;
        const d = Math.min((v * v) / (2 * DECEL), r.t + 0.01);
        const sx = x + ux * d, sy = y + uy * d;
        ctx.strokeStyle = 'rgba(255,214,90,.95)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(sx, sy, R + 0.6, 0, Math.PI * 2); ctx.stroke();
      }
      // the ball in your hand, gently pulsing
      drawBall(ctx, { n: view.next, x, y }, 0.95);
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 0.35;
      ctx.beginPath(); ctx.arc(x, y, R + 1.4 + Math.sin(now / 250) * 0.4, 0, Math.PI * 2); ctx.stroke();
      // ‹ › arrows: drag along the bottom to move your hand
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.font = '600 4px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('‹', x - R - 4.2, y); ctx.fillText('›', x + R + 4.2, y);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}

export function toTable(canvas, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const scale = r.width / TW;
  return { x: (clientX - r.left) / scale - RAIL, y: (clientY - r.top) / scale - RAIL };
}

export { Sim };
