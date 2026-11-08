// All money is stored and sent in CENTS (integers) to avoid rounding errors.
// 1 ETB = 100 cents. Convert only when reading user input or showing amounts.

/** "12.5" / 12.5 / "12,50" (ETB) -> 1250 (cents). Returns NaN for invalid input. */
export const toCents = (v) => {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

/** 1250 -> "12.50", 1200 -> "12", 123456700 -> "1,234,567" */
export const fmt = (cents) => {
  const n = Number(cents || 0) / 100;
  const whole = Number.isInteger(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
};

export const fmtMoney = (cents, currency = '') => `${fmt(cents)}${currency ? ` ${currency}` : ''}`;
