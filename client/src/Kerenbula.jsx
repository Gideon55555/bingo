import React, { useCallback, useEffect, useRef, useState } from 'react';
import { socket, emit, haptic, toast, confirmBox, takeJoin } from './api.js';
import { SocialBar, InviteBox } from './Social.jsx';
import { fmt } from '../../shared/money.js';
import { W, R, RELEASE_Y, BALL_HEX, canRelease } from '../../shared/kerenbula.js';
import { startKbRender, toTable, Sim } from './kbRender.js';
import { t, useLang, trServer } from './i18n.js';

const Dot = ({ color, gone }) => <span className={`kb-dot ${gone ? 'gone' : ''}`} style={{ background: BALL_HEX[color] }} />;

export default function Kerenbula({ cfg, balance }) {
  useLang();
  const [lobby, setLobby] = useState(null);
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [powerUi, setPowerUi] = useState(0);
  const [rolling, setRolling] = useState(false);
  const canvasRef = useRef(null);
  const view = useRef({ balls: [], pins: [], replay: null, canRoll: false, next: null, handX: W / 2, aim: { dx: 0, dy: -1 }, power: 0 }).current;
  const gameRef = useRef(null);
  gameRef.current = game;

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { haptic('error'); toast(e.message); } finally { setBusy(false); }
  };

  const [inviteMode, setInviteMode] = useState(false);
  const enter = useCallback(() => emit('kb:enter').then((r) => {
    setLobby(r.lobby); setMe(r.me); applyState(r.game);
    const code = !r.me && takeJoin('kb');
    if (code) emit('kb:join', { code }).then((j) => { setMe(j.me); haptic('success'); }).catch((e) => toast(e.message));
  }).catch((e) => toast(e.message)), []);

  function applyState(st) {
    setGame(st);
    if (!st) return;
    if (view.replay) view.pending = { balls: st.balls, pins: st.pins }; // apply when the animation ends
    else { view.balls = st.balls; view.pins = st.pins; }
    const myTurn = st.turn === st.me && (st.phase === 'jack' || st.phase === 'roll');
    const wasMine = view.canRoll;
    view.canRoll = myTurn;
    view.next = st.next;
    if (myTurn && !wasMine) {
      if (!canRelease(st.balls, view.handX)) {
        for (let k = 0; k < 40; k++) { const x = W / 2 + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3); if (canRelease(st.balls, x)) { view.handX = x; break; } }
      }
      view.aim = { dx: 0, dy: -1 };
      haptic('medium');
    }
  }

  useEffect(() => {
    enter();
    const onMe = (m) => { setMe(m); if (m?.game && gameRef.current?.id !== m.game) { haptic('success'); enter(); } };
    const onState = (st) => { setRolling(false); applyState(st); };
    const onRoll = ({ before, pins, roll, n, after, pinsAfter }) => {
      view.canRoll = false;
      view.pending = null;
      const sim = new Sim(before, pins, { n, ...roll });
      view.replay = {
        sim, after, pinsAfter, start: performance.now(), finished: false,
        onPin: () => haptic('heavy'),
        onHit: () => haptic('light'),
        onDone: () => {
          view.balls = view.pending?.balls || after; view.pins = view.pending?.pins || pinsAfter; view.pending = null;
          setTimeout(() => { view.replay = null; if (view.pending) { view.balls = view.pending.balls; view.pins = view.pending.pins; view.pending = null; } }, 50);
        },
      };
      haptic('medium');
      setRolling(true);
    };
    const onEvent = ({ name, reason }) => toast(`${name} ${trServer(reason)}`);
    socket.on('connect', enter);
    socket.on('kb:lobby', setLobby);
    socket.on('kb:me', onMe);
    socket.on('kb:state', onState);
    socket.on('kb:roll', onRoll);
    socket.on('kb:event', onEvent);
    return () => {
      socket.off('connect', enter);
      socket.off('kb:lobby', setLobby);
      socket.off('kb:me', onMe);
      socket.off('kb:state', onState);
      socket.off('kb:roll', onRoll);
      socket.off('kb:event', onEvent);
      emit('kb:exit').catch(() => {});
    };
  }, []);

  const hasTable = !!game;
  useEffect(() => {
    if (!hasTable || !canvasRef.current) return;
    return startKbRender(canvasRef.current, view);
  }, [hasTable]);

  // what just happened (pins, short jack, timeout, end of frame)
  useEffect(() => {
    if (!game) return;
    const name = (i) => game.players[i]?.name;
    const e = game.lastEvent;
    if (game.phase === 'frameEnd' && game.frameResult) {
      const f = game.frameResult;
      setMsg(f.winner === null ? t('kbFrameTie') : t('kbFrameWon', { name: name(f.winner), n: f.points }));
    } else if (e?.type === 'pins') {
      const parts = [];
      if (e.legal) parts.push(t('kbPinsLegal', { name: name(e.by), n: e.legal, pts: e.legal * game.pinPoints }));
      for (const f of e.fouls) parts.push(t('kbPinsFoul', { name: name(f.player), n: f.count, pts: f.count * game.pinPoints }));
      setMsg(parts.join(' · '));
    } else if (e?.type === 'badJack') setMsg(t('kbBadJack', { name: name(e.by) }));
    else if (e?.type === 'timeout') setMsg(t('kbTimeout', { name: name(e.by) }));
    else if (e?.type === 'jack' && e.pinsReset) setMsg(t('kbPinsReset'));
    else setMsg(null);
  }, [game?.turn, game?.phase, game?.frame, JSON.stringify(game?.lastEvent)]);

  // ---------- touch: drag along the bottom to move your hand, anywhere else to aim ----------
  const dragging = useRef(null);
  const setAim = (p) => {
    const dx = p.x - view.handX, dy = p.y - RELEASE_Y;
    if (dy < -1) view.aim = { dx, dy };
  };
  const onPointerDown = (e) => {
    if (!view.canRoll) return;
    const p = toTable(canvasRef.current, e.clientX, e.clientY);
    dragging.current = p.y > RELEASE_Y - R * 4 ? 'hand' : 'aim';
    if (dragging.current === 'aim') setAim(p); else moveHand(p);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveHand = (p) => {
    const x = Math.min(W - R, Math.max(R, p.x));
    if (canRelease(view.balls, x)) {
      // keep the aim pointing at the same spot on the table
      const tx = view.handX + view.aim.dx, ty = RELEASE_Y + view.aim.dy;
      view.handX = x;
      view.aim = { dx: tx - x, dy: ty - RELEASE_Y };
    }
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const p = toTable(canvasRef.current, e.clientX, e.clientY);
    if (dragging.current === 'hand') moveHand(p); else setAim(p);
  };
  const onPointerUp = () => { dragging.current = null; };
  const nudge = (deg) => {
    const a = (deg * Math.PI) / 180;
    const { dx, dy } = view.aim;
    const n = { dx: dx * Math.cos(a) - dy * Math.sin(a), dy: dx * Math.sin(a) + dy * Math.cos(a) };
    if (n.dy < 0) view.aim = n;
    haptic('light');
  };

  // ---------- power: pull your hand back, let go to roll ----------
  const powerDrag = useRef(null);
  const onPowerDown = (e) => {
    if (!view.canRoll) return;
    powerDrag.current = { y0: e.clientY, h: e.currentTarget.getBoundingClientRect().height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPowerMove = (e) => {
    if (!powerDrag.current) return;
    const p = Math.max(0, Math.min(1, (e.clientY - powerDrag.current.y0) / (powerDrag.current.h * 0.85)));
    view.power = p;
    setPowerUi(p);
  };
  const onPowerUp = () => {
    if (!powerDrag.current) return;
    powerDrag.current = null;
    const power = view.power;
    view.power = 0;
    setPowerUi(0);
    if (power < 0.03 || !view.canRoll) return;
    const roll = { x: view.handX, dx: view.aim.dx, dy: view.aim.dy, power };
    view.canRoll = false;
    run(async () => { try { await emit('kb:roll', roll); } catch (e) { view.canRoll = true; throw e; } });
  };

  if (cfg.devMode) window.__kb = { game, view }; // test hook (DEV_MODE only)
  if (!lobby) return <div className="center muted">{t('loading')}</div>;

  // ================= Match =================
  if (game) {
    const myTurn = game.turn === game.me && (game.phase === 'jack' || game.phase === 'roll');
    const chip = (i) => {
      const p = game.players[i];
      const active = game.turn === i && (game.phase === 'jack' || game.phase === 'roll');
      return (
        <div key={i} className={`pool-chip ${active ? 'active' : ''} ${p.out ? 'out' : ''}`}>
          <div className="lc-name">{p.name}{i === game.me ? ` (${t('you')})` : ''}</div>
          <div className="kb-row">
            <span className="kb-score">{p.score}</span>
            <span className="kb-dots">{[0, 1, 2, 3].map((k) => <Dot key={k} color={p.color} gone={k >= p.left} />)}</span>
          </div>
          {p.misses > 0 && <div className="small warn">{t('timeoutsN', { n: p.misses, max: game.maxMisses })}</div>}
          {active && !rolling && game.deadlineLeftMs != null && (
            <div className="lc-timer"><span key={`${game.turn}-${game.phase}-${game.next}-${p.left}`} style={{ animationDuration: `${game.deadlineLeftMs}ms` }} /></div>
          )}
        </div>
      );
    };
    let hint = '';
    if (game.phase === 'starting') hint = t('matchStarting');
    else if (rolling || game.phase === 'rolling') hint = '';
    else if (game.phase === 'frameEnd') hint = t('kbNextFrame');
    else if (myTurn && game.phase === 'jack') hint = t('kbYourJack');
    else if (myTurn) hint = t('kbYourRoll');
    else if (game.phase === 'jack') hint = t('kbRollingJack', { name: game.players[game.turn].name });
    else if (game.phase === 'roll') hint = t('isAiming', { name: game.players[game.turn].name });
    const leave = async () => {
      if (game.phase !== 'over' && !(await confirmBox(t('confirmForfeit', { amount: `${fmt(game.stake)} ${cfg.currency}` })))) return;
      if (game.phase !== 'over') await emit('kb:leave');
      setGame(null); enter();
    };
    return (
      <div className="pool kb">
        <div className="row-between ludo-top">
          {game.practice ? <span className="practice-badge">{t('practiceBadge')}</span>
            : <span className="small">{t('prize')} <b className="accent">{fmt(game.prize)} {cfg.currency}</b></span>}
          <span className="small muted">{t('kbFrameOf', { n: Math.max(1, game.frame), max: game.maxFrames, target: game.target })}</span>
          <button className="ghost sm" onClick={leave}>{game.phase === 'over' ? t('tables') : t('leave')}</button>
        </div>
        <div className="pool-chips">{game.players.map((_, i) => chip(i))}</div>
        {msg && <div className="pool-msg">{msg}</div>}
        <div className="pool-play">
          <canvas ref={canvasRef} className="pool-canvas"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          <div className={`pool-power kb-power ${myTurn ? '' : 'off'}`}
            onPointerDown={onPowerDown} onPointerMove={onPowerMove} onPointerUp={onPowerUp} onPointerCancel={onPowerUp}>
            <div className="pp-fill" style={{ transform: `scaleY(${powerUi})` }} />
            <div className="kb-hand" style={{ transform: `translateY(${powerUi * 70}%)` }}>✋</div>
            <div className="pp-label">{powerUi > 0 ? `${Math.round(powerUi * 100)}%` : t('pull')}</div>
          </div>
        </div>
        <div className="pool-under">
          <button className="ghost sm" disabled={!myTurn} onClick={() => nudge(-0.4)}>◀ {t('fine')}</button>
          <div className="pool-hint">{hint}</div>
          <button className="ghost sm" disabled={!myTurn} onClick={() => nudge(0.4)}>{t('fine')} ▶</button>
        </div>

        {game.phase === 'over' && game.result && (
          <div className="overlay">
            <div className="result">
              <h2>{game.practice ? (game.result.winner === game.me ? t('practiceWon') : t('practiceLost'))
                : game.result.winner === game.me ? t('youWonPrize', { amount: `${fmt(game.result.prize)} ${cfg.currency}` }) : t('nameWon', { name: game.result.winnerName })}</h2>
              <p className="big">{game.players.map((p) => p.score).join(' – ')}</p>
              <p className="muted small">{trServer(game.result.how)}</p>
              <button className="primary" onClick={() => { setGame(null); enter(); }}>{t('backToTables')}</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ================= Waiting =================
  if (me?.queue) {
    const q = me.queue;
    return (
      <div className="ludo">
        <div className="ludo-wait">
          <div className="spinner" />
          <h2>{q.code ? t('privateTable') : t('findingOpp')}</h2>
          <InviteBox prefix="kb" code={q.code} cfg={cfg} />
          <p className="muted">{t('poolEntryInfo', { stake: `${fmt(q.stake)} ${cfg.currency}`, prize: `${fmt(Math.floor(q.stake * 2 * (1 - cfg.kerenbula.houseCut)))} ${cfg.currency}` })}</p>
          <p className="small muted">{t('matchStartsWhen')}</p>
          <button className="ghost" disabled={busy} onClick={() => run(async () => { await emit('kb:leave'); setMe(null); })}>{t('leaveTable')}</button>
        </div>
      </div>
    );
  }

  // ================= Tables =================
  const k = cfg.kerenbula;
  const joinTable = (tb) => run(async () => {
    if (balance < tb.stake) throw new Error(t('balanceLow'));
    const r = await emit('kb:join', { stake: tb.stake, invite: inviteMode }); setMe(r.me); setInviteMode(false); haptic('medium');
  });
  return (
    <div className="ludo">
      {lobby.paused && <div className="banner">⏸ {t('paused')}</div>}
      <p className="muted small">
        {t('kbIntro', { target: k.target, pin: k.pinPoints, sec: k.rollSec, pct: Math.round((1 - k.houseCut) * 100) })}
        {lobby.playing ? ` · ${t('playingNow', { n: lobby.playing })}` : ''}
      </p>
      <SocialBar busy={busy} inviteMode={inviteMode} setInviteMode={setInviteMode}
        onPractice={() => run(async () => { const r = await emit('kb:practice'); setMe(r.me); haptic('medium'); })} />
      <div className="pool-tables">
        {lobby.tables.map((tb) => (
          <button key={tb.stake} className="ludo-table pool-table kb-table" disabled={busy || lobby.paused} onClick={() => joinTable(tb)}>
            <div className="pt-amt">{fmt(tb.stake)} <small>{cfg.currency}</small></div>
            <div className="lt-prize">{t('winX', { amount: fmt(tb.prize) })}</div>
            <div className="lt-wait">{tb.waiting ? t('oneWaiting') : t('join')}</div>
          </button>
        ))}
      </div>
      <p className="muted small center-text">{t('kbServerPhysics')}</p>
    </div>
  );
}
