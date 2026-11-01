import React, { useEffect, useState } from 'react';
import { api, socket, tg, withEndsAt } from './api.js';
import Lobby from './Lobby.jsx';
import Room from './Room.jsx';
import Wallet from './Wallet.jsx';
import Admin from './Admin.jsx';

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [rooms, setRooms] = useState([]);
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('admin') ? 'admin' : 'play');
  const [stake, setStake] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    socket.connect();
    Promise.all([api.config(), api.me()])
      .then(([c, m]) => {
        setCfg(c);
        setUser(m.user);
        setBalance(m.user.balance);
      })
      .catch((e) => setError(e.message));

    const onAll = (list) => setRooms(list.map(withEndsAt));
    const onOne = (r) => setRooms((prev) => prev.map((x) => (x.stake === r.stake ? withEndsAt(r) : x)));
    const onBal = ({ balance }) => setBalance(balance);
    const onErr = (e) => setError(e.message === 'Unauthorized' ? 'Please open this app from the Telegram bot.' : e.message);
    socket.on('lobby:all', onAll);
    socket.on('lobby', onOne);
    socket.on('balance', onBal);
    socket.on('connect_error', onErr);
    socket.on('connect', () => setError(''));
    return () => {
      socket.off('lobby:all', onAll);
      socket.off('lobby', onOne);
      socket.off('balance', onBal);
      socket.off('connect_error', onErr);
    };
  }, []);

  // Telegram back button leaves the room
  useEffect(() => {
    const back = tg?.BackButton;
    if (!back) return;
    const goBack = () => setStake(null);
    if (stake !== null) {
      back.show();
      back.onClick(goBack);
    } else back.hide();
    return () => back.offClick(goBack);
  }, [stake]);

  if (error && !cfg) return <div className="center muted">{error}</div>;
  if (!cfg || !user) return <div className="center muted">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🎱 Bingo</div>
        <button className="balance" onClick={() => { setStake(null); setTab('wallet'); }}>
          {balance} {cfg.currency}
        </button>
      </header>
      {error && <div className="banner">{error}</div>}

      <main>
        {stake !== null ? (
          <Room stake={stake} cfg={cfg} user={user} balance={balance} onExit={() => setStake(null)} />
        ) : tab === 'play' ? (
          <Lobby rooms={rooms} cfg={cfg} onEnter={setStake} />
        ) : tab === 'admin' && user.isAdmin ? (
          <Admin cfg={cfg} />
        ) : (
          <Wallet cfg={cfg} balance={balance} />
        )}
      </main>

      {stake === null && (
        <nav className="tabs">
          <button className={tab === 'play' ? 'active' : ''} onClick={() => setTab('play')}>🎮 Play</button>
          <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')}>💳 Wallet</button>
          {user.isAdmin && (
            <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>🛠 Admin</button>
          )}
        </nav>
      )}
    </div>
  );
}
