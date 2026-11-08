// Small in-memory rate limiter (fine for a single server instance).

const buckets = new Map();

/** Returns true if the action is allowed: at most `max` hits per `windowMs` for `key`. */
export function allow(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count++;
  return b.count <= max;
}

/** How many hits `key` has in the current window (without counting a new one). */
export function hits(key, windowMs) {
  const b = buckets.get(key);
  return b && Date.now() - b.start < windowMs ? b.count : 0;
}

// Forget old buckets so memory doesn't grow forever
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, b] of buckets) if (b.start < cutoff) buckets.delete(k);
}, 10 * 60 * 1000).unref();

/** Express middleware. keyFn(req) picks who is being limited (user id or IP). */
export const limit = (name, max, windowMs, keyFn = (req) => req.ip) => (req, res, next) => {
  if (allow(`${name}:${keyFn(req)}`, max, windowMs)) return next();
  res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
};
