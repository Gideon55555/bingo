import React, { useState } from 'react';
import Rules from './Rules.jsx';
import { fmt } from '../../shared/money.js';
import { fmtX } from '../../shared/crash.js';
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

export default function Lobby({ rooms, cfg, onEnter, crash, onRocket }) {
  const [showRules, setShowRules] = useState(() => !seenRules());
  const closeRules = () => {
    try { localStorage.setItem('rules_seen', '1'); } catch { /* ignore */ }
    setShowRules(false);
  };
  return (
    <div className="lobby">
      {showRules && <Rules cfg={cfg} onClose={closeRules} />}
      {crash && (
        <button className="rocket-card" onClick={onRocket}>
          <div className="rc-left">
            <div className="rc-title">🚀 Rocket</div>
            <div className="small">Cash out before it flies away</div>
            <div className="rc-chips">
              {crash.last.map((p, i) => <span key={i} className={`x-chip ${p < 200 ? 'x-low' : p < 1000 ? 'x-mid' : 'x-high'}`}>{fmtX(p)}</span>)}
            </div>
          </div>
          <div className="rc-right">
            <span className={`pill ${crash.phase === 'flying' ? 'playing' : crash.phase}`}>{crash.phase === 'flying' ? 'LIVE' : crash.phase === 'betting' ? 'Betting' : crash.phase}</span>
            <div className="join">Play →</div>
          </div>
        </button>
      )}
      <div className="row-between">
        <h2>🎱 Bingo rooms</h2>
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
