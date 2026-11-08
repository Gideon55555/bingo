// Promo banners: upload (admin only), real images only, resized + metadata stripped, order/hide/delete, safe serving.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const PORT = 3973, URL = `http://localhost:${PORT}`, TOKEN = '123456:BAN_TOKEN';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-banners-'));
const env = { ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', CRASH_ENABLED: 'false', KENO_ENABLED: 'false' };
const admin = { 'x-admin-key': 'admin-password-1' };
const sign = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  params.set('hash', crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(dcs).digest('hex'));
  return params.toString();
};
const up = (body, type, meta = {}, h = admin) => fetch(`${URL}/api/admin/banners?${new URLSearchParams(meta)}`, { method: 'POST', headers: { ...h, 'Content-Type': type }, body });
const json = async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) });
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  // A 3000×2000 JPEG photo with GPS location in it, like one straight from a phone
  const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#c8102e' } })
    .jpeg().withExif({ IFD0: { Make: 'TestPhone', Artist: 'Secret Name' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '9/1 1/1 0/1' } }).toBuffer();
  assert.ok((await sharp(photo).metadata()).exif); // the original has hidden data
  console.log('Upload');
  let r = await json(await up(photo, 'image/jpeg', { title: 'Weekend jackpot', subtitle: 'Bingo 10,000 ETB', cta: 'Play now', target: 'bingo' }, {}));
  assert.equal(r.status, 401); ok('only admins can upload');
  r = await json(await up(photo, 'image/jpeg', { title: 'Weekend jackpot', subtitle: 'Bingo 10,000 ETB', cta: 'Play now', target: 'bingo' }));
  assert.equal(r.status, 200); const b1 = r.data;
  const served = await fetch(`${URL}/banners/${b1.file}`);
  const img = Buffer.from(await served.arrayBuffer());
  const meta = await sharp(img).metadata();
  assert.equal(meta.format, 'webp'); assert.equal(meta.width, 1080); assert.equal(meta.height, 540);
  ok(`3000×2000 phone photo → 1080×540 WebP, ${Math.round(img.length / 1024)} KB (was ${Math.round(photo.length / 1024)} KB)`);
  assert.equal(meta.exif, undefined); assert.ok(!img.includes('Secret Name')); ok('hidden data (GPS location, camera, name) removed');
  assert.match(served.headers.get('cache-control'), /immutable/); assert.equal(served.headers.get('content-type'), 'image/webp'); ok('served as an image, cached by phones');
  r = await json(await up(Buffer.from('<script>alert(1)</script>'.padEnd(200, ' ')), 'image/png', { title: 'x' }));
  assert.equal(r.status, 400); ok('a script pretending to be a PNG is refused');
  r = await json(await up(Buffer.alloc(9 * 1024 * 1024, 1), 'image/jpeg'));
  assert.equal(r.status, 413); ok('files over 8 MB refused');
  r = await json(await up(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), crypto.randomBytes(5000)]), 'image/jpeg'));
  assert.equal(r.status, 400); ok('a broken image is refused cleanly (no crash)');
  const png = await sharp({ create: { width: 1200, height: 600, channels: 4, background: '#e9b949' } }).png().toBuffer();
  const b2 = (await json(await up(png, 'image/png', { title: 'Aviator x1000', target: 'aviator', cta: 'Fly' }))).data;
  const b3 = (await json(await up(png, 'image/png', { title: 'x'.repeat(500), target: 'hack://site' }))).data;
  assert.equal(b3.title.length, 60); assert.equal(b3.target, ''); ok('long text trimmed, unknown button target ignored');

  console.log('Manage');
  const pub = async () => (await json(await fetch(`${URL}/api/banners`))).data.items;
  assert.deepEqual((await pub()).map((x) => x.id), [b1.id, b2.id, b3.id]); ok('players see banners in order');
  await fetch(`${URL}/api/admin/banners/${b2.id}`, { method: 'PATCH', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ move: 'up' }) });
  assert.deepEqual((await pub()).map((x) => x.id), [b2.id, b1.id, b3.id]); ok('move up/down reorders');
  await fetch(`${URL}/api/admin/banners/${b3.id}`, { method: 'PATCH', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) });
  assert.equal((await pub()).length, 2); ok('hidden banners disappear for players');
  await fetch(`${URL}/api/admin/banners/${b1.id}`, { method: 'DELETE', headers: admin });
  assert.equal((await fetch(`${URL}/banners/${b1.file}`)).status, 404); ok('deleting removes the picture too');
  for (const p of ['/banners/..%2Fbingo.db', '/banners/../bingo.db', '/banners/x.webp', `/banners/${b2.file}.js`]) {
    const res = await fetch(URL + p);
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(res.status !== 200 || (!body.includes('SQLite format') && res.headers.get('content-type') !== 'image/webp'), p);
  }
  ok('only real banner files can be fetched (no path tricks)');
  const lg = (await json(await fetch(`${URL}/api/admin/log`, { headers: admin }))).data.items.map((l) => l.action);
  assert.ok(lg.includes('banner_added') && lg.includes('banner_deleted')); ok('banner changes are in the admin log');
  console.log(`\nAll ${passed} banner checks passed ✅`);
} catch (e) { console.error(e); process.exitCode = 1; } finally { proc.kill(); setTimeout(() => process.exit(), 300); }
