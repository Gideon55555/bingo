import { canvasDpr } from './prefs.js';
// Canvas renderer for the crash game. Runs its own requestAnimationFrame loop and reads live
// data from a plain object (`engine`), so React never re-renders 60 times a second.
import { GROWTH, fmtX } from '../../shared/crash.js';
import { fmt } from '../../shared/money.js';

const PAD = { l: 40, r: 16, t: 18, b: 24 };
const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
const ease = (dt, speed) => 1 - Math.exp(-dt * speed);

/** Our own jet (not an emoji, so it looks the same on every phone). Drawn facing right, ~64px long. */
function drawPlane(ctx, flicker) {
  // engine glow
  const g = ctx.createRadialGradient(-30, 1, 0, -30, 1, 16 + flicker * 4);
  g.addColorStop(0, 'rgba(255,200,90,.95)');
  g.addColorStop(0.4, 'rgba(255,120,30,.55)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(-30, 1, 18 + flicker * 4, 0, Math.PI * 2); ctx.fill();

  // far wing (behind body)
  ctx.fillStyle = '#9aa8ff';
  ctx.beginPath(); ctx.moveTo(2, -2); ctx.lineTo(-10, -15); ctx.lineTo(-3, -15); ctx.lineTo(11, -2); ctx.closePath(); ctx.fill();

  // tail fin
  ctx.fillStyle = '#5b6cff';
  ctx.beginPath(); ctx.moveTo(-18, -3); ctx.lineTo(-29, -17); ctx.lineTo(-22, -17); ctx.lineTo(-10, -3); ctx.closePath(); ctx.fill();

  // body
  const body = ctx.createLinearGradient(0, -7, 0, 7);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(1, '#c9d3ff');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(32, 1);
  ctx.quadraticCurveTo(28, -6, 16, -6.5);
  ctx.lineTo(-24, -5);
  ctx.quadraticCurveTo(-31, -4, -31, 1);
  ctx.quadraticCurveTo(-31, 6, -24, 6.5);
  ctx.lineTo(16, 6.5);
  ctx.quadraticCurveTo(28, 6, 32, 1);
  ctx.fill();

  // stripe + windows
  ctx.fillStyle = '#ff8a1f';
  ctx.fillRect(-22, 1.5, 38, 2);
  ctx.fillStyle = '#2b3570';
  ctx.beginPath(); ctx.ellipse(22, -1.5, 5, 2.6, -0.15, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(10 - i * 6, -1.5, 1.2, 0, Math.PI * 2); ctx.fill(); }

  // near wing (in front of body)
  ctx.fillStyle = '#7383ff';
  ctx.beginPath(); ctx.moveTo(4, 3); ctx.lineTo(-10, 19); ctx.lineTo(-1, 19); ctx.lineTo(14, 3); ctx.closePath(); ctx.fill();
  // tail wing
  ctx.beginPath(); ctx.moveTo(-20, 3); ctx.lineTo(-28, 10); ctx.lineTo(-23, 10); ctx.lineTo(-14, 3); ctx.closePath(); ctx.fill();
}

export function startFlight(canvas, engine, els) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  const resize = () => {
    dpr = canvasDpr();
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const stars = Array.from({ length: 55 }, () => ({ x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.75 }));
  const view = { t: 6000, m: 2 };
  const texts = {};
  // Write text to the DOM only when it changed (or the element was replaced by React)
  const setText = (key, el, value) => {
    const prev = texts[key];
    if (el && (!prev || prev.el !== el || prev.v !== value)) { el.textContent = value; texts[key] = { el, v: value }; }
  };
  let last = performance.now();
  let raf;

  const X = (t) => PAD.l + (t / view.t) * (w - PAD.l - PAD.r);
  const Y = (m) => h - PAD.b - ((m - 1) / (view.m - 1)) * (h - PAD.b - PAD.t);

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const e = engine;
    const phase = e.phase;

    // ---- flight time & multiplier ----
    let te = 0; // flight time to draw (ms)
    if (phase === 'flying' && e.flightStart != null) te = Math.max(0, now - e.flightStart);
    if (phase === 'crashed') te = e.crashMs;
    const mCont = Math.exp(GROWTH * te);
    const m100 = phase === 'crashed' ? e.point : Math.max(100, Math.floor(100 * mCont));

    // ---- camera: keep the plane around 70% across / 68% up, easing so it never jumps ----
    if (phase === 'flying') {
      const k = ease(dt, 5);
      view.t += (Math.max(6000, te / 0.75) - view.t) * k;
      view.m += (Math.max(2, 1 + (mCont - 1) / 0.5) - view.m) * k;
    } else if (phase === 'betting' || phase === 'paused') {
      const k = ease(dt, 3);
      view.t += (6000 - view.t) * k;
      view.m += (2 - view.m) * k;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // screen shake right after a crash
    const sinceCrash = phase === 'crashed' ? (now - e.crashedAt) / 1000 : 99;
    if (sinceCrash < 0.35) {
      const s = 5 * Math.exp(-sinceCrash * 10);
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    // ---- parallax stars (speed up with the multiplier) ----
    const speed = phase === 'flying' ? 50 + 160 * Math.min(1, (mCont - 1) / 3) : phase === 'crashed' ? 20 : 8;
    ctx.fillStyle = '#fff';
    for (const st of stars) {
      st.x -= (speed * st.z * dt) / Math.max(1, w);
      if (st.x < 0) { st.x += 1; st.y = Math.random(); }
      ctx.globalAlpha = 0.15 + st.z * 0.45;
      ctx.fillRect(st.x * w, st.y * (h - PAD.b), st.z * 1.8, st.z * 1.8);
    }
    ctx.globalAlpha = 1;

    // ---- horizontal grid with multiplier labels ----
    const step = NICE.find((s) => (view.m - 1) / s <= 4) || 1000;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 1; v <= view.m + 1e-9; v += step) {
      const y = Y(v);
      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillText(`${+v.toFixed(2)}x`, PAD.l - 6, y);
    }

    // ---- curve ----
    const crashedFade = phase === 'crashed' ? Math.max(0, 1 - sinceCrash / 1.4) : 1;
    let tipX = X(0), tipY = Y(1), angle = -0.12;
    if ((phase === 'flying' || phase === 'crashed') && te > 0) {
      const N = 90;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const t = (te * i) / N;
        pts.push([X(t), Y(Math.exp(GROWTH * t))]);
      }
      ctx.globalAlpha = crashedFade;
      const fill = ctx.createLinearGradient(0, PAD.t, 0, h - PAD.b);
      fill.addColorStop(0, phase === 'crashed' ? 'rgba(255,77,94,.35)' : 'rgba(255,138,31,.32)');
      fill.addColorStop(1, 'rgba(255,138,31,0)');
      ctx.beginPath();
      ctx.moveTo(pts[0][0], h - PAD.b);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[N][0], h - PAD.b);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = phase === 'crashed' ? '#ff4d5e' : '#ff8a1f';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = phase === 'crashed' ? 'rgba(255,77,94,.7)' : 'rgba(255,138,31,.7)';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      [tipX, tipY] = pts[N];
      const [px, py] = pts[N - 3];
      angle = Math.max(-0.95, Math.min(0, Math.atan2(tipY - py, tipX - px)));
    }

    // ---- the plane ----
    const flicker = Math.random();
    const bob = Math.sin(now / 260) * (phase === 'flying' ? 2.2 : 1.4);
    let planeX = tipX, planeY = tipY + bob, planeA = angle;
    let show = phase !== 'paused';
    if (phase === 'betting' || phase === 'paused') { planeX = PAD.l + 48; planeY = h - PAD.b - 22 + bob; planeA = -0.08; }
    if (phase === 'crashed') {
      // fly away: pull up and climb out of the top of the screen (visible for ~0.7s)
      const t = sinceCrash;
      planeX = tipX + 50 * t + 120 * t * t;
      planeY = tipY - (80 * t + 230 * t * t);
      planeA = Math.max(-1.05, angle - t * 1.4);
      show = planeX < w + 80 && planeY > -80;
    }
    if (show) {
      ctx.save();
      ctx.translate(planeX, planeY);
      ctx.rotate(planeA);
      const sc = Math.max(0.75, Math.min(1, w / 420));
      ctx.scale(sc, sc);
      drawPlane(ctx, flicker);
      ctx.restore();
    }

    // red flash on crash
    if (phase === 'crashed' && sinceCrash < 0.6) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(255,60,80,${0.28 * Math.exp(-sinceCrash * 5)})`;
      ctx.fillRect(0, 0, w, h);
    }

    // ---- text overlays (only touch the DOM when the text actually changes) ----
    if (phase === 'flying' || phase === 'crashed') setText('mult', els.mult, fmtX(m100));
    if (phase === 'betting' && e.bettingEnd) {
      const left = Math.max(0, (e.bettingEnd - now) / 1000);
      setText('count', els.count, `${left.toFixed(1)}s`);
      if (els.bar) els.bar.style.transform = `scaleX(${Math.min(1, left / (e.betSec || 7))})`;
    }
    if (els.cash && e.myAmount && phase === 'flying') setText('cash', els.cash, `${fmt(Math.floor((e.myAmount * m100) / 100))} ${e.currency}`);

    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}
