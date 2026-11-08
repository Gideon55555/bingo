// Health + live metrics: event-loop delay, memory, connections, database.
import fs from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { config } from './config.js';
import { db } from './db.js';

const loop = monitorEventLoopDelay({ resolution: 20 });
let ctx = null;
let lastLag = { p50: 0, p99: 0, max: 0 };
let warnedAt = 0;

export function startMonitor({ io, games }) {
  ctx = { io, games, startedAt: Date.now() };
  loop.enable();
  // Every 10 s: snapshot the event-loop delay, then reset the histogram
  setInterval(() => {
    lastLag = { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6, max: loop.max / 1e6 };
    loop.reset();
    // A blocked event loop = every player feels lag. Warn (at most once a minute).
    if (lastLag.p99 > 200 && Date.now() - warnedAt > 60000) {
      warnedAt = Date.now();
      console.warn(`[monitor] event loop slow: p99 ${lastLag.p99.toFixed(0)} ms, max ${lastLag.max.toFixed(0)} ms`);
    }
  }, 10000).unref();
  // Let SQLite refresh its query-planner statistics now and then
  setInterval(() => { try { db.pragma('optimize'); } catch { /* ignore */ } }, 6 * 3600 * 1000).unref();
}

const dbOk = () => {
  try { return db.prepare('SELECT 1 AS ok').get().ok === 1; } catch { return false; }
};

/** Public health check: just enough for an uptime monitor. */
export function health(shuttingDown) {
  const ok = !shuttingDown && dbOk();
  return { ok, uptime: Math.round(process.uptime()), lagMs: Math.round(lastLag.p99 * 10) / 10, shuttingDown: !!shuttingDown };
}

/** Detailed numbers for the admin panel. */
export function metrics() {
  const m = process.memoryUsage();
  let dbBytes = 0;
  for (const f of [config.dbPath, `${config.dbPath}-wal`]) { try { dbBytes += fs.statSync(f).size; } catch { /* ignore */ } }
  const g = ctx?.games;
  return {
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
    memoryMb: { rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576) },
    eventLoopMs: { p50: +lastLag.p50.toFixed(1), p99: +lastLag.p99.toFixed(1), max: +lastLag.max.toFixed(1) },
    connections: ctx?.io.engine.clientsCount ?? 0,
    playersOnline: ctx ? [...ctx.io.sockets.adapter.rooms.keys()].filter((k) => k.startsWith('user:')).length : 0,
    matches: {
      ludo: g?.ludo ? [...g.ludo.games.values()].filter((x) => x.phase !== 'over').length : 0,
      pool: g?.pool ? [...g.pool.games.values()].filter((x) => x.phase !== 'over').length : 0,
      kerenbula: g?.kerenbula ? [...g.kerenbula.games.values()].filter((x) => x.phase !== 'over').length : 0,
    },
    dbMb: +(dbBytes / 1048576).toFixed(1),
  };
}
