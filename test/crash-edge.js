// Statistical check of the crash game's house edge using the real crash-point function.
// For any cash-out target t, the expected return should be (1 - edge), i.e. 0.97 at 3%.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
process.env.BOT_DISABLED = 'true';
process.env.DB_PATH = `/tmp/edge-${Date.now()}.db`;
const { crashPointForSeed } = await import('../server/crash.js');
const fs = await import('node:fs');

const N = Number(process.env.N || 1_000_000);
const targets = [101, 150, 200, 500, 1000, 5000];
const ret = Object.fromEntries(targets.map((t) => [t, 0]));
let instant = 0;
for (let i = 0; i < N; i++) {
  const p = crashPointForSeed(crypto.randomBytes(32).toString('hex'));
  if (p === 100) instant++;
  for (const t of targets) if (t <= p) ret[t] += t / 100;
}
console.log(`${N.toLocaleString()} rounds · instant crash at 1.00x: ${((instant / N) * 100).toFixed(2)}%`);
let ok = true;
for (const t of targets) {
  const r = ret[t] / N;
  const se = Math.sqrt((t / 100) * 0.97) / Math.sqrt(N); // rough standard error
  const pass = Math.abs(r - 0.97) < 5 * se + 0.002;
  ok &&= pass;
  console.log(`  cash out at ${(t / 100).toFixed(2)}x → return ${(r * 100).toFixed(2)}%  ${pass ? '✓' : '✗'}`);
}
fs.rmSync(process.env.DB_PATH, { force: true });
assert.ok(ok, 'house edge out of expected range');
console.log('House edge check passed ✅');
