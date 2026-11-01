import crypto from 'node:crypto';
export { getCard, findWin, letterFor } from '../shared/cards.js';

/** Cryptographically shuffled 1..75 call order. */
export function shuffledBalls() {
  const balls = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let i = balls.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [balls[i], balls[j]] = [balls[j], balls[i]];
  }
  return balls;
}
