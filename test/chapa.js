// Chapa integration against a mock Chapa API: checkout, verify-before-credit, signed webhooks,
// no double credit, under-payment, cancelled payments, automatic payouts.
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const TOKEN = '123456:CHAPA_TOKEN';
const PORT = 3985, MOCK = 3984;
const URL = `http://localhost:${PORT}`;
const KEY = 'CHASECK_TEST-abcdef123456';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-chapa-'));
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', CRASH_ENABLED: 'false', KENO_ENABLED: 'false',
  CHAPA_SECRET_KEY: KEY, CHAPA_API_URL: `http://localhost:${MOCK}/v1`, CHAPA_AUTO_PAYOUT_MAX: '200', CHAPA_SWEEP_SEC: '1',
  WEBAPP_URL: 'https://bingo.example.com', WALLET_RATE: '100', MAX_PENDING_DEPOSITS: '20', MIN_WITHDRAW: '1',
};
Object.assign(process.env, env);

// ---------------- mock Chapa ----------------
const M = { inits: new Map(), paid: new Map(), status: new Map(), transfers: [], payout: new Map(), failPhone: '0900000000', badAuth: 0 };
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bearer ${KEY}`) { M.badAuth++; return send(401, { message: 'Invalid API Key', status: 'failed' }); }
    const u = new globalThis.URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/v1/transaction/initialize') {
      const b = JSON.parse(body);
      M.inits.set(b.tx_ref, b);
      return send(200, { message: 'Hosted Link', status: 'success', data: { checkout_url: `https://checkout.chapa.co/checkout/payment/${b.tx_ref}` } });
    }
    let m;
    if ((m = u.pathname.match(/^\/v1\/transaction\/verify\/(.+)$/))) {
      const ref = decodeURIComponent(m[1]);
      if (!M.inits.has(ref)) return send(404, { message: 'Invalid transaction or Transaction not found', status: 'failed' });
      const st = M.status.get(ref) || 'pending';
      return send(200, { message: 'Payment details', status: 'success', data: { status: st, amount: M.paid.get(ref) ?? M.inits.get(ref).amount, currency: 'ETB', tx_ref: ref } });
    }
    if (u.pathname === '/v1/banks') return send(200, { message: 'Banks retrieved', data: [{ id: 946, name: 'Commercial Bank of Ethiopia (CBE)' }, { id: 855, name: 'telebirr' }] });
    if (req.method === 'POST' && u.pathname === '/v1/transfers') {
      const b = JSON.parse(body);
      if (b.account_number === M.failPhone) return send(400, { message: 'The account number is not valid for bank name', status: 'failed' });
      M.transfers.push(b);
      return send(200, { message: 'Transfer Queued Successfully', status: 'success', data: b.reference });
    }
    if ((m = u.pathname.match(/^\/v1\/transfers\/verify\/(.+)$/))) return send(200, { message: 'Transfer details', status: 'success', data: { status: M.payout.get(decodeURIComponent(m[1])) || 'pending' } });
    send(404, { message: 'not found' });
  });
});
await new Promise((r) => mock.listen(MOCK, r));

const sign = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  params.set('hash', crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(dcs).digest('hex'));
  return params.toString();
};
const P = { id: 7501, first_name: 'Selam' };
const as = { Authorization: `tma ${sign(P)}`, 'Content-Type': 'application/json' };
const admin = { 'x-admin-key': 'admin-password-1', 'Content-Type': 'application/json' };
const call = async (method, p, headers, body) => {
  const r = await fetch(URL + p, { method, headers, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const webhook = (event, secret = KEY) => {
  const raw = JSON.stringify(event);
  return call('POST', '/api/chapa/webhook', { 'Content-Type': 'application/json', 'x-chapa-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') }, raw);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };

const db = await import('../server/db.js');
db.upsertUser(P);
const bal = () => db.getUser('7501').balance;
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  console.log('Deposits');
  const cfg = (await call('GET', '/api/config', {})).data;
  assert.ok(cfg.chapa?.enabled); ok('app sees online payment is available');
  let r = await call('POST', '/api/chapa/deposit', as, { amount: 10000 });
  assert.equal(r.status, 200); assert.match(r.data.checkoutUrl, /^https:\/\/checkout\.chapa\.co\//);
  const ref = r.data.txRef;
  const init = M.inits.get(ref);
  assert.equal(init.amount, '100.00'); assert.equal(init.currency, 'ETB'); assert.equal(init.callback_url, 'https://bingo.example.com/api/chapa/callback');
  ok(`checkout created at Chapa (100.00 ETB, ref ${ref}, callback to our server)`);
  assert.equal((await call('GET', `/api/chapa/status/${ref}`, as)).data.status, 'pending'); ok('not paid yet → pending, balance unchanged');
  r = await webhook({ event: 'charge.success', tx_ref: ref, status: 'success', amount: '100.00' }, 'wrong-secret');
  assert.equal(r.status, 401); assert.equal(bal(), 0); ok('forged webhook (wrong signature) rejected');
  r = await webhook({ event: 'charge.success', tx_ref: ref, status: 'success', amount: '100.00' });
  await sleep(300);
  assert.equal(r.status, 200); assert.equal(bal(), 0); ok('correctly signed webhook, but Chapa\'s verify says unpaid → NOT credited');
  M.status.set(ref, 'success');
  r = await webhook({ event: 'charge.success', tx_ref: ref, status: 'success', amount: '100.00' });
  await sleep(300);
  assert.equal(bal(), 10000); ok('paid + signed webhook → verified with Chapa → 100 ETB credited automatically');
  await webhook({ event: 'charge.success', tx_ref: ref, status: 'success', amount: '100.00' });
  await call('GET', `/api/chapa/callback?trx_ref=${ref}&status=success`, {});
  assert.equal((await call('GET', `/api/chapa/status/${ref}`, as)).data.status, 'approved');
  await sleep(300);
  assert.equal(bal(), 10000); ok('the same payment arriving 3 more times (webhook, callback, app check) is credited only once');

  r = await call('POST', '/api/chapa/deposit', as, { amount: 20000 });
  const short = r.data.txRef;
  M.status.set(short, 'success'); M.paid.set(short, '50.00');
  await call('GET', `/api/chapa/callback?trx_ref=${short}`, {});
  await sleep(300);
  assert.equal(bal(), 10000); assert.equal(db.getTx(r.data.id).status, 'pending'); ok('paid only 50 for a 200 checkout → not credited, left for an admin');
  r = await call('POST', '/api/chapa/deposit', as, { amount: 5000 });
  const cancelled = r.data.txRef;
  M.status.set(cancelled, 'cancelled');
  assert.equal((await call('GET', `/api/chapa/status/${cancelled}`, as)).data.status, 'rejected'); ok('cancelled payment → closed as rejected');
  const other = { Authorization: `tma ${sign({ id: 7502, first_name: 'Other' })}` };
  assert.equal((await call('GET', `/api/chapa/status/${ref}`, other)).status, 404); ok('players can\'t look up someone else\'s payment');
  r = await call('GET', `/api/chapa/callback?trx_ref=CH999-FAKE`, {});
  assert.equal(r.status, 200); assert.equal(bal(), 10000); ok('made-up references do nothing');
  assert.equal(M.badAuth, 0); ok('every call to Chapa used the secret key');

  console.log('Payouts');
  r = await call('POST', '/api/withdraw', as, { amount: 5000, phone: '+251911223344' });
  assert.ok(!r.data.auto); await call('POST', '/api/admin/decide', admin, { kind: 'withdraw', id: r.data.id, approve: false });
  ok('deposit-then-withdraw without playing is flagged → never paid automatically');
  db.debit('7501', 8000, 'bet', 'test'); db.credit('7501', 8000, 'win', 'test'); // the player actually plays
  r = await call('POST', '/api/withdraw', as, { amount: 5000, phone: '+251911223344' });
  assert.equal(r.data.auto, true);
  await sleep(300);
  const tr = M.transfers[0];
  assert.equal(tr.amount, '50.00'); assert.equal(tr.bank_code, 855); assert.equal(tr.account_number, '0911223344');
  ok('50 ETB withdrawal (under the 200 limit) sent to Chapa automatically: telebirr (bank 855), 0911223344');
  const wid = r.data.id;
  r = await call('POST', '/api/admin/decide', admin, { kind: 'withdraw', id: wid, approve: true });
  assert.equal(r.status, 400); assert.match(r.data.error, /being paid automatically/); ok('admins can\'t also pay it by hand (no double payout)');
  M.payout.set(tr.reference, 'success');
  await sleep(2500); // sweeper checks every second in this test
  assert.equal(db.getTx(wid).status, 'approved'); ok('Chapa confirms the transfer → withdrawal marked paid');
  r = await call('POST', '/api/withdraw', as, { amount: 25000, phone: '0911223344' });
  assert.equal(r.status, 400); // only 50 left
  db.credit('7501', 50000, 'win', 'test');
  r = await call('POST', '/api/withdraw', as, { amount: 25000, phone: '0911223344' });
  assert.ok(!r.data.auto); assert.equal(M.transfers.length, 1); ok('250 ETB (over the limit) waits for an admin as usual');
  r = await call('POST', '/api/withdraw', as, { amount: 1000, phone: '0900000000' });
  await sleep(500);
  const failed = db.getTx(r.data.id);
  assert.equal(failed.status, 'pending'); assert.equal(failed.payout_status, 'failed'); ok('Chapa refuses a payout → falls back to the admins');
  r = await call('POST', '/api/admin/decide', admin, { kind: 'withdraw', id: failed.id, approve: true });
  assert.equal(r.data.status, 'approved'); ok('…who can then pay it by hand');
  const logA = (await call('GET', '/api/admin/log', admin)).data.items.map((l) => l.action);
  for (const a of ['approve_deposit', 'auto_payout_sent', 'auto_payout_failed', 'chapa_amount_mismatch']) assert.ok(logA.includes(a), a);
  ok('every automatic deposit/payout is in the admin log');
  console.log(`\nAll ${passed} Chapa checks passed ✅`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-2500));
  process.exitCode = 1;
} finally {
  proc.kill(); mock.close();
  setTimeout(() => process.exit(), 300);
}
