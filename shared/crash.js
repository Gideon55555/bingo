// Crash game math, shared by the server (authoritative) and the app (animation + verification).
// Multipliers are integers x100: 100 = 1.00x, 245 = 2.45x.

/** Growth speed: multiplier = e^(GROWTH * ms). 2x after ~8.7s, 10x after ~29s, 100x after ~58s. */
export const GROWTH = 0.00008;

/** Multiplier (x100) after `ms` milliseconds of flight. */
export const multiplierAt = (ms) => Math.max(100, Math.floor(100 * Math.exp(GROWTH * Math.max(0, ms))));

/** Milliseconds of flight needed to reach multiplier m100. */
export const msFor = (m100) => Math.log(Math.max(100, m100) / 100) / GROWTH;

/**
 * Crash point from a provably-fair hash (hex). Uses the first 52 bits as a uniform number X in [0,1).
 * point = (1 - edge) / (1 - X), rounded down to 2 decimals, minimum 1.00x.
 * This gives P(point >= m) = (1 - edge) / m, so every cash-out target has the same house edge.
 */
export function crashPointFromHash(hex, edge, max100 = 100000) {
  const X = parseInt(hex.slice(0, 13), 16) / 2 ** 52;
  const p = Math.floor((100 * (1 - edge)) / (1 - X));
  return Math.min(max100, Math.max(100, p));
}

export const fmtX = (m100) => `${(m100 / 100).toFixed(2)}x`;
