// Promo banners for the home-screen carousel, managed in Admin → Banners.
// Uploads are re-encoded on the server (resized to 1080×540 WebP, ~60–120 KB): fast on mobile data,
// and any hidden data in the original file (phone GPS location, camera info, scripts) is thrown away.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, logAdmin } from './db.js';

export const BANNER_DIR = path.join(path.dirname(config.dbPath), 'banners');
fs.mkdirSync(BANNER_DIR, { recursive: true });
db.exec(`CREATE TABLE IF NOT EXISTS banners (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file       TEXT NOT NULL,
  title      TEXT,
  subtitle   TEXT,
  cta        TEXT,
  target     TEXT,              -- game to open (aviator, bingo, keno, ludo, pool, kerenbula), 'wallet', 'invite' or ''
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);

const TARGETS = ['', 'aviator', 'bingo', 'keno', 'ludo', 'pool', 'kerenbula', 'hunt', 'wallet', 'invite'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const clean = (m) => ({
  title: clip(m.title, 60), subtitle: clip(m.subtitle, 90), cta: clip(m.cta, 20),
  target: TARGETS.includes(String(m.target || '')) ? String(m.target || '') : '',
});

/** Is this really a JPEG / PNG / WebP? (checks the file's first bytes, not what the browser claims) */
function isImage(buf) {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
  return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP'; // WebP
}

// The image library is loaded on first upload, not at startup: it has no build for some platforms
// (e.g. an Android phone running Termux), and the rest of the app must still run there.
let sharpLib;
async function loadSharp() {
  if (sharpLib === undefined) {
    try { sharpLib = (await import('sharp')).default; } catch { sharpLib = null; }
  }
  if (!sharpLib) throw new Error('Banner uploads are not available on this server (image library missing)');
  return sharpLib;
}

export async function addBanner(buf, meta, who) {
  if (!Buffer.isBuffer(buf) || !isImage(buf)) throw new Error('Upload a JPG, PNG or WebP image');
  const sharp = await loadSharp();
  let out;
  try {
    out = await sharp(buf, { limitInputPixels: 40_000_000, failOn: 'error' })
      .rotate() // respect the phone's orientation
      .resize({ width: 1080, height: 540, fit: 'cover', position: 'attention' })
      .webp({ quality: 80 })
      .toBuffer();
  } catch { throw new Error('This image could not be read — try another file'); }
  const file = `${crypto.randomBytes(12).toString('hex')}.webp`;
  fs.writeFileSync(path.join(BANNER_DIR, file), out, { mode: 0o644 });
  const sort = (db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM banners').get().m || 0) + 1;
  const m = clean(meta);
  const id = db.prepare('INSERT INTO banners (file, title, subtitle, cta, target, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .run(file, m.title, m.subtitle, m.cta, m.target, sort).lastInsertRowid;
  logAdmin(who, 'banner_added', id, { title: m.title, kb: Math.round(out.length / 1024) }, who?.ip);
  return getBanner(id);
}

const getBanner = (id) => db.prepare('SELECT * FROM banners WHERE id = ?').get(Number(id));
export const listBanners = () => db.prepare('SELECT * FROM banners ORDER BY sort, id').all();
export const activeBanners = () => db.prepare('SELECT id, file, title, subtitle, cta, target FROM banners WHERE active = 1 ORDER BY sort, id').all()
  .map((b) => ({ ...b, url: `/banners/${b.file}` }));

export function updateBanner(id, patch, who) {
  const b = getBanner(id);
  if (!b) throw new Error('Banner not found');
  const m = clean({ ...b, ...patch });
  const active = patch.active === undefined ? b.active : (patch.active ? 1 : 0);
  db.prepare('UPDATE banners SET title = ?, subtitle = ?, cta = ?, target = ?, active = ? WHERE id = ?').run(m.title, m.subtitle, m.cta, m.target, active, b.id);
  if (patch.move === 'up' || patch.move === 'down') {
    const all = listBanners();
    const i = all.findIndex((x) => x.id === b.id);
    const j = patch.move === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < all.length) {
      [all[i], all[j]] = [all[j], all[i]];
      const set = db.prepare('UPDATE banners SET sort = ? WHERE id = ?');
      db.transaction(() => all.forEach((x, k) => set.run(k + 1, x.id)))();
    }
  }
  logAdmin(who, 'banner_changed', b.id, { ...m, active: !!active }, who?.ip);
  return getBanner(b.id);
}

export function deleteBanner(id, who) {
  const b = getBanner(id);
  if (!b) throw new Error('Banner not found');
  db.prepare('DELETE FROM banners WHERE id = ?').run(b.id);
  fs.rmSync(path.join(BANNER_DIR, b.file), { force: true });
  logAdmin(who, 'banner_deleted', b.id, b.title, who?.ip);
  return { ok: true };
}
