import React, { useCallback, useEffect, useRef, useState } from 'react';
import { socket, emit, haptic, toast, confirmBox, takeJoin } from './api.js';
import { SocialBar, InviteBox } from './Social.jsx';
import { fmt } from '../../shared/money.js';
import { SOLIDS, STRIPES, BALL_COLORS, R, W, H, HEAD_LINE } from '../../shared/pool.js';
import { startPoolRender, toTable, Sim, canPlaceCue } from './poolRender.js';
import { sfx } from './sound.js';
import { t, useLang, trServer } from './i18n.js';

function MiniBall({ n, gone }) {
  const stripe = n >= 9;
  const c = BALL_COLORS[n];
  return (
    <span className={`mini-pool ${gone ? 'gone' : ''}`}
      style={{ background: stripe ? `linear-gradient(#f8f8f2 25%, ${c} 25% 75%, #f8f8f2 75%)` : c }}><b>{n}</b></span>
  );
}

export default function Pool({ cfg, balance }) {
  useLang();
  const [lobby, setLobby] = useState(null);
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [powerUi, setPowerUi] = useState(0);
  const [rolling, setRolling] = useState(false);
  const canvasRef = useRef(null);
  const view = useRef({ balls: [], replay: null, aim: { dx: 0, dy: -1 }, power: 0, canAim: false, cueDrag: null, cuePlaced: null, ballInHand: false }).current;
  const gameRef = useRef(null);
  gameRef.current = game;

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { haptic('error'); toast(e.message); } finally { setBusy(false); }
  };

  const [inviteMode, setInviteMode] = useState(false);
  const enter = useCallback(() => emit('pool:enter').then((r) => {
    setLobby(r.lobby); setMe(r.me); applyState(r.game);
    const code = !r.me && takeJoin('pool');
    if (code) emit('pool:join', { code }).then((j) => { setMe(j.me); haptic('success'); }).catch((e) => toast(e.message));
  }).catch((e) => toast(e.message)), []);

  function applyState(st) {
    setGame(st);
    if (!st) return;
    if (!view.replay) view.balls = st.balls;
    const myTurn = st.turn === st.me && st.phase === 'aim';
    view.canAim = myTurn;
    view.ballInHand = st.ballInHand;
    view.breakShot = st.breakShot;
    if (myTurn && st.ballInHand && !view.cuePlaced) {
      // default cue spot for ball in hand: where it was, or the break spot
      const c = st.balls[0];
      const start = !c.in && canPlaceCue(st.balls, c.x, c.y, st.breakShot) ? { x: c.x, y: c.y } : { x: W / 2, y: H * 0.85 };
      view.cuePlaced = canPlaceCue(st.balls, start.x, start.y, st.breakShot) ? start : { x: W / 2, y: HEAD_LINE + 12 };
    }
    if (!myTurn || !st.ballInHand) view.cuePlaced = null;
    if (myTurn) { haptic('medium'); sfx('turn'); }
    if (st.phase === 'over' && st.result && !view.overSound) { view.overSound = true; sfx(st.practice ? (st.result.winner === st.me ? 'win' : 'lose') : st.result.winner === st.me ? 'win' : 'lose'); }
    if (st.phase !== 'over') view.overSound = false;
  }

  useEffect(() => {
    enter();
    const onLobby = setLobby;
    const onMe = (m) => { setMe(m); if (m?.game && gameRef.current?.id !== m.game) { haptic('success'); enter(); } };
    const onState = (st) => { setRolling(false); applyState(st); };
    const onShot = ({ before, shot, after, foul, shooter }) => {
      view.canAim = false;
      view.cueDrag = null;
      const sim = new Sim(before, shot);
      view.replay = {
        sim, after, start: performance.now(), finished: false,
        onPot: (n) => { haptic(n === 0 ? 'error' : 'light'); sfx('thud'); },
        onDone: () => {
          view.balls = after;
          setTimeout(() => { view.replay = null; }, 50);
          if (foul) setMsg(t('foulBy', { name: gameRef.current?.players[shooter]?.name, reason: trServer(foul) }));
        },
      };
      haptic('heavy'); sfx('ball');
      setRolling(true);
    };
    socket.on('connect', enter);
    socket.on('pool:lobby', onLobby);
    socket.on('pool:me', onMe);
    socket.on('pool:state', onState);
    socket.on('pool:shot', onShot);
    const onEvent = ({ name, reason }) => toast(`${name} ${trServer(reason)}`);
    socket.on('pool:event', onEvent);
    return () => {
      socket.off('connect', enter);
      socket.off('pool:lobby', onLobby);
      socket.off('pool:me', onMe);
      socket.off('pool:state', onState);
      socket.off('pool:shot', onShot);
      socket.off('pool:event', onEvent);
      emit('pool:exit').catch(() => {});
    };
  }, []);

  // canvas loop while a game is on screen
  const hasTable = !!game;
  useEffect(() => {
    if (!hasTable || !canvasRef.current) return;
    return startPoolRender(canvasRef.current, view);
  }, [hasTable]);

  // clear the foul message when a new turn starts
  useEffect(() => { if (game?.phase === 'aim' && !game.lastFoul) setMsg(null); else if (game?.lastFoul) setMsg(t('foulBallInHand', { name: game.lastFoul.by, reason: trServer(game.lastFoul.reason) })); }, [game?.turn, game?.phase]);

  // ---------- touch handling on the table ----------
  const dragging = useRef(null);
  const onPointerDown = (e) => {
    if (!view.canAim) return;
    const p = toTable(canvasRef.current, e.clientX, e.clientY);
    const cue = view.cuePlaced || view.balls[0];
    // grab the cue ball only when touching it (a little extra margin for fingers)
    if (view.ballInHand && Math.hypot(p.x - cue.x, p.y - cue.y) < R * 2.4) {
      dragging.current = 'cue';
      view.cueDrag = { x: cue.x, y: cue.y, valid: true };
    } else {
      dragging.current = 'aim';
      setAim(p);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const p = toTable(canvasRef.current, e.clientX, e.clientY);
    if (dragging.current === 'cue') {
      const x = Math.min(W - R, Math.max(R, p.x)), y = Math.min(H - R, Math.max(R, p.y));
      view.cueDrag = { x, y, valid: canPlaceCue(view.balls, x, y, view.breakShot) };
    } else setAim(p);
  };
  const onPointerUp = () => {
    if (dragging.current === 'cue' && view.cueDrag) {
      if (view.cueDrag.valid) view.cuePlaced = { x: view.cueDrag.x, y: view.cueDrag.y };
      else toast(view.breakShot ? t('breakPlace') : t('cantPlace'));
      view.cueDrag = null;
    }
    dragging.current = null;
  };
  function setAim(p) {
    const cue = view.cuePlaced || view.balls[0];
    const dx = p.x - cue.x, dy = p.y - cue.y;
    if (Math.hypot(dx, dy) > 1) view.aim = { dx, dy };
  }
  const nudge = (deg) => {
    const a = (deg * Math.PI) / 180;
    const { dx, dy } = view.aim;
    view.aim = { dx: dx * Math.cos(a) - dy * Math.sin(a), dy: dx * Math.sin(a) + dy * Math.cos(a) };
    haptic('light');
  };

  // ---------- power bar: pull down, release to shoot ----------
  const powerDrag = useRef(null);
  const onPowerDown = (e) => {
    if (!view.canAim) return;
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
    if (power < 0.03 || !view.canAim) return;
    const shot = { dx: view.aim.dx, dy: view.aim.dy, power };
    if (view.ballInHand) shot.cue = view.cuePlaced;
    view.canAim = false;
    run(async () => { try { await emit('pool:shoot', shot); } catch (e) { view.canAim = true; throw e; } });
  };

  if (cfg.devMode) window.__pool = { game, view }; // test hook (DEV_MODE only)
  if (!lobby) return <div className="center muted">{t('loading')}</div>;

  // ================= Match =================
  if (game) {
    const myTurn = game.turn === game.me && game.phase === 'aim';
    const chip = (i) => {
      const p = game.players[i];
      const active = game.turn === i && game.phase !== 'over';
      const set = p.set || (p.group ? (p.group === 'solids' ? SOLIDS : STRIPES) : null);
      return (
        <div key={i} className={`pool-chip ${active ? 'active' : ''} ${p.out || p.eliminated ? 'out' : ''}`}>
          <div className="lc-name">{p.name}{i === game.me ? ` (${t('you')})` : ''}</div>
          <div className="pool-group">
            {set ? set.map((n) => <MiniBall key={n} n={n} gone={game.balls.find((b) => b.n === n).in} />)
              : <span className="muted small">{game.breakShot ? (active ? t('breaking') : '') : t('openTable')}</span>}
            {set && !p.set && p.left === 0 && <MiniBall n={8} />}
          </div>
          {p.misses > 0 && <div className="small warn">{t('timeoutsN', { n: p.misses, max: game.maxMisses })}</div>}
          {active && !rolling && game.deadlineLeftMs != null && (
            <div className="lc-timer"><span key={`${game.turn}-${game.balls.map((b) => b.in ? 1 : 0).join('')}-${game.deadlineLeftMs > 0}`} style={{ animationDuration: `${game.deadlineLeftMs}ms` }} /></div>
          )}
        </div>
      );
    };
    let hint = '';
    if (game.phase === 'starting') hint = t('matchStarting');
    else if (game.phase === 'shooting' || rolling) hint = '';
    else if (myTurn && game.ballInHand) hint = game.breakShot ? t('yourBreak') : t('ballInHand');
    else if (myTurn) hint = t('yourShot');
    else if (game.phase === 'aim') hint = t('isAiming', { name: game.players[game.turn].name });
    const leave = async () => {
      if (game.phase !== 'over' && !(await confirmBox(t('confirmForfeit', { amount: `${fmt(game.stake)} ${cfg.currency}` })))) return;
      if (game.phase !== 'over') await emit('pool:leave');
      setGame(null); enter();
    };
    return (
      <div className="pool">
        <div className="row-between ludo-top">
          {game.practice ? <span className="practice-badge">{t('practiceBadge')}</span>
            : <span className="small">{t('prize')} <b className="accent">{fmt(game.prize)} {cfg.currency}</b></span>}
          <button className="ghost sm" onClick={leave}>{game.phase === 'over' ? t('tables') : t('leave')}</button>
        </div>
        <div className="pool-chips">{game.players.map((_, i) => chip(i))}</div>
        {msg && <div className="pool-msg">{msg}</div>}
        <div className="pool-play">
          <canvas ref={canvasRef} className="pool-canvas"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          <div className={`pool-power ${myTurn ? '' : 'off'}`}
            onPointerDown={onPowerDown} onPointerMove={onPowerMove} onPointerUp={onPowerUp} onPointerCancel={onPowerUp}>
            <div className="pp-fill" style={{ transform: `scaleY(${powerUi})` }} />
            <div className="pp-cue" style={{ transform: `translateY(${powerUi * 70}%)` }} />
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
              <p className="muted small">{game.result.how === 'potted the 8 ball' ? t('pottedEight') : trServer(game.result.how)}</p>
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
          <h2>{q.code ? t('privateTable') : q.size > 2 ? t('waitingPlayers') : t('findingOpp')}</h2>
          <InviteBox prefix="pool" code={q.code} cfg={cfg} />
          {q.size > 2 && <div className="big">{q.waiting}/{q.size}</div>}
          <p className="muted">{t('poolEntryInfo', { stake: `${fmt(q.stake)} ${cfg.currency}`, prize: `${fmt(Math.floor(q.stake * (q.size || 2) * (1 - cfg.pool.houseCut)))} ${cfg.currency}` })}</p>
          <p className="small muted">{q.size > 2 ? t('startsWhenFull') : t('matchStartsWhen')}</p>
          <button className="ghost" disabled={busy} onClick={() => run(async () => { await emit('pool:leave'); setMe(null); })}>{t('leaveTable')}</button>
        </div>
      </div>
    );
  }

  // ================= Tables =================
  const sizes = [...new Set(lobby.tables.map((x) => x.size))].sort();
  const stakes = [...new Set(lobby.tables.map((x) => x.stake))];
  const joinTable = (tb) => run(async () => {
    if (balance < tb.stake) throw new Error(t('balanceLow'));
    const r = await emit('pool:join', { stake: tb.stake, size: tb.size, invite: inviteMode }); setMe(r.me); setInviteMode(false); haptic('medium');
  });
  return (
    <div className="ludo">
      {lobby.paused && <div className="banner">⏸ {t('paused')}</div>}
      <p className="muted small">
        {t('poolIntro', { sec: cfg.pool.shotSec, pct: Math.round((1 - cfg.pool.houseCut) * 100) })}
        {lobby.playing ? ` · ${t('playingNow', { n: lobby.playing })}` : ''}
      </p>
      <SocialBar busy={busy} inviteMode={inviteMode} setInviteMode={setInviteMode}
        onPractice={() => run(async () => { const r = await emit('pool:practice'); setMe(r.me); haptic('medium'); })} />
      {sizes.length === 1 ? (
        <div className="pool-tables">
          {lobby.tables.map((tb) => (
            <button key={tb.stake} className="ludo-table pool-table" disabled={busy || lobby.paused} onClick={() => joinTable(tb)}>
              <div className="pt-amt">{fmt(tb.stake)} <small>{cfg.currency}</small></div>
              <div className="lt-prize">{t('winX', { amount: fmt(tb.prize) })}</div>
              <div className="lt-wait">{tb.waiting ? t('oneWaiting') : t('join')}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="ludo-tables">
          {stakes.map((stake) => (
            <div key={stake} className="ludo-stake" style={{ gridTemplateColumns: `88px repeat(${sizes.length}, 1fr)` }}>
              <div className="ls-amt">{fmt(stake)} <small>{cfg.currency}</small></div>
              {sizes.map((size) => {
                const tb = lobby.tables.find((x) => x.stake === stake && x.size === size);
                return (
                  <button key={size} className="ludo-table" disabled={busy || lobby.paused} onClick={() => joinTable(tb)}>
                    <div className="lt-size">{size === 2 ? t('oneVone') : t('nPlayersCut', { n: size })}</div>
                    <div className="lt-prize">🏆 {fmt(tb.prize)}</div>
                    <div className="lt-wait">{tb.waiting ? t('waitingN', { n: tb.waiting, size }) : t('join')}</div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <p className="muted small center-text">{t('serverPhysics')}</p>
    </div>
  );
}
