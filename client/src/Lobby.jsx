import React from 'react';
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
      <div className="stake">{r.stake} <small>{cfg.currency}</small></div>
      <div className="room-meta">
        <span className={`pill ${r.state}`}>
          {r.state === 'countdown' ? `Starts in ${secs}s` : STATUS[r.state]}
        </span>
        <span>👥 {r.players}</span>
        <span>🏆 {r.prize} {cfg.currency}</span>
      </div>
      <div className="join">{r.state === 'playing' ? 'Watch' : 'Join'} →</div>
    </button>
  );
}

export default function Lobby({ rooms, cfg, onEnter }) {
  return (
    <div className="lobby">
      <h2>Choose a room</h2>
      <p className="muted small">
        Pick a card, wait for the numbers, and press BINGO when you complete a row, column,
        diagonal, or the four corners. The winner takes the prize.
      </p>
      {rooms[0]?.paused && <div className="banner">⏸ Games are paused for maintenance. Please check back soon.</div>}
      <div className="room-list">
        {rooms.map((r) => <RoomCard key={r.stake} r={r} cfg={cfg} onEnter={onEnter} />)}
      </div>
    </div>
  );
}
