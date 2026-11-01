import { Bot, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import {
  getUser, pendingTx, approveDeposit, rejectDeposit, markWithdrawalPaid, rejectWithdrawal, getTx,
} from './db.js';

export let bot = null;
const isAdmin = (id) => config.adminIds.includes(String(id));
const who = (t) => (t.username ? `@${t.username}` : t.first_name || t.user_id);
const money = (n) => `${n} ${config.currency}`;

function txText(t) {
  if (t.type === 'deposit') {
    return `💰 Deposit #${t.id}\nUser: ${who(t)} (id ${t.user_id})\nAmount: ${money(t.amount)}\nRef: ${t.reference}`;
  }
  return `🏧 Withdrawal #${t.id}\nUser: ${who(t)} (id ${t.user_id})\nAmount: ${money(-t.amount)}\nSend to: ${t.phone}`;
}

function txKeyboard(t) {
  return t.type === 'deposit'
    ? new InlineKeyboard().text('✅ Approve', `dep:ok:${t.id}`).text('❌ Reject', `dep:no:${t.id}`)
    : new InlineKeyboard().text('✅ Mark paid', `wd:ok:${t.id}`).text('❌ Reject & refund', `wd:no:${t.id}`);
}

/** Notify all admins about a new pending transaction. */
export async function notifyAdmins(txId) {
  if (!bot) return;
  const raw = getTx(txId);
  const t = { ...raw, ...pickUser(raw.user_id) };
  for (const admin of config.adminIds) {
    await bot.api.sendMessage(admin, txText(t), { reply_markup: txKeyboard(t) }).catch((e) =>
      console.error('notify admin failed', e.message));
  }
}

export async function notifyUser(userId, text) {
  if (!bot) return;
  await bot.api.sendMessage(userId, text).catch(() => {});
}

function pickUser(id) {
  const u = getUser(id) || {};
  return { username: u.username, first_name: u.first_name };
}

export function startBot({ onBalanceChange }) {
  if (!config.botToken || process.env.BOT_DISABLED === 'true') {
    console.warn('Bot disabled (no BOT_TOKEN or BOT_DISABLED=true)');
    return;
  }
  bot = new Bot(config.botToken);

  const playKeyboard = () => new InlineKeyboard().webApp('🎱 Play Bingo', config.webAppUrl);

  bot.command('start', (ctx) =>
    ctx.reply('Welcome to Bingo! Pick a card, wait for the numbers, and shout BINGO first to win the pot.', {
      reply_markup: playKeyboard(),
    }));

  bot.command('balance', (ctx) => {
    const u = getUser(ctx.from.id);
    return ctx.reply(`Your balance: ${money(u ? u.balance : 0)}`, { reply_markup: playKeyboard() });
  });

  bot.command('pending', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const list = pendingTx();
    if (!list.length) return ctx.reply('No pending requests 🎉');
    for (const t of list) await ctx.reply(txText(t), { reply_markup: txKeyboard(t) });
  });

  bot.command('id', (ctx) => ctx.reply(`Your Telegram id: ${ctx.from.id}`));

  bot.callbackQuery(/^(dep|wd):(ok|no):(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Not allowed' });
    const [, kind, action, idStr] = ctx.match;
    const id = Number(idStr);
    let t;
    let userMsg;
    if (kind === 'dep' && action === 'ok') {
      t = approveDeposit(id);
      userMsg = t && `✅ Your deposit of ${money(t.amount)} was approved.`;
    } else if (kind === 'dep') {
      t = rejectDeposit(id);
      userMsg = t && `❌ Your deposit of ${money(t.amount)} (ref ${t.reference}) was rejected. Contact support if this is a mistake.`;
    } else if (action === 'ok') {
      t = markWithdrawalPaid(id);
      userMsg = t && `✅ Your withdrawal of ${money(-t.amount)} has been sent to ${t.phone}.`;
    } else {
      t = rejectWithdrawal(id);
      userMsg = t && `❌ Your withdrawal of ${money(-t.amount)} was rejected and refunded to your balance.`;
    }
    if (!t) return ctx.answerCallbackQuery({ text: 'Already handled' });

    onBalanceChange(t.user_id);
    await notifyUser(t.user_id, userMsg);
    const status = t.status === 'approved' ? '✅ APPROVED' : '❌ REJECTED';
    await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n${status} by ${ctx.from.first_name}`);
    return ctx.answerCallbackQuery({ text: status });
  });

  bot.catch((err) => console.error('Bot error:', err.message));

  bot.start({
    onStart: async (me) => {
      console.log(`Bot @${me.username} started`);
      if (config.webAppUrl) {
        await bot.api.setChatMenuButton({
          menu_button: { type: 'web_app', text: 'Play', web_app: { url: config.webAppUrl } },
        }).catch((e) => console.error('setChatMenuButton failed', e.message));
      }
    },
  }).catch((e) => console.error('Bot failed to start:', e.message));
}
