import React, { useCallback, useEffect, useRef, useState } from 'react';
import { socket, emit, haptic, toast, confirmBox, takeJoin } from './api.js';
import { fmt } from '../../shared/money.js';
import { SocialBar, InviteBox } from './Social.jsx';
import { sfx } from './sound.js';
import { t, useLang, trServer } from './i18n.js';
import { Person, Cop } from './HuntFigures.jsx';

const SEAT_COLOR = ['#f3c14b', '#4fb3ff', '#35d07f', '#ff6ad5'];
const CENTER = 4;
// where a token sits inside its box, so up to 4 players sharing a box don't cover each other
const SLOT = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const cellXY = (i) => [(i % 3) * 33.333 + 16.667, Math.floor(i / 3) * 33.333 + 16.667];

async function sha256(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function Board({ game, view, onPick, hop }) {
  const myPos = game.me >= 0 ? game.players[game.me].pos : null;
  return (
    <div className={`hunt-board ${hop ? 'hop' : ''}`}>
      {Array.from({ length: 9 }, (_, i) => {
        const legal = game.legal.includes(i);
        const chosen = game.myChoice === i;
        return (
          <button key={i} className={`hunt-cell ${legal ? 'legal' : ''} ${chosen ? 'chosen' : ''} ${i === myPos && game.phase === 'move' ? 'here' : ''}`}
            disabled={!legal} onClick={() => onPick(i)} aria-label={`box ${i + 1}`} />
        );
      })}
      {/* hunter */}
      {(() => {
        const [x, y] = cellXY(view.hunter);
        return <div className={`hunt-cop ${view.strike ? 'strike' : ''}`} style={{ left: `${x}%`, top: `${y}%` }}><Cop /></div>;
      })()}
      {/* players */}
      {game.players.map((p) => {
        const pos = view.pos[p.seat] ?? p.pos;
        const [x, y] = cellXY(pos);
        const [sx, sy] = SLOT[p.seat];
        const caught = view.caught.includes(p.seat);
        if (p.out && !caught) return null;
        return (
          <div key={p.seat} className={`hunt-token ${caught ? 'caught' : ''} ${p.seat === game.me ? 'me' : ''}`}
            style={{ left: `calc(${x}% + ${sx * 10}%)`, top: `calc(${y}% + ${sy * 7}%)`, zIndex: 2 + (sy > 0 ? 1 : 0) }}>
            <Person color={SEAT_COLOR[p.seat]} label={p.bot ? '' : (p.name || '?').slice(0, 1)} />
          </div>
        );
      })}
      {game.me >= 0 && game.myChoice != null && game.phase === 'move' && (() => {
        const [x, y] = cellXY(game.myChoice);
        const [sx, sy] = SLOT[game.me];
        return <div className="hunt-ghost" style={{ left: `calc(${x}% + ${sx * 10}%)`, top: `calc(${y}% + ${sy * 8}% + 6%)`, borderColor: SEAT_COLOR[game.me] }} />;
      })()}
    </div>
  );
}

export default function Hunt({ cfg, balance }) {
  useLang();
  const [lobby, setLobby] = useState(null);
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inviteMode, setInviteMode] = useState(false);
  const [view, setView] = useState({ pos: {}, hunter: CENTER, caught: [], strike: false });
  const [count, setCount] = useState(null);
  const [hop, setHop] = useState(false);
  const [fair, setFair] = useState(null);
  const gameRef = useRef(null);
  gameRef.current = game;
  const animating = useRef(false);

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { haptic('error'); toast(e.message); } finally { setBusy(false); }
  };
  const syncView = (st) => { if (!animating.current && st) setView({ pos: Object.fromEntries(st.players.map((p) => [p.seat, p.pos])), hunter: st.hunter, caught: [], strike: false }); };
  const enter = useCallback(() => emit('hunt:enter').then((r) => {
    setLobby(r.lobby); setMe(r.me); setGame(r.game); syncView(r.game);
    const code = !r.me && takeJoin('hunt');
    if (code) emit('hunt:join', { code }).then((j) => { setMe(j.me); haptic('success'); }).catch((e) => toast(e.message));
  }).catch((e) => toast(e.message)), []);

  useEffect(() => {
    enter();
    const onMe = (m) => { setMe(m); if (m?.game && gameRef.current?.id !== m.game) { haptic('success'); enter(); } };
    const onState = (st) => {
      setGame(st);
      syncView(st);
      if (st.phase === 'move') setFair(null);
      if (st.phase === 'over' && st.result && !gameRef.current?.result) sfx(st.result.winners.includes(st.me) ? 'win' : 'lose');
    };
    const onPicked = ({ seats }) => setGame((g) => (g ? { ...g, players: g.players.map((p) => ({ ...p, chose: seats.includes(p.seat) })) } : g));
    const onReveal = async (rv) => {
      animating.current = true;
      const pos = { ...Object.fromEntries((gameRef.current?.players || []).map((p) => [p.seat, p.pos])) };
      for (const m of rv.moves) pos[m.seat] = m.to;
      setView({ pos, hunter: rv.hunter.to, caught: rv.caught, strike: rv.caught.length > 0 });
      setHop(true); setTimeout(() => setHop(false), 700);
      if (rv.caught.length) { haptic('heavy'); sfx('crash'); } else sfx('ball');
      if (rv.caught.includes(gameRef.current?.me)) haptic('error');
      setTimeout(() => {
        animating.current = false;
        setView((v) => ({ ...v, hunter: rv.hunterNext, strike: false }));
      }, rv.caught.length ? 1300 : 700);
      // fairness: the hunter's box matches the hash shown before anyone picked
      const h = await sha256(`${rv.game}:${rv.move}:${rv.hunter.to}:${rv.salt}`);
      setFair(h === rv.commit);
    };
    const onEvent = ({ name, reason }) => toast(`${name} ${trServer(reason)}`);
    socket.on('connect', enter);
    socket.on('hunt:lobby', setLobby);
    socket.on('hunt:me', onMe);
    socket.on('hunt:state', onState);
    socket.on('hunt:picked', onPicked);
    socket.on('hunt:reveal', onReveal);
    socket.on('hunt:event', onEvent);
    return () => {
      socket.off('connect', enter);
      socket.off('hunt:lobby', setLobby);
      socket.off('hunt:me', onMe);
      socket.off('hunt:state', onState);
      socket.off('hunt:picked', onPicked);
      socket.off('hunt:reveal', onReveal);
      socket.off('hunt:event', onEvent);
      emit('hunt:exit').catch(() => {});
    };
  }, []);

  // Count 1… 2… 3… then everyone (cop included) jumps at the same moment
  const lastBeat = useRef(0);
  useEffect(() => {
    if (game?.phase !== 'move' || game.deadlineLeftMs == null) { setCount(null); return; }
    const sec = game.moveSec || 3;
    const end = Date.now() + game.deadlineLeftMs;
    lastBeat.current = 0;
    const tick = () => {
      const left = Math.ceil((end - Date.now() - 400) / 1000);       // server grace is 400 ms
      const n = Math.min(sec + 1, Math.max(1, sec - left + 1));     // 1..sec, then sec+1 = "jump!"
      setCount(n);
      if (n !== lastBeat.current) {
        lastBeat.current = n;
        if (n <= sec) { sfx(n === sec ? 'pick' : 'turn'); haptic(n === sec ? 'medium' : 'light'); }
      }
    };
    tick();
    const iv = setInterval(tick, 80);
    return () => clearInterval(iv);
  }, [game?.moveNo, game?.phase]);

  const pick = (box) => { haptic('light'); sfx('tap'); setGame((g) => ({ ...g, myChoice: box })); emit('hunt:choose', { box }).catch((e) => toast(e.message)); };

  if (!lobby) return <div className="center muted">{t('loading')}</div>;

  // ================= Game =================
  if (game) {
    const mine = game.players[game.me];
    const alive = game.players.filter((p) => !p.out).length;
    let hint = '';
    if (game.phase === 'starting') hint = t('huntStarting');
    else if (game.phase === 'move' && mine && !mine.out) hint = game.myChoice != null ? t('huntPicked') : t('huntPick');
    else if (mine?.out && game.phase !== 'over') hint = t('huntYouOut');
    else if (game.phase === 'reveal') hint = view.caught.length ? t('huntCaught', { names: view.caught.map((s) => game.players[s].name).join(', ') }) : t('huntMissed');
    const leave = async () => {
      if (game.phase !== 'over' && mine && !mine.out && !game.practice && !(await confirmBox(t('confirmForfeit', { amount: `${fmt(game.stake)} ${cfg.currency}` })))) return;
      if (game.phase !== 'over') await emit('hunt:leave').catch(() => {});
      setGame(null); enter();
    };
    return (
      <div className="hunt">
        <div className="row-between ludo-top">
          {game.practice ? <span className="practice-badge">{t('practiceBadge')}</span>
            : <span className="small">{t('prize')} <b className="accent score">{fmt(game.prize)} {cfg.currency}</b></span>}
          <span className="small muted">{t('huntMove', { n: game.moveNo || 1 })} · {t('huntLeft', { n: alive })}</span>
          <button className="ghost sm" onClick={leave}>{game.phase === 'over' ? t('tables') : t('leave')}</button>
        </div>
        <div className="hunt-players">
          {game.players.map((p) => (
            <div key={p.seat} className={`hunt-chip ${p.out ? 'out' : ''} ${p.seat === game.me ? 'me' : ''}`}>
              <span className="dot" style={{ background: SEAT_COLOR[p.seat] }} />
              <span className="nm">{p.name}{p.seat === game.me ? ` (${t('you')})` : ''}</span>
              <span className="st">{p.out ? '✖' : game.phase === 'move' && p.chose ? '✓' : ''}</span>
            </div>
          ))}
        </div>
        <div className={`hunt-count ${count > (game.moveSec || 3) || hop ? 'zero' : ''}`}>
          <span key={`${game.moveNo}-${hop ? 'j' : count}`}>{hop || (game.phase === 'move' && count > (game.moveSec || 3)) ? t('huntJump') : game.phase === 'move' && count ? count : ''}</span>
        </div>
        <Board game={game} view={view} onPick={pick} hop={hop} />
        <div className="hunt-hint">{hint}</div>
        <div className="small muted center-text">
          {game.phase === 'move' && game.commit ? `🔒 ${t('huntSealed')} ${game.commit.slice(0, 10)}…` : fair === true ? `✅ ${t('huntFair')}` : fair === false ? '⚠️' : ''}
        </div>

        {game.phase === 'over' && game.result && (
          <div className="overlay">
            <div className="result">
              <h2>{game.result.winners.includes(game.me)
                ? (game.practice ? t('practiceWon') : game.result.split ? t('huntSplitWon', { amount: `${fmt(game.result.each)} ${cfg.currency}` }) : t('youWonPrize', { amount: `${fmt(game.result.each)} ${cfg.currency}` }))
                : (game.practice ? t('practiceLost') : t('nameWon', { name: game.result.names.join(' & ') }))}</h2>
              <p className="muted small">{t('huntAfter', { n: game.moveNo })}</p>
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
          <h2>{q.code ? t('privateTable') : t('waitingPlayers')}</h2>
          <div className="big score">{q.waiting}/{q.size}</div>
          <InviteBox prefix="hunt" code={q.code} cfg={cfg} />
          <p className="muted">{t('poolEntryInfo', { stake: `${fmt(q.stake)} ${cfg.currency}`, prize: `${fmt(Math.floor(q.stake * q.size * (1 - cfg.hunt.houseCut)))} ${cfg.currency}` })}</p>
          <button className="ghost" disabled={busy} onClick={() => run(async () => { await emit('hunt:leave'); setMe(null); })}>{t('leaveTable')}</button>
        </div>
      </div>
    );
  }

  // ================= Tables =================
  const h = cfg.hunt;
  return (
    <div className="ludo">
      {lobby.paused && <div className="banner">⏸ {t('paused')}</div>}
      <p className="muted small">{t('huntIntro', { sec: h.moveSec, pct: Math.round((1 - h.houseCut) * 100) })}{lobby.playing ? ` · ${t('playingNow', { n: lobby.playing })}` : ''}</p>
      <SocialBar busy={busy} inviteMode={inviteMode} setInviteMode={setInviteMode}
        onPractice={() => run(async () => { const r = await emit('hunt:practice'); setMe(r.me); haptic('medium'); })} />
      <div className="pool-tables">
        {lobby.tables.map((tb) => (
          <button key={tb.stake} className="ludo-table pool-table" disabled={busy || lobby.paused} onClick={() => run(async () => {
            if (balance < tb.stake) throw new Error(t('balanceLow'));
            const r = await emit('hunt:join', { stake: tb.stake, invite: inviteMode }); setMe(r.me); setInviteMode(false); haptic('medium');
          })}>
            <div className="pt-amt">{fmt(tb.stake)} <small>{cfg.currency}</small></div>
            <div className="lt-prize">{t('winX', { amount: fmt(tb.prize) })}</div>
            <div className="lt-wait">{tb.waiting ? t('waitingN', { n: tb.waiting, size: tb.size }) : t('join')}</div>
          </button>
        ))}
      </div>
      <p className="muted small center-text">{t('huntFairNote')}</p>
    </div>
  );
}
