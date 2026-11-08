import React, { useEffect, useMemo, useState } from 'react';
import { socket, emit, haptic, toast, withEndsAt } from './api.js';
import { useCountdown } from './hooks.js';
import { letterFor } from '../../shared/cards.js';
import Card from './Card.jsx';
import { fmt } from '../../shared/money.js';
import { t, useLang } from './i18n.js';

const loadAutoMark = () => {
  try { return localStorage.getItem('automark') !== '0'; } catch { return true; }
};

export default function Room({ stake, cfg, user, balance, onExit }) {
  useLang();
  const [room, setRoom] = useState(null);
  const [preview, setPreview] = useState(null);
  const [marked, setMarked] = useState(new Set());
  const [autoMark, setAutoMark] = useState(loadAutoMark);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const enter = () =>
      emit('room:enter', { stake })
        .then((res) => alive && setRoom(withEndsAt(res.room)))
        .catch((e) => toast(e.message));
    enter();
    socket.on('connect', enter); // re-enter after reconnect

    const onRoom = (r) => r.stake === stake && setRoom(withEndsAt(r));
    const onCall = ({ stake: s, number }) => {
      if (s !== stake) return;
      haptic('light');
      setRoom((prev) => (prev ? { ...prev, called: [...prev.called, number] } : prev));
    };
    socket.on('room', onRoom);
    socket.on('call', onCall);
    return () => {
      alive = false;
      socket.off('connect', enter);
      socket.off('room', onRoom);
      socket.off('call', onCall);
      emit('room:exit', { stake }).catch(() => {});
    };
  }, [stake]);

  // New round → clear marks and preview
  useEffect(() => {
    if (room?.state === 'waiting') { setMarked(new Set()); setPreview(null); }
  }, [room?.state]);

  // Celebrate / commiserate on results
  useEffect(() => {
    if (room?.state !== 'finished' || !room.result) return;
    const won = room.result.winners.some((w) => w.userId === String(user.id));
    haptic(won ? 'success' : 'error');
  }, [room?.state]);

  const called = useMemo(() => new Set(room?.called || []), [room?.called]);
  const effectiveMarks = useMemo(
    () => (autoMark ? new Set([...marked, ...called]) : marked),
    [autoMark, marked, called],
  );
  const secs = useCountdown(room?.countdownEndsAt);

  if (!room) return <div className="center muted">{t('loading')}</div>;

  const inGame = room.myCard !== null;
  const lastCall = room.called[room.called.length - 1];

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { haptic('error'); toast(e.message); } finally { setBusy(false); }
  };

  const pick = (card) => run(async () => {
    await emit('card:pick', { stake, card });
    haptic('medium');
    setPreview(null);
  });
  const unpick = () => run(() => emit('card:unpick', { stake }));
  const claim = () => run(async () => {
    const res = await emit('bingo', { stake });
    if (res.valid === false) { haptic('error'); toast(res.message); }
  });
  const toggle = (n) => {
    haptic('light');
    setMarked((prev) => {
      const s = new Set(prev);
      s.has(n) ? s.delete(n) : s.add(n);
      return s;
    });
  };
  const toggleAuto = () => {
    setAutoMark((v) => {
      try { localStorage.setItem('automark', v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  };

  // ------------------------------------------------------------------
  const header = (
    <div className="room-head">
      <div>
        <div className="muted small">{t('room')}</div>
        <div className="big">{fmt(stake)} {cfg.currency}</div>
      </div>
      <div>
        <div className="muted small">{t('players')}</div>
        <div className="big">{room.players}</div>
      </div>
      <div>
        <div className="muted small">{t('prize')}</div>
        <div className="big accent">{fmt(room.prize)}</div>
      </div>
    </div>
  );

  // ---------- Picking phase ----------
  if (room.state === 'waiting' || room.state === 'countdown') {
    const taken = new Set(room.takenCards);
    const showing = preview ?? room.myCard;
    return (
      <div className="room">
        {header}
        <div className={`status-bar ${room.state}`}>
          {room.state === 'countdown'
            ? <b>{t('gameStartsIn', { n: secs })}</b>
            : <>{t('waitingMore', { n: Math.max(0, cfg.minPlayers - room.players) })}</>}
        </div>

        {showing && (
          <div className="preview">
            <Card id={showing} size="md" />
            <div className="preview-actions">
              {preview && preview !== room.myCard ? (
                <button className="primary" disabled={busy} onClick={() => pick(preview)}>
                  {inGame ? t('switchCard', { n: preview }) : t('playCard', { n: preview, amount: `${fmt(stake)} ${cfg.currency}` })}
                </button>
              ) : (
                <div className="ok">{t('inWithCard', { n: room.myCard })}</div>
              )}
              {inGame && <button className="ghost" disabled={busy} onClick={unpick}>{t('leaveRefund')}</button>}
              {!inGame && balance < stake && <div className="warn small">{t('balanceLow')}</div>}
            </div>
          </div>
        )}

        <h3>{inGame ? t('changeCard') : t('pickCard')}</h3>
        <div className="picker">
          {Array.from({ length: cfg.cardCount }, (_, i) => i + 1).map((n) => {
            const mine = n === room.myCard;
            const isTaken = taken.has(n) && !mine;
            return (
              <button
                key={n}
                className={`pick ${mine ? 'mine' : ''} ${isTaken ? 'taken' : ''} ${preview === n ? 'sel' : ''}`}
                disabled={isTaken}
                onClick={() => { haptic('light'); setPreview(n); }}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- Playing / finished ----------
  const result = room.state === 'finished' ? room.result : null;
  const myWin = result?.winners.find((w) => w.userId === String(user.id));

  return (
    <div className="room">
      {header}

      <div className="ball-row">
        <div className={`ball ball-${lastCall ? letterFor(lastCall) : 'none'}`} key={lastCall}>
          {lastCall ? <><small>{letterFor(lastCall)}</small>{lastCall}</> : '—'}
        </div>
        <div className="recent">
          {room.called.slice(-6, -1).reverse().map((n) => (
            <span key={n} className={`mini-ball ball-${letterFor(n)}`}>{n}</span>
          ))}
          <div className="muted small">{t('calledOf', { n: room.called.length })}</div>
        </div>
      </div>

      {inGame ? (
        <>
          {room.disqualified && <div className="banner">{t('falseBingo')}</div>}
          <Card
            id={room.myCard}
            called={called}
            marked={effectiveMarks}
            onToggle={room.state === 'playing' && !autoMark ? toggle : null}
            winLine={myWin?.line}
          />
          <div className="controls">
            <label className="toggle">
              <input type="checkbox" checked={autoMark} onChange={toggleAuto} /> {t('autoMark')}
            </label>
            <button
              className="bingo-btn"
              disabled={busy || room.state !== 'playing' || room.disqualified}
              onClick={claim}
            >
              {t('bingoBtn')}
            </button>
          </div>
        </>
      ) : (
        <div className="banner info">{t('watching')}</div>
      )}

      <CalledBoard called={called} />

      {result && (
        <div className="overlay">
          <div className="result">
            {myWin ? <h2>{t('youWon', { amount: `${fmt(result.amountEach)} ${cfg.currency}` })}</h2>
              : result.winners.length ? <h2>{t('gameOver')}</h2> : <h2>{t('noWinner')}</h2>}
            {result.winners.map((w) => (
              <div key={w.userId} className="winner">
                <div>🏆 <b>{w.name}</b> — card #{w.card} — {fmt(result.amountEach)} {cfg.currency}</div>
                <Card id={w.card} called={called} marked={called} winLine={w.line} size="sm" />
              </div>
            ))}
            <p className="muted small">{t('nextRoundSoon')}</p>
            <button className="ghost" onClick={onExit}>{t('backToRooms')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalledBoard({ called }) {
  return (
    <div className="board">
      {'BINGO'.split('').map((l, i) => (
        <div key={l} className="board-row">
          <span className={`board-letter ball-${l}`}>{l}</span>
          {Array.from({ length: 15 }, (_, j) => i * 15 + j + 1).map((n) => (
            <span key={n} className={`board-n ${called.has(n) ? 'on' : ''}`}>{n}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
