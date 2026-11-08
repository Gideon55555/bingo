// Time-based one-time passwords (RFC 6238) — the 6-digit codes from Google Authenticator,
// Microsoft Authenticator, Authy, etc. No external library needed.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function totp(secret, time = Date.now(), step = 30) {
  const counter = Math.floor(time / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6;
  return String(code).padStart(6, '0');
}

const used = new Map(); // code+step -> time, so a code can't be replayed
/** Accepts the current code or the one before/after (phone clocks drift a little). Each code works once. */
export function verifyTotp(secret, code, time = Date.now()) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  for (const drift of [0, -1, 1]) {
    const t = time + drift * 30000;
    const expected = totp(secret, t);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) {
      const key = `${code}:${Math.floor(t / 30000)}`;
      if (used.has(key)) return false;
      used.set(key, Date.now());
      for (const [k, at] of used) if (Date.now() - at > 120000) used.delete(k);
      return true;
    }
  }
  return false;
}
