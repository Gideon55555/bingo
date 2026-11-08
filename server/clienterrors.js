// App errors reported from players' phones, so problems are noticed before players complain.
// Same error on the same screen is grouped (count + last seen). Kept for 30 days.
import crypto from 'node:crypto';
import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS client_errors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fp         TEXT NOT NULL UNIQUE,        -- fingerprint: message + first stack line
  message    TEXT NOT NULL,
  stack      TEXT,
  path       TEXT,
  ua         TEXT,
  user_id    TEXT,
  count      INTEGER NOT NULL DEFAULT 1,
  first_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  last_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
`);
const upsert = db.prepare(`INSERT INTO client_errors (fp, message, stack, path, ua, user_id) VALUES (@fp, @message, @stack, @path, @ua, @user_id)
  ON CONFLICT(fp) DO UPDATE SET count = count + 1, last_at = unixepoch(), user_id = COALESCE(excluded.user_id, user_id), ua = excluded.ua`);
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

export function recordClientError(body, userId) {
  const message = clip(body?.message, 300);
  if (!message) return;
  const stack = clip(body.stack, 2000);
  const fp = crypto.createHash('sha1').update(`${message}|${(stack || '').split('\n')[1] || ''}`).digest('hex');
  upsert.run({ fp, message, stack, path: clip(body.path, 120), ua: clip(body.ua, 200), user_id: userId ? String(userId) : null });
}

export const listClientErrors = () => {
  db.prepare('DELETE FROM client_errors WHERE last_at < unixepoch() - 30 * 86400').run();
  return db.prepare('SELECT * FROM client_errors ORDER BY last_at DESC LIMIT 100').all();
};
