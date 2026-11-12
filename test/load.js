// Load test: N real (signed) players connect at once, sit in Aviator and bet every round, while
// the REST API is hammered in parallel. Reports connect time, ack latency, API throughput,
// server event-loop lag, CPU and memory.   Usage:  N=1000 node test/load.js
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const N = Number(process.env.N || 500);
const SECONDS = Number(process.env.SECONDS || 25);
const TOKEN = '123456:LOAD_TOKEN';
const PORT = 3995;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bingo-load-'));
const env = {
  ...process.env, SIGNUP_BONUS: '0', WITHDRAW_MIN_DEPOSIT: '0', PORT, BOT_TOKEN: TOKEN, BOT_DISABLED: 'true', DB_PATH: path.join(tmp, 'bingo.db'), BACKUP_DIR: path.join(tmp, 'b'),
  DEV_MODE: 'false', NODE_ENV: '', ADMIN_PASSWORD: 'admin-password-1', CRASH_BET_SEC: '4', CRASH_MAX_MULTIPLIER: '3', LOAD_TEST: '1',
  SOCKET_RATE: '100000', API_RATE_IP: '1000000', CONN_RATE_IP: '1000000',
};
Object.assign(process.env, env);

const initDataFor = (user) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
};
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = (x) => `${x.toFixed(1)} ms`;

const db = await import('../server/db.js');
const users = Array.from({ length: N }, (_, i) => ({ id: 900000 + i, first_name: `Load${i}` }));
db.db.transaction(() => { for (const u of users) { db.upsertUser(u); db.credit(u.id, 100000, 'deposit', 'seed'); } })();
db.db.close();

const proc = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });
await new Promise((res) => proc.stdout.on('data', (d) => String(d).includes('Bingo server') && res()));

const usage = () => {
  try {
    const [utime, stime] = fs.readFileSync(`/proc/${proc.pid}/stat`, 'utf8').split(') ')[1].split(' ').slice(11, 13).map(Number);
    const rss = Number(fs.readFileSync(`/proc/${proc.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) / 1024;
    return { cpu: (utime + stime) / os.constants?.CLK_TCK || (utime + stime) / 100, rss };
  } catch { return { cpu: 0, rss: 0 }; }
};

// ---- connect everyone (in waves of 100, like a real rush) ----
const connectTimes = [];
const socks = [];
const t0 = Date.now();
for (let i = 0; i < N; i += 100) {
  await Promise.all(users.slice(i, i + 100).map(async (u) => {
    const s0 = performance.now();
    const s = io(URL, { auth: { initData: initDataFor(u) }, transports: ['websocket'], reconnection: false });
    await new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
    connectTimes.push(performance.now() - s0);
    socks.push(s);
  }));
}
const connectAll = Date.now() - t0;
const emitAck = (s, ev, p = {}) => new Promise((res) => { const a = performance.now(); s.emit(ev, p, (r) => res({ r, ms: performance.now() - a })); });
await Promise.all(socks.map((s) => emitAck(s, 'crash:enter')));

// ---- play: everyone bets each round with auto cash-out; API traffic in parallel ----
const ackTimes = [];
let bets = 0, betErrors = 0, apiOk = 0, apiErr = 0;
const apiTimes = [];
const cpu0 = usage();
const tStart = Date.now();
let running = true;
for (const s of socks) {
  s.on('crash:state', async (st) => {
    if (!running || st.phase !== 'betting') return;
    await sleep(Math.random() * 1500);
    const { r, ms: t } = await emitAck(s, 'crash:bet', { amount: 1000, auto: 110 + Math.floor(Math.random() * 150) });
    ackTimes.push(t);
    r.ok ? bets++ : betErrors++;
  });
}
const apiWorker = async (k) => {
  while (running) {
    const u = users[(k * 7919 + apiOk + apiErr) % N];
    const a = performance.now();
    try {
      const r = await fetch(`${URL}/api/me`, { headers: { Authorization: `tma ${initDataFor(u)}` } });
      await r.text();
      r.ok ? apiOk++ : apiErr++;
    } catch { apiErr++; }
    apiTimes.push(performance.now() - a);
  }
};
const lags = [];
const lagPoll = (async () => {
  while (running) {
    try { const h = await (await fetch(`${URL}/healthz`)).json(); if (h.lagMs != null) lags.push(h.lagMs); } catch { /* ignore */ }
    await sleep(1000);
  }
})();
const workers = Array.from({ length: 20 }, (_, k) => apiWorker(k));
let peakRss = 0;
const rssPoll = setInterval(() => { peakRss = Math.max(peakRss, usage().rss); }, 500);
await sleep(SECONDS * 1000);
running = false;
await Promise.all(workers); await lagPoll;
clearInterval(rssPoll);
const cpu1 = usage();
const dur = (Date.now() - tStart) / 1000;

console.log(`\n=== Load test: ${N} players, ${dur.toFixed(0)} s ===`);
console.log(`connect:      all ${N} in ${connectAll} ms · p50 ${ms(pct(connectTimes, 50))} · p95 ${ms(pct(connectTimes, 95))} · p99 ${ms(pct(connectTimes, 99))}`);
console.log(`crash bets:   ${bets} placed, ${betErrors} rejected · ack p50 ${ms(pct(ackTimes, 50))} · p95 ${ms(pct(ackTimes, 95))} · p99 ${ms(pct(ackTimes, 99))}`);
console.log(`REST /api/me: ${(apiOk / dur).toFixed(0)} req/s (${apiErr} errors) · p50 ${ms(pct(apiTimes, 50))} · p95 ${ms(pct(apiTimes, 95))} · p99 ${ms(pct(apiTimes, 99))}`);
console.log(`server:       CPU ${(((cpu1.cpu - cpu0.cpu) / dur) * 100).toFixed(0)}% of one core · peak memory ${peakRss.toFixed(0)} MB${lags.length ? ` · event-loop lag p50 ${ms(pct(lags, 50))} max ${ms(Math.max(...lags))}` : ''}`);
for (const s of socks) s.close();
proc.kill('SIGTERM');
await sleep(1500);
if (process.env.DBG) console.log(log.slice(-2000));
process.exit(0);
