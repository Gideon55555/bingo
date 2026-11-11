// Demo players: fill Bingo rooms in development, play a full game, and are refused in production.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
const DB = '/tmp/demo-test.db'; for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const PORT = 3996, base = `http://localhost:${PORT}`;
const env = { ...process.env, PORT, DB_PATH: DB, BOT_TOKEN: '', NODE_ENV: 'development', DEMO_PLAYERS: 'true', STAKES: '10', MIN_PLAYERS: '2', COUNTDOWN_SEC: '5', CALL_INTERVAL_MS: '60', RESULT_SHOW_SEC: '3' };
let passed = 0; const ok = (m) => { passed++; console.log(`  ✓ ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prod = spawnSync(process.execPath, ['server/index.js'], { env: { ...env, PORT: 3997, NODE_ENV: 'production', WEBAPP_URL: 'https://x.example.com', BOT_TOKEN: '1:a', BOT_DISABLED: 'true' }, encoding: 'utf8', timeout: 15000 });
assert.notEqual(prod.status, 0); assert.match(prod.stderr + prod.stdout, /DEMO_PLAYERS=true is not allowed in production/); ok('server refuses to start with demo players in production');
const proc = spawn(process.execPath, ['server/index.js'], { env, stdio: 'pipe' });
try {
  await sleep(2500);
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfg.demo, true); ok('the app is told to show the DEMO ribbon');
  const Database = (await import('better-sqlite3')).default;
  let games = 0, names = [];
  for (let i = 0; i < 60 && !games; i++) {
    await sleep(1000);
    const d = new Database(DB, { readonly: true });
    games = d.prepare('SELECT COUNT(*) c FROM games').get().c;
    names = d.prepare("SELECT first_name FROM users WHERE id LIKE 'demo:%'").all().map((r) => r.first_name);
    d.close();
  }
  assert.ok(games >= 1); ok('demo players joined a room, played and finished a Bingo game on their own');
  assert.ok(names.length >= 2 && names.every((n) => /[ሀ-፿]/.test(n))); ok(`they have Amharic names (${names.slice(0, 3).join('፣ ')}…)`);
  const d = new Database(DB, { readonly: true });
  const multi = d.prepare("SELECT MAX(c) m FROM (SELECT COUNT(*) c FROM transactions WHERE user_id LIKE 'demo:%' AND type = 'bet' GROUP BY user_id, round_id)").get().m;
  d.close();
  assert.equal(multi, 1); ok('each demo player takes exactly one cartela per game');
  console.log(`\nAll ${passed} demo-player checks passed ✅`);
} catch (e) { console.error(e); process.exitCode = 1; } finally { proc.kill(); setTimeout(() => process.exit(), 300); }
