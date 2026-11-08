import React, { useEffect, useRef, useState } from 'react';
import { socket, emit, haptic, toast } from './api.js';
import { fmt, toCents } from '../../shared/money.js';
import { fmtX, msFor } from '../../shared/crash.js';
import { startFlight } from './flight.js';

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

  // Live animation data, read by the canvas loop (no React re-render per frame)
  const engine = useRef({ phase: 'idle', flightStart: null, point: 100, crashMs: 0, crashedAt: 0, bettingEnd: 0,
    betSec: cfg.crash.betSec || 7, myAmount: 0, currency: cfg.currency }).current;
  const canvasRef = useRef(null);
  const multRef = useRef(null);
  const countRef = useRef(null);
  const barRef = useRef(null);
  const cashRef = useRef(null);

  // ---------- server sync ----------
  useEffect(() => {
    const apply = (s) => {
      const now = performance.now();
      if (s.phase === 'flying') engine.flightStart = now - s.elapsedMs;
      if (s.phase === 'betting') engine.bettingEnd = now + s.bettingLeftMs;
      if (s.phase === 'crashed') {
        engine.point = s.point;
        engine.crashMs = msFor(s.point);
        engine.crashedAt = now;
      }
      engine.phase = s.phase;
      setSt(s);
    };
    // Gentle clock correction once a second: small drift is eased out, big gaps snap
    const onTime = ({ e }) => {
      if (engine.phase !== 'flying') return;
      const target = performance.now() - e;
      const diff = target - engine.flightStart;
      engine.flightStart += Math.abs(diff) > 400 ? diff : diff * 0.25;
    };
    const onBets = ({ bets }) => setSt((p) => (p ? { ...p, bets } : p));
    const enter = () => emit('crash:enter').then((r) => { apply(r.state); setMe(r.me); }).catch((e) => toast(e.message));
    enter();
    socket.on('connect', enter);
    socket.on('crash:state', apply);
    socket.on('crash:t', onTime);
    socket.on('crash:bets', onBets);
    socket.on('crash:me', setMe);
    return () => {
      socket.off('connect', enter);
      socket.off('crash:state', apply);
      socket.off('crash:t', onTime);
      socket.off('crash:bets', onBets);
      socket.off('crash:me', setMe);
      emit('crash:exit').catch(() => {});
    };
  }, []);

  // ---------- canvas loop ----------
  const hasStage = !!st;
  useEffect(() => {
    if (!canvasRef.current) return;
    return startFlight(canvasRef.current, engine, {
      get mult() { return multRef.current; },
      get count() { return countRef.current; },
      get bar() { return barRef.current; },
      get cash() { return cashRef.current; },
    });
  }, [hasStage]);

  const phase = st?.phase;
  engine.myAmount = me && !me.cashedAt ? me.amount : 0;

  // ---------- reactions to phase changes ----------
  useEffect(() => {
    if (phase === 'crashed') haptic(me && !me.cashedAt ? 'error' : 'light');
    if (phase === 'flying' && me) haptic('medium');
    if (phase === 'betting' && queued) { setQueued(false); placeBet(); }
  }, [phase, st?.round]);

  useEffect(() => {
    if (!me?.cashedAt) return;
    setFlash(`+${fmt(me.win)} ${cfg.currency} at ${fmtX(me.cashedAt)}`);
    haptic('success');
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
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

  if (!st) return <div className="center muted">Loading {cfg.crash.name}…</div>;

  // ---------- main button ----------
  let btn;
  const live = me && !me.cashedAt && phase === 'flying';
  if (phase === 'paused') btn = <button key="paused" className="rk-btn" disabled>Paused for maintenance</button>;
  else if (phase === 'betting' && me) btn = <button key="cancel" className="rk-btn cancel" disabled={busy} onClick={cancel}>Cancel<small>waiting for take-off</small></button>;
  else if (phase === 'betting') btn = <button key="bet" className="rk-btn bet" disabled={busy || !(amountCents > 0)} onClick={placeBet}>BET<small>{fmt(amountCents)} {cfg.currency}</small></button>;
  else if (live) btn = <button key="cash" className="rk-btn cash" disabled={busy} onPointerDown={cashout}>CASH OUT<small ref={cashRef}>{fmt(me.amount)} {cfg.currency}</small></button>;
  else if (queued) btn = <button key="unqueue" className="rk-btn cancel" onClick={() => setQueued(false)}>Cancel<small>bet for next round</small></button>;
  else btn = <button key="queue" className="rk-btn bet" disabled={!(amountCents > 0)} onClick={() => { setQueued(true); haptic('light'); }}>BET<small>next round · {fmt(amountCents)} {cfg.currency}</small></button>;

  return (
    <div className="rocket">
      <div className="rk-history">
        {st.history.map((h) => <span key={h.id} className={`x-chip ${colorFor(h.point)}`}>{fmtX(h.point)}</span>)}
      </div>

      <div className={`rk-stage ${phase}`}>
        <canvas ref={canvasRef} className="rk-canvas" />
        <div className="rk-center">
          {phase === 'betting' && (
            <>
              <div className="rk-wait">Place your bets</div>
              <div className="rk-count" ref={countRef}>{(st.bettingLeftMs / 1000).toFixed(1)}s</div>
              <div className="rk-bar"><span ref={barRef} /></div>
            </>
          )}
          {(phase === 'flying' || phase === 'crashed') && (
            <div key={phase} className={`rk-mult ${phase === 'crashed' ? 'crashed' : ''}`} ref={multRef}>
              {phase === 'crashed' ? fmtX(st.point) : '1.00x'}
            </div>
          )}
          {phase === 'crashed' && <div className="rk-wait rk-away">Flew away!</div>}
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
          {[10, 50, 100, 500].map((v) => <button key={v} onClick={() => setAmt(v * 100)}>{v}</button>)}
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
        <li>If the plane flies away before you cash out, you lose the bet.</li>
        <li>Turn on <b>Auto cash out</b> to cash out automatically at the multiplier you choose.</li>
      </ol>
      <p className="small muted">
        Bets: {fmt(cfg.crash.minBet)}–{fmt(cfg.crash.maxBet)} {cfg.currency}. Maximum win per bet: {fmt(cfg.crash.maxWin)} {cfg.currency}.
        Average return to players: {100 - edge}%. If a round is interrupted by a technical problem, bets that weren't cashed out are refunded.
      </p>
      <h3>Provably fair</h3>
      <p className="small">
        Before each round, we publish a fingerprint (hash) of a secret seed. After the round, we reveal the seed.
        Check that SHA-256(seed) equals the hash, so the result was fixed before anyone bet. The crash point comes from
        HMAC-SHA256(key = seed, message = "rocket").
      </p>
      <div className="mono small break">Current round hash: {st.hash || '—'}</div>
      {st.seed && <div className="mono small break">Last seed: {st.seed}</div>}
    </div>
  );
}
