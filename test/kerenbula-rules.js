// Kerenbula physics + scoring tests.
import assert from 'node:assert/strict';
import { W, H, R, PINS, RELEASE_Y, Sim, freshBalls, freshPins, pinPoints, closestPlayer, frameScore, canRelease, MIDLINE } from '../shared/kerenbula.js';

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const place = (list) => { const b = freshBalls(); for (const [n, x, y] of list) Object.assign(b[n], { x, y, on: true }); return b; };
const roll = (balls, pins, n, x, tx, ty, power) => new Sim(balls, pins, { n, x, dx: tx - x, dy: ty - RELEASE_Y, power }).run();
const colors = ['red', 'white'];

console.log('Physics');
{
  // jack rolled straight past the pins on the left side, past the midline
  let r = roll(freshBalls(), freshPins(), 0, 20, 20, 0, 0.7);
  assert.ok(r.balls[0].y < MIDLINE); assert.equal(r.knocked.length, 0); ok('a firm roll carries the jack past the midline');
  // red ball rolled straight into the centre pin → knocked by red
  r = roll(freshBalls(), freshPins(), 1, W / 2, W / 2, H / 2, 0.6);
  assert.ok(r.knocked.some((k) => k.by === 1)); ok('a red ball rolled into the pins knocks them over (direct hit)');
  // red ball hits the blue ball, which then hits the pins → knocked by the jack
  const b = place([[0, W / 2, H / 2 + 12]]);
  r = roll(b, freshPins(), 1, W / 2, W / 2, H / 2, 0.65);
  assert.ok(r.knocked.length > 0 && r.knocked.every((k) => k.by === 0), JSON.stringify(r.knocked)); ok('hitting the blue ball into the pins: pins knocked by the BLUE ball');
  // cushions keep everything on the table, every roll ends
  for (let i = 0; i < 40; i++) {
    const res = roll(place([[0, 30 + i, 60]]), freshPins(), 1 + (i % 8), 10 + i * 2, Math.random() * W, Math.random() * 40, Math.random());
    for (const x of res.balls) if (x.on) assert.ok(x.x >= R - 1e-6 && x.x <= W - R + 1e-6 && x.y >= R - 1e-6 && x.y <= H - R + 1e-6);
    assert.ok(res.ms < 30000);
  }
  ok('40 random rolls: balls stay on the table, every roll stops');
  const a1 = roll(place([[0, 40, 70]]), freshPins(), 2, 33, 41, 60, 0.83), a2 = roll(place([[0, 40, 70]]), freshPins(), 2, 33, 41, 60, 0.83);
  assert.deepEqual(a1, a2); ok('deterministic: same roll → same result');
  assert.equal(canRelease(place([[3, 50, RELEASE_Y]]), 50), false); assert.equal(canRelease(freshBalls(), 50), true); ok('release spot can\'t be on top of a resting ball');
}

console.log('Scoring');
{
  let p = pinPoints(colors, 0, [{ pin: 1, by: 0 }, { pin: 0, by: 0 }], { isJackRoll: false });
  assert.deepEqual(p.delta, [8, 0]); ok('2 pins knocked by the blue ball → +8 to the shooter');
  p = pinPoints(colors, 0, [{ pin: 1, by: 2 }, { pin: 0, by: 3 }, { pin: 2, by: 1 }], { isJackRoll: false });
  assert.deepEqual(p.delta, [-12, 0]); ok('all 3 pins knocked directly by your own ball → −12');
  p = pinPoints(colors, 0, [{ pin: 1, by: 6 }], { isJackRoll: false });
  assert.deepEqual(p.delta, [0, -4]); ok('knocking the opponent\'s ball into a pin → −4 for the opponent');
  p = pinPoints(colors, 1, [{ pin: 1, by: 0 }], { isJackRoll: true });
  assert.deepEqual(p.delta, [0, 0]); assert.equal(p.reset, true); ok('pins knocked by the jack roll itself don\'t count (pins are stood back up)');

  const balls = place([[0, 50, 60], [1, 50, 66], [2, 55, 70], [3, 80, 150], [5, 50, 52], [6, 20, 30]]);
  assert.equal(closestPlayer(colors, balls), 0); ok('closest player is found (red 6 away beats white 8 away)');
  const f = frameScore(colors, place([[0, 50, 60], [1, 50, 63], [2, 50, 65], [3, 80, 150], [5, 50, 70], [6, 20, 30]]));
  assert.deepEqual(f, { winner: 0, points: 2 }); ok('frame: red has 2 balls closer than white\'s best → red scores 2');
  assert.deepEqual(frameScore(colors, place([[0, 50, 60], [1, 50, 70], [5, 50, 50]])), { winner: null, points: 0 }); ok('exact tie for closest → no points');
}
console.log(`\nAll ${passed} Kerenbula rule checks passed ✅`);
