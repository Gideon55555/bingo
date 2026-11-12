// Admin security: 2-step login, sessions, audit log, two-admin approval for big withdrawals.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { totp } from '../server/totp.js';

const TOKEN = '123456:ADMIN_TOKEN';
const PORT = 3998;
const URL = `http://localhost:${PORT}`;
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-admin-'));
const env = {
  ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', ADMIN_TOTP_SECRET: SECRET,
  ADMIN_IDS: '111,222', WITHDRAW_SECOND_APPROVAL: '100', CRASH_ENABLED: 'false', KENO_ENABLED: 'false',
};
Object.assign(process.env, env);
const sign = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
};
const call = async (method, p, { body, headers = {} } = {}) => {
  const r = await fetch(URL + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };

const db = await import('../server/db.js');
db.upsertUser({ id: 5001, first_name: 'Player' }); db.credit(5001, 100000, 'deposit', 'seed');
db.upsertUser({ id: 111, first_name: 'Owner' }); db.upsertUser({ id: 222, first_name: 'Partner' });
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
try {
  console.log('2-step login (browser admin)');
  let r = await call('POST', '/api/admin/login', { body: { password: 'wrong' } });
  assert.equal(r.status, 401); ok('wrong password refused');
  r = await call('POST', '/api/admin/login', { body: { password: 'admin-password-1' } });
  assert.equal(r.status, 401); assert.equal(r.data.needCode, true); ok('right password alone → asks for the 6-digit code');
  r = await call('POST', '/api/admin/login', { body: { password: 'admin-password-1', code: '123456' } });
  assert.equal(r.status, 401); ok('wrong code refused');
  const code = totp(SECRET);
  r = await call('POST', '/api/admin/login', { body: { password: 'admin-password-1', code } });
  assert.equal(r.status, 200); assert.ok(r.data.token); ok('password + correct code → session');
  const session = { 'x-admin-session': r.data.token };
  r = await call('POST', '/api/admin/login', { body: { password: 'admin-password-1', code } });
  assert.equal(r.status, 401); ok('the same code can\'t be used twice (replay)');
  assert.equal((await call('GET', '/api/admin/stats', { headers: session })).status, 200); ok('session works');
  assert.equal((await call('GET', '/api/admin/stats', { headers: { 'x-admin-key': 'admin-password-1' } })).status, 401);
  ok('with 2FA on, the password header alone no longer works');
  assert.equal((await call('GET', '/api/admin/stats', { headers: { 'x-admin-session': 'made-up-token' } })).status, 401); ok('made-up session refused');

  console.log('Audit log');
  await call('POST', '/api/admin/adjust', { headers: session, body: { userId: '5001', amount: 500, note: 'test bonus' } });
  const owner = { Authorization: `tma ${sign({ id: 111, first_name: 'Owner' })}` };
  const partner = { Authorization: `tma ${sign({ id: 222, first_name: 'Partner' })}` };
  const player = { Authorization: `tma ${sign({ id: 5001, first_name: 'Player' })}` };

  console.log('Big withdrawals need two admins');
  const big = await call('POST', '/api/withdraw', { headers: player, body: { amount: 20000, phone: '0911000000' } });
  const small = await call('POST', '/api/withdraw', { headers: player, body: { amount: 5000, phone: '0911000000' } });
  assert.equal(big.status, 200); assert.equal(small.status, 200);
  r = await call('POST', '/api/admin/decide', { headers: owner, body: { kind: 'withdraw', id: small.data.id, approve: true } });
  assert.equal(r.data.status, 'approved'); ok('small withdrawal (50 ETB): one approval is enough');
  r = await call('POST', '/api/admin/decide', { headers: owner, body: { kind: 'withdraw', id: big.data.id, approve: true } });
  assert.equal(r.data.awaitingSecond, true); assert.equal(db.getTx(big.data.id).status, 'pending'); ok('big withdrawal (200 ETB): first approval keeps it pending');
  r = await call('POST', '/api/admin/decide', { headers: owner, body: { kind: 'withdraw', id: big.data.id, approve: true } });
  assert.equal(r.status, 400); assert.match(r.data.error, /different admin/); ok('the same admin can\'t give the second approval');
  r = await call('POST', '/api/admin/decide', { headers: partner, body: { kind: 'withdraw', id: big.data.id, approve: true } });
  assert.equal(r.data.status, 'approved'); ok('a second admin completes it');
  assert.equal(JSON.parse(db.getTx(big.data.id).approvals).length, 2); ok('both sign-offs stored on the withdrawal');
  r = await call('POST', '/api/admin/decide', { headers: owner, body: { kind: 'withdraw', id: big.data.id, approve: false } });
  assert.equal(r.status, 400); ok('a finished withdrawal can\'t be changed afterwards');

  const logItems = (await call('GET', '/api/admin/log', { headers: session })).data.items;
  const actions = logItems.map((l) => l.action);
  for (const a of ['login', 'login_failed', 'adjust_balance', 'withdraw_first_approval', 'approve_withdraw'])
    assert.ok(actions.includes(a), `log has ${a}`);
  assert.ok(logItems.some((l) => l.action === 'approve_withdraw' && /Partner/.test(l.admin)));
  ok('admin log records logins, failed logins, balance changes and both approvals — with who and when');

  r = await call('POST', '/api/admin/logout', { headers: session });
  assert.equal((await call('GET', '/api/admin/stats', { headers: session })).status, 401); ok('logout ends the session');
  console.log(`\nAll ${passed} admin security checks passed ✅`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  proc.kill();
  setTimeout(() => process.exit(), 300);
}
