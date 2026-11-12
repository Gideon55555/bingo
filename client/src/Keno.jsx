import React, { useEffect, useMemo, useRef, useState } from 'react';
import { socket, emit, haptic, toast } from './api.js';
import { fmt, toCents } from '../../shared/money.js';
import { PAYTABLE, KENO_MAX_PICKS, countHits } from '../../shared/keno.js';
import { sfx } from './sound.js';
import { t, useLang } from './i18n.js';

const loadPref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const NUMS = Array.from({ length: 80 }, (_, i) => i + 1);

function quickPick(count) {
  const s = new Set();
  while (s.size < count) s.add(1 + Math.floor(Math.random() * 80));
  return [...s].sort((a, b) => a - b);
}

/** Countdown text that ticks on its own, so the board doesn't re-render every 100ms */
function Countdown({ endsAt }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 200); return () => clearInterval(t); }, []);
  return <>{t('seconds', { n: Math.max(0, Math.ceil((endsAt - performance.now()) / 1000)) })}</>;
}

export default function Keno({ cfg, balance }) {
  useLang();
  const [st, setSt] = useState(null);
  const [me, setMe] = useState(null);
  const [picks, setPicks] = useState(() => { try { return JSON.parse(loadPref('kn_picks', '[]')); } catch { return []; } });
  const [amount, setAmount] = useState(() => loadPref('kn_amount', '10'));
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const endsAt = useRef(0);

  const picksRef = useRef(new Set());
  useEffect(() => {
    const apply = (s) => {
      if (s.phase === 'betting') endsAt.current = performance.now() + s.bettingLeftMs;
      setSt(s);
    };
    const onBall = ({ n, i }) => {
      sfx('tap');
      // the number shows a moment after the ball drops in — that's when a hit is felt
      setTimeout(() => { if (picksRef.current.has(n)) { haptic('success'); sfx('pick'); } else haptic('light'); }, 520);
      setSt((p) => (p && p.revealed.length === i ? { ...p, revealed: [...p.revealed, n] } : p));
    };
    const onPlayers = ({ players }) => setSt((p) => (p ? { ...p, players } : p));
    const enter = () => emit('keno:enter').then((r) => { apply(r.state); setMe(r.me); }).catch((e) => toast(e.message));
    enter();
    socket.on('connect', enter);
    socket.on('keno:state', apply);
    socket.on('keno:ball', onBall);
    socket.on('keno:players', onPlayers);
    socket.on('keno:me', setMe);
    return () => {
      socket.off('connect', enter);
      socket.off('keno:state', apply);
      socket.off('keno:ball', onBall);
      socket.off('keno:players', onPlayers);
      socket.off('keno:me', setMe);
      emit('keno:exit').catch(() => {});
    };
  }, []);

  const phase = st?.phase;
  const revealed = st?.revealed || [];
  const drawnSet = useMemo(() => new Set(revealed), [revealed]);
  const shownPicks = me ? me.picks : picks;
  const pickSet = useMemo(() => new Set(shownPicks), [shownPicks]);
  picksRef.current = pickSet;
  const hitsSoFar = countHits(shownPicks, revealed);
  const amountCents = toCents(amount);
  const locked = !!me && phase !== 'results';

  // Results feedback + auto-buy queued ticket when betting opens
  useEffect(() => {
    if (phase === 'results' && me?.win != null) { haptic(me.win > 0 ? 'success' : 'error'); if (me.win > 0) sfx('win'); }
    if (phase === 'betting' && queued) { setQueued(false); buy(); }
  }, [phase, st?.round]);

  const toggle = (n) => {
    if (locked) return;
    haptic('light');
    setPicks((p) => {
      const next = p.includes(n) ? p.filter((x) => x !== n) : p.length >= KENO_MAX_PICKS ? p : [...p, n].sort((a, b) => a - b);
      if (!p.includes(n) && p.length >= KENO_MAX_PICKS) toast(t('maxPicks', { n: KENO_MAX_PICKS }));
      savePref('kn_picks', JSON.stringify(next));
      return next;
    });
  };
  const doQuick = () => { const q = quickPick(picks.length || 5); setPicks(q); savePref('kn_picks', JSON.stringify(q)); haptic('medium'); };
  const clear = () => { setPicks([]); savePref('kn_picks', '[]'); };
  const setAmt = (c) => setAmount(String(Math.min(cfg.keno.maxBet, Math.max(cfg.keno.minBet, Math.round(c))) / 100));

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { haptic('error'); toast(e.message); } finally { setBusy(false); }
  };
  function buy() {
    savePref('kn_amount', amount);
    return run(async () => { const r = await emit('keno:buy', { picks, amount: amountCents }); setMe(r.me); haptic('medium'); });
  }
  const cancel = () => run(async () => { await emit('keno:cancel'); setMe(null); });

  if (!st) return <div className="center muted">{t('loading')}</div>;

  const n = shownPicks.length;
  const table = PAYTABLE[n] || {};
  const last = revealed[revealed.length - 1];

  // ---- status line ----
  let status;
  if (phase === 'betting') status = <>{t('nextDrawIn')} <b><Countdown endsAt={endsAt.current} /></b> · {t('tickets', { n: st.players })}</>;
  else if (phase === 'drawing') status = <><b>{revealed.length >= 17 && revealed.length < 20 ? t('kenoLast') : t('drawingN', { n: revealed.length })}</b>{n ? <> · <b className="kn-hitcount">{t('youHitSoFar', { n: hitsSoFar })}</b></> : null}</>;
  else if (phase === 'results') status = me ? (me.win > 0 ? <b>{t('hitWon', { h: me.hits, p: me.picks.length, amount: `${fmt(me.win)} ${cfg.currency}` })}</b> : <>{t('hitNoWin', { h: me.hits, p: me.picks.length })}</>) : <>{t('drawDone')}</>;
  else status = <>{t('pausedMaint')}</>;

  // ---- main button ----
  let btn;
  if (phase === 'paused') btn = <button key="p" className="rk-btn" disabled>{t('pausedShort')}</button>;
  else if (phase === 'betting' && me) btn = <button key="c" className="rk-btn cancel" disabled={busy} onClick={cancel}>{t('cancelTicket')}<small>{t('nNumbers', { n: me.picks.length, amount: `${fmt(me.amount)} ${cfg.currency}` })}</small></button>;
  else if (phase === 'betting') btn = <button key="b" className="rk-btn bet" disabled={busy || !n || !(amountCents > 0)} onClick={buy}>{n ? t('buyTicket') : t('pickNumbers')}<small>{n ? t('nNumbers', { n, amount: `${fmt(amountCents)} ${cfg.currency}` }) : t('pickRange', { max: KENO_MAX_PICKS })}</small></button>;
  else if (queued) btn = <button key="q" className="rk-btn cancel" onClick={() => setQueued(false)}>{t('cancel')}<small>{t('cancelNextTicket')}</small></button>;
  else if (locked) btn = <button key="l" className="rk-btn" disabled>{t('ticketInPlay')}<small>{t('nNumbers', { n: me.picks.length, amount: `${fmt(me.amount)} ${cfg.currency}` })}</small></button>;
  else btn = <button key="n" className="rk-btn bet" disabled={!n || !(amountCents > 0)} onClick={() => { setQueued(true); haptic('light'); }}>{t('buy')}<small>{t('forNextDraw', { n: n || 0, amount: `${fmt(amountCents)} ${cfg.currency}` })}</small></button>;

  return (
    <div className="keno">
      <div className={`kn-status ${phase}`}>{status}</div>

      <div className={`kn-tray kn2 ${phase === 'drawing' ? 'live' : ''} ${phase === 'drawing' && revealed.length >= 17 && revealed.length < 20 ? 'tense' : ''}`}>
        <div className="kn-stage">
          <div className={`kn-bigball ${last ? '' : 'idle'} ${last && pickSet.has(last) ? 'hit' : ''}`} key={last || 'none'}><span>{last || '?'}</span></div>
        </div>
        <div className="kn-drawn">
          {Array.from({ length: 20 }, (_, i) => {
            const b = revealed[i];
            return <span key={i} className={`kn-ball ${b ? 'on' : ''} ${b && pickSet.has(b) ? 'hit' : ''}`}>{b || ''}</span>;
          })}
        </div>
      </div>

      <div className={`kn-board kn2 ${locked ? 'locked' : ''}`}>
        {NUMS.map((x) => {
          const picked = pickSet.has(x);
          const drawn = drawnSet.has(x);
          const cls = picked && drawn ? 'hit' : picked ? (phase === 'results' && me ? 'miss' : 'picked') : drawn ? 'drawn' : '';
          return <button key={x} className={`kn-cell ${cls}`} onClick={() => toggle(x)}>{x}</button>;
        })}
      </div>

      <div className="rk-panel">
        <div className="row-between">
          <span className="small">{t('numbersPicked', { n, max: KENO_MAX_PICKS })}</span>
          <span className="kn-tools">
            <button onClick={doQuick} disabled={locked}>{t('quickPick')}</button>
            <button onClick={clear} disabled={locked || !picks.length}>{t('clear')}</button>
          </span>
        </div>
        <div className="rk-amount">
          <button onClick={() => setAmt(amountCents / 2)} disabled={locked}>½</button>
          <input inputMode="decimal" value={amount} disabled={locked} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          <button onClick={() => setAmt(amountCents * 2)} disabled={locked}>2×</button>
        </div>
        <div className="rk-presets">
          {[5, 10, 50, 100].map((v) => <button key={v} disabled={locked} onClick={() => setAmt(v * 100)}>{v}</button>)}
        </div>
        {btn}
        {!me && balance < amountCents && <div className="warn small center-text">{t('balanceLow')}</div>}
      </div>

      {n > 0 && (
        <div className="kn-pay">
          <h3>{t('payoutsFor', { n })}</h3>
          <div className="kn-paygrid">
            {Object.entries(table).sort((a, b) => Number(b[0]) - Number(a[0])).map(([hits, mult]) => {
              const active = (phase === 'drawing' || phase === 'results') && Number(hits) === hitsSoFar;
              const stake = me ? me.amount : amountCents;
              return (
                <div key={hits} className={`kn-payrow ${active ? 'active' : ''}`}>
                  <span>{t('hits', { n: hits })}</span>
                  <span className="mono">{mult}×</span>
                  <span>{fmt(Math.min(Math.floor(stake * mult), cfg.keno.maxWin))} {cfg.currency}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'results' && st.result?.winners?.length > 0 && (
        <div className="rk-bets">
          <h3>{t('winnersDraw')}</h3>
          {st.result.winners.map((w, i) => (
            <div key={i} className="rk-bet won"><span>{w.name}</span><span>{w.hits}/{w.picks}</span><span /><span>+{fmt(w.win)}</span></div>
          ))}
        </div>
      )}

      <button className="ghost sm" onClick={() => setShowInfo((v) => !v)}>{showInfo ? t('hide') : t('howFair')}</button>
      {showInfo && (
        <div className="rk-info">
          <p className="small">{t('kenoFair')}</p>
          <div className="mono small break">{t('roundHash')}: {st.hash || '—'}</div>
          {st.seed && <div className="mono small break">{t('lastSeed')}: {st.seed}</div>}
        </div>
      )}
    </div>
  );
}
