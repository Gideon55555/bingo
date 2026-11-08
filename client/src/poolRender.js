// Canvas renderer for the pool table. Runs its own animation loop and reads from a plain
// object (`view`) so React doesn't re-render every frame.
import { W, H, R, POCKETS, BALL_COLORS, HEAD_LINE, FOOT_SPOT, DT, Sim, aimGuide, canPlaceCue } from '../../shared/pool.js';

export const RAIL = 7;
export const TW = W + RAIL * 2;
export const TH = H + RAIL * 2;

function drawBall(ctx, b, s) {
  const x = b.x, y = b.y;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(x + 0.5, y + 0.9, R * 0.95, R * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  const col = b.n === 0 ? '#f8f8f2' : BALL_COLORS[b.n];
  const stripe = b.n >= 9;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = stripe ? '#f8f8f2' : col;
  ctx.fillRect(x - R, y - R, R * 2, R * 2);
  if (stripe) { ctx.fillStyle = col; ctx.fillRect(x - R, y - R * 0.55, R * 2, R * 1.1); }
  // shading
  const g = ctx.createRadialGradient(x - R * 0.4, y - R * 0.45, R * 0.1, x, y, R * 1.05);
  g.addColorStop(0, 'rgba(255,255,255,.55)');
  g.addColorStop(0.35, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = g;
  ctx.fillRect(x - R, y - R, R * 2, R * 2);
  ctx.restore();
  if (b.n > 0) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, R * 0.48, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `700 ${R * 0.62}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(b.n), x, y + R * 0.04);
  }
}

function drawTable(ctx) {
  // wooden rail
  const wood = ctx.createLinearGradient(-RAIL, 0, W + RAIL, 0);
  wood.addColorStop(0, '#5b3415'); wood.addColorStop(0.5, '#7a4a20'); wood.addColorStop(1, '#5b3415');
  ctx.fillStyle = wood;
  ctx.beginPath(); ctx.roundRect(-RAIL, -RAIL, TW, TH, 4); ctx.fill();
  // cushion strip
  ctx.fillStyle = '#0d6b3a';
  ctx.fillRect(-1.6, -1.6, W + 3.2, H + 3.2);
  // felt
  const felt = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, H * 0.7);
  felt.addColorStop(0, '#1a9a55'); felt.addColorStop(1, '#0f7a40');
  ctx.fillStyle = felt;
  ctx.fillRect(0, 0, W, H);
  // markings
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 0.35; ctx.setLineDash([1.5, 1.5]);
  ctx.beginPath(); ctx.moveTo(0, HEAD_LINE); ctx.lineTo(W, HEAD_LINE); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.beginPath(); ctx.arc(FOOT_SPOT.x, FOOT_SPOT.y, 0.7, 0, Math.PI * 2); ctx.fill();
  // diamonds on the rails
  ctx.fillStyle = '#e8d5a8';
  for (let i = 1; i < 4; i++) for (const x of [-RAIL / 2, W + RAIL / 2]) { ctx.beginPath(); ctx.arc(x, (H / 4) * i - (i === 2 ? 0 : 0), 0.7, 0, Math.PI * 2); ctx.fill(); }
  for (let i = 1; i < 4; i++) { const yy = (H / 8) * (i * 2 - 1); for (const x of [-RAIL / 2, W + RAIL / 2]) { ctx.beginPath(); ctx.arc(x, yy, 0.5, 0, Math.PI * 2); ctx.fill(); } }
  // pockets
  for (const p of POCKETS) {
    ctx.fillStyle = '#050505';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.92, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 0.6; ctx.stroke();
  }
}

/**
 * view = {
 *   balls,                      // resting positions from the server
 *   replay: { sim, start, after } | null,
 *   aim: { dx, dy }, power,     // my aim (shown only when canAim)
 *   canAim, cueDrag: {x,y,valid} | null, ballInHand, breakShot
 * }
 */
export function startPoolRender(canvas, view) {
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

    let balls = view.balls;
    if (view.replay) {
      const rp = view.replay;
      const target = Math.floor((now - rp.start) / (DT * 1000));
      let guard = 0;
      while (rp.sim.steps < target && !rp.sim.done && guard++ < 400) {
        const potsBefore = rp.sim.potted.length;
        rp.sim.step();
        if (rp.sim.potted.length > potsBefore && rp.onPot) rp.onPot(rp.sim.potted[rp.sim.potted.length - 1]);
      }
      balls = rp.sim.balls;
      if (rp.sim.done) { balls = rp.after; if (!rp.finished) { rp.finished = true; rp.onDone?.(); } }
    }

    const cueOverride = view.cueDrag || (view.ballInHand && view.cuePlaced);
    // balls
    for (const b of balls) {
      if (b.in && !(b.n === 0 && cueOverride)) continue;
      if (b.n === 0 && cueOverride && !view.replay) {
        drawBall(ctx, { n: 0, x: cueOverride.x, y: cueOverride.y }, scale);
        if (view.cueDrag && !view.cueDrag.valid) {
          ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.arc(cueOverride.x, cueOverride.y, R + 0.8, 0, Math.PI * 2); ctx.stroke();
        }
        continue;
      }
      drawBall(ctx, b, scale);
    }

    // ball-in-hand marker
    if (view.canAim && view.ballInHand && !view.cueDrag) {
      const c = cueOverride || balls[0];
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 0.45; ctx.setLineDash([1, 1]);
      ctx.beginPath(); ctx.arc(c.x, c.y, R + 2.2 + Math.sin(now / 250) * 0.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }

    // aiming guide + cue stick
    if (view.canAim && !view.replay && !view.cueDrag && view.aim) {
      const cueBall = cueOverride ? { ...balls[0], ...cueOverride, in: false } : balls[0];
      if (!cueBall.in) {
        const bs = balls.map((b) => (b.n === 0 ? cueBall : b));
        const { dx, dy } = view.aim;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const g = aimGuide(bs, ux, uy);
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 0.4;
        ctx.beginPath(); ctx.moveTo(cueBall.x + ux * R, cueBall.y + uy * R);
        const end = g.ghost || g.end;
        ctx.lineTo(end.x, end.y); ctx.stroke();
        if (g.ghost) {
          ctx.beginPath(); ctx.arc(g.ghost.x, g.ghost.y, R, 0, Math.PI * 2); ctx.stroke();
          const ob = bs.find((b) => b.n === g.ball);
          ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(ob.x, ob.y); ctx.lineTo(ob.x + g.objDir.x * 26 * g.dot, ob.y + g.objDir.y * 26 * g.dot); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,.4)';
          ctx.beginPath(); ctx.moveTo(g.ghost.x, g.ghost.y); ctx.lineTo(g.ghost.x + g.cueDir.x * 14, g.ghost.y + g.cueDir.y * 14); ctx.stroke();
        }
        // cue stick behind the ball, pulled back with power
        const pull = 2 + (view.power || 0) * 16;
        const sx = cueBall.x - ux * (R + pull), sy = cueBall.y - uy * (R + pull);
        const ex = sx - ux * 80, ey = sy - uy * 80;
        const grad = ctx.createLinearGradient(sx, sy, ex, ey);
        grad.addColorStop(0, '#f1e3c6'); grad.addColorStop(0.04, '#f1e3c6'); grad.addColorStop(0.05, '#2d6cdf');
        grad.addColorStop(0.07, '#d9b37a'); grad.addColorStop(0.7, '#a0652e'); grad.addColorStop(1, '#3b200c');
        ctx.strokeStyle = grad; ctx.lineCap = 'round';
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.lineCap = 'butt';
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
