// Daily database backups: kept on disk, and (optionally) sent to admins on Telegram
// so you always have an off-server copy.
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { sendDocumentToAdmins } from './bot.js';
import { encryptFile } from './crypto-backup.js';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function runBackup({ sendToTelegram = config.backupToTelegram, label = 'daily' } = {}) {
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const time = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  const file = path.join(config.backupDir, `bingo-${today()}-${time}.db`);
  await db.backup(file);
  fs.chmodSync(file, 0o600);
  // Prove the copy is usable before trusting it
  const copy = new Database(file, { readonly: true });
  const check = copy.pragma('integrity_check', { simple: true });
  const users = copy.prepare('SELECT COUNT(*) n FROM users').get().n;
  copy.close();
  if (check !== 'ok') throw new Error(`backup integrity check failed: ${check}`);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

  // Keep only the newest N backups
  const files = fs.readdirSync(config.backupDir).filter((f) => /^bingo-.*\.db$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - config.backupKeep))) {
    fs.rmSync(path.join(config.backupDir, old), { force: true });
  }

  const sizeKb = Math.round(fs.statSync(file).size / 1024);
  console.log(`[backup] ${label} backup saved: ${path.basename(file)} (${sizeKb} KB, ${users} users, verified, sha256 ${sha})`);
  if (sendToTelegram) {
    if (config.backupPassword) {
      const enc = encryptFile(file, `${file}.enc`, config.backupPassword);
      await sendDocumentToAdmins(enc, `🔒 ${label} backup ${today()} (${sizeKb} KB, ${users} users, verified ✅, sha256 ${sha}). Encrypted — open with: npm run backup:decrypt -- ${path.basename(enc)}`);
      fs.rmSync(enc, { force: true });
    } else {
      await sendDocumentToAdmins(file, `🗄 ${label} backup ${today()} (${sizeKb} KB, ${users} users, verified ✅, sha256 ${sha}). Keep this file safe — it contains balances and phone numbers. Set BACKUP_PASSWORD to encrypt these.`);
    }
  }
  return file;
}

/** Check every 15 minutes; run once per day after BACKUP_HOUR (local time). */
export function scheduleBackups() {
  const check = async () => {
    const already = fs.existsSync(config.backupDir)
      && fs.readdirSync(config.backupDir).some((f) => f.startsWith(`bingo-${today()}`));
    if (!already && new Date().getHours() >= config.backupHour) {
      await runBackup().catch((e) => console.error('[backup] failed:', e.message));
    }
  };
  setTimeout(check, 30 * 1000).unref();
  setInterval(check, 15 * 60 * 1000).unref();
}
