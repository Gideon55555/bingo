import React, { memo } from 'react';
import { TRACK, HOME_COL, START, STARS, COLORS, COLOR_HEX, BASE_SPOTS, coordOf } from '../../shared/ludo.js';

const LIGHT = { red: '#fecaca', green: '#bbf7d0', yellow: '#fef08a', blue: '#bfdbfe' };
const BASE_ORIGIN = [[0, 0], [9, 0], [9, 9], [0, 9]];

/** Static board (drawn once). */
const BoardBg = memo(function BoardBg({ spots }) {
  const starSet = new Set(STARS);
  const startColor = Object.fromEntries(START.map((s, seat) => [s, COLORS[seat]]));
  return (
    <g>
      <rect x="0" y="0" width="15" height="15" rx="0.5" fill="#ffffff" />
      {/* bases */}
      {BASE_ORIGIN.map(([x, y], seat) => {
        const c = COLORS[seat];
        return (
          <g key={seat}>
            <rect x={x} y={y} width="6" height="6" fill={COLOR_HEX[c]} />
            <rect x={x + 1} y={y + 1} width="4" height="4" rx="0.5" fill="#fff" />
            {BASE_SPOTS[seat].slice(0, spots).map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="0.48" fill={LIGHT[c]} stroke={COLOR_HEX[c]} strokeWidth="0.06" />)}
          </g>
        );
      })}
      {/* track */}
      {TRACK.map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="1" height="1" fill={startColor[i] ? COLOR_HEX[startColor[i]] : '#fff'} stroke="#cbd5e1" strokeWidth="0.04" />
          {starSet.has(i) && <text x={x + 0.5} y={y + 0.72} fontSize="0.7" textAnchor="middle" fill="#94a3b8">★</text>}
          {startColor[i] && <text x={x + 0.5} y={y + 0.72} fontSize="0.6" textAnchor="middle" fill="#fff">➜</text>}
        </g>
      ))}
      {/* home columns */}
      {HOME_COL.map((col, seat) => col.map(([x, y], i) => (
        <rect key={`${seat}-${i}`} x={x} y={y} width="1" height="1" fill={COLOR_HEX[COLORS[seat]]} stroke="#cbd5e1" strokeWidth="0.04" />
      )))}
      {/* centre */}
      <polygon points="6,6 6,9 7.5,7.5" fill={COLOR_HEX.red} />
      <polygon points="6,6 9,6 7.5,7.5" fill={COLOR_HEX.green} />
      <polygon points="9,6 9,9 7.5,7.5" fill={COLOR_HEX.yellow} />
      <polygon points="6,9 9,9 7.5,7.5" fill={COLOR_HEX.blue} />
    </g>
  );
});

/**
 * tokens: [{ key, seat, index, rel, movable }]
 * Each token is positioned with a CSS transform so moves glide smoothly from square to square.
 */
export default function LudoBoard({ tokens, onTokenClick, stepMs, tokensPerPlayer = 4 }) {
  // Spread out tokens that share a square
  const groups = new Map();
  for (const t of tokens) {
    const [x, y] = coordOf(t.seat, t.rel, t.index);
    const k = `${x.toFixed(2)},${y.toFixed(2)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ ...t, x, y });
  }
  const placed = [];
  for (const g of groups.values()) {
    g.forEach((t, i) => {
      const n = g.length;
      const off = n > 1 && t.rel >= 0 ? 0.22 : 0;
      const ang = (i / n) * Math.PI * 2;
      placed.push({ ...t, x: t.x + Math.cos(ang) * off, y: t.y + Math.sin(ang) * off, small: n > 1 && t.rel >= 0 });
    });
  }
  // movable tokens drawn last so they're on top and easy to tap
  placed.sort((a, b) => Number(a.movable) - Number(b.movable));

  return (
    <svg className="ludo-board" viewBox="0 0 15 15">
      <BoardBg spots={tokensPerPlayer} />
      {placed.map((t) => {
        const c = COLOR_HEX[COLORS[t.seat]];
        const r = t.small ? 0.3 : 0.38;
        return (
          <g
            key={t.key}
            className={`ludo-token ${t.movable ? 'movable' : ''}`}
            style={{ transform: `translate(${t.x}px, ${t.y}px)`, transition: `transform ${t.slow ? 450 : stepMs}ms ${t.slow ? 'ease-in-out' : 'linear'}` }}
            onClick={t.movable ? () => onTokenClick(t.index) : undefined}
          >
            {t.movable && <circle r="0.62" className="ludo-pulse" fill="none" stroke={c} strokeWidth="0.1" />}
            {t.movable && <circle r="0.75" fill="transparent" />}
            <ellipse cx="0" cy={r * 0.75} rx={r * 0.9} ry={r * 0.35} fill="rgba(0,0,0,.25)" />
            <circle r={r} fill={c} stroke="#fff" strokeWidth="0.09" />
            <circle r={r * 0.42} fill="rgba(255,255,255,.55)" />
          </g>
        );
      })}
    </svg>
  );
}
