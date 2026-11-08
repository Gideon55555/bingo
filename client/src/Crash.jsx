import React, { useEffect, useRef, useState } from 'react';
import { socket, emit, haptic, toast } from './api.js';
import { fmt, toCents } from '../../shared/money.js';
import { fmtX, msFor } from '../../shared/crash.js';
import { startFlight } from './flight.js';
import { sfx } from './sound.js';
import { t, useLang } from './i18n.js';

const loadPref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const colorFor = (p) => (p < 200 ? 'x-low' : p < 1000 ? 'x-mid' : 'x-high');

export default function Crash({ cfg, balance }) {
  useLang();
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
    if (phase === 'crashed') { haptic(me && !me.cashedAt ? 'error' : 'light'); sfx('crash'); }
    if (phase === 'flying' && me) haptic('medium');
    if (phase === 'betting' && queued) { setQueued(false); placeBet(); }
  }, [phase, st?.round]);

  useEffect(() => {
    if (!me?.cashedAt) return;
    setFlash(`+${fmt(me.win)} ${cfg.currency} at ${fmtX(me.cashedAt)}`);
    haptic('success'); sfx('cash');
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

  if (!st) return <div className="center muted">{t('loading')}</div>;

  // ---------- main button ----------
  let btn;
  const live = me && !me.cashedAt && phase === 'flying';
  if (phase === 'paused') btn = <button key="paused" className="rk-btn" disabled>{t('pausedMaint')}</button>;
  else if (phase === 'betting' && me) btn = <button key="cancel" className="rk-btn cancel" disabled={busy} onClick={cancel}>{t('cancel')}<small>{t('waitingTakeoff')}</small></button>;
  else if (phase === 'betting') btn = <button key="bet" className="rk-btn bet" disabled={busy || !(amountCents > 0)} onClick={placeBet}>{t('bet')}<small>{fmt(amountCents)} {cfg.currency}</small></button>;
  else if (live) btn = <button key="cash" className="rk-btn cash" disabled={busy} onPointerDown={cashout}>{t('cashOut')}<small ref={cashRef}>{fmt(me.amount)} {cfg.currency}</small></button>;
  else if (queued) btn = <button key="unqueue" className="rk-btn cancel" onClick={() => setQueued(false)}>{t('cancel')}<small>{t('betNextRound')}</small></button>;
  else btn = <button key="queue" className="rk-btn bet" disabled={!(amountCents > 0)} onClick={() => { setQueued(true); haptic('light'); }}>{t('bet')}<small>{t('nextRound')} · {fmt(amountCents)} {cfg.currency}</small></button>;

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
              <div className="rk-wait">{t('placeBets')}</div>
              <div className="rk-count" ref={countRef}>{(st.bettingLeftMs / 1000).toFixed(1)}s</div>
              <div className="rk-bar"><span ref={barRef} /></div>
            </>
          )}
          {(phase === 'flying' || phase === 'crashed') && (
            <div key={phase} className={`rk-mult ${phase === 'crashed' ? 'crashed' : ''}`} ref={multRef}>
              {phase === 'crashed' ? fmtX(st.point) : '1.00x'}
            </div>
          )}
          {phase === 'crashed' && <div className="rk-wait rk-away">{t('flewAway')}</div>}
          {phase === 'paused' && <div className="rk-wait">{t('pausedMaint')}</div>}
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
          {t('autoCashAt')}
          <input inputMode="decimal" value={auto} disabled={!autoOn} onChange={(e) => setAuto(e.target.value.replace(/[^\d.]/g, ''))} />x
        </label>
        {btn}
        {me && (
          <div className="muted small center-text" style={{ marginTop: 6 }}>
            {t('yourBet', { amount: `${fmt(me.amount)} ${cfg.currency}` })}{me.auto ? ` · ${t('autoX', { x: fmtX(me.auto) })}` : ''}
            {me.cashedAt ? ` · ${t('wonAt', { amount: fmt(me.win), x: fmtX(me.cashedAt) })}` : phase === 'crashed' ? ` · ${t('lost')}` : ''}
          </div>
        )}
        {!me && balance < amountCents && <div className="warn small center-text">{t('balanceLow')}</div>}
      </div>

      <div className="rk-bets">
        <div className="row-between"><h3>{t('betsThisRound')}</h3><span className="muted small">{st.bets.length} {t('players')}</span></div>
        {st.bets.length === 0 && <div className="muted small">{t('noBets')}</div>}
        {st.bets.map((b, i) => (
          <div key={i} className={`rk-bet ${b.cashedAt ? 'won' : phase === 'crashed' ? 'lost' : ''}`}>
            <span>{b.name}</span>
            <span>{fmt(b.amount)}</span>
            <span>{b.cashedAt ? fmtX(b.cashedAt) : '—'}</span>
            <span>{b.cashedAt ? `+${fmt(b.win)}` : ''}</span>
          </div>
        ))}
      </div>

      <button className="ghost sm" onClick={() => setShowInfo((v) => !v)}>{showInfo ? t('hide') : t('howFair')}</button>
      {showInfo && <Info cfg={cfg} st={st} />}
    </div>
  );
}

function Info({ cfg, st }) {
  useLang();
  return (
    <div className="rk-info">
      <p className="small">{t('provablyFair')}</p>
      <div className="mono small break">{t('roundHash')}: {st.hash || '—'}</div>
      {st.seed && <div className="mono small break">{t('lastSeed')}: {st.seed}</div>}
    </div>
  );
}
