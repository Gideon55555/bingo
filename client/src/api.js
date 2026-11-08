import { io } from 'socket.io-client';

export const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
// Dev only: open http://localhost:5173/?dev_user=1 in a normal browser (server needs DEV_MODE=true)
const devUser = new URLSearchParams(location.search).get('dev_user') || '';

const headers = () => ({
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
};

// Default transports: starts with HTTP long-polling and upgrades to WebSocket when the host allows it
export const socket = io({ auth: { initData, devUser }, autoConnect: false });
export const inTelegram = !!initData;

// ---------- Admin API ----------
// In Telegram, admins are recognised by their Telegram id. In a normal browser, by ADMIN_PASSWORD.
const KEY = 'bingo_admin_key';
export const adminKey = {
  get: () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } },
  set: (v) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
};
async function adminRequest(method, url, body) {
  const h = headers();
  const k = adminKey.get();
  if (k) h['x-admin-key'] = k;
  const res = await fetch('/api/admin' + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}
export const adminApi = {
  stats: () => adminRequest('GET', '/stats'),
  pending: () => adminRequest('GET', '/pending'),
  users: (search = '', offset = 0) => adminRequest('GET', `/users?search=${encodeURIComponent(search)}&offset=${offset}`),
  user: (id) => adminRequest('GET', `/users/${encodeURIComponent(id)}`),
  transactions: (q = {}) => adminRequest('GET', `/transactions?${new URLSearchParams(q)}`),
  games: () => adminRequest('GET', '/games'),
  crashRounds: () => adminRequest('GET', '/crash-rounds'),
  kenoRounds: () => adminRequest('GET', '/keno-rounds'),
  ludoGames: () => adminRequest('GET', '/ludo-games'),
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
  if (tg?.showAlert && tg.initData) tg.showAlert(msg);
  else alert(msg);
};

/** Yes/no confirmation that works inside Telegram and in a browser */
export const confirmBox = (msg) =>
  new Promise((resolve) => {
    if (tg?.showConfirm && tg.initData) tg.showConfirm(msg, resolve);
    else resolve(window.confirm(msg));
  });
