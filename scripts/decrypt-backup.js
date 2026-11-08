// Turn an encrypted backup from Telegram back into a database file.
//   npm run backup:decrypt -- bingo-2026-11-08-040000.db.enc restored.db
// Asks for BACKUP_PASSWORD (or reads it from the environment / .env).
import readline from 'node:readline';
import { decryptFile } from '../server/crypto-backup.js';
import 'dotenv/config';

const [src, dest = src.replace(/\.enc$/, '') || 'restored.db'] = process.argv.slice(2);
if (!src) { console.error('Usage: npm run backup:decrypt -- <file.db.enc> [output.db]'); process.exit(1); }
let password = process.env.BACKUP_PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await new Promise((r) => rl.question('Backup password: ', (a) => { rl.close(); r(a); }));
}
try {
  decryptFile(src, dest, password);
  console.log(`✅ Decrypted to ${dest}. To restore: stop the app, copy it over data/bingo.db (delete bingo.db-wal / -shm), start the app.`);
} catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
