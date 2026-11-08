// Chapa payment gateway (Telebirr, CBE Birr, M-Pesa, bank cards…): automatic deposits and payouts.
// Off until CHAPA_SECRET_KEY is set; the manual "send money + transaction ID" flow keeps working either way.
//
// Deposits:  app asks for a checkout → player pays on Chapa's page → Chapa calls our webhook / callback
//            → we ALWAYS re-check with Chapa's verify API (never trust the webhook alone) → balance credited.
//            Crediting is idempotent: the same payment can never be credited twice.
// Payouts:   withdrawals up to CHAPA_AUTO_PAYOUT_MAX with no fraud warnings are sent automatically;
//            bigger or flagged ones wait for an admin as before.
//
// API: https://developer.chapa.co — initialize, verify, transfers, banks, webhooks (x-chapa-signature).
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, getTx, approveDeposit, rejectDeposit, markWithdrawalPaid, logAdmin, getUser } from './db.js';

const c = () => config.chapa;
export const chapaEnabled = () => !!c().secretKey;

const cols = db.prepare('PRAGMA table_info(transactions)').all().map((x) => x.name);
if (!cols.includes('provider')) db.exec('ALTER TABLE transactions ADD COLUMN provider TEXT');
if (!cols.includes('payout_ref')) db.exec('ALTER TABLE transactions ADD COLUMN payout_ref TEXT');
if (!cols.includes('payout_status')) db.exec('ALTER TABLE transactions ADD COLUMN payout_status TEXT');

async function api(method, path, body) {
  const r = await fetch(`${c().baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c().secretKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof data.message === 'string' ? data.message : JSON.stringify(data.message || data).slice(0, 200);
    const e = new Error(`Chapa: ${msg || r.status}`);
    e.chapa = true; e.status = r.status;
    throw e;
  }
  return data;
}

const insertDeposit = db.prepare(`INSERT INTO transactions (user_id, type, amount, status, reference, note, provider)
  VALUES (?, 'deposit', ?, 'pending', ?, 'Chapa checkout', 'chapa')`);

/** Start a deposit: returns { txRef, checkoutUrl } for the player to pay on Chapa's page. */
export async function createCheckout(user, amount) {
  const txRef = `CH${user.id}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const id = insertDeposit.run(String(user.id), amount, txRef).lastInsertRowid;
  try {
    const r = await api('POST', '/transaction/initialize', {
      amount: (amount / 100).toFixed(2),
      currency: config.currency,
      first_name: (user.first_name || 'Player').slice(0, 40),
      last_name: (user.username || String(user.id)).slice(0, 40),
      tx_ref: txRef,
      callback_url: `${config.webAppUrl}/api/chapa/callback`,
      return_url: `${config.webAppUrl}/paid.html`,
      customization: { title: (config.appName || 'Games').slice(0, 16), description: 'Wallet deposit' },
    });
    const checkoutUrl = r?.data?.checkout_url;
    if (!checkoutUrl) throw new Error('Chapa did not return a checkout page');
    return { id, txRef, checkoutUrl };
  } catch (e) {
    db.prepare("UPDATE transactions SET status = 'rejected', note = ? WHERE id = ? AND status = 'pending'").run(`Chapa checkout failed: ${e.message}`.slice(0, 200), id);
    throw e.chapa ? new Error('The payment service is not available right now. Please try again or pay manually.') : e;
  }
}

const byRef = db.prepare("SELECT * FROM transactions WHERE reference = ? AND type = 'deposit' AND provider = 'chapa'");

/**
 * Check a Chapa deposit with Chapa's verify API and credit it once.
 * Returns { status: 'approved' | 'pending' | 'rejected', tx, credited }.
 * hooks.onCredited(tx) runs only the first time it is credited.
 */
export async function confirmDeposit(txRef, hooks = {}) {
  const t = byRef.get(String(txRef));
  if (!t) return { status: 'unknown' };
  if (t.status !== 'pending') return { status: t.status, tx: t };
  let v;
  try { v = await api('GET', `/transaction/verify/${encodeURIComponent(t.reference)}`); } catch (e) {
    if (e.status === 404 || e.status === 400) return { status: 'pending', tx: t }; // not paid yet
    throw e;
  }
  const d = v?.data || {};
  const paid = String(d.status || '').toLowerCase() === 'success';
  const amountOk = Math.round(Number(d.amount) * 100) >= t.amount;
  const currencyOk = !d.currency || String(d.currency).toUpperCase() === config.currency.toUpperCase();
  const refOk = !d.tx_ref || d.tx_ref === t.reference;
  if (paid && amountOk && currencyOk && refOk) {
    const done = approveDeposit(t.id); // atomic: only the first caller gets a row back
    if (done) {
      logAdmin({ name: 'chapa' }, 'approve_deposit', t.id, { amount: t.amount, user: t.user_id, ref: t.reference, auto: true });
      await hooks.onCredited?.(done);
      return { status: 'approved', tx: done, credited: true };
    }
    return { status: getTx(t.id).status, tx: getTx(t.id) };
  }
  if (paid && !amountOk) {
    console.warn(`[chapa] ${t.reference}: paid ${d.amount} but expected ${t.amount / 100} — left for an admin`);
    logAdmin({ name: 'chapa' }, 'chapa_amount_mismatch', t.id, { expected: t.amount, paid: d.amount });
    return { status: 'pending', tx: t };
  }
  if (['failed', 'cancelled', 'canceled', 'reversed'].includes(String(d.status || '').toLowerCase())) {
    rejectDeposit(t.id);
    return { status: 'rejected', tx: getTx(t.id) };
  }
  return { status: 'pending', tx: t };
}

/** Webhook signature: x-chapa-signature = HMAC-SHA256(payload, secret). Constant-time compare. */
export function validSignature(rawBody, headers) {
  const secret = c().webhookSecret || c().secretKey;
  if (!secret) return false;
  const sig = String(headers['x-chapa-signature'] || '');
  if (!/^[a-f0-9]{64}$/i.test(sig)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig.toLowerCase()));
}

// ---------------- payouts ----------------
let banksCache = { at: 0, list: [] };
async function bankCode(name) {
  if (/^\d+$/.test(String(name))) return Number(name);
  if (Date.now() - banksCache.at > 6 * 3600 * 1000) {
    const r = await api('GET', '/banks');
    banksCache = { at: Date.now(), list: Array.isArray(r.data) ? r.data : [] };
  }
  const want = String(name).toLowerCase().replace(/\s+/g, '');
  const b = banksCache.list.find((x) => String(x.name || x.slug || '').toLowerCase().replace(/\s+/g, '').includes(want));
  if (!b) throw new Error(`Chapa bank "${name}" not found`);
  return b.id ?? b.code;
}
const localPhone = (p) => String(p).replace(/^\+?251/, '0').replace(/\D/g, '');

/** Can this withdrawal be paid automatically? */
export function canAutoPay(t, flags = []) {
  return chapaEnabled() && c().autoPayoutMax > 0 && -t.amount <= c().autoPayoutMax && flags.length === 0
    && !(config.adminIds.length >= 2 && -t.amount >= config.withdrawSecondApproval);
}

/** Send a withdrawal through Chapa. The withdrawal stays "pending" until Chapa confirms the transfer. */
export async function sendPayout(t) {
  const reference = `PO${t.id}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  if (db.prepare("UPDATE transactions SET payout_ref = ?, payout_status = 'sending' WHERE id = ? AND status = 'pending' AND payout_ref IS NULL").run(reference, t.id).changes === 0) return null;
  try {
    const u = getUser(t.user_id);
    await api('POST', '/transfers', {
      account_name: (u?.first_name || 'Player').slice(0, 40),
      account_number: localPhone(t.phone),
      amount: (-t.amount / 100).toFixed(2),
      currency: config.currency,
      reference,
      bank_code: await bankCode(c().payoutBank),
    });
    db.prepare("UPDATE transactions SET payout_status = 'sent' WHERE id = ?").run(t.id);
    logAdmin({ name: 'chapa' }, 'auto_payout_sent', t.id, { amount: -t.amount, user: t.user_id, phone: t.phone, reference });
    return reference;
  } catch (e) {
    db.prepare("UPDATE transactions SET payout_status = 'failed', payout_ref = NULL WHERE id = ?").run(t.id);
    logAdmin({ name: 'chapa' }, 'auto_payout_failed', t.id, e.message.slice(0, 200));
    throw e;
  }
}

const byPayoutRef = db.prepare("SELECT * FROM transactions WHERE payout_ref = ? AND type = 'withdraw'");
/** Check a sent payout; marks the withdrawal paid when Chapa says it succeeded. */
export async function confirmPayout(reference, hooks = {}) {
  const t = byPayoutRef.get(String(reference));
  if (!t || t.status !== 'pending') return { status: t?.status || 'unknown' };
  const v = await api('GET', `/transfers/verify/${encodeURIComponent(reference)}`).catch(() => null);
  const s = String(v?.data?.status || '').toLowerCase();
  if (s === 'success') {
    const done = markWithdrawalPaid(t.id);
    if (done) { db.prepare("UPDATE transactions SET payout_status = 'paid' WHERE id = ?").run(t.id); await hooks.onPaid?.(done); }
    return { status: 'approved' };
  }
  if (['failed', 'reversed', 'cancelled'].includes(s)) {
    db.prepare("UPDATE transactions SET payout_status = 'failed', payout_ref = NULL WHERE id = ?").run(t.id);
    await hooks.onFailed?.(t);
    return { status: 'pending', failed: true };
  }
  return { status: 'pending' };
}

/** Background: re-check unconfirmed deposits/payouts, expire abandoned checkouts. */
export function startChapaSweeper(hooks) {
  const sweep = async () => {
    if (!chapaEnabled()) return;
    const deps = db.prepare("SELECT reference, created_at FROM transactions WHERE provider = 'chapa' AND type = 'deposit' AND status = 'pending' ORDER BY id LIMIT 50").all();
    for (const d of deps) {
      try { await confirmDeposit(d.reference, hooks); } catch { /* try next time */ }
      // Abandoned checkout (never paid) → close it after 2 hours so it doesn't block new deposits
      if (Date.now() / 1000 - d.created_at > 2 * 3600 && byRef.get(d.reference)?.status === 'pending') {
        db.prepare("UPDATE transactions SET status = 'rejected', note = 'Chapa checkout expired (not paid)' WHERE reference = ? AND status = 'pending'").run(d.reference);
      }
    }
    const pays = db.prepare("SELECT payout_ref FROM transactions WHERE type = 'withdraw' AND status = 'pending' AND payout_status = 'sent' LIMIT 50").all();
    for (const p of pays) { try { await confirmPayout(p.payout_ref, hooks); } catch { /* next time */ } }
  };
  setInterval(sweep, Number(process.env.CHAPA_SWEEP_SEC || 60) * 1000).unref();
  return sweep;
}
