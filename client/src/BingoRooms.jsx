import React from 'react';
import { useCountdown } from './hooks.js';
import { fmt } from '../../shared/money.js';
import { t, useLang } from './i18n.js';

function RoomCard({ r, cfg, onEnter }) {
  useLang();
  const secs = useCountdown(r.countdownEndsAt);
  return (
    <button className={`room-card ${r.state}`} onClick={() => onEnter(r.stake)}>
      <div className="stake">{fmt(r.stake)} <small>{cfg.currency}</small></div>
      <div className="room-meta">
        <span className={`pill ${r.state}`}>{r.state === 'countdown' ? t('startsIn', { n: secs }) : t(`r_${r.state}`)}</span>
        <span>👥 {r.players}</span>
        <span>🏆 {fmt(r.prize)} {cfg.currency}</span>
      </div>
      <div className="join">{r.state === 'playing' ? t('watch') : t('join')} →</div>
    </button>
  );
}

export default function BingoRooms({ rooms, cfg, onEnter }) {
  useLang();
  return (
    <div className="lobby">
      {rooms[0]?.paused && <div className="banner">⏸ {t('paused')}</div>}
      <h2>{t('bingoRooms')}</h2>
      <p className="muted small">{t('bingoIntro')}</p>
      <div className="room-list">
        {rooms.map((r) => <RoomCard key={r.stake} r={r} cfg={cfg} onEnter={onEnter} />)}
      </div>
    </div>
  );
}
