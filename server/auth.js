import crypto from 'node:crypto';
import { config } from './config.js';
import { upsertUser } from './db.js';

const MAX_AGE_SEC = 24 * 60 * 60;

/**
 * Validates Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Returns the Telegram user object, or null if invalid.
 */
export function validateInitData(initData, botToken = config.botToken) {
  if (!initData || !botToken) return null;
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
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return null;

  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

/** Resolve a user from initData (or a dev user in DEV_MODE). Creates/updates the DB row. */
export function authenticate(initData, devUserId) {
  let tgUser = validateInitData(initData);
  if (!tgUser && config.devMode && devUserId) {
    tgUser = { id: String(devUserId), first_name: `Dev ${devUserId}`, username: `dev${devUserId}` };
  }
  if (!tgUser) return null;
  return upsertUser(tgUser);
}

/** Express middleware: expects header `Authorization: tma <initData>` */
export function requireAuth(req, res, next) {
  const h = req.get('authorization') || '';
  const initData = h.startsWith('tma ') ? h.slice(4) : '';
  const user = authenticate(initData, req.get('x-dev-user'));
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}
