import React from 'react';
import { getCard } from '../../shared/cards.js';

/**
 * Renders a 5x5 bingo card.
 * - called: Set of called numbers (highlights hint)
 * - marked: Set of numbers the player tapped
 * - winLine: array of [r,c] to highlight
 */
export default function Card({ id, called, marked, onToggle, winLine, size = 'lg' }) {
  const grid = getCard(id);
  const winSet = new Set((winLine || []).map(([r, c]) => `${r}-${c}`));
  return (
    <div className={`card card-${size}`}>
      {'BINGO'.split('').map((l) => <div key={l} className={`hdr hdr-${l}`}>{l}</div>)}
      {grid.map((row, r) =>
        row.map((n, c) => {
          const free = n === 0;
          const isCalled = free || called?.has(n);
          const isMarked = free || marked?.has(n);
          const cls = [
            'cell',
            free && 'free',
            isMarked && 'marked',
            isCalled && !isMarked && 'called',
            winSet.has(`${r}-${c}`) && 'win',
          ].filter(Boolean).join(' ');
          return (
            <button key={`${r}-${c}`} className={cls} disabled={!onToggle || free} onClick={() => onToggle?.(n)}>
              {free ? '★' : n}
            </button>
          );
        }))}
      <div className="card-id">Card #{id}</div>
    </div>
  );
}
