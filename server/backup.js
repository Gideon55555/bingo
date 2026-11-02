// Daily database backups: kept on disk, and (optionally) sent to admins on Telegram
// so you always have an off-server copy.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { sendDocumentToAdmins } from './bot.js';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function runBackup({ sendToTelegram = config.backupToTelegram, label = 'daily' } = {}) {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const time = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  const file = path.join(config.backupDir, `bingo-${today()}-${time}.db`);
  await db.backup(file);

  // Keep only the newest N backups
  const files = fs.readdirSync(config.backupDir).filter((f) => /^bingo-.*\.db$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - config.backupKeep))) {
    fs.rmSync(path.join(config.backupDir, old), { force: true });
  }

  const sizeKb = Math.round(fs.statSync(file).size / 1024);
  console.log(`[backup] ${label} backup saved: ${path.basename(file)} (${sizeKb} KB)`);
  if (sendToTelegram) await sendDocumentToAdmins(file, `🗄 ${label} backup ${today()} (${sizeKb} KB). Keep this file safe.`);
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
