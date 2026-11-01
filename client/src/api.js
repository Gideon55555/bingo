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

export const socket = io({ auth: { initData, devUser }, transports: ['websocket', 'polling'] });

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
