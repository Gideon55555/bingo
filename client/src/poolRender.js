import { canvasDpr } from './prefs.js';
// Canvas renderer for the 8-ball table. Runs its own animation loop and reads from a plain
// object (`view`) so React doesn't re-render every frame.
import { W, H, R, POCKETS, BALL_COLORS, HEAD_LINE, FOOT_SPOT, DT, Sim, aimGuide, canPlaceCue } from '../../shared/pool.js';

export const RAIL = 7;
export const TW = W + RAIL * 2;
export const TH = H + RAIL * 2;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- table (drawn once, cached)
function drawTable(ctx) {
  // rail: dark mahogany with a gold inlay
  const wood = ctx.createLinearGradient(-RAIL, 0, W + RAIL, 0);
  wood.addColorStop(0, '#1f0806'); wood.addColorStop(0.12, '#5a1f12'); wood.addColorStop(0.5, '#3a120a');
  wood.addColorStop(0.88, '#5a1f12'); wood.addColorStop(1, '#1f0806');
  ctx.fillStyle = wood;
  ctx.beginPath(); ctx.roundRect(-RAIL, -RAIL, TW, TH, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(233,185,73,.75)'; ctx.lineWidth = 0.35;
  ctx.beginPath(); ctx.roundRect(-RAIL + 1.1, -RAIL + 1.1, TW - 2.2, TH - 2.2, 4); ctx.stroke();

  // gold pocket plates (only on the rail, never over the cloth)
  ctx.save();
  ctx.beginPath(); ctx.rect(-RAIL, -RAIL, TW, TH); ctx.rect(-2, -2, W + 4, H + 4); ctx.clip('evenodd');
  for (const p of POCKETS) {
    const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.6, p.x, p.y, p.r * 1.7);
    g.addColorStop(0, '#fbe39a'); g.addColorStop(0.55, '#c9982f'); g.addColorStop(1, '#7a5512');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.7, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // cushions
  ctx.fillStyle = '#085a2e';
  ctx.fillRect(-2, -2, W + 4, H + 4);
  // cloth, lit from above like a real table lamp
  const felt = ctx.createRadialGradient(W / 2, H / 2, 8, W / 2, H / 2, H * 0.72);
  felt.addColorStop(0, '#22a862'); felt.addColorStop(0.6, '#168a4b'); felt.addColorStop(1, '#0b6535');
  ctx.fillStyle = felt;
  ctx.fillRect(0, 0, W, H);
  for (const cy of [H * 0.27, H * 0.73]) {
    const lamp = ctx.createRadialGradient(W / 2, cy, 2, W / 2, cy, 46);
    lamp.addColorStop(0, 'rgba(255,255,220,.10)'); lamp.addColorStop(1, 'rgba(255,255,220,0)');
    ctx.fillStyle = lamp; ctx.fillRect(0, 0, W, H);
  }
  // cushion shadow on the cloth (depth)
  const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,.34)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, 3.4, 0, 0, 0, 3.4, H); edge(W, 0, W - 3.4, 0, W - 3.4, 0, 3.4, H);
  edge(0, 0, 0, 3.4, 0, 0, W, 3.4); edge(0, H, 0, H - 3.4, 0, H - 3.4, W, 3.4);
  // cushion highlight
  ctx.strokeStyle = 'rgba(160,255,200,.22)'; ctx.lineWidth = 0.3;
  ctx.strokeRect(-1.1, -1.1, W + 2.2, H + 2.2);

  // markings
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 0.35; ctx.setLineDash([1.5, 1.5]);
  ctx.beginPath(); ctx.moveTo(0, HEAD_LINE); ctx.lineTo(W, HEAD_LINE); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.beginPath(); ctx.arc(FOOT_SPOT.x, FOOT_SPOT.y, 0.7, 0, TAU); ctx.fill();
  // faint emblem in the middle of the cloth
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 13, 0, TAU); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.font = '800 17px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('8', W / 2, H / 2 + 0.8);

  // gold diamonds on the rails
  ctx.fillStyle = '#f3c14b';
  const diamond = (x, y) => { ctx.beginPath(); ctx.moveTo(x, y - 0.95); ctx.lineTo(x + 0.7, y); ctx.lineTo(x, y + 0.95); ctx.lineTo(x - 0.7, y); ctx.fill(); };
  for (const k of [1, 2, 3, 5, 6, 7]) for (const x of [-RAIL / 2 - 0.4, W + RAIL / 2 + 0.4]) diamond(x, (H / 8) * k);
  for (const k of [1, 2, 3]) for (const y of [-RAIL / 2 - 0.4, H + RAIL / 2 + 0.4]) diamond((W / 4) * k, y);

  // pockets
  for (const p of POCKETS) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, '#000'); g.addColorStop(0.75, '#060606'); g.addColorStop(1, '#1c1c1c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.94, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 0.7; ctx.stroke();
  }
}

// ---------------------------------------------------------------- balls
/** Each ball remembers how far it has rolled so its number spins as it moves. */
function rollState(roll, b) {
  let st = roll.get(b.n);
  if (!st) { st = { x: b.x, y: b.y, ax: 0, ay: 0 }; roll.set(b.n, st); return st; }
  const dx = b.x - st.x, dy = b.y - st.y;
  if (Math.abs(dx) + Math.abs(dy) > 30) { st.ax = 0; st.ay = 0; }        // re-spotted / new rack
  else if (dx || dy) { st.ax += dx / R; st.ay += dy / R; }
  else { st.ax -= Math.sin(2 * st.ax) * 0.12; st.ay -= Math.sin(2 * st.ay) * 0.12; } // at rest the number turns to face up
  st.x = b.x; st.y = b.y;
  return st;
}

function drawBall(ctx, b, st, k = 1, alpha = 1) {
  const x = b.x, y = b.y, r = R * k;
  ctx.globalAlpha = alpha;
  // soft shadow
  ctx.fillStyle = 'rgba(0,0,0,.38)';
  ctx.beginPath(); ctx.ellipse(x + 0.7 * k, y + 1.1 * k, r * 0.98, r * 0.86, 0, 0, TAU); ctx.fill();
  const col = b.n === 0 ? '#fbfbf4' : BALL_COLORS[b.n];
  const stripe = b.n >= 9;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
  ctx.fillStyle = stripe ? '#fbfbf4' : col;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  if (stripe) { ctx.fillStyle = col; ctx.fillRect(x - r, y - r * 0.58, r * 2, r * 1.16); }
  if (b.n > 0) {
    // the number disc rolls over the ball (there is one on each side)
    const vis = Math.cos(st?.ax || 0) * Math.cos(st?.ay || 0);
    const sgn = vis >= 0 ? 1 : -1;
    const ox = sgn * Math.sin(st?.ax || 0) * r * 0.72, oy = sgn * Math.sin(st?.ay || 0) * r * 0.72;
    const dr = r * 0.5 * (0.5 + 0.5 * Math.abs(vis));
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x + ox, y + oy, dr, 0, TAU); ctx.fill();
    if (Math.abs(vis) > 0.35) {
      ctx.fillStyle = '#111';
      ctx.font = `800 ${dr * 1.32}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(b.n), x + ox, y + oy + dr * 0.08);
    }
  }
  // glossy shading
  const g = ctx.createRadialGradient(x - r * 0.42, y - r * 0.48, r * 0.05, x, y, r * 1.08);
  g.addColorStop(0, 'rgba(255,255,255,.75)');
  g.addColorStop(0.22, 'rgba(255,255,255,.12)');
  g.addColorStop(0.6, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- cue stick
function drawCue(ctx, cx, cy, ux, uy, pull) {
  const nx = -uy, ny = ux;
  const at = (d, wd) => [cx - ux * d + nx * wd, cy - uy * d + ny * wd];
  const seg = (d0, d1, w0, w1, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(...at(d0, w0)); ctx.lineTo(...at(d1, w1)); ctx.lineTo(...at(d1, -w1)); ctx.lineTo(...at(d0, -w0));
    ctx.closePath(); ctx.fill();
  };
  const d0 = R + pull, L = 92;
  const wAt = (d) => 0.45 + ((d - d0) / L) * 0.75;
  // shadow
  ctx.save(); ctx.translate(1.2, 1.8); ctx.globalAlpha = 0.28;
  seg(d0, d0 + L, wAt(d0), wAt(d0 + L), '#000');
  ctx.restore();
  seg(d0, d0 + 1, wAt(d0), wAt(d0 + 1), '#3f8cff');                         // chalked tip
  seg(d0 + 1, d0 + 3, wAt(d0 + 1), wAt(d0 + 3), '#f6efdc');                 // ferrule
  const [sx, sy] = at(d0 + 3, 0), [ex, ey] = at(d0 + 56, 0);
  const maple = ctx.createLinearGradient(sx, sy, ex, ey);
  maple.addColorStop(0, '#f0d9a8'); maple.addColorStop(1, '#c8944c');
  seg(d0 + 3, d0 + 56, wAt(d0 + 3), wAt(d0 + 56), maple);                   // shaft
  seg(d0 + 56, d0 + 57.2, wAt(d0 + 56), wAt(d0 + 57.2), '#e9b949');         // gold ring
  seg(d0 + 57.2, d0 + 78, wAt(d0 + 57.2), wAt(d0 + 78), '#16090a');         // wrap
  seg(d0 + 78, d0 + 79.2, wAt(d0 + 78), wAt(d0 + 79.2), '#e9b949');
  seg(d0 + 79.2, d0 + L, wAt(d0 + 79.2), wAt(d0 + L), '#7d1220');           // butt
  // light along the stick
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 0.22;
  ctx.beginPath(); ctx.moveTo(...at(d0 + 3, wAt(d0 + 3) * 0.45)); ctx.lineTo(...at(d0 + L, wAt(d0 + L) * 0.45)); ctx.stroke();
}

/**
 * view = {
 *   balls,                      // resting positions from the server
 *   replay: { sim, start, after, onPot, onHit, onRail, onDone } | null,
 *   aim: { dx, dy }, power,     // my aim (shown only when canAim)
 *   canAim, cueDrag: {x,y,valid} | null, cuePlaced, ballInHand, breakShot,
 *   targets: [n…] | null,       // balls I may legally hit first (null = any)
 *   strike: { at, power } | null  // the cue thrusting forward right after I shoot
 * }
 */
export function startPoolRender(canvas, view) {
  const ctx = canvas.getContext('2d');
  const table = document.createElement('canvas');
  const roll = new Map();
  let fx = [];
  let w = 0, h = 0, dpr = 1, raf;
  const resize = () => {
    dpr = canvasDpr();
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    table.width = canvas.width; table.height = canvas.height;
    const s = (w / TW) * dpr;
    const tc = table.getContext('2d');
    tc.setTransform(s, 0, 0, s, RAIL * s, RAIL * s);
    drawTable(tc);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const frame = (now) => {
    const scale = w / TW;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (table.width) ctx.drawImage(table, 0, 0);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * RAIL * scale, dpr * RAIL * scale);

    let balls = view.balls;
    if (view.replay) {
      const rp = view.replay;
      const target = Math.floor((now - rp.start) / (DT * 1000));
      let guard = 0;
      while (rp.sim.steps < target && !rp.sim.done && guard++ < 400) rp.sim.step();
      // sounds and sparkles for what just happened
      const ev = rp.sim.events;
      for (let i = rp.evAt || 0; i < ev.length; i++) {
        const e = ev[i];
        if (e.type === 'pot') {
          const b = rp.sim.balls.find((q) => q.n === e.n);
          let pk = POCKETS[0], best = Infinity;
          for (const p of POCKETS) { const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < best) { best = d; pk = p; } }
          fx.push({ type: 'pot', n: e.n, x: Math.max(0, Math.min(W, b.x)), y: Math.max(0, Math.min(H, b.y)), px: pk.x, py: pk.y, t: now });
          rp.onPot?.(e.n);
        } else if (e.type === 'hit') {
          if (e.speed > 25) {
            const a = rp.sim.balls.find((q) => q.n === e.n), b = rp.sim.balls.find((q) => q.n === e.m);
            fx.push({ type: 'spark', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: now, k: Math.min(1, e.speed / 250) });
          }
          rp.onHit?.(e.speed);
        } else if (e.type === 'rail') rp.onRail?.(e.speed);
      }
      rp.evAt = ev.length;
      balls = rp.sim.balls;
      if (rp.sim.done) { balls = rp.after; if (!rp.finished) { rp.finished = true; rp.onDone?.(); } }
    }

    const cueOverride = view.cueDrag || (view.ballInHand && view.cuePlaced);
    const aiming = view.canAim && !view.replay;

    // rings on the balls I'm allowed to hit
    if (aiming && view.targets && view.targets.length <= 7) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 280);
      ctx.strokeStyle = `rgba(251,227,154,${0.45 + 0.4 * pulse})`; ctx.lineWidth = 0.5;
      for (const b of balls) {
        if (b.in || !view.targets.includes(b.n)) continue;
        ctx.beginPath(); ctx.arc(b.x, b.y, R + 1 + pulse * 0.7, 0, TAU); ctx.stroke();
      }
    }

    // balls dropping into a pocket
    fx = fx.filter((f) => now - f.t < (f.type === 'pot' ? 260 : 200));
    for (const f of fx) {
      if (f.type !== 'pot') continue;
      const k = (now - f.t) / 260;
      drawBall(ctx, { n: f.n, x: f.x + (f.px - f.x) * k, y: f.y + (f.py - f.y) * k }, roll.get(f.n), 1 - k * 0.55, 1 - k);
    }

    // balls
    for (const b of balls) {
      if (b.in && !(b.n === 0 && cueOverride)) continue;
      if (b.n === 0 && cueOverride && !view.replay) {
        const c = { n: 0, x: cueOverride.x, y: cueOverride.y };
        drawBall(ctx, c, rollState(roll, c));
        if (view.cueDrag && !view.cueDrag.valid) {
          ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.arc(c.x, c.y, R + 0.8, 0, TAU); ctx.stroke();
        }
        continue;
      }
      drawBall(ctx, b, rollState(roll, b));
    }

    // collision sparkles
    for (const f of fx) {
      if (f.type !== 'spark') continue;
      const k = (now - f.t) / 200;
      ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.7 * f.k})`; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(f.x, f.y, R * (0.5 + k * 1.4), 0, TAU); ctx.stroke();
    }

    // ball-in-hand marker
    if (aiming && view.ballInHand && !view.cueDrag) {
      const c = cueOverride || balls[0];
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 0.45; ctx.setLineDash([1, 1]);
      ctx.beginPath(); ctx.arc(c.x, c.y, R + 2.2 + Math.sin(now / 250) * 0.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '4.6px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✋', c.x, c.y - R - 5.2 + Math.sin(now / 250) * 0.5);
    }

    // aiming guide + cue stick
    const striking = view.strike && now - view.strike.at < 110 && !view.replay;
    if ((aiming || striking) && !view.cueDrag && view.aim) {
      const cueBall = cueOverride ? { ...balls[0], ...cueOverride, in: false } : balls[0];
      if (!cueBall.in) {
        const bs = balls.map((b) => (b.n === 0 ? cueBall : b));
        const { dx, dy } = view.aim;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        if (aiming) {
          const g = aimGuide(bs, ux, uy);
          const legal = !g.ghost || !view.targets || view.targets.includes(g.ball);
          const main = legal ? '255,255,255' : '255,90,105';
          ctx.save();
          ctx.beginPath(); ctx.rect(-1.5, -1.5, W + 3, H + 3); ctx.clip();
          ctx.lineCap = 'round';
          // path of the cue ball: marching dots
          const end = g.ghost || g.end;
          ctx.strokeStyle = `rgba(${main},.92)`; ctx.lineWidth = 0.55;
          ctx.setLineDash([0.1, 1.9]); ctx.lineDashOffset = -(now / 45) % 2;
          ctx.beginPath(); ctx.moveTo(cueBall.x + ux * (R + 0.8), cueBall.y + uy * (R + 0.8)); ctx.lineTo(end.x, end.y); ctx.stroke();
          ctx.setLineDash([]);
          if (g.ghost) {
            const ob = bs.find((b) => b.n === g.ball);
            // where the cue ball will be at contact
            ctx.strokeStyle = `rgba(${main},.95)`; ctx.lineWidth = 0.45;
            ctx.beginPath(); ctx.arc(g.ghost.x, g.ghost.y, R, 0, TAU); ctx.stroke();
            if (!legal) {
              ctx.lineWidth = 0.6;
              ctx.beginPath(); ctx.moveTo(ob.x - 1.3, ob.y - 1.3); ctx.lineTo(ob.x + 1.3, ob.y + 1.3);
              ctx.moveTo(ob.x + 1.3, ob.y - 1.3); ctx.lineTo(ob.x - 1.3, ob.y + 1.3); ctx.stroke();
            } else {
              // where the object ball will go, and the pocket it's heading for
              const L = 10 + 46 * g.dot;
              for (const p of POCKETS) {
                const vx = p.x - ob.x, vy = p.y - ob.y;
                const along = vx * g.objDir.x + vy * g.objDir.y;
                const off = Math.abs(vx * g.objDir.y - vy * g.objDir.x);
                if (along > 0 && along < L + p.r && off < p.r * 0.7 && g.dot > 0.2) {
                  const glow = ctx.createRadialGradient(p.x, p.y, p.r * 0.4, p.x, p.y, p.r * 1.5);
                  glow.addColorStop(0, 'rgba(251,227,154,.75)'); glow.addColorStop(1, 'rgba(251,227,154,0)');
                  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.5, 0, TAU); ctx.fill();
                }
              }
              ctx.strokeStyle = 'rgba(251,227,154,.95)'; ctx.lineWidth = 0.6;
              ctx.beginPath(); ctx.moveTo(ob.x + g.objDir.x * R, ob.y + g.objDir.y * R);
              ctx.lineTo(ob.x + g.objDir.x * (R + L), ob.y + g.objDir.y * (R + L)); ctx.stroke();
              // where the cue ball goes after contact
              ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 0.4;
              ctx.beginPath(); ctx.moveTo(g.ghost.x, g.ghost.y); ctx.lineTo(g.ghost.x + g.cueDir.x * 16, g.ghost.y + g.cueDir.y * 16); ctx.stroke();
            }
          }
          ctx.restore();
        }
        // cue stick behind the ball: pulled back with power, thrust forward on the shot
        let pull = 1.6 + (view.power || 0) * 20;
        if (striking) pull = (1.6 + view.strike.power * 20) * Math.max(0, 1 - (now - view.strike.at) / 70) - 0.6;
        drawCue(ctx, cueBall.x, cueBall.y, ux, uy, pull);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}

/** Screen (client) coordinates → table coordinates */
export function toTable(canvas, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const scale = r.width / TW;
  return { x: (clientX - r.left) / scale - RAIL, y: (clientY - r.top) / scale - RAIL };
}

export { Sim, canPlaceCue };
