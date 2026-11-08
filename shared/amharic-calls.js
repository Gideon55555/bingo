// What the bingo caller says for each number, in Amharic: the column letter, then the number in words.
// Used to generate the voice clips (scripts/voice/) and shown as text under the called ball.
export const LETTERS_AM = { B: 'ቢ', I: 'አይ', N: 'ኤን', G: 'ጂ', O: 'ኦ' };
const ONES = ['', 'አንድ', 'ሁለት', 'ሶስት', 'አራት', 'አምስት', 'ስድስት', 'ሰባት', 'ስምንት', 'ዘጠኝ'];
const TENS = ['', 'አስራ', 'ሃያ', 'ሰላሳ', 'አርባ', 'ሃምሳ', 'ስልሳ', 'ሰባ'];

/** 1–79 in Amharic words: 10 = አስር, 14 = አስራ አራት, 54 = ሃምሳ አራት. */
export function amharicNumber(n) {
  if (n === 10) return 'አስር';
  const t = Math.floor(n / 10), o = n % 10;
  return [TENS[t], ONES[o]].filter(Boolean).join(' ');
}

export const letterOf = (n) => 'BINGO'[Math.floor((n - 1) / 15)];

/** e.g. 54 → { letter: 'G', letterAm: 'ጂ', words: 'ሃምሳ አራት', text: 'ጂ ሃምሳ አራት' } */
export function callFor(n) {
  const letter = letterOf(n);
  const words = amharicNumber(n);
  return { n, letter, letterAm: LETTERS_AM[letter], words, text: `${LETTERS_AM[letter]} ${words}` };
}

export const ALL_CALLS = Array.from({ length: 75 }, (_, i) => callFor(i + 1));
