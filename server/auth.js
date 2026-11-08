import crypto from 'node:crypto';
import { config } from './config.js';
import { upsertUser, getUser } from './db.js';
import { allow, hits } from './ratelimit.js';

// Validated initData is cached briefly, so each request/socket doesn't redo the HMAC and JSON parse.
const CACHE_MAX = 20000;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // hash -> { tgUser, until }

/**
 * Validates Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Returns the Telegram user object, or null if invalid.
 */
export function validateInitData(initData, botToken = config.botToken) {
  if (!initData || !botToken || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > config.initDataMaxAgeSec) return null;

  try {
    const u = JSON.parse(params.get('user'));
    if (!u || !(typeof u.id === 'number' || /^\d{1,20}$/.test(String(u.id)))) return null;
    return { id: u.id, username: typeof u.username === 'string' ? u.username.slice(0, 64) : null,
      first_name: typeof u.first_name === 'string' ? u.first_name.slice(0, 64) : null, authDate };
  } catch {
    return null;
  }
}

function validateCached(initData) {
  if (!initData) return null;
  const key = new URLSearchParams(initData).get('hash');
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now() && hit.raw === initData) return hit.tgUser;
  const tgUser = validateInitData(initData);
  if (!tgUser) return null;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // drop the oldest
  const expires = (tgUser.authDate + config.initDataMaxAgeSec) * 1000;
  cache.set(key, { tgUser, raw: initData, until: Math.min(Date.now() + CACHE_MS, expires) });
  return tgUser;
}

/** Resolve a user from initData (or a dev user in DEV_MODE). Creates/updates the DB row. */
export function authenticate(initData, devUserId) {
  let tgUser = validateCached(initData);
  if (!tgUser && config.devMode && devUserId) {
    tgUser = { id: String(devUserId), first_name: `Dev ${devUserId}`, username: `dev${devUserId}` };
  }
  if (!tgUser) return null;
  // Only write to the database when the user is new or changed their name
  const existing = getUser(tgUser.id);
  if (existing && existing.username === (tgUser.username || null) && existing.first_name === (tgUser.first_name || null)) return existing;
  return upsertUser(tgUser);
}

/** Express middleware: expects header `Authorization: tma <initData>` */
export function requireAuth(req, res, next) {
  if (failedTooOften(req.ip)) return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  const h = req.get('authorization') || '';
  const initData = h.startsWith('tma ') ? h.slice(4) : '';
  const user = authenticate(initData, req.get('x-dev-user'));
  if (!user) { recordAuthFailure(req.ip); return res.status(401).json({ error: 'Unauthorized' }); }
  if (!allow(`apiu:${user.id}`, config.apiRateUser, 60 * 1000)) return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  req.user = user;
  next();
}

// Failed logins per IP: after AUTH_FAIL_RATE_IP failures in a minute, that IP is refused for the rest of the minute.
export const failedTooOften = (ip) => hits(`authfail:${ip}`, 60 * 1000) >= config.authFailRateIp;
export const recordAuthFailure = (ip) => allow(`authfail:${ip}`, Infinity, 60 * 1000);
