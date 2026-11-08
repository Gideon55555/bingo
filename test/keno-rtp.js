// Keno math checks: exact return of every paytable row + fairness of the real draw function.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
process.env.BOT_DISABLED = 'true';
process.env.DB_PATH = `/tmp/keno-rtp-${Date.now()}.db`;
const fs = await import('node:fs');
const { PAYTABLE, payoutFor, countHits } = await import('../shared/keno.js');
const { drawForSeed } = await import('../server/keno.js');

// ---- 1. Exact expected return per pick count (hypergeometric probabilities) ----
const C = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const total = C(80, 20);
console.log('Exact return to player per ticket size:');
for (let n = 1; n <= 10; n++) {
  let rtp = 0;
  for (let k = 0; k <= n; k++) rtp += (C(n, k) * C(80 - n, 20 - k) / total) * (PAYTABLE[n][k] || 0);
  console.log(`  ${String(n).padStart(2)} numbers → ${(rtp * 100).toFixed(2)}%`);
  assert.ok(rtp > 0.93 && rtp < 0.95, `pick ${n} RTP ${rtp} out of range`);
}

// ---- 2. Draw fairness: 20 unique numbers, every number equally likely ----
const N = Number(process.env.N || 100000);
const freq = new Array(81).fill(0);
const firstBall = new Array(81).fill(0);
let simBet = 0, simPaid = 0;
for (let i = 0; i < N; i++) {
  const d = drawForSeed(crypto.randomBytes(32).toString('hex'));
  assert.equal(new Set(d).size, 20);
  d.forEach((x) => { assert.ok(x >= 1 && x <= 80); freq[x]++; });
  firstBall[d[0]]++;
  // a random 5-number ticket each draw
  const picks = [...new Set(Array.from({ length: 12 }, () => 1 + crypto.randomInt(80)))].slice(0, 5);
  if (picks.length === 5) { simBet += 1000; simPaid += payoutFor(1000, 5, countHits(picks, d)); }
}
const expected = (N * 20) / 80;
const chi = freq.slice(1).reduce((s, f) => s + (f - expected) ** 2 / expected, 0);
console.log(`Draw fairness over ${N.toLocaleString()} draws: each number drawn ${Math.min(...freq.slice(1))}–${Math.max(...freq.slice(1))} times (expected ${expected}), chi² ${chi.toFixed(1)} (79 d.f.)`);
assert.ok(chi < 130, 'number frequencies look non-uniform'); // p ≈ 0.0003 cutoff
console.log(`Simulated 5-number tickets: return ${((simPaid / simBet) * 100).toFixed(2)}% (exact 93.84%)`);

// ---- 3. Determinism: same seed → same draw (needed for verification) ----
const s = crypto.randomBytes(32).toString('hex');
assert.deepEqual(drawForSeed(s), drawForSeed(s));
console.log('Same seed always gives the same draw ✓');
fs.rmSync(process.env.DB_PATH, { force: true });
console.log('Keno math checks passed ✅');
