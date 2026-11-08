import React, { useEffect, useState } from 'react';
import { api, socket, tg, withEndsAt } from './api.js';
import Lobby from './Lobby.jsx';
import Room from './Room.jsx';
import Wallet from './Wallet.jsx';
import Admin from './Admin.jsx';
import Crash from './Crash.jsx';
import Keno from './Keno.jsx';
import Ludo from './Ludo.jsx';
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
  const [keno, setKeno] = useState(false);
  const [kenoLobby, setKenoLobby] = useState(null);
  const [ludo, setLudo] = useState(false);
  const [ludoHome, setLudoHome] = useState(null);
  const inGame = stake !== null || rocket || keno || ludo;
  const goHome = () => { setStake(null); setRocket(false); setKeno(false); setLudo(false); };
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
    socket.on('keno:lobby', setKenoLobby);
    socket.on('ludo:home', setLudoHome);
    // If a Ludo game starts while you're elsewhere in the app, jump straight to it
    const onLudoMe = (m) => { if (m?.game) { setStake(null); setRocket(false); setKeno(false); setLudo(true); } };
    socket.on('ludo:me', onLudoMe);
    socket.on('connect_error', onErr);
    socket.on('connect', () => setError(''));
    socket.on('server:restart', () => setError('Server is restarting for maintenance — reconnecting… Any unfinished game entry is refunded.'));
    return () => {
      socket.off('lobby:all', onAll);
      socket.off('lobby', onOne);
      socket.off('balance', onBal);
      socket.off('crash:lobby', setCrashLobby);
      socket.off('keno:lobby', setKenoLobby);
      socket.off('ludo:home', setLudoHome);
      socket.off('ludo:me', onLudoMe);
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
        <div className="brand">{rocket ? `✈️ ${cfg.crash?.name || 'Sky High'}` : keno ? '🎯 Keno' : ludo ? '🎲 Ludo' : stake !== null ? '🎱 Bingo' : `🎮 ${cfg.appName || 'Games'}`}</div>
        <button className="balance" onClick={() => { goHome(); setTab('wallet'); }}>
          {fmt(balance)} {cfg.currency}
        </button>
      </header>
      {error && <div className="banner">{error}</div>}

      <main>
        {ludo ? (
          <Ludo cfg={cfg} balance={balance} />
        ) : keno ? (
          <Keno cfg={cfg} balance={balance} />
        ) : rocket ? (
          <Crash cfg={cfg} balance={balance} />
        ) : stake !== null ? (
          <Room stake={stake} cfg={cfg} user={user} balance={balance} onExit={goHome} />
        ) : tab === 'play' ? (
          <Lobby rooms={rooms} cfg={cfg} onEnter={setStake} crash={cfg.crash ? crashLobby : null} onRocket={() => setRocket(true)}
            keno={cfg.keno ? kenoLobby : null} onKeno={() => setKeno(true)}
            ludo={cfg.ludo ? (ludoHome || { playing: 0 }) : null} onLudo={() => setLudo(true)} />
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
