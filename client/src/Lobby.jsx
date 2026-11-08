import React, { useState } from 'react';
import Rules from './Rules.jsx';
import { fmt } from '../../shared/money.js';
import { useCountdown } from './hooks.js';

const STATUS = {
  waiting: 'Waiting for players',
  countdown: 'Starting soon',
  playing: 'In progress',
  finished: 'Finished',
};

function RoomCard({ r, cfg, onEnter }) {
  const secs = useCountdown(r.countdownEndsAt);
  return (
    <button className={`room-card ${r.state}`} onClick={() => onEnter(r.stake)}>
      <div className="stake">{fmt(r.stake)} <small>{cfg.currency}</small></div>
      <div className="room-meta">
        <span className={`pill ${r.state}`}>
          {r.state === 'countdown' ? `Starts in ${secs}s` : STATUS[r.state]}
        </span>
        <span>👥 {r.players}</span>
        <span>🏆 {fmt(r.prize)} {cfg.currency}</span>
      </div>
      <div className="join">{r.state === 'playing' ? 'Watch' : 'Join'} →</div>
    </button>
  );
}

const seenRules = () => { try { return localStorage.getItem('rules_seen') === '1'; } catch { return false; } };

export default function Lobby({ rooms, cfg, onEnter }) {
  const [showRules, setShowRules] = useState(() => !seenRules());
  const closeRules = () => {
    try { localStorage.setItem('rules_seen', '1'); } catch { /* ignore */ }
    setShowRules(false);
  };
  return (
    <div className="lobby">
      {showRules && <Rules cfg={cfg} onClose={closeRules} />}
      <div className="row-between">
        <h2>Choose a room</h2>
        <button className="ghost sm" onClick={() => setShowRules(true)}>📖 Rules</button>
      </div>
      <p className="muted small">
        Pick a card, wait for the numbers, and press BINGO when you complete a row, column,
        diagonal, or the four corners. The winner takes the prize.
      </p>
      {rooms[0]?.paused && <div className="banner">⏸ Games are paused for maintenance. Please check back soon.</div>}
      <div className="room-list">
        {rooms.map((r) => <RoomCard key={r.stake} r={r} cfg={cfg} onEnter={onEnter} />)}
      </div>
      <p className="muted small center-text">🔞 {cfg.minAge}+ only · Play responsibly{cfg.supportContact ? ` · Help: ${cfg.supportContact}` : ''}</p>
    </div>
  );
}
