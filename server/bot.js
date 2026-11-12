import { Bot, InlineKeyboard, InputFile, webhookCallback } from 'grammy';
import { config } from './config.js';
import { fmtMoney, fmt, toCents } from '../shared/money.js';
import { getUser, getTx, upsertUser } from './db.js';
import { tr } from './i18n.js';

export let bot = null;
const isAdmin = (id) => config.adminIds.includes(String(id));
let onReferral = null;
/** Set by the referral module: called when someone opens the bot from a friend's referral link. */
export const setReferralHandler = (fn) => { onReferral = fn; };
/** The bot's @username (for invite links). */
export const botUsername = () => {
  // grammY's botInfo getter throws until bot.init() succeeds (e.g. Telegram slow or unreachable at boot).
  try { return bot?.botInfo?.username || process.env.BOT_USERNAME || null; } catch { return process.env.BOT_USERNAME || null; }
};
const who = (t) => (t.username ? `@${t.username}` : t.first_name || t.user_id || t.id);
const money = (n) => fmtMoney(n, config.currency);
const adminWho = (ctx) => ({ id: `tg:${ctx.from.id}`, name: ctx.from.first_name || String(ctx.from.id) });
const notifyOtherAdmins = (exceptId, text) => Promise.all(config.adminIds.filter((a) => a !== String(exceptId)).map((a) => sendMessage(a, text)));
const fmtDate = (s) => new Date(s * 1000).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

function txText(t) {
  if (t.type === 'deposit') {
    return `💰 Deposit #${t.id}\nUser: ${who(t)} (id ${t.user_id})\nAmount: ${money(t.amount)}\nRef: ${t.reference}\n\n⚠️ Check that the money arrived before approving.`;
  }
  return `🏧 Withdrawal #${t.id}\nUser: ${who(t)} (id ${t.user_id})\nAmount: ${money(-t.amount)}\nSend to: ${t.phone}`;
}

function txKeyboard(t) {
  return t.type === 'deposit'
    ? new InlineKeyboard().text('✅ Approve', `dep:ok:${t.id}`).text('❌ Reject', `dep:no:${t.id}`)
    : new InlineKeyboard().text('✅ Mark paid', `wd:ok:${t.id}`).text('❌ Reject & refund', `wd:no:${t.id}`);
}

/** Send a message; returns true on success. Safe to call when bot is disabled. */
export async function sendMessage(chatId, text, extra) {
  if (!bot) return false;
  try {
    await bot.api.sendMessage(chatId, text, extra);
    return true;
  } catch {
    return false;
  }
}

export const notifyUser = (userId, text) => sendMessage(userId, text);

export async function sendDocumentToAdmins(filePath, caption) {
  if (!bot) return;
  for (const admin of config.adminIds) {
    await bot.api.sendDocument(admin, new InputFile(filePath), { caption }).catch((e) =>
      console.error('[bot] sending backup failed:', e.message));
  }
}

export async function stopBot() {
  if (bot && config.botMode === 'polling') await bot.stop().catch(() => {});
}

/** Notify all admins about a new pending transaction. */
export async function notifyAdmins(txId) {
  const raw = getTx(txId);
  const u = getUser(raw.user_id) || {};
  const t = { ...raw, username: u.username, first_name: u.first_name };
  for (const admin of config.adminIds) await sendMessage(admin, txText(t), { reply_markup: txKeyboard(t) });
}

const ADMIN_HELP = `🛠 Admin commands
/stats — today's and all-time numbers
/pending — deposits & withdrawals waiting for you
/user <id or @username> — player balance & history
/addbalance <id or @username> <amount> [note] — add (or subtract with a minus) balance
/broadcast <message> — message every player
/pause — stop new games (unstarted rounds are refunded)
/resume — allow games again
/backup — send yourself a copy of the database now
/admin — open the admin panel`;

export async function startBot({ actions, app }) {
  if (!config.botToken || process.env.BOT_DISABLED === 'true') {
    console.warn('Bot disabled (no BOT_TOKEN or BOT_DISABLED=true)');
    return;
  }
  bot = new Bot(config.botToken);

  const playKeyboard = (uid) => new InlineKeyboard().webApp(tr(uid, 'playButton'), config.webAppUrl);
  const adminOnly = (fn) => async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.reply('This command is for admins only.');
    try {
      await fn(ctx);
    } catch (e) {
      await ctx.reply(`⚠️ ${e.message}`);
    }
  };
  const args = (ctx) => (ctx.match || '').trim();

  // ---------- Player commands ----------
  bot.command('start', async (ctx) => {
    const payload = String(ctx.match || '').trim();
    // Invite link from a friend: t.me/<bot>?start=pool_ABC123 → button straight into that table
    const inv = payload.match(/^(pool|kb|ludo|hunt)_([A-Z0-9]{6})$/);
    if (inv) {
      upsertUser(ctx.from);
      return ctx.reply(tr(ctx.from.id, 'inviteOpen'), {
        reply_markup: new InlineKeyboard().webApp(tr(ctx.from.id, 'inviteButton'), `${config.webAppUrl}/?join=${inv[1]}_${inv[2]}`),
      });
    }
    // Referral link: t.me/<bot>?start=ref_<inviter id>
    const ref = payload.match(/^ref_(\d{1,20})$/);
    if (ref) onReferral?.(ctx.from, ref[1]);
    return ctx.reply(tr(ctx.from.id, 'welcome'), { reply_markup: playKeyboard(ctx.from.id) });
  });

  bot.command('balance', (ctx) => {
    const u = getUser(ctx.from.id);
    return ctx.reply(tr(ctx.from.id, 'balance', { amount: money(u ? u.balance : 0) }), { reply_markup: playKeyboard(ctx.from.id) });
  });

  bot.command('id', (ctx) => ctx.reply(tr(ctx.from.id, 'yourId', { id: ctx.from.id })));

  bot.command('help', (ctx) =>
    ctx.reply(isAdmin(ctx.from.id) ? ADMIN_HELP : tr(ctx.from.id, 'help')));

  // ---------- Admin commands ----------
  bot.command('admin', adminOnly((ctx) =>
    ctx.reply('Admin panel:', {
      reply_markup: new InlineKeyboard().webApp('🛠 Open admin panel', `${config.webAppUrl}/?admin=1`),
    })));

  bot.command('stats', adminOnly((ctx) => {
    const s = actions.stats();
    const b = (x) =>
      `Bingo games: ${x.games}  ·  ${config.crash.name} rounds: ${x.crashRounds}  ·  Keno draws: ${x.kenoRounds}  ·  Ludo games: ${x.ludoGames}  ·  Pool matches: ${x.poolGames}  ·  Kerenbula matches: ${x.kerenbulaGames}  ·  Dibibkosh games: ${x.huntGames}  ·  Bets: ${money(x.totalBets)}\n` +
      `🏦 House earned: ${money(x.houseEarnings)} (Bingo ${money(x.bingoEarnings)}, ${config.crash.name} ${money(x.crashEarnings)}, Keno ${money(x.kenoEarnings)}, Ludo ${money(x.ludoEarnings)}, Pool ${money(x.poolEarnings)}, Kerenbula ${money(x.kerenbulaEarnings)}, Dibibkosh ${money(x.huntEarnings)})\n` +
      `💰 Deposits: ${money(x.deposits)}  ·  🏧 Withdrawals: ${money(x.withdrawals)}\n` +
      `👥 Active players: ${x.activePlayers}  ·  New users: ${x.newUsers}`;
    const rooms = s.rooms.map((r) => `${fmt(r.stake)}: ${r.state}, ${r.players} players`).join('\n');
    return ctx.reply(
      `📊 TODAY\n${b(s.today)}\n\n📈 ALL TIME\n${b(s.allTime)}\n\n` +
      `Users: ${s.users}  ·  Player balances held: ${money(s.playerBalances)}\n` +
      `⏳ Pending: ${s.pendingDeposits.n} deposits (${money(s.pendingDeposits.total)}), ` +
      `${s.pendingWithdrawals.n} withdrawals (${money(s.pendingWithdrawals.total)})\n\n` +
      `🎱 Rooms ${s.paused ? '(⏸ PAUSED)' : ''}\n${rooms}`,
    );
  }));

  bot.command('pending', adminOnly(async (ctx) => {
    const list = actions.pending();
    if (!list.length) return ctx.reply('No pending requests 🎉');
    for (const t of list) await ctx.reply(txText(t), { reply_markup: txKeyboard(t) });
  }));

  bot.command('user', adminOnly((ctx) => {
    const q = args(ctx);
    if (!q) return ctx.reply('Usage: /user <id or @username>');
    const { user: u, history } = actions.userDetail(q);
    const lines = history.slice(0, 10).map((t) =>
      `${fmtDate(t.created_at)}  ${t.type}  ${t.amount > 0 ? '+' : ''}${fmt(t.amount)}${t.status !== 'done' ? ` (${t.status})` : ''}`);
    return ctx.reply(
      `👤 ${u.first_name || ''} ${u.username ? `@${u.username}` : ''}\nid: ${u.id}\n` +
      `Balance: ${money(u.balance)}\nDeposited: ${money(u.deposited ?? 0)}  ·  Withdrawn: ${money(u.withdrawn ?? 0)}\n` +
      `Games: ${u.games_played ?? 0}  ·  Wins: ${u.games_won ?? 0}\nJoined: ${fmtDate(u.created_at)}\n\n` +
      `Last transactions:\n${lines.join('\n') || '—'}`,
    );
  }));

  bot.command('addbalance', adminOnly(async (ctx) => {
    const [q, amount, ...note] = args(ctx).split(/\s+/);
    if (!q || !amount || !Number.isFinite(toCents(amount)) || toCents(amount) === 0) {
      return ctx.reply('Usage: /addbalance <id or @username> <amount> [note]\nExample: /addbalance @abebe 50 welcome bonus\nUse a negative amount to subtract.');
    }
    const u = await actions.adjust(q, toCents(amount), note.join(' '), adminWho(ctx));
    return ctx.reply(`✅ Done. ${who(u)} now has ${money(u.balance)}.`);
  }));

  bot.command('broadcast', adminOnly(async (ctx) => {
    const text = args(ctx);
    if (!text) return ctx.reply('Usage: /broadcast <message>');
    const job = actions.broadcast(text, adminWho(ctx));
    return ctx.reply(`📣 Sending to ${job.total} players… (about ${Math.ceil(job.total / 20)}s)`);
  }));

  bot.command('pause', adminOnly((ctx) => {
    const { refunded } = actions.pause(adminWho(ctx));
    return ctx.reply(`⏸ Games paused. ${refunded} waiting player(s) refunded. Running games will finish normally.\nUse /resume to reopen.`);
  }));

  bot.command('resume', adminOnly((ctx) => {
    actions.resume(adminWho(ctx));
    return ctx.reply('▶️ Games resumed.');
  }));

  bot.command('backup', adminOnly(async (ctx) => {
    await ctx.reply('🗄 Making a backup…');
    await actions.backup(adminWho(ctx));
  }));

  // ---------- Approve / reject buttons ----------
  bot.callbackQuery(/^(dep|wd):(ok|no):(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Not allowed' });
    const [, kind, action, idStr] = ctx.match;
    try {
      const t = await actions.decide(kind === 'dep' ? 'deposit' : 'withdraw', Number(idStr), action === 'ok', adminWho(ctx));
      if (t.awaitingSecond) {
        // Keep the buttons: a DIFFERENT admin must approve too
        await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n☑️ First approval by ${ctx.from.first_name} — needs a second admin to approve`, { reply_markup: ctx.callbackQuery.message.reply_markup });
        notifyOtherAdmins(ctx.from.id, `☑️ ${ctx.from.first_name} approved withdrawal #${t.id} (${money(-t.amount)} to ${t.phone}). It needs your approval too — see /pending.`);
        return ctx.answerCallbackQuery({ text: 'First approval recorded — a second admin must approve' });
      }
      const status = t.status === 'approved' ? '✅ APPROVED' : '❌ REJECTED';
      await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n${status} by ${ctx.from.first_name}`);
      return ctx.answerCallbackQuery({ text: status });
    } catch (e) {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      return ctx.answerCallbackQuery({ text: e.message });
    }
  });

  bot.catch((err) => console.error('Bot error:', err.message));

  const onReady = async () => {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Play bingo' },
      { command: 'balance', description: 'Your balance' },
      { command: 'help', description: 'Help' },
    ]).catch(() => {});
    for (const admin of config.adminIds) {
      await bot.api.setMyCommands([
        { command: 'admin', description: 'Open admin panel' },
        { command: 'stats', description: 'Stats' },
        { command: 'pending', description: 'Pending requests' },
        { command: 'user', description: 'Look up a player' },
        { command: 'addbalance', description: 'Add/subtract balance' },
        { command: 'broadcast', description: 'Message all players' },
        { command: 'pause', description: 'Pause games' },
        { command: 'resume', description: 'Resume games' },
        { command: 'backup', description: 'Get a database backup' },
        { command: 'help', description: 'All commands' },
      ], { scope: { type: 'chat', chat_id: Number(admin) } }).catch(() => {});
    }
    // The bot's own name in Telegram follows the app name (Telegram allows this only a few times a day)
    if (config.appName) {
      const cur = await bot.api.getMyName().catch(() => null);
      if (cur && cur.name !== config.appName) await bot.api.setMyName(config.appName).catch((e) => console.error('setMyName failed', e.message));
    }
    if (config.webAppUrl) {
      await bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: 'Play', web_app: { url: config.webAppUrl } },
      }).catch((e) => console.error('setChatMenuButton failed', e.message));
    }
  };

  if (config.botMode === 'webhook') {
    // Telegram pushes updates to https://your-app/tg-webhook/<secret>. Works on shared hosting.
    app.post(config.webhookPath, webhookCallback(bot, 'express', { secretToken: config.webhookSecret }));
    try {
      await bot.init();
      await bot.api.setWebhook(`${config.webAppUrl}${config.webhookPath}`, {
        secret_token: config.webhookSecret,
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query'],
      });
      console.log(`Bot @${bot.botInfo.username} started (webhook)`);
      await onReady();
    } catch (e) {
      console.error('Bot webhook setup failed:', e.message);
    }
    return;
  }

  // Polling mode (also removes any old webhook automatically)
  bot.start({
    allowed_updates: ['message', 'callback_query'],
    onStart: async (me) => {
      console.log(`Bot @${me.username} started (polling)`);
      await onReady();
    },
  }).catch((e) => console.error('Bot failed to start:', e.message));
}
