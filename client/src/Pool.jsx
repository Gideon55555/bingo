import React, { useCallback, useEffect, useRef, useState } from 'react';
import { socket, emit, haptic, toast, confirmBox } from './api.js';
import { fmt } from '../../shared/money.js';
import { SOLIDS, STRIPES, BALL_COLORS, R, W, H, HEAD_LINE } from '../../shared/pool.js';
import { startPoolRender, toTable, Sim, canPlaceCue } from './poolRender.js';

function MiniBall({ n, gone }) {
  const stripe = n >= 9;
  const c = BALL_COLORS[n];
  return (
    <span className={`mini-pool ${gone ? 'gone' : ''}`}
      style={{ background: stripe ? `linear-gradient(#f8f8f2 25%, ${c} 25% 75%, #f8f8f2 75%)` : c }}><b>{n}</b></span>
  );
}

export default function Pool({ cfg, balance }) {
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

  const enter = useCallback(() => emit('pool:enter').then((r) => { setLobby(r.lobby); setMe(r.me); applyState(r.game); }).catch((e) => toast(e.message)), []);

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
    if (myTurn) haptic('medium');
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
        onPot: (n) => haptic(n === 0 ? 'error' : 'light'),
        onDone: () => {
          view.balls = after;
          setTimeout(() => { view.replay = null; }, 50);
          if (foul) setMsg(`Foul by ${gameRef.current?.players[shooter]?.name}: ${foul}`);
        },
      };
      haptic('heavy');
      setRolling(true);
    };
    socket.on('connect', enter);
    socket.on('pool:lobby', onLobby);
    socket.on('pool:me', onMe);
    socket.on('pool:state', onState);
    socket.on('pool:shot', onShot);
    return () => {
      socket.off('connect', enter);
      socket.off('pool:lobby', onLobby);
      socket.off('pool:me', onMe);
      socket.off('pool:state', onState);
      socket.off('pool:shot', onShot);
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
  useEffect(() => { if (game?.phase === 'aim' && !game.lastFoul) setMsg(null); else if (game?.lastFoul) setMsg(`Foul by ${game.lastFoul.by}: ${game.lastFoul.reason} — ball in hand`); }, [game?.turn, game?.phase]);

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
      else toast(view.breakShot ? 'On the break, place the cue ball behind the line' : 'The cue ball can’t go there');
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
  if (!lobby) return <div className="center muted">Loading pool…</div>;

  // ================= Match =================
  if (game) {
    const myTurn = game.turn === game.me && game.phase === 'aim';
    const chip = (i) => {
      const p = game.players[i];
      const active = game.turn === i && game.phase !== 'over';
      const set = p.group ? (p.group === 'solids' ? SOLIDS : STRIPES) : null;
      return (
        <div className={`pool-chip ${active ? 'active' : ''}`}>
          <div className="lc-name">{p.name}{i === game.me ? ' (you)' : ''}</div>
          <div className="pool-group">
            {set ? set.map((n) => <MiniBall key={n} n={n} gone={game.balls.find((b) => b.n === n).in} />)
              : <span className="muted small">{game.breakShot ? (active ? 'breaking' : '') : 'open table'}</span>}
            {set && p.left === 0 && <MiniBall n={8} />}
          </div>
          {p.misses > 0 && <div className="small warn">⏱ {p.misses}/{game.maxMisses} timeouts</div>}
          {active && !rolling && game.deadlineLeftMs != null && (
            <div className="lc-timer"><span key={`${game.turn}-${game.balls.map((b) => b.in ? 1 : 0).join('')}-${game.deadlineLeftMs > 0}`} style={{ animationDuration: `${game.deadlineLeftMs}ms` }} /></div>
          )}
        </div>
      );
    };
    let hint = '';
    if (game.phase === 'starting') hint = 'Match starting…';
    else if (game.phase === 'shooting' || rolling) hint = '';
    else if (myTurn && game.ballInHand) hint = game.breakShot ? 'Your break! Drag the white ball (behind the line), aim, then pull the cue' : 'Ball in hand: drag the white ball anywhere, aim, then pull the cue';
    else if (myTurn) hint = 'Your shot: touch the table to aim, pull the cue down to shoot';
    else if (game.phase === 'aim') hint = `${game.players[game.turn].name} is aiming…`;
    const leave = async () => {
      if (game.phase !== 'over' && !(await confirmBox(`Leave and forfeit this match? You will lose your ${fmt(game.stake)} ${cfg.currency} entry.`))) return;
      if (game.phase !== 'over') await emit('pool:leave');
      setGame(null); enter();
    };
    return (
      <div className="pool">
        <div className="row-between ludo-top">
          <span className="small">Prize <b className="accent">{fmt(game.prize)} {cfg.currency}</b></span>
          <button className="ghost sm" onClick={leave}>{game.phase === 'over' ? '← Tables' : 'Leave'}</button>
        </div>
        <div className="pool-chips">{chip(0)}{chip(1)}</div>
        {msg && <div className="pool-msg">{msg}</div>}
        <div className="pool-play">
          <canvas ref={canvasRef} className="pool-canvas"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          <div className={`pool-power ${myTurn ? '' : 'off'}`}
            onPointerDown={onPowerDown} onPointerMove={onPowerMove} onPointerUp={onPowerUp} onPointerCancel={onPowerUp}>
            <div className="pp-fill" style={{ transform: `scaleY(${powerUi})` }} />
            <div className="pp-cue" style={{ transform: `translateY(${powerUi * 70}%)` }} />
            <div className="pp-label">{powerUi > 0 ? `${Math.round(powerUi * 100)}%` : 'PULL'}</div>
          </div>
        </div>
        <div className="pool-under">
          <button className="ghost sm" disabled={!myTurn} onClick={() => nudge(-0.4)}>◀ fine</button>
          <div className="pool-hint">{hint}</div>
          <button className="ghost sm" disabled={!myTurn} onClick={() => nudge(0.4)}>fine ▶</button>
        </div>

        {game.phase === 'over' && game.result && (
          <div className="overlay">
            <div className="result">
              <h2>{game.result.winner === game.me ? `🏆 You won ${fmt(game.result.prize)} ${cfg.currency}!` : `${game.result.winnerName} won`}</h2>
              <p className="muted small">{game.result.how === 'potted the 8 ball' ? 'Potted the 8 ball.' : game.result.how}</p>
              <button className="primary" onClick={() => { setGame(null); enter(); }}>Back to tables</button>
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
          <h2>Finding an opponent…</h2>
          <p className="muted">Entry {fmt(q.stake)} {cfg.currency} · winner gets {fmt(Math.floor(q.stake * 2 * (1 - cfg.pool.houseCut)))} {cfg.currency}</p>
          <p className="small muted">The match starts as soon as another player joins. We'll also message you on Telegram.</p>
          <button className="ghost" disabled={busy} onClick={() => run(async () => { await emit('pool:leave'); setMe(null); })}>Leave table & refund</button>
        </div>
      </div>
    );
  }

  // ================= Tables =================
  return (
    <div className="ludo">
      {lobby.paused && <div className="banner">⏸ Games are paused for maintenance.</div>}
      <p className="muted small">
        Classic 8-ball, 1 vs 1. Pot all your solids or stripes, then the 8. Fouls give your opponent ball in hand.
        {' '}{cfg.pool.shotSec}s per shot. Winner gets {Math.round((1 - cfg.pool.houseCut) * 100)}% of the pot.
        {lobby.playing ? ` · ${lobby.playing} playing now` : ''}
      </p>
      <div className="pool-tables">
        {lobby.tables.map((t) => (
          <button key={t.stake} className="ludo-table pool-table" disabled={busy || lobby.paused}
            onClick={() => run(async () => {
              if (balance < t.stake) throw new Error('Balance too low — deposit in Wallet.');
              const r = await emit('pool:join', { stake: t.stake }); setMe(r.me); haptic('medium');
            })}>
            <div className="pt-amt">{fmt(t.stake)} <small>{cfg.currency}</small></div>
            <div className="lt-prize">🏆 Win {fmt(t.prize)}</div>
            <div className="lt-wait">{t.waiting ? '1 player waiting — join now!' : 'Join'}</div>
          </button>
        ))}
      </div>
      <p className="muted small center-text">Every shot is calculated on the server with the same physics for both players.</p>
    </div>
  );
}
