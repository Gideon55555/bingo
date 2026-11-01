import { useEffect, useState } from 'react';

/** Seconds remaining until `endsAt` (ms timestamp), updating every 250ms. */
export function useCountdown(endsAt) {
  const calc = () => (endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0);
  const [s, setS] = useState(calc);
  useEffect(() => {
    setS(calc());
    if (!endsAt) return;
    const t = setInterval(() => setS(calc()), 250);
    return () => clearInterval(t);
  }, [endsAt]);
  return s;
}
