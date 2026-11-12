// Encrypted backups, app error reports.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { encryptFile, decryptFile } from '../server/crypto-backup.js';

const PORT = 3987;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-polish-'));
const env = { ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: '1:x', BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', CRASH_ENABLED: 'false', KENO_ENABLED: 'false' };
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const post = (p, body, h = {}) => fetch(URL + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });

console.log('Encrypted backups');
const src = path.join(tmp, 'x.db');
fs.writeFileSync(src, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.from('balance phone 0911223344 '.repeat(500))]));
encryptFile(src, `${src}.enc`, 'correct horse');
const enc = fs.readFileSync(`${src}.enc`);
assert.ok(!enc.includes('SQLite') && !enc.includes('0911223344')); ok('encrypted file reveals nothing (no "SQLite", no phone numbers)');
assert.equal((fs.statSync(`${src}.enc`).mode & 0o777).toString(8), '600'); ok('encrypted file is private to the server user');
decryptFile(`${src}.enc`, `${src}.out`, 'correct horse');
assert.ok(fs.readFileSync(`${src}.out`).equals(fs.readFileSync(src))); ok('decrypts back to the exact same database');
assert.throws(() => decryptFile(`${src}.enc`, `${src}.bad`, 'wrong'), /Wrong password/); ok('wrong password refused');
const tampered = Buffer.from(enc); tampered[200] ^= 1; fs.writeFileSync(`${src}.t`, tampered);
assert.throws(() => decryptFile(`${src}.t`, `${src}.bad`, 'correct horse')); ok('a modified file is detected (authenticated encryption)');

const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  console.log('App error reports');
  for (let i = 0; i < 3; i++) await post('/api/client-error', { message: 'Cannot read properties of undefined (reading x)', stack: 'TypeError: …\n    at Pool (Pool-abc.js:1:200)', path: '/' });
  await post('/api/client-error', { message: 'x'.repeat(5000), stack: 'y'.repeat(10000), path: '/' });
  const items = (await (await fetch(`${URL}/api/admin/client-errors`, { headers: { 'x-admin-key': 'admin-password-1' } })).json()).items;
  const grouped = items.find((e) => e.message.startsWith('Cannot read'));
  assert.equal(grouped.count, 3); ok('same error from 3 phones is grouped (count 3)');
  assert.ok(items.every((e) => e.message.length <= 300 && (e.stack || '').length <= 2000)); ok('huge reports are trimmed');
  let last;
  for (let i = 0; i < 25; i++) last = await post('/api/client-error', { message: `spam ${i}` }, { 'X-Forwarded-For': '10.9.9.9' });
  assert.equal(last.status, 429); ok('error reports are rate-limited (no flooding)');
  assert.equal((await fetch(`${URL}/api/admin/client-errors`)).status, 401); ok('only admins can read them');
  console.log(`\nAll ${passed} backup & error-report checks passed ✅`);
} catch (e) { console.error(e); process.exitCode = 1; } finally { proc.kill(); setTimeout(() => process.exit(), 300); }
