// Card generation and win checking for 75-ball bingo.
// Cards are deterministic: card #N always has the same numbers, so players
// can pick a "cartela" number and everyone sees the same card.

const COLS = [
  [1, 15],  // B
  [16, 30], // I
  [31, 45], // N
  [46, 60], // G
  [61, 75], // O
];

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map();

/** Returns a 5x5 grid as rows: grid[row][col]. Center (2,2) is 0 = FREE. */
export function getCard(cardId, salt = 'bingo-v1') {
  const key = `${salt}:${cardId}`;
  if (cache.has(key)) return cache.get(key);
  let seed = 0;
  for (const ch of key) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
  const rand = mulberry32(seed);

  const columns = COLS.map(([lo, hi]) => {
    const pool = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 5);
  });
  columns[2][2] = 0; // free space

  const grid = [0, 1, 2, 3, 4].map((r) => columns.map((col) => col[r]));
  cache.set(key, grid);
  return grid;
}

/** All winning lines: 5 rows, 5 columns, 2 diagonals, 4 corners. */
const LINES = (() => {
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push([0, 1, 2, 3, 4].map((c) => [i, c]));
    lines.push([0, 1, 2, 3, 4].map((r) => [r, i]));
  }
  lines.push([0, 1, 2, 3, 4].map((i) => [i, i]));
  lines.push([0, 1, 2, 3, 4].map((i) => [i, 4 - i]));
  lines.push([[0, 0], [0, 4], [4, 0], [4, 4]]);
  return lines;
})();

/** Returns the winning line (array of [r,c]) or null. `called` is a Set of numbers. */
export function findWin(cardId, called) {
  const grid = getCard(cardId);
  for (const line of LINES) {
    if (line.every(([r, c]) => grid[r][c] === 0 || called.has(grid[r][c]))) return line;
  }
  return null;
}

export const letterFor = (n) => 'BINGO'[Math.floor((n - 1) / 15)];
