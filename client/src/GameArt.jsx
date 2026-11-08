import React from 'react';

// Original illustrations of each game, used on the home screen tiles. Pure SVG, so they
// stay sharp on every screen and add nothing to download.

const Ball = ({ x, y, r, color, n, stripe }) => (
  <g>
    <circle cx={x} cy={y + r * 0.12} r={r} fill="rgba(0,0,0,.3)" />
    {stripe ? (
      <>
        <circle cx={x} cy={y} r={r} fill="#f8f8f2" />
        <clipPath id={`c${n}${x}`}><circle cx={x} cy={y} r={r} /></clipPath>
        <rect x={x - r} y={y - r * 0.55} width={r * 2} height={r * 1.1} fill={color} clipPath={`url(#c${n}${x})`} />
      </>
    ) : <circle cx={x} cy={y} r={r} fill={color} />}
    <circle cx={x} cy={y} r={r * 0.46} fill="#fff" />
    <text x={x} y={y + r * 0.2} fontSize={r * 0.6} fontWeight="800" textAnchor="middle" fill="#111">{n}</text>
    <circle cx={x - r * 0.38} cy={y - r * 0.42} r={r * 0.22} fill="rgba(255,255,255,.55)" />
  </g>
);

export function AviatorArt() {
  return (
    <svg viewBox="0 0 100 100" className="game-art" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="av-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b0f2a" /><stop offset="1" stopColor="#24124a" /></linearGradient>
        <linearGradient id="av-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(255,90,60,.55)" /><stop offset="1" stopColor="rgba(255,90,60,0)" /></linearGradient>
        <filter id="av-glow"><feGaussianBlur stdDeviation="1.6" /></filter>
      </defs>
      <rect width="100" height="100" fill="url(#av-bg)" />
      {[[12, 14], [30, 8], [55, 20], [80, 10], [90, 30], [20, 40], [65, 6], [44, 34]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".8" fill="#fff" opacity=".6" />)}
      {[30, 50, 70].map((y) => <line key={y} x1="8" y1={y} x2="96" y2={y} stroke="rgba(255,255,255,.07)" />)}
      <path d="M8 88 Q 50 86 70 52 L70 92 L8 92 Z" fill="url(#av-fill)" />
      <path d="M8 88 Q 50 86 70 52" fill="none" stroke="#ff5a3c" strokeWidth="5" filter="url(#av-glow)" opacity=".7" />
      <path d="M8 88 Q 50 86 70 52" fill="none" stroke="#ff7a45" strokeWidth="3" strokeLinecap="round" />
      {/* jet */}
      <g transform="translate(74 46) rotate(-38) scale(.62)">
        <circle cx="-30" cy="1" r="9" fill="rgba(255,170,60,.7)" />
        <path d="M2 -2 L-10 -15 L-3 -15 L11 -2 Z" fill="#9aa8ff" />
        <path d="M-18 -3 L-29 -17 L-22 -17 L-10 -3 Z" fill="#5b6cff" />
        <path d="M32 1 Q28 -6 16 -6.5 L-24 -5 Q-31 -4 -31 1 Q-31 6 -24 6.5 L16 6.5 Q28 6 32 1 Z" fill="#fff" />
        <rect x="-22" y="1.5" width="38" height="2" fill="#ff8a1f" />
        <ellipse cx="22" cy="-1.5" rx="5" ry="2.6" fill="#2b3570" />
        <path d="M4 3 L-10 19 L-1 19 L14 3 Z" fill="#7383ff" />
      </g>
      <text x="34" y="44" fontSize="16" fontWeight="900" textAnchor="middle" fill="#fff">2.45x</text>
    </svg>
  );
}

export function BingoArt() {
  const cols = ['#4f7cff', '#ff4d8d', '#8b5cf6', '#22c55e', '#ff8a1f'];
  const marked = new Set([0, 6, 12, 18, 24, 3, 9]);
  return (
    <svg viewBox="0 0 100 100" className="game-art" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="bg-bingo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3b1d6e" /><stop offset="1" stopColor="#6b2fa3" /></linearGradient></defs>
      <rect width="100" height="100" fill="url(#bg-bingo)" />
      <g transform="translate(14 14) rotate(-6 36 36)">
        <rect x="0" y="0" width="64" height="72" rx="5" fill="#fff" />
        {'BINGO'.split('').map((l, i) => (
          <g key={l}><rect x={2 + i * 12} y="2" width="11" height="11" rx="2" fill={cols[i]} />
            <text x={7.5 + i * 12} y="10.6" fontSize="8" fontWeight="900" textAnchor="middle" fill="#fff">{l}</text></g>
        ))}
        {Array.from({ length: 25 }, (_, k) => {
          const c = k % 5, r = Math.floor(k / 5);
          const x = 7.5 + c * 12, y = 20 + r * 11.5;
          return (
            <g key={k}>
              <text x={x} y={y + 2.2} fontSize="5.5" fontWeight="700" textAnchor="middle" fill="#334">{k === 12 ? '★' : [3, 18, 33, 52, 67][c] + r * 2}</text>
              {marked.has(k) && <circle cx={x} cy={y} r="4.6" fill="rgba(255,77,141,.55)" />}
            </g>
          );
        })}
      </g>
      <Ball x={78} y={78} r={13} color="#ff8a1f" n={67} />
    </svg>
  );
}

export function KenoArt() {
  const hits = new Set([2, 7, 9, 14, 17]);
  return (
    <svg viewBox="0 0 100 100" className="game-art" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="bg-keno" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0f3b3a" /><stop offset="1" stopColor="#12233f" /></linearGradient>
        <radialGradient id="kb" cx=".35" cy=".3"><stop offset="0" stopColor="#fff" /><stop offset=".6" stopColor="#cfe0ff" /><stop offset="1" stopColor="#8fb0ff" /></radialGradient>
        <radialGradient id="kg" cx=".35" cy=".3"><stop offset="0" stopColor="#fff8d6" /><stop offset=".6" stopColor="#ffd34d" /><stop offset="1" stopColor="#ff9f1a" /></radialGradient></defs>
      <rect width="100" height="100" fill="url(#bg-keno)" />
      {Array.from({ length: 20 }, (_, i) => {
        const x = 12 + (i % 5) * 15, y = 12 + Math.floor(i / 5) * 15;
        const hit = hits.has(i);
        return (
          <g key={i}>
            <rect x={x - 6.5} y={y - 6.5} width="13" height="13" rx="3" fill={hit ? '#ffd34d' : 'rgba(255,255,255,.12)'} />
            <text x={x} y={y + 2.4} fontSize="6.5" fontWeight="800" textAnchor="middle" fill={hit ? '#3a2500' : '#cfe0ff'}>{i * 3 + 7}</text>
          </g>
        );
      })}
      <circle cx="66" cy="80" r="13" fill="url(#kb)" /><text x="66" y="84.5" fontSize="12" fontWeight="900" textAnchor="middle" fill="#10203f">43</text>
      <circle cx="84" cy="74" r="11" fill="url(#kg)" /><text x="84" y="78" fontSize="10" fontWeight="900" textAnchor="middle" fill="#3a2500">16</text>
    </svg>
  );
}

export function LudoArt() {
  const C = { r: '#ef4444', g: '#22c55e', y: '#facc15', b: '#3b82f6' };
  return (
    <svg viewBox="0 0 100 100" className="game-art" preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill="#1e2a55" />
      <g transform="translate(10 10)">
        <rect width="80" height="80" rx="4" fill="#fff" />
        <rect x="0" y="0" width="32" height="32" fill={C.r} /><rect x="48" y="0" width="32" height="32" fill={C.g} />
        <rect x="48" y="48" width="32" height="32" fill={C.y} /><rect x="0" y="48" width="32" height="32" fill={C.b} />
        {[[0, 0], [48, 0], [48, 48], [0, 48]].map(([x, y], i) => <rect key={i} x={x + 5} y={y + 5} width="22" height="22" rx="3" fill="#fff" />)}
        {[[11, 11, C.r], [21, 21, C.r], [59, 11, C.g], [69, 21, C.g], [59, 59, C.y], [69, 69, C.y], [11, 59, C.b], [21, 69, C.b]].map(([x, y, c], i) => (
          <circle key={i} cx={x} cy={y} r="4.2" fill={c} stroke="#fff" strokeWidth="1.2" />
        ))}
        <polygon points="32,32 32,48 40,40" fill={C.r} /><polygon points="32,32 48,32 40,40" fill={C.g} />
        <polygon points="48,32 48,48 40,40" fill={C.y} /><polygon points="32,48 48,48 40,40" fill={C.b} />
        {[[37, 8], [37, 18], [43, 18], [43, 26], [8, 37], [18, 43], [60, 37], [70, 43]].map(([x, y], i) => <rect key={i} x={x - 2.6} y={y - 2.6} width="5.2" height="5.2" fill="none" stroke="#cbd5e1" strokeWidth=".6" />)}
      </g>
      <g transform="translate(70 62) rotate(14)">
        <rect x="-11" y="-11" width="22" height="22" rx="5" fill="#fff" stroke="#e11d48" strokeWidth="2" />
        {[[-5, -5], [5, -5], [0, 0], [-5, 5], [5, 5]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2" fill="#111827" />)}
      </g>
    </svg>
  );
}

export function PoolArt() {
  return (
    <svg viewBox="0 0 100 100" className="game-art" preserveAspectRatio="xMidYMid slice">
      <defs><radialGradient id="felt" cx=".5" cy=".5" r=".7"><stop offset="0" stopColor="#1fae62" /><stop offset="1" stopColor="#0b6b38" /></radialGradient></defs>
      <rect width="100" height="100" fill="#5b3415" />
      <rect x="6" y="6" width="88" height="88" rx="4" fill="url(#felt)" />
      {[[6, 6], [94, 6], [6, 94], [94, 94]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="6.5" fill="#050505" />)}
      <Ball x={34} y={30} r={8} color="#dc2626" n={3} />
      <Ball x={50} y={26} r={8} color="#1d4ed8" n={10} stripe />
      <Ball x={42} y={42} r={8} color="#f5c400" n={1} />
      <Ball x={60} y={40} r={8} color="#15803d" n={14} stripe />
      <Ball x={52} y={58} r={14} color="#111111" n={8} />
      <line x1="22" y1="96" x2="78" y2="70" stroke="#a0652e" strokeWidth="3.6" strokeLinecap="round" />
      <line x1="66" y1="75.6" x2="78" y2="70" stroke="#f1e3c6" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="84" cy="67" r="5.5" fill="#f8f8f2" />
    </svg>
  );
}

export const GAME_ART = { aviator: AviatorArt, bingo: BingoArt, keno: KenoArt, ludo: LudoArt, pool: PoolArt };
