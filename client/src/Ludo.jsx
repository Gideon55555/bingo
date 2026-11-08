import React, { useCallback, useEffect, useRef, useState } from 'react';
import { socket, emit, haptic, toast, confirmBox } from './api.js';
import { fmt } from '../../shared/money.js';
import { COLORS, COLOR_HEX, HOME_POS } from '../../shared/ludo.js';
import LudoBoard from './LudoBoard.jsx';

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function Die({ value, rolling, color, onClick, big }) {
  return (
    <button className={`ludo-die ${rolling ? 'rolling' : ''} ${onClick ? 'can-roll' : ''} ${big ? 'big' : ''}`}
      style={{ '--die': COLOR_HEX[color] || '#64748b' }} onClick={onClick} disabled={!onClick}>
      <div className="die-face">
        {Array.from({ length: 9 }, (_, i) => <span key={i} className={(PIPS[value] || []).includes(i) ? 'pip' : ''} />)}
      </div>
    </button>
  );
}

export default function Ludo({ cfg, balance }) {
  const [lobby, setLobby] = useState(null);
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dice, setDice] = useState({ value: 6, rolling: false, seat: null });
  const [, rerender] = useState(0);
  const overrides = useRef(new Map()); // `${seat}:${i}` -> { rel, slow, active }
  const gameRef = useRef(null);
  gameRef.current = game;

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { haptic('error'); toast(e.message); } finally { setBusy(false); }
  };

  const enter = useCallback(() => emit('ludo:enter').then((r) => {
    setLobby(r.lobby); setMe(r.me); setGame(r.game);
  }).catch((e) => toast(e.message)), []);

  useEffect(() => {
    enter();
    const onLobby = setLobby;
    const onMe = (m) => {
      setMe(m);
      if (m?.game && gameRef.current?.id !== m.game) { haptic('success'); enter(); }
    };
    const onState = (st) => {
      // drop finished animations; keep ones still playing
      for (const [k, o] of overrides.current) if (!o.active) overrides.current.delete(k);
      setGame(st);
    };
    const onRoll = ({ seat, value }) => {
      setDice({ value: 1 + Math.floor(Math.random() * 6), rolling: true, seat });
      setTimeout(() => setDice({ value, rolling: false, seat }), 420);
    };
    const onMove = ({ seat, token, from, to, captured }) => {
      const stepMs = cfg.ludo.stepMs;
      const key = `${seat}:${token}`;
      const path = from < 0 ? [0] : Array.from({ length: to - from }, (_, i) => from + 1 + i);
      overrides.current.set(key, { rel: from, active: true });
      captured.forEach((c) => overrides.current.set(`${c.seat}:${c.token}`, { rel: c.from, active: true }));
      path.forEach((rel, i) => setTimeout(() => {
        overrides.current.set(key, { rel, active: i < path.length - 1 });
        rerender((x) => x + 1);
        if (i === path.length - 1) {
          if (captured.length) {
            haptic('heavy');
            captured.forEach((c) => overrides.current.set(`${c.seat}:${c.token}`, { rel: -1, slow: true, active: false }));
            rerender((x) => x + 1);
          } else haptic('light');
        }
      }, (i + 1) * stepMs));
      // safety net: clear everything a little after the server's own animation window
      setTimeout(() => { overrides.current.clear(); rerender((x) => x + 1); }, path.length * stepMs + 2000);
    };
    const onEvent = ({ text }) => toast(text);
    socket.on('connect', enter);
    socket.on('ludo:lobby', onLobby);
    socket.on('ludo:me', onMe);
    socket.on('ludo:state', onState);
    socket.on('ludo:roll', onRoll);
    socket.on('ludo:move', onMove);
    socket.on('ludo:event', onEvent);
    return () => {
      socket.off('connect', enter);
      socket.off('ludo:lobby', onLobby);
      socket.off('ludo:me', onMe);
      socket.off('ludo:state', onState);
      socket.off('ludo:roll', onRoll);
      socket.off('ludo:move', onMove);
      socket.off('ludo:event', onEvent);
      emit('ludo:exit').catch(() => {});
    };
  }, []);

  // buzz when it becomes my turn
  const myTurn = game && game.turnSeat === game.mySeat && game.mySeat !== null;
  useEffect(() => { if (myTurn && game.phase === 'roll') haptic('medium'); }, [myTurn, game?.phase]);

  if (!lobby) return <div className="center muted">Loading Ludo…</div>;

  // ================= In a game =================
  if (game) {
    const tokens = [];
    game.players.forEach((p) => {
      if (p.out) return;
      p.tokens.forEach((rel, i) => {
        const o = overrides.current.get(`${p.seat}:${i}`);
        tokens.push({
          key: `${p.seat}:${i}`, seat: p.seat, index: i, rel: o ? o.rel : rel, slow: o?.slow,
          movable: myTurn && game.phase === 'move' && game.legal.includes(i) && p.seat === game.mySeat,
        });
      });
    });
    const current = game.players.find((p) => p.seat === game.turnSeat);
    const bySeat = Object.fromEntries(game.players.map((p) => [p.seat, p]));
    const canRoll = myTurn && game.phase === 'roll';
    const leave = async () => {
      if (game.phase !== 'over' && !(await confirmBox(`Leave and forfeit this game? You will lose your ${fmt(game.stake)} ${cfg.currency} entry.`))) return;
      if (game.phase !== 'over') await emit('ludo:leave');
      setGame(null); enter();
    };
    const chip = (seat) => {
      const p = bySeat[seat];
      if (!p) return <div className="ludo-chip empty" />;
      const active = game.turnSeat === seat && game.phase !== 'over';
      const home = p.tokens.filter((t) => t === HOME_POS).length;
      return (
        <div className={`ludo-chip ${active ? 'active' : ''} ${p.out ? 'out' : ''}`} style={{ '--c': COLOR_HEX[p.color] }}>
          <div className="lc-name"><span className="lc-dot" />{p.name}{seat === game.mySeat ? ' (you)' : ''}</div>
          <div className="lc-meta">
            {p.out ? 'left the game' : <>🏠 {home}/{p.tokens.length}{p.misses ? <span className="warn"> · ⚠️ {p.misses}/{game.maxMisses} missed</span> : null}</>}
          </div>
          {active && game.deadlineLeftMs != null && (
            <div className="lc-timer"><span key={`${game.turnSeat}-${game.phase}-${game.roll}`} style={{ animationDuration: `${game.deadlineLeftMs}ms` }} /></div>
          )}
        </div>
      );
    };
    let hint;
    if (game.phase === 'over') hint = '';
    else if (game.phase === 'starting') hint = 'Game starting…';
    else if (canRoll) hint = 'Your turn — tap the dice!';
    else if (myTurn && game.phase === 'move') hint = 'Tap a glowing token to move';
    else if (myTurn) hint = game.roll === 6 && game.phase === 'anim' ? 'Six! Roll again…' : game.legal.length === 0 && game.roll && game.phase === 'rolled' ? 'No move possible' : `You rolled ${game.roll ?? ''}`;
    else hint = `${current?.name}'s turn`;

    return (
      <div className="ludo">
        <div className="row-between ludo-top">
          <span className="small">Pot <b>{fmt(game.pot)}</b> · Prize <b className="accent">{fmt(game.prize)} {cfg.currency}</b></span>
          <button className="ghost sm" onClick={leave}>{game.phase === 'over' ? '← Tables' : 'Leave'}</button>
        </div>
        <div className="ludo-chips">{chip(0)}{chip(1)}</div>
        <LudoBoard tokens={tokens} stepMs={cfg.ludo.stepMs} tokensPerPlayer={cfg.ludo.tokens} onTokenClick={(i) => run(() => emit('ludo:move', { token: i }))} />
        <div className="ludo-chips">{chip(3)}{chip(2)}</div>
        <div className="ludo-controls">
          <Die value={dice.value} rolling={dice.rolling} big color={COLORS[dice.seat ?? game.turnSeat]}
            onClick={canRoll && !busy ? () => run(() => emit('ludo:roll')) : null} />
          <div className={`ludo-hint ${canRoll ? 'go' : ''}`}>{hint}</div>
        </div>

        {game.phase === 'over' && game.result && (
          <div className="overlay">
            <div className="result">
              <h2>{game.result.winnerSeat === game.mySeat ? `🏆 You won ${fmt(game.result.prize)} ${cfg.currency}!` : `${game.result.winnerName} won`}</h2>
              <p className="muted small">{game.result.how === 'all tokens home' ? 'All tokens home first.' : `Won because ${game.result.how}.`}</p>
              <button className="primary" onClick={() => { setGame(null); enter(); }}>Back to tables</button>
              <p className="mono small muted break">Dice seed: {game.seed}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ================= Waiting at a table =================
  if (me?.queue) {
    const q = me.queue;
    return (
      <div className="ludo">
        <div className="ludo-wait">
          <div className="spinner" />
          <h2>Waiting for players…</h2>
          <div className="big">{q.waiting}/{q.size}</div>
          <p className="muted">{q.size === 2 ? '1 vs 1' : '4 players'} · entry {fmt(q.stake)} {cfg.currency} · prize {fmt(Math.floor(q.stake * q.size * (1 - cfg.ludo.houseCut)))} {cfg.currency}</p>
          <p className="small muted">The game starts as soon as the table is full. We'll also message you on Telegram.</p>
          <button className="ghost" disabled={busy} onClick={() => run(async () => { await emit('ludo:leave'); setMe(null); })}>Leave table & refund</button>
        </div>
      </div>
    );
  }

  // ================= Table list =================
  const stakes = [...new Set(lobby.tables.map((t) => t.stake))];
  return (
    <div className="ludo">
      {lobby.paused && <div className="banner">⏸ Games are paused for maintenance.</div>}
      <p className="muted small">
        Race your {cfg.ludo.tokens} tokens home before your opponents. Roll a 6 to leave base, land on others to send them back.
        Winner takes the pot ({Math.round((1 - cfg.ludo.houseCut) * 100)}%). {cfg.ludo.turnSec}s per turn.
        {lobby.playing ? ` · ${lobby.playing} playing now` : ''}
      </p>
      <div className="ludo-tables">
        {stakes.map((stake) => (
          <div key={stake} className="ludo-stake">
            <div className="ls-amt">{fmt(stake)} <small>{cfg.currency}</small></div>
            {[2, 4].map((size) => {
              const t = lobby.tables.find((x) => x.stake === stake && x.size === size);
              return (
                <button key={size} className="ludo-table" disabled={busy || lobby.paused}
                  onClick={() => run(async () => {
                    if (balance < stake) throw new Error('Balance too low — deposit in Wallet.');
                    const r = await emit('ludo:join', { stake, size }); setMe(r.me); haptic('medium');
                  })}>
                  <div className="lt-size">{size === 2 ? '1 vs 1' : '4 players'}</div>
                  <div className="lt-prize">🏆 {fmt(t.prize)}</div>
                  <div className="lt-wait">{t.waiting ? `${t.waiting}/${size} waiting` : 'Join'}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="muted small center-text">Dice are rolled on the server and can be verified with the seed shown after each game.</p>
    </div>
  );
}
