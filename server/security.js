// HTTP security headers, safe error messages and client-IP handling.
import { config } from './config.js';

const telegramFrames = 'https://web.telegram.org https://*.telegram.org';

function cspHeader() {
  let wss = '';
  try { if (config.webAppUrl) wss = ` wss://${new URL(config.webAppUrl).host}`; } catch { /* ignore */ }
  return [
    "default-src 'self'",
    "script-src 'self' https://telegram.org",
    "style-src 'self' 'unsafe-inline'",           // React inline style attributes
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${wss}${config.devMode ? ' ws: http://localhost:*' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors 'self' ${telegramFrames}`,   // only Telegram may embed the app
  ].join('; ');
}

/** Security headers on every response. */
export function securityHeaders() {
  const csp = cspHeader();
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}

/**
 * Message that is safe to show a player. Errors we throw on purpose (plain Error) are shown;
 * programming errors and database errors are logged and replaced with a generic message,
 * so internals never leak.
 */
export function publicMessage(e, where = '') {
  const internal = !(e instanceof Error) || e.code || e instanceof TypeError || e instanceof RangeError
    || e instanceof ReferenceError || e instanceof SyntaxError;
  if (!internal) return e.message;
  console.error(`[error]${where ? ` ${where}` : ''}`, e);
  return 'Something went wrong. Please try again.';
}

/** Last Express middleware: JSON errors, no stack traces. */
export function errorHandler(err, req, res, _next) {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  res.status(500).json({ error: publicMessage(err, `${req.method} ${req.path}`) });
}

/**
 * Visitor IP for a socket handshake, following the same TRUST_PROXY rule as Express:
 * trust the last N proxy hops, so a visitor can't fake their IP with an X-Forwarded-For header.
 */
export function socketIp(handshake) {
  const remote = handshake.address || '';
  const xff = String(handshake.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const chain = [remote, ...xff.reverse()];
  return chain[Math.min(config.trustProxy, chain.length - 1)] || remote;
}
