import dotenv from 'dotenv';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { toCents } from '../shared/money.js';

// Always load .env from the project root, no matter where the process is started from
// (shared hosting / Passenger often starts apps from a different working directory).
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

// "Today" in stats, backups and logs uses this timezone, not the server's (often UTC).
process.env.TZ = process.env.TIMEZONE || 'Africa/Addis_Ababa';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
// Amounts in .env are written in ETB; internally everything is cents.
const cents = (v, d) => toCents(v === undefined || v === '' ? d : v);
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const fromRoot = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const botToken = process.env.BOT_TOKEN || '';
const derived = (label) => crypto.createHash('sha256').update(`${label}:${botToken}`).digest('hex').slice(0, 40);

export const config = {
  production: process.env.NODE_ENV === 'production',
  port: num(process.env.PORT, 3000),
  timezone: process.env.TZ,
  botToken,
  webAppUrl: (process.env.WEBAPP_URL || '').replace(/\/+$/, ''),
  adminIds: list(process.env.ADMIN_IDS),
  // Password for the browser admin panel at /admin (min 8 chars; empty = browser login disabled)
  adminPassword: (process.env.ADMIN_PASSWORD || '').length >= 8 ? process.env.ADMIN_PASSWORD : '',
  dbPath: fromRoot(process.env.DB_PATH || './data/bingo.db'),

  // Bot: 'polling' (simple, good for a VPS) or 'webhook' (needed on shared hosting / Passenger)
  botMode: process.env.BOT_MODE === 'webhook' ? 'webhook' : 'polling',
  webhookPath: `/tg-webhook/${derived('path')}`,
  webhookSecret: derived('secret'),

  // Game
  stakes: list(process.env.STAKES || '10,20,50,100').map(toCents), // cents
  cardCount: num(process.env.CARD_COUNT, 100),
  minPlayers: num(process.env.MIN_PLAYERS, 2),
  countdownSec: num(process.env.COUNTDOWN_SEC, 30),
  callIntervalMs: num(process.env.CALL_INTERVAL_MS, 3500),
  resultShowSec: num(process.env.RESULT_SHOW_SEC, 8),
  houseCut: num(process.env.HOUSE_CUT, 0.2),

  // Rocket (crash game). Amounts in ETB in .env, cents internally.
  crash: {
    enabled: process.env.CRASH_ENABLED !== 'false',
    houseEdge: num(process.env.CRASH_HOUSE_EDGE, 0.03),
    minBet: cents(process.env.CRASH_MIN_BET, 5),
    maxBet: cents(process.env.CRASH_MAX_BET, 5000),
    maxWin: cents(process.env.CRASH_MAX_WIN, 100000),
    betSec: num(process.env.CRASH_BET_SEC, 7),
    maxMultiplier: Math.round(num(process.env.CRASH_MAX_MULTIPLIER, 1000) * 100), // x100
  },

  // Wallet
  currency: process.env.CURRENCY || 'ETB',
  paymentInfo: process.env.PAYMENT_INFO || 'Telebirr: 09XXXXXXXX (Your Name)',
  // (cents)
  minDeposit: cents(process.env.MIN_DEPOSIT, 10),
  maxDeposit: cents(process.env.MAX_DEPOSIT, 100000),
  minWithdraw: cents(process.env.MIN_WITHDRAW, 50),
  maxPendingDeposits: num(process.env.MAX_PENDING_DEPOSITS, 3),
  maxPendingWithdrawals: num(process.env.MAX_PENDING_WITHDRAWALS, 2),

  // Name shown in the app header
  appName: process.env.APP_NAME || 'Bingo',

  // Shown on the Rules screen
  supportContact: process.env.SUPPORT_CONTACT || '',
  minAge: num(process.env.MIN_AGE, 18),

  // Backups
  backupDir: fromRoot(process.env.BACKUP_DIR || './backups'),
  backupKeep: num(process.env.BACKUP_KEEP, 14),
  backupHour: num(process.env.BACKUP_HOUR, 4), // local time
  backupToTelegram: process.env.BACKUP_TO_TELEGRAM !== 'false',

  // Dev mode lets you open the app in a normal browser without Telegram.
  // NEVER enable in production.
  devMode: process.env.DEV_MODE === 'true',
};

/** Refuse to start with dangerous settings in production. */
export function checkConfig() {
  const errors = [];
  const warnings = [];
  if (config.production) {
    if (config.devMode) errors.push('DEV_MODE=true is not allowed in production (anyone could log in as anyone).');
    if (!config.botToken) errors.push('BOT_TOKEN is required.');
    if (!config.webAppUrl.startsWith('https://')) errors.push('WEBAPP_URL must be your public https:// address.');
    if (!config.adminIds.length) warnings.push('ADMIN_IDS is empty — nobody can approve deposits from the bot.');
    if (!config.adminPassword) warnings.push('ADMIN_PASSWORD not set (or < 8 chars) — browser admin panel is disabled.');
    if (/09X|Your Name/.test(config.paymentInfo)) warnings.push('PAYMENT_INFO still has the placeholder text.');
  } else if (config.devMode) {
    warnings.push('DEV_MODE is ON — anyone can log in as any user. Never use this in production.');
  }
  if (config.houseCut < 0 || config.houseCut >= 1) errors.push('HOUSE_CUT must be between 0 and 0.99.');
  if (config.crash.houseEdge < 0 || config.crash.houseEdge >= 0.5) errors.push('CRASH_HOUSE_EDGE must be between 0 and 0.5.');
  if (config.crash.minBet <= 0 || config.crash.maxBet < config.crash.minBet) errors.push('CRASH_MIN_BET / CRASH_MAX_BET are invalid.');
  if (!config.stakes.length || config.stakes.some((s) => !Number.isInteger(s) || s <= 0)) errors.push('STAKES must be positive amounts.');
  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e}`);
    process.exit(1);
  }
}
