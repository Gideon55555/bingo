// Dibibkosh rules + hunter model.
import assert from 'node:assert/strict';
import { neighbors, CENTER, CORNERS, resolve, PlayerModel, hunterPick, ctxFor, botMove, cheb } from '../shared/hunt.js';

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };

console.log('Board');
assert.equal(neighbors(CENTER).length, 8); assert.equal(neighbors(0).length, 3); assert.equal(neighbors(1).length, 5);
for (let i = 0; i < 9; i++) assert.ok(!neighbors(i).includes(i));
ok('moves go to a neighbouring box (8 from the middle, 5 from an edge, 3 from a corner) — never standing still');

console.log('Catching');
const mk = (positions) => positions.map((pos) => ({ pos, last: null, out: false, model: new PlayerModel() }));
let ps = mk([0, 2, 6, 8]);
let r = resolve(ps, new Map([[0, 1], [1, 1], [2, 3], [3, 5]]), 3);
assert.deepEqual(r.caught, [2]); assert.equal(r.winners, null); assert.ok(ps[0].pos === 1 && ps[1].pos === 1 && !ps[0].out);
ok('two players sharing a box are fine; only the one in the hunter\'s box is out');
assert.throws(() => resolve(mk([0, 2, 6, 8]), new Map([[0, 0]]), 4)); assert.throws(() => resolve(mk([0, 2, 6, 8]), new Map([[0, 8]]), 4));
ok('standing still or jumping across the board is refused');
ps = mk([0, 2, 6, 8]); ps[2].out = true; ps[3].out = true;
r = resolve(ps, new Map([[0, 1], [1, 1]]), 1);
assert.deepEqual(r.winners, [0, 1]); ok('last two caught together → they split the win');
ps = mk([0, 2, 6, 8]); ps[2].out = true; ps[3].out = true;
r = resolve(ps, new Map([[0, 1], [1, 5]]), 5);
assert.deepEqual(r.winners, [0]); ok('one left → winner');

console.log('Hunter learns');
{
  // A player who always runs to a corner: the model should come to expect it
  const m = new PlayerModel({ flee: 0, corner: 0, center: 0, repeat: 0, back: 0, crowd: 0 });
  const ctx = { hunter: 4, last: null, others: [] };
  const before = m.probs(1, ctx).get(0);
  for (let k = 0; k < 8; k++) m.observe(1, k % 2 ? 2 : 0, ctx);
  const after = m.probs(1, ctx).get(0) + m.probs(1, ctx).get(2);
  assert.ok(after > 2 * before + 0.2, `${before} → ${after}`); ok(`after 8 moves it expects corner-runner's corners (${Math.round(before * 200)}% → ${Math.round(after * 100)}%)`);
}

console.log('Balance (simulated games)');
const rnd = Math.random;
function play(style) {
  const players = mk([0, 2, 6, 8]);
  let hunter = CENTER, moves = 0;
  for (;;) {
    moves++;
    const alive = players.filter((p) => !p.out);
    const pick = hunterPick(alive, hunter, rnd).box; // decided BEFORE players move
    const mv = new Map();
    players.forEach((p, i) => {
      if (p.out) return;
      const opts = neighbors(p.pos);
      let to;
      if (style === 'random') to = opts[Math.floor(rnd() * opts.length)];
      else if (style === 'flee') to = opts.sort((a, b) => cheb(b, hunter) - cheb(a, hunter) || a - b)[0]; // very predictable
      else to = botMove(players, i, hunter, rnd);
      mv.set(i, to);
    });
    const ctxs = new Map(players.map((p, i) => [i, ctxFor(players, p, hunter)]));
    const froms = new Map(players.map((p, i) => [i, p.pos]));
    const res = resolve(players, mv, pick);
    for (const [i, to] of mv) players[i].model.observe(froms.get(i), to, ctxs.get(i));
    hunter = res.caught.length ? CENTER : pick;
    if (res.winners) return { moves, split: res.winners.length > 1 };
    if (moves > 300) return { moves, split: true };
  }
}
const stats = (style, n = 2000) => {
  let total = 0, splits = 0;
  for (let k = 0; k < n; k++) { const g = play(style); total += g.moves; splits += g.split ? 1 : 0; }
  return { avg: total / n, splitPct: (splits / n) * 100 };
};
const sRandom = stats('random'), sFlee = stats('flee'), sBot = stats('bot');
console.log(`    average moves per game — unpredictable players: ${sRandom.avg.toFixed(1)}, bots: ${sBot.avg.toFixed(1)}, predictable "always flee" players: ${sFlee.avg.toFixed(1)}`);
assert.ok(sFlee.avg < sRandom.avg, 'predictable players are caught faster'); ok('the hunter catches predictable players faster than unpredictable ones (skill matters)');
assert.ok(sRandom.avg > 4 && sRandom.avg < 60, `game length ${sRandom.avg}`); ok(`a 4-player game lasts about ${Math.round(sRandom.avg)} moves (~${Math.round((sRandom.avg * 4.5) / 60 * 10) / 10} min at 3 s + reveal)`);
assert.ok(sRandom.splitPct < 25, `${sRandom.splitPct}% splits`); ok(`split wins are uncommon (${sRandom.splitPct.toFixed(1)}% of games)`);
console.log(`\nAll ${passed} Dibibkosh rule checks passed ✅`);
