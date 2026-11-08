// 8-ball pool physics + rules tests (no server).
import assert from 'node:assert/strict';
import { W, H, R, POCKETS, Sim, rack, judge, cloneBalls, canPlaceCue, aimGuide, respot, HEAD_LINE } from '../shared/pool.js';

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
// Helper: table with only the listed balls on it (others potted)
function table(list) {
  const all = Array.from({ length: 16 }, (_, n) => ({ n, x: 0, y: 0, vx: 0, vy: 0, in: true }));
  for (const [n, x, y] of list) Object.assign(all[n], { x, y, in: false });
  return all;
}
const run = (balls, dx, dy, power) => new Sim(balls, { dx, dy, power }).run();

console.log('Physics');
{
  const r0 = rack(() => 0.42);
  assert.equal(r0.length, 16);
  for (let i = 1; i < 16; i++) for (let j = i + 1; j < 16; j++) {
    assert.ok(Math.hypot(r0[i].x - r0[j].x, r0[i].y - r0[j].y) >= 2 * R - 1e-9, 'rack overlap');
  }
  const e = r0.find((b) => b.n === 8); assert.ok(Math.abs(e.x - W / 2) < 1e-9); ok('rack: 15 balls touching but not overlapping, 8 in the middle');

  // straight shot into the top-left corner pocket
  let b = table([[0, 30, 60], [1, 15, 30]]);
  const dir = { x: 1 - 30, y: 1 - 60 }; // aim cue at the corner through the 1 ball? → aim cue at ball 1 along the line to pocket
  const toPocket = { x: 0 - 15, y: 0 - 30 }; const l = Math.hypot(toPocket.x, toPocket.y);
  const ghost = { x: 15 - (toPocket.x / l) * 2 * R, y: 30 - (toPocket.y / l) * 2 * R };
  let res = run(b, ghost.x - 30, ghost.y - 60, 0.5);
  assert.deepEqual(res.potted, [1]); assert.equal(res.firstHit, 1); ok('ghost-ball aim pots the 1 into the corner');

  // head-on: cue nearly stops, object ball takes the speed
  b = table([[0, 50, 150], [5, 50, 120]]);
  const sim = new Sim(b, { dx: 0, dy: -1, power: 0.3 });
  while (!sim.done && sim.firstHit === null) sim.step();
  sim.step();
  const cue = sim.balls[0], obj = sim.balls[5];
  assert.ok(Math.abs(cue.vy) < Math.abs(obj.vy) * 0.1, 'cue should nearly stop'); ok('head-on hit transfers the speed (cue ball stops)');

  // cushion bounce
  b = table([[0, 50, 100]]);
  res = run(b, 1, 0.2, 0.4);
  assert.equal(res.potted.length, 0); assert.ok(res.balls[0].x < W - R && res.balls[0].x > R); ok('cue ball bounces off the cushion and stays on the table');

  // all balls always end inside the table or in a pocket, and nothing overlaps (break at full power)
  for (let s = 0; s < 30; s++) {
    let seed = s + 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const br = rack(rnd);
    br[0].x = 20 + rnd() * 60; br[0].y = 160 + rnd() * 30;
    const out = run(br, W / 2 - br[0].x + (rnd() - 0.5) * 3, 50 - br[0].y, 1);
    for (const x of out.balls) if (!x.in) assert.ok(x.x >= R - 1e-6 && x.x <= W - R + 1e-6 && x.y >= R - 1e-6 && x.y <= H - R + 1e-6, 'ball outside table');
    const on = out.balls.filter((x) => !x.in);
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) assert.ok(Math.hypot(on[i].x - on[j].x, on[i].y - on[j].y) > 2 * R - 0.05, 'overlap after shot');
    assert.ok(out.ms < 30000);
  }
  ok('30 full-power breaks: no ball escapes, no overlaps, every shot ends');

  // determinism
  const a1 = rack(() => 0.3), a2 = rack(() => 0.3);
  const s1 = run(a1, 0.7, -10, 0.93), s2 = run(a2, 0.7, -10, 0.93);
  assert.deepEqual(s1, s2); ok('same shot → identical result (deterministic)');

  const t0 = Date.now(); for (let i = 0; i < 20; i++) run(rack(), 0.2, -1, 1); const per = (Date.now() - t0) / 20;
  assert.ok(per < 100); ok(`full-power break simulates in ${per.toFixed(1)} ms`);

  // aim guide
  b = table([[0, 50, 150], [3, 50, 100]]);
  const g = aimGuide(b, 0, -1);
  assert.equal(g.ball, 3); assert.ok(Math.abs(g.ghost.y - (100 + 2 * R)) < 1e-6); ok('aim guide finds the ghost-ball position');
}

console.log('Rules');
{
  const base = (over = {}) => ({ groups: [null, null], turn: 0, breakShot: false, ...over });
  const before = table([[0, 50, 150], [1, 20, 20], [9, 80, 20], [8, 50, 50]]);
  const R0 = { firstHit: 1, potted: [], railAfterHit: true };
  assert.equal(judge(base(), before, { ...R0, potted: [0] }).foul, true); ok('potting the cue ball is a foul');
  assert.equal(judge(base(), before, { ...R0, firstHit: null }).foul, true); ok('missing every ball is a foul');
  assert.equal(judge(base(), before, { ...R0, firstHit: 8 }).foul, true); ok('hitting the 8 first on an open table is a foul');
  assert.equal(judge(base(), before, { ...R0, railAfterHit: false }).foul, true); ok('no cushion after contact (and nothing potted) is a foul');
  let j = judge(base(), before, { ...R0, potted: [9] });
  assert.deepEqual(j.assign, { player: 0, group: 'stripes' }); assert.equal(j.keepTurn, true); ok('first legal pot assigns the group, and you keep shooting');
  j = judge(base({ groups: ['solids', 'stripes'] }), before, { ...R0, firstHit: 9, potted: [1] });
  assert.equal(j.foul, true); ok('hitting the opponent\'s ball first is a foul');
  j = judge(base({ groups: ['solids', 'stripes'] }), before, { ...R0, firstHit: 1, potted: [9] });
  assert.equal(j.foul, false); assert.equal(j.keepTurn, false); ok('potting only the opponent\'s ball ends your turn');
  j = judge(base({ groups: ['solids', 'stripes'] }), before, { ...R0, firstHit: 1, potted: [8] });
  assert.equal(j.win, 1); ok('potting the 8 too early loses the game');
  const onEight = table([[0, 50, 150], [9, 80, 20], [8, 50, 50]]);
  j = judge(base({ groups: ['solids', 'stripes'] }), onEight, { ...R0, firstHit: 8, potted: [8] });
  assert.equal(j.win, 0); ok('potting the 8 after clearing your group wins');
  j = judge(base({ groups: ['solids', 'stripes'] }), onEight, { ...R0, firstHit: 8, potted: [8, 0] });
  assert.equal(j.win, 1); ok('potting the 8 and the cue ball together loses');
  j = judge(base({ breakShot: true }), before, { ...R0, firstHit: 1, potted: [8, 3], railAfterHit: false });
  assert.equal(j.respot8, true); assert.equal(j.win, null); assert.equal(j.keepTurn, true); ok('8 on the break is re-spotted; potting on the break keeps the table open and your turn');

  const b2 = table([[0, 50, 150], [8, 50, 50]]); b2[8].in = true;
  respot(b2, 8); assert.equal(b2[8].in, false); ok('re-spot puts the 8 back on the table');
  assert.equal(canPlaceCue(before, 50, 100, true), false); assert.equal(canPlaceCue(before, 50, HEAD_LINE + 10, true), true); ok('on the break the cue ball must be behind the head line');
  assert.equal(canPlaceCue(before, 20, 20, false), false); ok('cue ball can\'t be placed on another ball');
}

console.log(`\nAll ${passed} pool physics + rules checks passed ✅`);

console.log('Cutthroat (3+ players)');
{
  const { cutthroatSets, rackCutthroat, judgeCutthroat, aliveFromBalls } = await import('../shared/pool.js');
  assert.deepEqual(cutthroatSets(3), [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]]);
  assert.deepEqual(cutthroatSets(4).map((s) => s.length), [3, 3, 3, 3]); ok('ball sets: 3 players × 5 balls, 4 players × 3 balls');
  const r4 = rackCutthroat(4, () => 0.5);
  assert.equal(r4.length, 13); assert.equal(r4[0].n, 0); ok('4-player rack has 12 balls + cue');
  const sets = cutthroatSets(3);
  const balls = Array.from({ length: 16 }, (_, n) => ({ n, x: 10, y: 10, in: false }));
  const res = (over) => ({ firstHit: 6, potted: [], railAfterHit: true, balls: balls.map((b) => ({ ...b })), ...over });
  let j = judgeCutthroat({ turn: 0, breakShot: false, sets, alive: [true, true, true] }, balls, res({ potted: [7] }));
  assert.equal(j.foul, false); assert.equal(j.keepTurn, true); ok('potting any ball legally keeps your turn');
  const afterFoul = res({ potted: [0] });
  afterFoul.balls.find((b) => b.n === 7).in = true; afterFoul.balls.find((b) => b.n === 12).in = true; afterFoul.balls.find((b) => b.n === 13).in = true;
  j = judgeCutthroat({ turn: 0, breakShot: false, sets, alive: [true, true, true] }, balls, afterFoul);
  assert.equal(j.foul, true); assert.deepEqual(j.returnBalls, [7, 12]); ok('foul: each opponent gets one potted ball back');
  const gone = balls.map((b) => ({ ...b, in: b.n >= 1 && b.n <= 5 }));
  assert.deepEqual(aliveFromBalls(sets, gone), [false, true, true]); ok('player with no balls left is out');
}
console.log(`\nAll ${passed} pool checks (incl. cutthroat) passed ✅`);
