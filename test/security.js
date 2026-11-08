// Security & hardening checks against a real server: forged logins, floods, oversized input,
// headers, caching/compression, connection limits, health check.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const TOKEN = '123456:SEC_TOKEN';
const PORT = 3997;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-sec-'));
const env = {
  ...process.env, PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', AUTH_FAIL_RATE_IP: '20', API_RATE_USER: '30', MAX_SOCKETS_PER_USER: '3',
  TRUST_PROXY: '1', CRASH_ENABLED: 'false', KENO_ENABLED: 'false',
};
const sign = (fields, token = TOKEN) => {
  const params = new URLSearchParams(fields);
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
};
const now = () => String(Math.floor(Date.now() / 1000));
const good = (id, name = 'Sec') => sign({ auth_date: now(), user: JSON.stringify({ id, first_name: name }) });
const get = (p, h = {}) => fetch(URL + p, { headers: h });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const ok = (n) => { passed++; console.log('  ✓', n); };
const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));
// Each block below pretends to come from a different IP (X-Forwarded-For, TRUST_PROXY=1)
const ip = (n) => ({ 'X-Forwarded-For': `10.0.0.${n}` });
try {
  console.log('Headers');
  {
    const r = await get('/');
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'self' https:\/\/web\.telegram\.org/); assert.match(csp, /object-src 'none'/);
    ok('Content-Security-Policy: only this site + Telegram script; only Telegram may embed the app');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('referrer-policy')); assert.ok(r.headers.get('permissions-policy'));
    assert.equal(r.headers.get('x-powered-by'), null);
    ok('nosniff, referrer & permissions policies set; no X-Powered-By');
    assert.equal(r.headers.get('cache-control'), 'no-cache'); ok('index.html is re-checked on every open (updates show immediately)');
  }

  console.log('Static files');
  {
    const html = await (await get('/')).text();
    const js = html.match(/\/assets\/index-[\w-]+\.js/)[0];
    let r = await get(js, { 'Accept-Encoding': 'br, gzip' });
    assert.equal(r.headers.get('content-encoding'), 'br'); assert.match(r.headers.get('cache-control'), /immutable/);
    ok('JavaScript sent brotli-compressed and cached for a year (immutable)');
    r = await get(js, { 'Accept-Encoding': 'gzip' }); assert.equal(r.headers.get('content-encoding'), 'gzip'); ok('gzip for phones without brotli');
    const etag = r.headers.get('etag');
    r = await get(js, { 'If-None-Match': etag }); assert.equal(r.status, 304); ok('unchanged files answer 304 (no re-download)');
    r = await get('/assets/old-build-123.js'); assert.equal(r.status, 404); ok('missing asset → 404, not HTML');
    for (const p of ['/../package.json', '/%2e%2e/.env', '/assets/../../.env', '/.env', '/data/bingo.db']) {
      r = await get(p); const body = await r.text();
      assert.ok(!body.includes('BOT_TOKEN') && !body.includes('SQLite format'), p);
    }
    ok('path tricks (../, %2e%2e, /.env, /data/bingo.db) never return secrets or the database');
    r = await get('/%E0%A4%A'); assert.equal(r.status, 400); ok('malformed URL → 400, no crash');
  }

  console.log('Login (Telegram signature)');
  {
    const me = (data, h = {}) => get('/api/me', { Authorization: `tma ${data}`, ...h });
    assert.equal((await me(good(1001), ip(1))).status, 200); ok('valid signed login accepted');
    const fake = sign({ auth_date: now(), user: JSON.stringify({ id: 1001 }) }, '999:WRONG_TOKEN');
    assert.equal((await me(fake, ip(1))).status, 401); ok('login signed with another bot token rejected');
    const tampered = good(1001).replace(encodeURIComponent('"id":1001'), encodeURIComponent('"id":1002'));
    assert.equal((await me(tampered, ip(1))).status, 401); ok('changing the user id after signing is rejected');
    const old = sign({ auth_date: String(Math.floor(Date.now() / 1000) - 3 * 86400), user: JSON.stringify({ id: 1001 }) });
    assert.equal((await me(old, ip(1))).status, 401); ok('3-day-old login rejected (expired)');
    assert.equal((await get('/api/me', { 'x-dev-user': '1', ...ip(1) })).status, 401); ok('dev login header ignored when DEV_MODE is off');
    const weird = sign({ auth_date: now(), user: JSON.stringify({ id: 'DROP TABLE users', first_name: 'x' }) });
    assert.equal((await me(weird, ip(1))).status, 401); ok('non-numeric user id rejected even if signed');
    // brute force: 20 failures from one IP → blocked, even with a valid login, for that minute
    for (let i = 0; i < 20; i++) await me(fake, ip(2));
    assert.equal((await me(good(1003), ip(2))).status, 429); ok('20 failed logins from one IP → that IP is blocked for a minute');
    assert.equal((await me(good(1003), ip(3))).status, 200); ok('…other IPs (other players behind other carriers) unaffected');
  }

  console.log('Rate limits');
  {
    const d = good(1010);
    let last;
    for (let i = 0; i < 31; i++) last = await get('/api/me', { Authorization: `tma ${d}`, ...ip(4) });
    assert.equal(last.status, 429); ok('one player: over 30 requests/minute → 429 (API_RATE_USER)');
    assert.equal((await get('/api/me', { Authorization: `tma ${good(1011)}`, ...ip(4) })).status, 200);
    ok('another player on the SAME IP still works (shared carrier IPs are not punished)');
  }

  console.log('Bad input');
  {
    const auth = { Authorization: `tma ${good(1020)}`, 'Content-Type': 'application/json', ...ip(5) };
    let r = await fetch(`${URL}/api/deposit`, { method: 'POST', headers: auth, body: '{"amount": 1000, ' });
    let body = await r.text();
    assert.equal(r.status, 400); assert.ok(!/at .*\.js|node_modules|stack/i.test(body), body); ok('broken JSON → 400 with no stack trace');
    r = await fetch(`${URL}/api/deposit`, { method: 'POST', headers: auth, body: JSON.stringify({ amount: 1000, reference: 'x'.repeat(30000) }) });
    assert.equal(r.status, 413); ok('oversized request body (30 KB) → 413');
    r = await fetch(`${URL}/api/deposit`, { method: 'POST', headers: auth, body: JSON.stringify({ amount: -5000, reference: 'ABC12345' }) });
    assert.equal(r.status, 400); ok('negative deposit rejected');
    r = await fetch(`${URL}/api/withdraw`, { method: 'POST', headers: auth, body: JSON.stringify({ amount: 1e15, phone: '0911223344' }) });
    assert.equal(r.status, 400); ok('withdrawing more than the balance rejected');
    r = await fetch(`${URL}/api/deposit`, { method: 'POST', headers: auth, body: JSON.stringify({ amount: { $gt: 0 }, reference: ['A'] }) });
    assert.equal(r.status, 400); ok('objects/arrays instead of numbers/text rejected');
  }

  console.log('Admin');
  {
    assert.equal((await get('/api/admin/stats', ip(6))).status, 401); ok('admin API without login → 401');
    assert.equal((await get('/api/admin/stats', { Authorization: `tma ${good(1030)}`, ...ip(6) })).status, 401); ok('normal player → 401');
    assert.equal((await get('/api/admin/metrics', { 'x-admin-key': 'admin-password-1', ...ip(6) })).status, 200); ok('admin password works; /metrics available');
    let r;
    for (let i = 0; i < 11; i++) r = await get('/api/admin/stats', { 'x-admin-key': 'wrong-guess-' + i, ...ip(7) });
    assert.equal(r.status, 429); ok('10 wrong admin passwords → locked out');
  }

  console.log('Sockets');
  {
    const connect = (auth, h = {}) => new Promise((res) => {
      const s = io(URL, { auth, transports: ['websocket'], reconnection: false, extraHeaders: h });
      s.on('connect', () => res({ s, ok: true })); s.on('connect_error', (e) => res({ s, ok: false, err: e.message }));
    });
    let c = await connect({ initData: 'user=%7B%22id%22%3A1%7D&hash=abc' }, ip(8));
    assert.equal(c.ok, false); ok('socket with a forged login refused');
    c = await connect({ devUser: '1' }, ip(8)); assert.equal(c.ok, false); ok('socket dev login refused when DEV_MODE is off');
    const d = good(1040);
    const socks = [];
    for (let i = 0; i < 3; i++) socks.push((await connect({ initData: d }, ip(9))).s);
    let replaced = false;
    socks[0].on('server:replaced', () => { replaced = true; });
    const fourth = await connect({ initData: d }, ip(9));
    await sleep(300);
    assert.ok(fourth.ok && replaced && socks[0].disconnected); ok('4th connection for the same player closes the oldest (max 3 here)');
    // payload bigger than 10 KB → socket closed by the server
    const big = (await connect({ initData: good(1041) }, ip(10))).s;
    big.emit('crash:bet', { amount: 'x'.repeat(20000) });
    await sleep(500);
    assert.ok(big.disconnected); ok('oversized socket message (20 KB) → connection dropped');
    // spam: game actions are rate-limited per player
    const spam = (await connect({ initData: good(1042) }, ip(11))).s;
    const acks = await Promise.all(Array.from({ length: 40 }, () => new Promise((r) => spam.emit('pool:enter', {}, r))));
    assert.ok(acks.some((a) => !a.ok && /Slow down/.test(a.error))); ok('40 actions in a burst → excess refused ("Slow down")');
    for (const s of [...socks, fourth.s, big, spam]) s.close();
  }

  console.log('Health');
  {
    const r = await get('/healthz'); const h = await r.json();
    assert.equal(r.status, 200); assert.equal(h.ok, true); assert.ok('lagMs' in h); assert.ok(!('rooms' in h));
    ok('/healthz → 200 {ok, uptime, lagMs} with no internal details');
    assert.ok(!/SQLITE|TypeError|ReferenceError/.test(log), 'no internal errors in the log'); ok('no internal errors logged during the attacks');
  }
  console.log(`\nAll ${passed} security checks passed ✅`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  proc.kill('SIGTERM');
  setTimeout(() => process.exit(), 500);
}
