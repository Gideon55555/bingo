// Password-encrypted backups (AES-256-GCM, key from scrypt). Used for the copies sent to Telegram,
// so a leaked chat or lost phone doesn't expose balances and phone numbers.
// File format: "BKP1" | salt(16) | iv(12) | tag(16) | ciphertext
import crypto from 'node:crypto';
import fs from 'node:fs';

const MAGIC = Buffer.from('BKP1');
const key = (password, salt) => crypto.scryptSync(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function encryptFile(src, dest, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(password, salt), iv);
  const body = Buffer.concat([c.update(fs.readFileSync(src)), c.final()]);
  fs.writeFileSync(dest, Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]), { mode: 0o600 });
  return dest;
}

export function decryptFile(src, dest, password) {
  const buf = fs.readFileSync(src);
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not an encrypted backup file');
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(32, 48);
  const d = crypto.createDecipheriv('aes-256-gcm', key(password, salt), iv);
  d.setAuthTag(tag);
  let out;
  try { out = Buffer.concat([d.update(buf.subarray(48)), d.final()]); } catch { throw new Error('Wrong password (or the file is damaged)'); }
  fs.writeFileSync(dest, out, { mode: 0o600 });
  return dest;
}
