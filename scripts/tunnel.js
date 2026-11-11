// One command for testing on your own computer:  npm run tunnel
// Starts a Cloudflare quick tunnel, reads the new https address it prints, and starts the game with
// WEBAPP_URL set to it — so there is no need to edit .env every time the address changes.
// (The bot's Play button is pointed at the new address automatically when the game starts.)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '';
const port = process.env.PORT || (env.match(/^PORT=(\d+)/m) || [])[1] || '3000';

const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const candidates = [process.env.CLOUDFLARED, exe, path.join(os.homedir(), 'Desktop', exe), path.join(ROOT, exe), path.join(ROOT, '..', exe)].filter(Boolean);
const bin = candidates.find((c) => { try { return spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } });
if (!bin) {
  console.error(`cloudflared was not found. Put ${exe} on your Desktop or in this folder, or set CLOUDFLARED=full\\path\\to\\${exe}`);
  process.exit(1);
}

console.log(`Starting tunnel to http://localhost:${port} …`);
const tunnel = spawn(bin, ['tunnel', '--protocol', 'http2', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let server = null, buf = '';
const stop = () => { server?.kill(); tunnel.kill(); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });

const onData = (chunk) => {
  if (server) return;
  buf += chunk.toString();
  const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m) return;
  const url = m[0];
  console.log(`\n✅ Game address: ${url}\n   (the bot's Play button now opens this address)\n`);
  server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, WEBAPP_URL: url, PORT: port } });
  server.on('exit', (code) => { tunnel.kill(); process.exit(code ?? 0); });
};
tunnel.stdout.on('data', onData);
tunnel.stderr.on('data', onData);
tunnel.on('exit', (code) => { if (!server) { console.error(`cloudflared stopped before giving an address:\n${buf.slice(-600)}`); process.exit(code || 1); } else { console.error('The tunnel closed — stopping the game. Run "npm run tunnel" again.'); server.kill(); } });
setTimeout(() => { if (!server) { console.error('No tunnel address after 60 seconds. Check your internet connection and try again.'); stop(); process.exit(1); } }, 60000).unref();
