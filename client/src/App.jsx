import React, { useEffect, useState } from 'react';
import { api, socket, tg, withEndsAt } from './api.js';
import Lobby from './Lobby.jsx';
import Room from './Room.jsx';
import Wallet from './Wallet.jsx';
import Admin from './Admin.jsx';
import Crash from './Crash.jsx';
import { fmt } from '../../shared/money.js';

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [rooms, setRooms] = useState([]);
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('admin') ? 'admin' : 'play');
  const [stake, setStake] = useState(null);
  const [rocket, setRocket] = useState(false);
  const [crashLobby, setCrashLobby] = useState(null);
  const inGame = stake !== null || rocket;
  const goHome = () => { setStake(null); setRocket(false); };
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
    socket.on('crash:lobby', setCrashLobby);
    socket.on('connect_error', onErr);
    socket.on('connect', () => setError(''));
    socket.on('server:restart', () => setError('Server is restarting for maintenance — reconnecting… Any unfinished game entry is refunded.'));
    return () => {
      socket.off('lobby:all', onAll);
      socket.off('lobby', onOne);
      socket.off('balance', onBal);
      socket.off('crash:lobby', setCrashLobby);
      socket.off('connect_error', onErr);
    };
  }, []);

  // Telegram back button leaves the room
  useEffect(() => {
    const back = tg?.BackButton;
    if (!back) return;
    const goBack = goHome;
    if (inGame) {
      back.show();
      back.onClick(goBack);
    } else back.hide();
    return () => back.offClick(goBack);
  }, [inGame]);

  if (error && !cfg) return <div className="center muted">{error}</div>;
  if (!cfg || !user) return <div className="center muted">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">{rocket ? '🚀 Rocket' : stake !== null ? '🎱 Bingo' : `🎮 ${cfg.appName || 'Games'}`}</div>
        <button className="balance" onClick={() => { goHome(); setTab('wallet'); }}>
          {fmt(balance)} {cfg.currency}
        </button>
      </header>
      {error && <div className="banner">{error}</div>}

      <main>
        {rocket ? (
          <Crash cfg={cfg} balance={balance} />
        ) : stake !== null ? (
          <Room stake={stake} cfg={cfg} user={user} balance={balance} onExit={goHome} />
        ) : tab === 'play' ? (
          <Lobby rooms={rooms} cfg={cfg} onEnter={setStake} crash={cfg.crash ? crashLobby : null} onRocket={() => setRocket(true)} />
        ) : tab === 'admin' && user.isAdmin ? (
          <Admin cfg={cfg} />
        ) : (
          <Wallet cfg={cfg} balance={balance} />
        )}
      </main>

      {inGame && !tg?.initData && <button className="floating-back" onClick={goHome}>← Games</button>}
      {!inGame && (
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
