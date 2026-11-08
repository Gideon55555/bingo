// Keno rules shared by the server and the app.
// 80 numbers, 20 are drawn each round. Players pick 1–10 numbers.

export const KENO_NUMBERS = 80;
export const KENO_DRAWN = 20;
export const KENO_MAX_PICKS = 10;

/**
 * PAYTABLE[picks][hits] = multiplier of the bet (missing = 0).
 * Tuned so every pick count returns ~94% to players on average (house edge ~6%).
 * The exact return for each row is checked in test/keno-rtp.js.
 */
export const PAYTABLE = {
  1: { 1: 3.75 },
  2: { 1: 1, 2: 9.25 },
  3: { 2: 2.5, 3: 43 },
  4: { 2: 1, 3: 4, 4: 180 },
  5: { 2: 0.5, 3: 3, 4: 12, 5: 630 },
  6: { 2: 0.5, 3: 1.5, 4: 6, 5: 50, 6: 2050 },
  7: { 3: 1, 4: 5.25, 5: 27, 6: 180, 7: 5000 },
  8: { 3: 0.5, 4: 3.5, 5: 14, 6: 70, 7: 510, 8: 10000 },
  9: { 3: 0.5, 4: 2.25, 5: 6.25, 6: 32, 7: 190, 8: 1600, 9: 10000 },
  10: { 0: 2, 4: 1.75, 5: 3.25, 6: 16, 7: 80, 8: 660, 9: 3300, 10: 10000 },
};

/** Multiplier (e.g. 3.25) for `hits` matches with `picks` numbers chosen. */
export const multiplierFor = (picks, hits) => PAYTABLE[picks]?.[hits] || 0;

/** Payout in cents for a bet in cents (rounded down to the cent). */
export const payoutFor = (betCents, picks, hits) => Math.floor(betCents * multiplierFor(picks, hits));

export const countHits = (picks, drawn) => {
  const set = new Set(drawn);
  return picks.reduce((n, p) => n + (set.has(p) ? 1 : 0), 0);
};

/** Validates a ticket: 1–10 unique whole numbers between 1 and 80. Returns sorted picks or throws. */
export function cleanPicks(picks) {
  if (!Array.isArray(picks)) throw new Error('Pick your numbers');
  const nums = [...new Set(picks.map(Number))].sort((a, b) => a - b);
  if (nums.length !== picks.length) throw new Error('Each number can only be picked once');
  if (nums.length < 1 || nums.length > KENO_MAX_PICKS) throw new Error(`Pick between 1 and ${KENO_MAX_PICKS} numbers`);
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > KENO_NUMBERS)) throw new Error('Numbers must be between 1 and 80');
  return nums;
}
