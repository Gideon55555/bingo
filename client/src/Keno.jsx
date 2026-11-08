import React, { useEffect, useMemo, useRef, useState } from 'react';
import { socket, emit, haptic, toast } from './api.js';
import { fmt, toCents } from '../../shared/money.js';
import { PAYTABLE, KENO_MAX_PICKS, countHits } from '../../shared/keno.js';

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
  return <>{Math.max(0, Math.ceil((endsAt - performance.now()) / 1000))}s</>;
}

export default function Keno({ cfg, balance }) {
  const [st, setSt] = useState(null);
  const [me, setMe] = useState(null);
  const [picks, setPicks] = useState(() => { try { return JSON.parse(loadPref('kn_picks', '[]')); } catch { return []; } });
  const [amount, setAmount] = useState(() => loadPref('kn_amount', '10'));
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const endsAt = useRef(0);

  useEffect(() => {
    const apply = (s) => {
      if (s.phase === 'betting') endsAt.current = performance.now() + s.bettingLeftMs;
      setSt(s);
    };
    const onBall = ({ n, i }) => {
      haptic('light');
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
  const hitsSoFar = countHits(shownPicks, revealed);
  const amountCents = toCents(amount);
  const locked = !!me && phase !== 'results';

  // Results feedback + auto-buy queued ticket when betting opens
  useEffect(() => {
    if (phase === 'results' && me?.win != null) haptic(me.win > 0 ? 'success' : 'error');
    if (phase === 'betting' && queued) { setQueued(false); buy(); }
  }, [phase, st?.round]);

  const toggle = (n) => {
    if (locked) return;
    haptic('light');
    setPicks((p) => {
      const next = p.includes(n) ? p.filter((x) => x !== n) : p.length >= KENO_MAX_PICKS ? p : [...p, n].sort((a, b) => a - b);
      if (!p.includes(n) && p.length >= KENO_MAX_PICKS) toast(`You can pick up to ${KENO_MAX_PICKS} numbers`);
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

  if (!st) return <div className="center muted">Loading Keno…</div>;

  const n = shownPicks.length;
  const table = PAYTABLE[n] || {};
  const last = revealed[revealed.length - 1];

  // ---- status line ----
  let status;
  if (phase === 'betting') status = <>Next draw in <b><Countdown endsAt={endsAt.current} /></b> · {st.players} ticket(s)</>;
  else if (phase === 'drawing') status = <>Drawing… <b>{revealed.length}/20</b>{n ? <> · you hit <b className="kn-hitcount">{hitsSoFar}</b></> : null}</>;
  else if (phase === 'results') status = me ? (me.win > 0 ? <>🎉 You hit <b>{me.hits}/{me.picks.length}</b> — won <b>{fmt(me.win)} {cfg.currency}</b></> : <>You hit {me.hits}/{me.picks.length} — no win this time</>) : <>Draw complete</>;
  else status = <>⏸ Paused for maintenance</>;

  // ---- main button ----
  let btn;
  if (phase === 'paused') btn = <button key="p" className="rk-btn" disabled>Paused</button>;
  else if (phase === 'betting' && me) btn = <button key="c" className="rk-btn cancel" disabled={busy} onClick={cancel}>Cancel ticket<small>{me.picks.length} numbers · {fmt(me.amount)} {cfg.currency}</small></button>;
  else if (phase === 'betting') btn = <button key="b" className="rk-btn bet" disabled={busy || !n || !(amountCents > 0)} onClick={buy}>{n ? 'BUY TICKET' : 'Pick numbers'}<small>{n ? `${n} numbers · ${fmt(amountCents)} ${cfg.currency}` : `choose 1–${KENO_MAX_PICKS} on the board`}</small></button>;
  else if (queued) btn = <button key="q" className="rk-btn cancel" onClick={() => setQueued(false)}>Cancel<small>ticket for next draw</small></button>;
  else if (locked) btn = <button key="l" className="rk-btn" disabled>Ticket in play<small>{me.picks.length} numbers · {fmt(me.amount)} {cfg.currency}</small></button>;
  else btn = <button key="n" className="rk-btn bet" disabled={!n || !(amountCents > 0)} onClick={() => { setQueued(true); haptic('light'); }}>BUY<small>for next draw · {n || 0} numbers · {fmt(amountCents)} {cfg.currency}</small></button>;

  return (
    <div className="keno">
      <div className={`kn-status ${phase}`}>{status}</div>

      <div className="kn-tray">
        <div className={`kn-bigball ${last && pickSet.has(last) ? 'hit' : ''}`} key={last || 'none'}>{last || '?'}</div>
        <div className="kn-drawn">
          {Array.from({ length: 20 }, (_, i) => {
            const b = revealed[i];
            return <span key={i} className={`kn-ball ${b ? 'on' : ''} ${b && pickSet.has(b) ? 'hit' : ''}`}>{b || ''}</span>;
          })}
        </div>
      </div>

      <div className={`kn-board ${locked ? 'locked' : ''}`}>
        {NUMS.map((x) => {
          const picked = pickSet.has(x);
          const drawn = drawnSet.has(x);
          const cls = picked && drawn ? 'hit' : picked ? (phase === 'results' && me ? 'miss' : 'picked') : drawn ? 'drawn' : '';
          return <button key={x} className={`kn-cell ${cls}`} onClick={() => toggle(x)}>{x}</button>;
        })}
      </div>

      <div className="rk-panel">
        <div className="row-between">
          <span className="small"><b>{n}</b>/{KENO_MAX_PICKS} numbers picked</span>
          <span className="kn-tools">
            <button onClick={doQuick} disabled={locked}>🎲 Quick pick</button>
            <button onClick={clear} disabled={locked || !picks.length}>Clear</button>
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
        {!me && balance < amountCents && <div className="warn small center-text">Balance too low — deposit in Wallet.</div>}
      </div>

      {n > 0 && (
        <div className="kn-pay">
          <h3>Payouts for {n} number{n > 1 ? 's' : ''}</h3>
          <div className="kn-paygrid">
            {Object.entries(table).sort((a, b) => Number(b[0]) - Number(a[0])).map(([hits, mult]) => {
              const active = (phase === 'drawing' || phase === 'results') && Number(hits) === hitsSoFar;
              const stake = me ? me.amount : amountCents;
              return (
                <div key={hits} className={`kn-payrow ${active ? 'active' : ''}`}>
                  <span>{hits} hit{hits === '1' ? '' : 's'}</span>
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
          <h3>Winners this draw</h3>
          {st.result.winners.map((w, i) => (
            <div key={i} className="rk-bet won"><span>{w.name}</span><span>{w.hits}/{w.picks}</span><span /><span>+{fmt(w.win)}</span></div>
          ))}
        </div>
      )}

      <button className="ghost sm" onClick={() => setShowInfo((v) => !v)}>{showInfo ? 'Hide' : '📖 How to play & fairness'}</button>
      {showInfo && (
        <div className="rk-info">
          <h3>How to play</h3>
          <ol>
            <li>Pick 1–{KENO_MAX_PICKS} numbers from 1 to 80 (or tap Quick pick), choose your stake and buy a ticket.</li>
            <li>When betting closes, 20 numbers are drawn one by one.</li>
            <li>The more of your numbers are drawn, the more you win. See the payout table for your ticket.</li>
          </ol>
          <p className="small muted">
            Tickets: {fmt(cfg.keno.minBet)}–{fmt(cfg.keno.maxBet)} {cfg.currency}. Maximum win per ticket: {fmt(cfg.keno.maxWin)} {cfg.currency}.
            Average return to players: about 94%. If a draw is interrupted by a technical problem, all tickets are refunded.
          </p>
          <h3>Provably fair</h3>
          <p className="small">
            Before betting opens we publish the hash of a secret seed. After the draw we reveal the seed. SHA-256(seed) must equal the
            hash, and the 20 numbers are the first 20 of a shuffle of 1–80 driven by HMAC-SHA256(seed, "keno:0", "keno:1", …).
          </p>
          <div className="mono small break">This round's hash: {st.hash || '—'}</div>
          {st.seed && <div className="mono small break">Seed: {st.seed}</div>}
        </div>
      )}
    </div>
  );
}
