import React, { useEffect, useState } from 'react';
import { api, adminApi, adminKey } from './api.js';
import Admin from './Admin.jsx';

/** Browser admin panel at /admin, protected by ADMIN_PASSWORD. */
export default function AdminStandalone() {
  const [cfg, setCfg] = useState(null);
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.config().then(setCfg).catch((e) => setError(e.message));
    if (adminKey.get()) {
      adminApi.stats().then(() => setAuthed(true)).catch(() => adminKey.set('')).finally(() => setChecking(false));
    } else setChecking(false);
  }, []);

  const login = async (e) => {
    e.preventDefault();
    adminKey.set(pw);
    try {
      await adminApi.stats();
      setAuthed(true);
      setError('');
    } catch (err) {
      adminKey.set('');
      setError(err.status === 401 ? 'Wrong password (or ADMIN_PASSWORD is not set on the server)' : err.message);
    }
  };

  const logout = () => { adminKey.set(''); setAuthed(false); setPw(''); };

  if (checking || !cfg) return <div className="center muted">{error || 'Loading…'}</div>;

  if (!authed) {
    return (
      <div className="center">
        <form className="login" onSubmit={login}>
          <div className="brand">🎱 Bingo Admin</div>
          <input type="password" placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          <button className="primary">Log in</button>
          {error && <div className="warn small">{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="app admin-wide">
      <header className="topbar"><div className="brand">🎱 Bingo Admin</div></header>
      <main><Admin cfg={cfg} onLogout={logout} /></main>
    </div>
  );
}
