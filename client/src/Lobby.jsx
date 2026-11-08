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

export default function Lobby({ rooms, cfg, onEnter, crash, onRocket, keno, onKeno, ludo, onLudo, pool, onPool }) {
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
            <div className="rc-title">✈️ {cfg.crash?.name || 'Sky High'}</div>
            <div className="small">Cash out before the plane flies away</div>
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
      {pool && (
        <button className="rocket-card pool-card" onClick={onPool}>
          <div className="rc-left">
            <div className="rc-title">🎱 8-Ball Pool</div>
            <div className="small">1 vs 1 skill game · winner takes the pot</div>
            <div className="rc-chips">
              {[1, 10, 3, 14, 8].map((n) => <span key={n} className="mini-pool" style={{ background: n >= 9 ? `linear-gradient(#f8f8f2 25%, ${['', '#f5c400', '#1d4ed8', '#dc2626', '#6d28d9', '#ea580c', '#15803d', '#7f1d1d', '#111'][n - 8] || '#111'} 25% 75%, #f8f8f2 75%)` : ['', '#f5c400', '#1d4ed8', '#dc2626', '#6d28d9', '#ea580c', '#15803d', '#7f1d1d', '#111'][n] }}><b>{n}</b></span>)}
            </div>
          </div>
          <div className="rc-right">
            <span className="pill playing">{pool.playing ? `${pool.playing} playing` : 'Skill'}</span>
            <div className="join">Play →</div>
          </div>
        </button>
      )}
      {ludo && (
        <button className="rocket-card ludo-card" onClick={onLudo}>
          <div className="rc-left">
            <div className="rc-title">🎲 Ludo</div>
            <div className="small">Play 1-vs-1 or 4 players · winner takes the pot</div>
            <div className="rc-chips">
              {['#ef4444', '#22c55e', '#facc15', '#3b82f6'].map((c) => <span key={c} className="ludo-dot" style={{ background: c }} />)}
            </div>
          </div>
          <div className="rc-right">
            <span className="pill playing">{ludo.playing ? `${ludo.playing} playing` : 'PvP'}</span>
            <div className="join">Play →</div>
          </div>
        </button>
      )}
      {keno && (
        <button className="rocket-card keno-card" onClick={onKeno}>
          <div className="rc-left">
            <div className="rc-title">🎯 Keno</div>
            <div className="small">Pick up to 10 numbers · draws every minute</div>
            <div className="rc-chips">
              {keno.last.map((n, i) => <span key={i} className="kn-chip">{n}</span>)}
            </div>
          </div>
          <div className="rc-right">
            <span className={`pill ${keno.phase === 'drawing' ? 'playing' : keno.phase === 'betting' ? 'countdown' : keno.phase}`}>
              {keno.phase === 'drawing' ? 'DRAWING' : keno.phase === 'betting' ? 'Open' : keno.phase}
            </span>
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
