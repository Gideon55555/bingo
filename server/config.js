import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: num(process.env.PORT, 3000),
  botToken: process.env.BOT_TOKEN || '',
  webAppUrl: (process.env.WEBAPP_URL || '').replace(/\/+$/, ''),
  adminIds: list(process.env.ADMIN_IDS),
  // Password for the browser admin panel at /admin (min 8 chars; empty = browser login disabled)
  adminPassword: (process.env.ADMIN_PASSWORD || '').length >= 8 ? process.env.ADMIN_PASSWORD : '',
  dbPath: process.env.DB_PATH || './data/bingo.db',

  // Game
  stakes: list(process.env.STAKES || '10,20,50,100').map(Number),
  cardCount: num(process.env.CARD_COUNT, 100),
  minPlayers: num(process.env.MIN_PLAYERS, 2),
  countdownSec: num(process.env.COUNTDOWN_SEC, 30),
  callIntervalMs: num(process.env.CALL_INTERVAL_MS, 3500),
  resultShowSec: num(process.env.RESULT_SHOW_SEC, 8),
  houseCut: num(process.env.HOUSE_CUT, 0.2),

  // Wallet
  currency: process.env.CURRENCY || 'ETB',
  paymentInfo: process.env.PAYMENT_INFO || 'Telebirr: 09XXXXXXXX (Your Name)',
  minDeposit: num(process.env.MIN_DEPOSIT, 10),
  minWithdraw: num(process.env.MIN_WITHDRAW, 50),

  // Dev mode lets you open the app in a normal browser without Telegram.
  // NEVER enable in production.
  devMode: process.env.DEV_MODE === 'true',
};
