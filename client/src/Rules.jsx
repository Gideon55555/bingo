import React from 'react';

export default function Rules({ cfg, onClose }) {
  const cut = Math.round(cfg.houseCut * 100);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="result rules" onClick={(e) => e.stopPropagation()}>
        <h2>How to play</h2>
        <ol>
          <li>Choose a room. The room amount is your entry fee.</li>
          <li>Pick a card number. You can switch cards for free, or leave for a full refund, until the game starts.</li>
          <li>The game starts {cfg.minPlayers > 1 ? `once ${cfg.minPlayers} players have joined and ` : ''}after a short countdown.</li>
          <li>A number is called every {Math.round(cfg.callIntervalMs / 100) / 10} seconds. Matching numbers are marked on your card.</li>
          <li>Complete a <b>row</b>, <b>column</b>, <b>diagonal</b>, or the <b>four corners</b>, then press <b>BINGO!</b></li>
        </ol>

        <h3>Rules</h3>
        <ul>
          <li>The first valid BINGO wins the prize: all entry fees minus a {cut}% service fee.</li>
          <li>If several players complete a line on the same number, they share the prize equally.</li>
          <li>Pressing BINGO without a complete line <b>disqualifies you</b> from that round. Your entry fee is not returned.</li>
          <li>If you lose connection, the game continues without you. If nobody claims before all 75 numbers are called, everyone holding a winning line shares the prize.</li>
          <li>If a game is interrupted by a technical problem on our side, every entry fee for that game is refunded automatically.</li>
          <li>Deposits are credited after we confirm the payment. Withdrawals are sent manually, usually within 24 hours.</li>
        </ul>

        <div className="age">🔞 You must be {cfg.minAge} or older to play. Please play responsibly. Only play with money you can afford to lose.</div>
        {cfg.supportContact && <p>Need help? Contact <b>{cfg.supportContact}</b></p>}
        <button className="primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
