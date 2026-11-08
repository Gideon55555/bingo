// Ludo rules unit tests (no server needed).
import assert from 'node:assert/strict';
import {
  TRACK, HOME_COL, START, SAFE, legalMoves, applyMove, absSquare, hasWon, bestMove, coordOf, pathOf, HOME_POS,
} from '../shared/ludo.js';

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const mk = (...seatsTokens) => seatsTokens.map(([seat, tokens]) => ({ seat, tokens: [...tokens] }));

console.log('Board geometry');
assert.equal(TRACK.length, 52);
assert.equal(new Set(TRACK.map(String)).size, 52); ok('52 unique track squares');
for (let i = 0; i < 52; i++) {
  const [x1, y1] = TRACK[i], [x2, y2] = TRACK[(i + 1) % 52];
  assert.equal(Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)), 1, `squares ${i}->${i + 1} not adjacent`);
}
const diagonals = TRACK.filter((a, i) => { const b = TRACK[(i + 1) % 52]; return a[0] !== b[0] && a[1] !== b[1]; }).length;
assert.equal(diagonals, 4);
ok('closed loop of neighbouring squares, with the 4 standard diagonal steps at the inner corners');
for (let s = 0; s < 4; s++) {
  const [lx, ly] = TRACK[absSquare(s, 50)];
  const [hx, hy] = HOME_COL[s][0];
  assert.equal(Math.abs(lx - hx) + Math.abs(ly - hy), 1, `seat ${s} home column not connected`);
}
ok('each colour\'s last track square leads into its home column');
assert.deepEqual(START.map((s) => TRACK[s]), [[1, 6], [8, 1], [13, 8], [6, 13]]); ok('start squares at the standard spots');
const p = pathOf(0, 48, 53);
assert.equal(p.length, 5); assert.deepEqual(p[2], coordOf(0, 51)); ok('movement path walks square by square into the home column');

console.log('Moves');
assert.deepEqual(legalMoves([-1, -1], 5), []); ok('need a 6 to leave base');
assert.deepEqual(legalMoves([-1, -1], 6), [0, 1]); ok('a 6 lets a token out');
assert.deepEqual(legalMoves([54, 10], 3), [1]); ok('exact roll needed for home (54+3 overshoots)');
assert.deepEqual(legalMoves([54, 56], 2), [0]); ok('54+2 reaches home exactly; finished tokens can\'t move');

let players = mk([0, [-1, -1]], [2, [-1, -1]]);
let r = applyMove(players, 0, 0, 6);
assert.equal(players[0].tokens[0], 0); assert.equal(r.extraTurn, true); ok('leaving base puts the token on its start square, 6 gives another roll');

// capture: red token lands where yellow token is (non-safe)
players = mk([0, [10, -1]], [2, [-1, -1]]);
const sqTarget = absSquare(0, 14); // red rel 14
const yellowRel = (sqTarget - START[2] + 52) % 52;
players[1].tokens[0] = yellowRel;
assert.ok(!SAFE.has(sqTarget));
r = applyMove(players, 0, 0, 4);
assert.equal(players[1].tokens[0], -1); assert.equal(r.captured.length, 1); assert.equal(r.extraTurn, true);
ok('landing on an opponent sends it back to base and gives another roll');

// no capture on a star (safe)
players = mk([0, [4, -1]], [2, [-1, -1]]);
const star = absSquare(0, 8);
assert.ok(SAFE.has(star));
players[1].tokens[0] = (star - START[2] + 52) % 52;
r = applyMove(players, 0, 0, 4);
assert.equal(players[1].tokens[0], (star - START[2] + 52) % 52); assert.equal(r.captured.length, 0); ok('no capture on safe star squares');

// no capture inside home column
players = mk([0, [49, -1]], [2, [-1, -1]]);
players[1].tokens[0] = 30;
r = applyMove(players, 0, 0, 3);
assert.equal(r.captured.length, 0); ok('home column is private (no captures)');

players = mk([0, [53, 56]], [2, [-1, -1]]);
r = applyMove(players, 0, 0, 3);
assert.equal(r.home, true); assert.equal(r.extraTurn, true); assert.equal(hasWon(players[0].tokens), true); ok('reaching home gives another roll; all tokens home = win');
assert.throws(() => applyMove(mk([0, [-1, -1]], [2, [-1, -1]]), 0, 0, 3)); ok('illegal moves are rejected');

console.log('Auto-play choice');
players = mk([0, [10, -1]], [2, [-1, -1]]);
players[1].tokens[0] = (absSquare(0, 16) - START[2] + 52) % 52;
assert.equal(bestMove(players, 0, 6), 0); ok('auto-play prefers a capture over leaving base');
players = mk([0, [52, 20]], [2, [-1, -1]]);
assert.equal(bestMove(players, 0, 4), 0); ok('auto-play prefers bringing a token home');

console.log(`\nAll ${passed} Ludo rule checks passed ✅`);
