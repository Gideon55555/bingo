import { io } from 'socket.io-client';
import { trServer } from './i18n.js';

export const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
// Dev only: open http://localhost:5173/?dev_user=1 in a normal browser (server needs DEV_MODE=true)
const devUser = new URLSearchParams(location.search).get('dev_user') || '';

// A random id kept on this phone — lets the server spot several accounts played from one device.
const deviceId = (() => {
  try {
    let d = localStorage.getItem('dev_id');
    if (!d) { d = (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 32); localStorage.setItem('dev_id', d); }
    return d;
  } catch { return ''; }
})();

const headers = () => ({
  ...(deviceId ? { 'x-device': deviceId } : {}),
  'Content-Type': 'application/json',
  Authorization: `tma ${initData}`,
  ...(devUser ? { 'x-dev-user': devUser } : {}),
});

async function request(method, url, body) {
  const res = await fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  config: () => request('GET', '/api/config'),
  me: () => request('GET', '/api/me'),
  history: () => request('GET', '/api/history'),
  deposit: (amount, reference) => request('POST', '/api/deposit', { amount, reference }),
  withdraw: (amount, phone) => request('POST', '/api/withdraw', { amount, phone }),
  setLang: (lang) => request('POST', '/api/lang', { lang }),
  growth: () => request('GET', '/api/growth'),
  claimDaily: () => request('POST', '/api/daily'),
  leaderboard: () => request('GET', '/api/leaderboard'),
  rg: () => request('GET', '/api/rg'),
  rgToday: () => request('GET', '/api/rg/today'),
  confirmAge: () => request('POST', '/api/rg/age'),
  setLimits: (day, week) => request('POST', '/api/rg/limits', { day, week }),
  setReminder: (minutes) => request('POST', '/api/rg/reminder', { minutes }),
  selfExclude: (days) => request('POST', '/api/rg/exclude', { days }),
};

// WebSocket first (one round-trip faster to connect); if the host or network blocks WebSockets,
// it falls back to HTTP long-polling automatically.
export const socket = io({ auth: { initData, devUser, device: deviceId }, autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
export const inTelegram = !!initData;

// Opened from a friend's invite (?join=pool_ABC123, or Telegram's start_param): which game + table code
let joinParam = (() => {
  const raw = new URLSearchParams(location.search).get('join') || tg?.initDataUnsafe?.start_param || '';
  const m = raw.match(/^(pool|kb|ludo)_([A-Z0-9]{6})$/);
  return m ? { prefix: m[1], code: m[2], game: { pool: 'pool', kb: 'kerenbula', ludo: 'ludo' }[m[1]] } : null;
})();
export const peekJoin = () => joinParam;
/** The invite code for this game (only once). */
export function takeJoin(prefix) {
  if (!joinParam || joinParam.prefix !== prefix) return null;
  const c = joinParam.code;
  joinParam = null;
  return c;
}

// ---------- Admin API ----------
// In Telegram, admins are recognised by their Telegram id. In a normal browser, by ADMIN_PASSWORD.
const KEY = 'bingo_admin_session';
export const adminKey = {
  get: () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } },
  set: (v) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
};
async function adminRequest(method, url, body) {
  const h = headers();
  const k = adminKey.get();
  if (k) h['x-admin-session'] = k;
  const res = await fetch('/api/admin' + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}
export const adminApi = {
  login: async (password, code) => {
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, code }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Login failed (${res.status})`); e.status = res.status; e.needCode = !!data.needCode; throw e; }
    return data;
  },
  logout: () => adminRequest('POST', '/logout').catch(() => {}),
  risk: () => adminRequest('GET', '/risk'),
  clientErrors: () => adminRequest('GET', '/client-errors'),
  freeze: (userId, on, reason) => adminRequest('POST', '/freeze', { userId, on, reason }),
  log: (before) => adminRequest('GET', `/log${before ? `?before=${before}` : ''}`),
  stats: () => adminRequest('GET', '/stats'),
  pending: () => adminRequest('GET', '/pending'),
  users: (search = '', offset = 0) => adminRequest('GET', `/users?search=${encodeURIComponent(search)}&offset=${offset}`),
  user: (id) => adminRequest('GET', `/users/${encodeURIComponent(id)}`),
  transactions: (q = {}) => adminRequest('GET', `/transactions?${new URLSearchParams(q)}`),
  games: () => adminRequest('GET', '/games'),
  crashRounds: () => adminRequest('GET', '/crash-rounds'),
  kenoRounds: () => adminRequest('GET', '/keno-rounds'),
  ludoGames: () => adminRequest('GET', '/ludo-games'),
  poolGames: () => adminRequest('GET', '/pool-games'),
  metrics: () => adminRequest('GET', '/metrics'),
  kerenbulaGames: () => adminRequest('GET', '/kerenbula-games'),
  decide: (kind, id, approve) => adminRequest('POST', '/decide', { kind, id, approve }),
  adjust: (userId, amount, note) => adminRequest('POST', '/adjust', { userId, amount, note }),
  pause: () => adminRequest('POST', '/pause'),
  resume: () => adminRequest('POST', '/resume'),
  broadcast: (text) => adminRequest('POST', '/broadcast', { text }),
  broadcastStatus: () => adminRequest('GET', '/broadcast'),
};

/** emit with ack → Promise; rejects with server error message */
export const emit = (event, payload) =>
  new Promise((resolve, reject) =>
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) return reject(new Error('Server not responding'));
      if (!res?.ok) return reject(new Error(res?.error || 'Error'));
      resolve(res);
    }));

/** Convert server's countdownLeftMs into a local timestamp */
export const withEndsAt = (r) => ({
  ...r,
  countdownEndsAt: r.countdownLeftMs != null ? Date.now() + r.countdownLeftMs : null,
});

export const haptic = (type = 'light') => {
  try {
    if (type === 'success' || type === 'error') tg?.HapticFeedback?.notificationOccurred(type);
    else tg?.HapticFeedback?.impactOccurred(type);
  } catch { /* not in Telegram */ }
};

export const toast = (msg) => {
  msg = trServer(msg); // server messages arrive in English
  if (tg?.showAlert && tg.initData) tg.showAlert(msg);
  else alert(msg);
};

/** Yes/no confirmation that works inside Telegram and in a browser */
export const confirmBox = (msg) =>
  new Promise((resolve) => {
    if (tg?.showConfirm && tg.initData) tg.showConfirm(msg, resolve);
    else resolve(window.confirm(msg));
  });

// ---------- Report app errors to the server (admin → Errors) ----------
let reported = 0;
export function reportError(err, extra = '') {
  if (reported++ > 10) return; // at most 10 per page load
  const e = err instanceof Error ? err : new Error(String(err?.message || err));
  fetch('/api/client-error', {
    method: 'POST', headers: headers(), keepalive: true,
    body: JSON.stringify({ message: `${e.message}${extra ? ` (${extra})` : ''}`, stack: e.stack, path: location.pathname + location.search.slice(0, 40), ua: navigator.userAgent }),
  }).catch(() => {});
}
window.addEventListener('error', (ev) => { if (ev.error || ev.message) reportError(ev.error || ev.message); });
window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason || 'unhandled rejection'));
