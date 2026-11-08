// Ludo rules + board geometry, shared by the server (authoritative) and the app (drawing/animation).
//
// Token position is RELATIVE to its owner:
//   -1        in base (yard)
//    0..50    on the main track (0 = the owner's start square)
//   51..55    in the owner's home column
//   56        home (finished)
//
// Rules used:
//   • A 6 is needed to bring a token out of base.
//   • A 6 gives another roll; a third 6 in a row ends the turn with no move.
//   • Landing on an opponent on a non-safe square sends it back to base, and gives another roll.
//   • Bringing a token home gives another roll.
//   • You need the exact number to reach home.
//   • Safe squares: every start square and the 4 star squares. Tokens there can't be captured.

export const TRACK_LEN = 52;
export const HOME_POS = 56;
export const LAST_TRACK = 50;

// Seats: 0 red (top-left), 1 green (top-right), 2 yellow (bottom-right), 3 blue (bottom-left)
export const COLORS = ['red', 'green', 'yellow', 'blue'];
export const COLOR_HEX = { red: '#ef4444', green: '#22c55e', yellow: '#facc15', blue: '#3b82f6' };
export const START = [0, 13, 26, 39];
export const STARS = [8, 21, 34, 47];
export const SAFE = new Set([...START, ...STARS]);
/** Which seats play in a 2-player game (opposite corners) and a 4-player game */
export const SEATS_FOR = { 2: [0, 2], 4: [0, 1, 2, 3] };

// 52 main-track squares on a 15×15 grid, starting at red's start square, going clockwise.
export const TRACK = (() => {
  const t = [];
  for (let x = 1; x <= 5; x++) t.push([x, 6]);
  for (let y = 5; y >= 0; y--) t.push([6, y]);
  t.push([7, 0]);
  for (let y = 0; y <= 5; y++) t.push([8, y]);
  for (let x = 9; x <= 14; x++) t.push([x, 6]);
  t.push([14, 7]);
  for (let x = 14; x >= 9; x--) t.push([x, 8]);
  for (let y = 9; y <= 14; y++) t.push([8, y]);
  t.push([7, 14]);
  for (let y = 14; y >= 9; y--) t.push([6, y]);
  for (let x = 5; x >= 0; x--) t.push([x, 8]);
  t.push([0, 7]);
  t.push([0, 6]);
  return t;
})();

/** Home columns (5 squares each) per seat */
export const HOME_COL = [
  [1, 2, 3, 4, 5].map((x) => [x, 7]),
  [1, 2, 3, 4, 5].map((y) => [7, y]),
  [13, 12, 11, 10, 9].map((x) => [x, 7]),
  [13, 12, 11, 10, 9].map((y) => [7, y]),
];
/** Where finished tokens sit (inside the centre triangle of their colour) */
export const HOME_SPOT = [[6.55, 7.5], [7.5, 6.55], [8.45, 7.5], [7.5, 8.45]];
/** Base (yard) token spots, 4 per seat */
export const BASE_SPOTS = [[0, 0], [9, 0], [9, 9], [0, 9]].map(([ox, oy]) =>
  [[2.25, 2.25], [3.75, 3.75], [3.75, 2.25], [2.25, 3.75]].map(([x, y]) => [ox + x, oy + y]));

export const absSquare = (seat, rel) => (START[seat] + rel) % TRACK_LEN;

/** Grid coordinates [x, y] (cell centre) of a token. */
export function coordOf(seat, rel, tokenIndex = 0) {
  if (rel < 0) {
    const [x, y] = BASE_SPOTS[seat][tokenIndex];
    return [x, y];
  }
  if (rel >= HOME_POS) return HOME_SPOT[seat];
  if (rel > LAST_TRACK) {
    const [x, y] = HOME_COL[seat][rel - LAST_TRACK - 1];
    return [x + 0.5, y + 0.5];
  }
  const [x, y] = TRACK[absSquare(seat, rel)];
  return [x + 0.5, y + 0.5];
}

/** Squares a token passes through when moving (for step-by-step animation). */
export function pathOf(seat, from, to, tokenIndex = 0) {
  if (from < 0) return [coordOf(seat, 0, tokenIndex)];
  const out = [];
  for (let r = from + 1; r <= to; r++) out.push(coordOf(seat, r, tokenIndex));
  return out;
}

/** Token indexes that can move with this roll. tokens = array of relative positions. */
export function legalMoves(tokens, roll) {
  const moves = [];
  tokens.forEach((pos, i) => {
    if (pos === HOME_POS) return;
    if (pos < 0) { if (roll === 6) moves.push(i); return; }
    if (pos + roll <= HOME_POS) moves.push(i);
  });
  return moves;
}

/**
 * Apply a move. players = [{ seat, tokens:[...] }, ...] (mutated).
 * Returns { from, to, captured: [{player, token}], home, extraTurn }.
 */
export function applyMove(players, pIndex, tokenIndex, roll) {
  const p = players[pIndex];
  const from = p.tokens[tokenIndex];
  const to = from < 0 ? 0 : from + roll;
  if (from === HOME_POS || (from < 0 && roll !== 6) || to > HOME_POS) throw new Error('Illegal move');
  p.tokens[tokenIndex] = to;

  const captured = [];
  if (to <= LAST_TRACK) {
    const sq = absSquare(p.seat, to);
    if (!SAFE.has(sq)) {
      players.forEach((o, oi) => {
        if (oi === pIndex || o.out) return;
        o.tokens.forEach((t, ti) => {
          if (t >= 0 && t <= LAST_TRACK && absSquare(o.seat, t) === sq) {
            o.tokens[ti] = -1;
            captured.push({ player: oi, token: ti, from: t });
          }
        });
      });
    }
  }
  const home = to === HOME_POS;
  return { from, to, captured, home, extraTurn: roll === 6 || captured.length > 0 || home };
}

export const hasWon = (tokens) => tokens.every((t) => t === HOME_POS);

/**
 * Simple "good move" choice used when a player runs out of time:
 * capture > bring home > leave base > move the most advanced token that isn't already safe at home column.
 */
export function bestMove(players, pIndex, roll) {
  const p = players[pIndex];
  const moves = legalMoves(p.tokens, roll);
  if (!moves.length) return null;
  const score = (i) => {
    const from = p.tokens[i];
    const to = from < 0 ? 0 : from + roll;
    let s = to; // progress
    if (to === HOME_POS) s += 1000;
    if (from < 0) s += 500;
    if (to <= LAST_TRACK) {
      const sq = absSquare(p.seat, to);
      if (!SAFE.has(sq)) {
        const caps = players.some((o, oi) => oi !== pIndex && !o.out && o.tokens.some((t) => t >= 0 && t <= LAST_TRACK && absSquare(o.seat, t) === sq));
        if (caps) s += 2000;
      } else s += 50;
    }
    return s;
  };
  return moves.reduce((a, b) => (score(b) > score(a) ? b : a));
}
