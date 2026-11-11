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
  // Max game actions per player per 10 seconds (anti-spam)
  socketRate: num(process.env.SOCKET_RATE, 30),

  // ---- Security & limits ----
  // How many reverse proxies sit in front of the app (Caddy/Nginx/Passenger = 1, plus Cloudflare = 2).
  // Used to read the real visitor IP. 0 = the app is exposed directly.
  trustProxy: num(process.env.TRUST_PROXY, 1),
  // Ethiopian mobile carriers put many phones behind ONE public IP (carrier-grade NAT), so per-IP
  // limits are generous and the real per-player limits are per Telegram user.
  apiRateIp: num(process.env.API_RATE_IP, 3000),        // API requests per minute per IP
  apiRateUser: num(process.env.API_RATE_USER, 120),     // API requests per minute per player
  walletRate: num(process.env.WALLET_RATE, 5),          // deposit/withdraw requests per 10 minutes per player
  connRateIp: num(process.env.CONN_RATE_IP, 600),       // new socket connections per minute per IP
  authFailRateIp: num(process.env.AUTH_FAIL_RATE_IP, 60), // failed logins per minute per IP before blocking
  maxSocketsPerUser: num(process.env.MAX_SOCKETS_PER_USER, 5),
  initDataMaxAgeSec: num(process.env.INITDATA_MAX_AGE_HOURS, 24) * 3600,
  // Browser admin panel 2-step login: base32 secret from `npm run admin:2fa` (empty = password only)
  adminTotpSecret: (process.env.ADMIN_TOTP_SECRET || '').replace(/\s/g, ''),
  adminSessionHours: num(process.env.ADMIN_SESSION_HOURS, 12),
  // Players must confirm they are MIN_AGE+ (21) before playing or depositing (always on in production)
  requireAgeConfirm: process.env.AGE_CONFIRM ? process.env.AGE_CONFIRM === 'true' : process.env.NODE_ENV === 'production',
  // Withdrawals of this amount or more need a second, different admin (only when ADMIN_IDS has 2+ admins)
  withdrawSecondApproval: cents(process.env.WITHDRAW_SECOND_APPROVAL, 5000),
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
  bingoEnabled: process.env.BINGO_ENABLED !== 'false',   // admin can hide Bingo like any other game
  cardCount: num(process.env.CARD_COUNT, 100),
  maxCards: Math.max(1, num(process.env.BINGO_MAX_CARDS, 3)), // cards one player may hold per round
  minPlayers: num(process.env.MIN_PLAYERS, 2),
  countdownSec: num(process.env.COUNTDOWN_SEC, 30),
  callIntervalMs: num(process.env.CALL_INTERVAL_MS, 3500),
  resultShowSec: num(process.env.RESULT_SHOW_SEC, 8),
  houseCut: num(process.env.HOUSE_CUT, 0.2),

  // Rocket (crash game). Amounts in ETB in .env, cents internally.
  crash: {
    enabled: process.env.CRASH_ENABLED !== 'false',
    name: process.env.CRASH_NAME || 'Aviator',
    houseEdge: num(process.env.CRASH_HOUSE_EDGE, 0.03),
    minBet: cents(process.env.CRASH_MIN_BET, 5),
    maxBet: cents(process.env.CRASH_MAX_BET, 5000),
    maxWin: cents(process.env.CRASH_MAX_WIN, 100000),
    betSec: num(process.env.CRASH_BET_SEC, 7),
    maxMultiplier: Math.round(num(process.env.CRASH_MAX_MULTIPLIER, 1000) * 100), // x100
  },

  // Keno. Amounts in ETB in .env, cents internally.
  keno: {
    enabled: process.env.KENO_ENABLED !== 'false',
    minBet: cents(process.env.KENO_MIN_BET, 5),
    maxBet: cents(process.env.KENO_MAX_BET, 2000),
    maxWin: cents(process.env.KENO_MAX_WIN, 100000),
    betSec: num(process.env.KENO_BET_SEC, 40),
    ballMs: num(process.env.KENO_BALL_MS, 600),
    resultSec: num(process.env.KENO_RESULT_SEC, 7),
  },

  // Ludo (player vs player). Stakes in ETB in .env, cents internally.
  ludo: {
    enabled: process.env.LUDO_ENABLED !== 'false',
    stakes: list(process.env.LUDO_STAKES || '10,20,50,100').map(toCents),
    houseCut: num(process.env.LUDO_HOUSE_CUT, 0.1),
    tokens: Math.min(4, Math.max(1, num(process.env.LUDO_TOKENS, 2))),
    turnSec: num(process.env.LUDO_TURN_SEC, 15),
    maxMisses: num(process.env.LUDO_MAX_MISSES, 3),
    stepMs: num(process.env.LUDO_STEP_MS, 140),
    delayScale: num(process.env.LUDO_DELAY_SCALE, 1),
  },

  // 8-ball pool (1 vs 1). Stakes in ETB in .env, cents internally.
  pool: {
    enabled: process.env.POOL_ENABLED !== 'false',
    stakes: list(process.env.POOL_STAKES || '10,20,50,100').map(toCents),
    // Players per table: 2 = 8-ball (1 vs 1); 3–6 = Cutthroat
    sizes: list(process.env.POOL_SIZES || '2').map(Number).filter((n) => n >= 2 && n <= 6),
    houseCut: num(process.env.POOL_HOUSE_CUT, 0.1),
    shotSec: num(process.env.POOL_SHOT_SEC, 30),
    maxMisses: num(process.env.POOL_MAX_MISSES, 3),
    delayScale: num(process.env.POOL_DELAY_SCALE, 1), // < 1 only for automated tests
  },

  // ከረንቡላ Kerenbula (1 vs 1, hand-rolled table bocce with pins)
  kerenbula: {
    enabled: process.env.KERENBULA_ENABLED !== 'false',
    stakes: list(process.env.KERENBULA_STAKES || '10,20,50,100').map(toCents),
    houseCut: num(process.env.KERENBULA_HOUSE_CUT, 0.1),
    target: num(process.env.KERENBULA_TARGET, 11),      // first to this many points (checked at the end of a frame)
    maxFrames: num(process.env.KERENBULA_MAX_FRAMES, 7), // after this, the leader wins (a tie plays one more frame)
    pinPoints: num(process.env.KERENBULA_PIN_POINTS, 4),
    rollSec: num(process.env.KERENBULA_ROLL_SEC, 25),
    maxMisses: num(process.env.KERENBULA_MAX_MISSES, 3),
    delayScale: num(process.env.KERENBULA_DELAY_SCALE, 1), // < 1 only for automated tests
  },

  // ድብብቆሽ Dibibkosh (4 players hide from the hunter on a 3×3 board)
  hunt: {
    enabled: process.env.HUNT_ENABLED !== 'false',
    stakes: list(process.env.HUNT_STAKES || '10,20,50,100').map(toCents),
    houseCut: num(process.env.HUNT_HOUSE_CUT, 0.1),
    moveSec: num(process.env.HUNT_MOVE_SEC, 3),            // the 3-2-1 count for each move
    jumpAny: process.env.HUNT_JUMP_ANY === 'true',          // default: the cop moves one step, like the players (true = may jump anywhere)
    surprise: num(process.env.HUNT_SURPRISE, 0.15),        // share of moves where the hunter picks a random box
    delayScale: num(process.env.HUNT_DELAY_SCALE, 1),      // < 1 only for automated tests
  },

  // Growth: referrals, daily reward. Amounts in ETB in .env (0 = off).
  growth: {
    signupBonus: cents(process.env.SIGNUP_BONUS, 0),                // to every new player (once per phone)
    referralBonus: cents(process.env.REFERRAL_BONUS, 10),           // to the inviter
    referralFriendBonus: cents(process.env.REFERRAL_FRIEND_BONUS, 0), // to the new player
    referralMinDeposit: cents(process.env.REFERRAL_MIN_DEPOSIT, 50),   // friend's first deposit must be at least this
    dailyReward: cents(process.env.DAILY_REWARD, 2),
    bonusWager: num(process.env.BONUS_WAGER, 1),                       // bonus must be played this many times before withdrawal
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
  appName: process.env.APP_NAME || '',

  // Shown on the Rules screen
  supportContact: process.env.SUPPORT_CONTACT || '',
  minAge: num(process.env.MIN_AGE, 21),

  // Backups
  backupDir: fromRoot(process.env.BACKUP_DIR || './backups'),
  backupKeep: num(process.env.BACKUP_KEEP, 14),
  backupHour: num(process.env.BACKUP_HOUR, 4), // local time
  backupToTelegram: process.env.BACKUP_TO_TELEGRAM !== 'false',
  // Copies sent to Telegram are encrypted with this password (decrypt: npm run backup:decrypt)
  backupPassword: process.env.BACKUP_PASSWORD || '',

  // Dev mode lets you open the app in a normal browser without Telegram.
  // NEVER enable in production.
  devMode: process.env.DEV_MODE === 'true',
  // Demo Bingo players with play money, for testing and demos only. Refused when NODE_ENV=production.
  demo: { players: process.env.DEMO_PLAYERS === 'true', count: num(process.env.DEMO_PLAYERS_COUNT, 10) },
};

/** Refuse to start with dangerous settings in production. */
export function checkConfig() {
  const errors = [];
  const warnings = [];
  if (config.production) {
    if (config.devMode) errors.push('DEV_MODE=true is not allowed in production (anyone could log in as anyone).');
    if (config.demo.players) errors.push('DEMO_PLAYERS=true is not allowed in production (demo players are for testing with play money only).');
    if (!config.botToken) errors.push('BOT_TOKEN is required.');
    if (!config.webAppUrl.startsWith('https://')) errors.push('WEBAPP_URL must be your public https:// address.');
    if (!config.adminIds.length) warnings.push('ADMIN_IDS is empty — nobody can approve deposits from the bot.');
    if (!config.adminPassword) warnings.push('ADMIN_PASSWORD not set (or < 8 chars) — browser admin panel is disabled.');
    if (/09X|Your Name/.test(config.paymentInfo)) warnings.push('PAYMENT_INFO still has the placeholder text.');
    if (config.adminPassword && (config.adminPassword.length < 12 || /^(admin|password|123|qwerty)/i.test(config.adminPassword)))
      warnings.push('ADMIN_PASSWORD is weak — use at least 12 random characters.');
    if (config.adminPassword && !config.adminTotpSecret) warnings.push('ADMIN_TOTP_SECRET not set — the browser admin panel only needs a password. Run "npm run admin:2fa" to add a 6-digit code.');
    if (config.backupToTelegram && !config.backupPassword) warnings.push('BACKUP_PASSWORD not set — backups sent to Telegram are NOT encrypted (they contain balances and phone numbers).');
    if (config.trustProxy === 0) warnings.push('TRUST_PROXY=0: make sure nothing sits in front of the app, or rate limits will see one IP for everyone.');
  } else if (config.devMode) {
    warnings.push('DEV_MODE is ON — anyone can log in as any user. Never use this in production.');
  }
  if (config.houseCut < 0 || config.houseCut >= 1) errors.push('HOUSE_CUT must be between 0 and 0.99.');
  if (config.crash.houseEdge < 0 || config.crash.houseEdge >= 0.5) errors.push('CRASH_HOUSE_EDGE must be between 0 and 0.5.');
  if (config.keno.minBet <= 0 || config.keno.maxBet < config.keno.minBet) errors.push('KENO_MIN_BET / KENO_MAX_BET are invalid.');
  if (config.crash.minBet <= 0 || config.crash.maxBet < config.crash.minBet) errors.push('CRASH_MIN_BET / CRASH_MAX_BET are invalid.');
  if (!config.stakes.length || config.stakes.some((s) => !Number.isInteger(s) || s <= 0)) errors.push('STAKES must be positive amounts.');
  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e}`);
    process.exit(1);
  }
}
