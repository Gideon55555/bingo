import React, { useEffect, useMemo, useRef, useState } from 'react';
import { socket, emit, haptic, toast } from './api.js';
import { fmt, toCents } from '../../shared/money.js';
import { multiplierAt, fmtX } from '../../shared/crash.js';

const loadPref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const colorFor = (p) => (p < 200 ? 'x-low' : p < 1000 ? 'x-mid' : 'x-high');

export default function Crash({ cfg, balance }) {
  const [st, setSt] = useState(null);
  const [me, setMe] = useState(null);
  const [amount, setAmount] = useState(() => loadPref('rk_amount', String(Math.max(10, cfg.crash.minBet / 100))));
  const [autoOn, setAutoOn] = useState(() => loadPref('rk_auto_on', '0') === '1');
  const [auto, setAuto] = useState(() => loadPref('rk_auto', '2.00'));
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [flash, setFlash] = useState(null);
  const flightRef = useRef(null); // performance.now() at take-off
  const bettingEndRef = useRef(null);
  const [now, setNow] = useState(0);

  // ---------- server sync ----------
  useEffect(() => {
    const apply = (s) => {
      setSt(s);
      if (s.phase === 'flying') flightRef.current = performance.now() - s.elapsedMs;
      if (s.phase === 'betting') bettingEndRef.current = performance.now() + s.bettingLeftMs;
    };
    const enter = () => emit('crash:enter').then((r) => { apply(r.state); setMe(r.me); }).catch((e) => toast(e.message));
    enter();
    socket.on('connect', enter);
    socket.on('crash:state', apply);
    socket.on('crash:bets', ({ bets }) => setSt((p) => (p ? { ...p, bets } : p)));
    socket.on('crash:me', setMe);
    return () => {
      socket.off('connect', enter);
      socket.off('crash:state', apply);
      socket.off('crash:bets');
      socket.off('crash:me', setMe);
      emit('crash:exit').catch(() => {});
    };
  }, []);

  // ---------- animation clock ----------
  useEffect(() => {
    let raf;
    const loop = () => { setNow(performance.now()); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phase = st?.phase;
  const elapsed = phase === 'flying' && flightRef.current ? now - flightRef.current : 0;
  const m = phase === 'flying' ? multiplierAt(elapsed) : phase === 'crashed' ? st.point : 100;
  const bettingLeft = phase === 'betting' ? Math.max(0, (bettingEndRef.current - now) / 1000) : 0;

  // ---------- reactions to phase changes ----------
  useEffect(() => {
    if (phase === 'crashed') {
      haptic(me && !me.cashedAt ? 'error' : 'light');
    }
    if (phase === 'betting' && queued) {
      setQueued(false);
      placeBet();
    }
  }, [phase, st?.round]);

  useEffect(() => {
    if (me?.cashedAt) {
      setFlash(`+${fmt(me.win)} ${cfg.currency} at ${fmtX(me.cashedAt)}`);
      haptic('success');
      const t = setTimeout(() => setFlash(null), 3500);
      return () => clearTimeout(t);
    }
  }, [me?.cashedAt]);

  // ---------- actions ----------
  const amountCents = toCents(amount);
  const autoX100 = autoOn ? Math.round(Number(auto) * 100) : null;
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { haptic('error'); toast(e.message); } finally { setBusy(false); }
  };
  function placeBet() {
    savePref('rk_amount', amount); savePref('rk_auto', auto); savePref('rk_auto_on', autoOn ? '1' : '0');
    return run(async () => {
      const r = await emit('crash:bet', { amount: amountCents, auto: autoX100 });
      setMe(r.me);
      haptic('medium');
    });
  }
  const cancel = () => run(async () => { await emit('crash:cancel'); setMe(null); });
  const cashout = () => run(async () => { const r = await emit('crash:cashout'); setMe(r.me); });

  const setAmt = (cents) => {
    const c = Math.min(cfg.crash.maxBet, Math.max(cfg.crash.minBet, Math.round(cents)));
    setAmount(String(c / 100));
  };

  if (!st) return <div className="center muted">Loading Rocket…</div>;

  // ---------- main button ----------
  let btn;
  const live = me && !me.cashedAt && phase === 'flying';
  if (phase === 'paused') btn = <button className="rk-btn" disabled>Paused for maintenance</button>;
  else if (phase === 'betting' && me) btn = <button className="rk-btn cancel" disabled={busy} onClick={cancel}>Cancel<small>waiting for take-off</small></button>;
  else if (phase === 'betting') btn = <button className="rk-btn bet" disabled={busy || !(amountCents > 0)} onClick={placeBet}>BET<small>{fmt(amountCents)} {cfg.currency}</small></button>;
  else if (live) btn = <button className="rk-btn cash" disabled={busy} onClick={cashout}>CASH OUT<small>{fmt(Math.floor((me.amount * m) / 100))} {cfg.currency}</small></button>;
  else if (queued) btn = <button className="rk-btn cancel" onClick={() => setQueued(false)}>Cancel<small>bet for next round</small></button>;
  else btn = <button className="rk-btn bet" disabled={!(amountCents > 0)} onClick={() => { setQueued(true); haptic('light'); }}>BET<small>next round · {fmt(amountCents)} {cfg.currency}</small></button>;

  return (
    <div className="rocket">
      <div className="rk-history">
        {st.history.map((h) => <span key={h.id} className={`x-chip ${colorFor(h.point)}`}>{fmtX(h.point)}</span>)}
      </div>

      <div className={`rk-stage ${phase}`}>
        <FlightCanvas phase={phase} elapsed={elapsed} m={m} />
        <div className="rk-center">
          {phase === 'betting' && (
            <>
              <div className="rk-wait">Place your bets</div>
              <div className="rk-count">{bettingLeft.toFixed(1)}s</div>
              <div className="rk-bar"><span style={{ width: `${(bettingLeft / (cfg.crash.betSec || 7)) * 100}%` }} /></div>
            </>
          )}
          {phase === 'flying' && <div className="rk-mult">{fmtX(m)}</div>}
          {phase === 'crashed' && (<><div className="rk-mult crashed">{fmtX(st.point)}</div><div className="rk-wait">Flew away!</div></>)}
          {phase === 'paused' && <div className="rk-wait">⏸ Paused for maintenance</div>}
        </div>
        {flash && <div className="rk-flash">🎉 {flash}</div>}
      </div>

      <div className="rk-panel">
        <div className="rk-amount">
          <button onClick={() => setAmt(amountCents / 2)} disabled={!!me && phase !== 'crashed'}>½</button>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          <button onClick={() => setAmt(amountCents * 2)} disabled={!!me && phase !== 'crashed'}>2×</button>
        </div>
        <div className="rk-presets">
          {[10, 50, 100, 500].map((v) => (
            <button key={v} onClick={() => setAmt(v * 100)}>{v}</button>
          ))}
        </div>
        <label className="rk-auto">
          <input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} />
          Auto cash out at
          <input inputMode="decimal" value={auto} disabled={!autoOn} onChange={(e) => setAuto(e.target.value.replace(/[^\d.]/g, ''))} />x
        </label>
        {btn}
        {me && (
          <div className="muted small center-text" style={{ marginTop: 6 }}>
            Your bet: {fmt(me.amount)} {cfg.currency}{me.auto ? ` · auto ${fmtX(me.auto)}` : ''}
            {me.cashedAt ? ` · won ${fmt(me.win)} at ${fmtX(me.cashedAt)}` : phase === 'crashed' ? ' · lost' : ''}
          </div>
        )}
        {!me && balance < amountCents && <div className="warn small center-text">Balance too low — deposit in Wallet.</div>}
      </div>

      <div className="rk-bets">
        <div className="row-between"><h3>Bets this round</h3><span className="muted small">{st.bets.length} players</span></div>
        {st.bets.length === 0 && <div className="muted small">No bets yet.</div>}
        {st.bets.map((b, i) => (
          <div key={i} className={`rk-bet ${b.cashedAt ? 'won' : phase === 'crashed' ? 'lost' : ''}`}>
            <span>{b.name}</span>
            <span>{fmt(b.amount)}</span>
            <span>{b.cashedAt ? fmtX(b.cashedAt) : '—'}</span>
            <span>{b.cashedAt ? `+${fmt(b.win)}` : ''}</span>
          </div>
        ))}
      </div>

      <button className="ghost sm" onClick={() => setShowInfo((v) => !v)}>{showInfo ? 'Hide' : '📖 How to play & fairness'}</button>
      {showInfo && <Info cfg={cfg} st={st} />}
    </div>
  );
}

function Info({ cfg, st }) {
  const edge = Math.round(cfg.crash.houseEdge * 100);
  return (
    <div className="rk-info">
      <h3>How to play</h3>
      <ol>
        <li>Place a bet before take-off.</li>
        <li>The multiplier rises from 1.00x. Press <b>CASH OUT</b> any time to win your bet × the multiplier.</li>
        <li>If the rocket flies away before you cash out, you lose the bet.</li>
        <li>Turn on <b>Auto cash out</b> to cash out automatically at the multiplier you choose.</li>
      </ol>
      <p className="small muted">
        Bets: {fmt(cfg.crash.minBet)}–{fmt(cfg.crash.maxBet)} {cfg.currency}. Maximum win per bet: {fmt(cfg.crash.maxWin)} {cfg.currency}.
        Average return to players: {100 - edge}%. If a round is interrupted by a technical problem, bets that weren't cashed out are refunded.
      </p>
      <h3>Provably fair</h3>
      <p className="small">
        Before each round, we publish a fingerprint (hash) of a secret seed. After the crash, we reveal the seed.
        Check that SHA-256(seed) equals the hash, so the result was fixed before anyone bet. The crash point comes from
        HMAC-SHA256(key = seed, message = "rocket").
      </p>
      <div className="mono small break">Current round hash: {st.hash || '—'}</div>
      {st.seed && <div className="mono small break">Last seed: {st.seed}</div>}
    </div>
  );
}

/** Curve + rocket drawn on a canvas, sized to its container. */
function FlightCanvas({ phase, elapsed, m }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (phase !== 'flying' && phase !== 'crashed') return;

    const pad = 18;
    const tMax = Math.max(8000, elapsed * 1.15);
    const mMax = Math.max(2, (m / 100) * 1.2);
    const X = (t) => pad + (t / tMax) * (w - pad * 2);
    const Y = (mult) => h - pad - ((mult - 1) / (mMax - 1)) * (h - pad * 2);

    const pts = [];
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const t = (elapsed * i) / steps;
      pts.push([X(t), Y(Math.min(m / 100, Math.exp(0.00008 * t)))]);
    }
    const crashed = phase === 'crashed';
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, crashed ? 'rgba(255,77,94,.35)' : 'rgba(255,138,31,.35)');
    grad.addColorStop(1, 'rgba(255,138,31,0)');
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h - pad);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(pts[pts.length - 1][0], h - pad);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = crashed ? '#ff4d5e' : '#ff8a1f';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    const [tx, ty] = pts[pts.length - 1];
    const [px, py] = pts[Math.max(0, pts.length - 4)];
    ctx.save();
    ctx.translate(tx, ty);
    ctx.font = '30px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (crashed) {
      ctx.fillText('💥', 0, 0);
    } else {
      ctx.rotate(Math.atan2(ty - py, tx - px) + Math.PI / 4); // 🚀 emoji points up-right
      ctx.fillText('🚀', 0, 0);
    }
    ctx.restore();
  });
  return <canvas ref={ref} className="rk-canvas" />;
}
