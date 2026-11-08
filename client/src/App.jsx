import React, { useEffect, useState } from 'react';
import { api, socket, tg, withEndsAt } from './api.js';
import { t, useLang, getLang, setLang, crashName } from './i18n.js';
import Home from './Home.jsx';
import BingoRooms from './BingoRooms.jsx';
import Room from './Room.jsx';
import Wallet from './Wallet.jsx';
import Admin from './Admin.jsx';
import Crash from './Crash.jsx';
import Keno from './Keno.jsx';
import Ludo from './Ludo.jsx';
import Pool from './Pool.jsx';
import Kerenbula from './Kerenbula.jsx';
import GameRules, { rulesSeen, markRulesSeen } from './GameRules.jsx';
import { fmt } from '../../shared/money.js';

function LangSwitch() {
  const lang = useLang();
  const pick = (l) => {
    setLang(l);
    api.setLang(l).catch(() => {}); // so the bot also messages you in this language
  };
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      <button className={lang === 'am' ? 'on' : ''} onClick={() => pick('am')}>አማ</button>
      <button className={lang === 'en' ? 'on' : ''} onClick={() => pick('en')}>EN</button>
    </div>
  );
}

export default function App() {
  useLang();
  const [cfg, setCfg] = useState(null);
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [rooms, setRooms] = useState([]);
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('admin') ? 'admin' : 'play');
  const [game, setGame] = useState(null);       // null | 'aviator' | 'bingo' | 'keno' | 'ludo' | 'pool' | 'kerenbula'
  const [stake, setStake] = useState(null);     // bingo room inside the bingo screen
  const [showRules, setShowRules] = useState(false);
  const [live, setLive] = useState({});         // lobby summaries for the home tiles
  const [error, setError] = useState('');

  const openGame = (g) => {
    setStake(null);
    setGame(g);
    setShowRules(!rulesSeen(g));
  };
  const goHome = () => { setStake(null); setGame(null); setShowRules(false); };
  const goBack = () => (stake !== null ? setStake(null) : goHome());

  useEffect(() => {
    socket.connect();
    Promise.all([api.config(), api.me()])
      .then(([c, m]) => {
        setCfg(c);
        setUser(m.user);
        setBalance(m.user.balance);
        api.setLang(getLang()).catch(() => {});
      })
      .catch((e) => setError(e.message));

    const onAll = (list) => setRooms(list.map(withEndsAt));
    const onOne = (r) => setRooms((prev) => prev.map((x) => (x.stake === r.stake ? withEndsAt(r) : x)));
    const onBal = ({ balance }) => setBalance(balance);
    const onErr = (e) => setError(e.message === 'Unauthorized' ? 'openFromBot' : e.message);
    const put = (k) => (v) => setLive((p) => ({ ...p, [k]: v }));
    const onCrash = put('aviator'), onKeno = put('keno'), onLudo = put('ludo'), onPool = put('pool'), onKb = put('kerenbula');
    // A Ludo or pool game started while you're elsewhere in the app → jump straight to it
    const onLudoMe = (m) => { if (m?.game) { setStake(null); setGame('ludo'); } };
    const onPoolMe = (m) => { if (m?.game) { setStake(null); setGame('pool'); } };
    const onKbMe = (m) => { if (m?.game) { setStake(null); setGame('kerenbula'); } };
    socket.on('lobby:all', onAll);
    socket.on('lobby', onOne);
    socket.on('balance', onBal);
    socket.on('crash:lobby', onCrash);
    socket.on('keno:lobby', onKeno);
    socket.on('ludo:home', onLudo);
    socket.on('pool:home', onPool);
    socket.on('ludo:me', onLudoMe);
    socket.on('pool:me', onPoolMe);
    socket.on('kb:home', onKb);
    socket.on('kb:me', onKbMe);
    socket.on('connect_error', onErr);
    socket.on('connect', () => setError(''));
    socket.on('server:restart', () => setError('restarting'));
    return () => {
      socket.off('lobby:all', onAll);
      socket.off('lobby', onOne);
      socket.off('balance', onBal);
      socket.off('crash:lobby', onCrash);
      socket.off('keno:lobby', onKeno);
      socket.off('ludo:home', onLudo);
      socket.off('pool:home', onPool);
      socket.off('ludo:me', onLudoMe);
      socket.off('pool:me', onPoolMe);
      socket.off('kb:home', onKb);
      socket.off('kb:me', onKbMe);
      socket.off('connect_error', onErr);
    };
  }, []);

  // Telegram's own back button
  const inGame = game !== null;
  useEffect(() => {
    const back = tg?.BackButton;
    if (!back) return;
    if (inGame) { back.show(); back.onClick(goBack); } else back.hide();
    return () => back.offClick(goBack);
  }, [inGame, stake]);

  const errText = error === 'openFromBot' ? t('openFromBot') : error === 'restarting' ? t('restarting') : error;
  if (error && !cfg) return <div className="center muted">{errText}</div>;
  if (!cfg || !user) return <div className="center muted">{t('loading')}</div>;

  const gameName = game === 'aviator' ? crashName(cfg) : game ? t(`g_${game}`) : null;
  const icons = { aviator: '✈️', bingo: '🔢', keno: '🎯', ludo: '🎲', pool: '🎱', kerenbula: '🔴' };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">{game ? `${icons[game]} ${gameName}` : `🎮 ${cfg.appName || t('games')}`}</div>
        <div className="topbar-right">
          {game && <button className="rules-btn" onClick={() => setShowRules(true)}>📖 {t('rules')}</button>}
          <LangSwitch />
          <button className="balance" onClick={() => { goHome(); setTab('wallet'); }}>{fmt(balance)} {cfg.currency}</button>
        </div>
      </header>
      {error && <div className="banner">{errText}</div>}

      <main>
        {game === 'kerenbula' ? <Kerenbula cfg={cfg} balance={balance} />
          : game === 'pool' ? <Pool cfg={cfg} balance={balance} />
          : game === 'ludo' ? <Ludo cfg={cfg} balance={balance} />
          : game === 'keno' ? <Keno cfg={cfg} balance={balance} />
          : game === 'aviator' ? <Crash cfg={cfg} balance={balance} />
          : game === 'bingo' ? (stake !== null
            ? <Room stake={stake} cfg={cfg} user={user} balance={balance} onExit={() => setStake(null)} />
            : <BingoRooms rooms={rooms} cfg={cfg} onEnter={setStake} />)
          : tab === 'play' ? <Home cfg={cfg} live={live} rooms={rooms} onOpen={openGame} />
          : tab === 'admin' && user.isAdmin ? <Admin cfg={cfg} />
          : <Wallet cfg={cfg} balance={balance} />}
      </main>

      {game && showRules && <GameRules game={game} cfg={cfg} onClose={() => { markRulesSeen(game); setShowRules(false); }} />}

      {inGame && !tg?.initData && <button className="floating-back" onClick={goBack}>{stake !== null ? `← ${t('bingoRooms')}` : t('backToGames')}</button>}
      {!inGame && (
        <nav className="tabs">
          <button className={tab === 'play' ? 'active' : ''} onClick={() => setTab('play')}>🎮 {t('games')}</button>
          <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')}>💳 {t('wallet')}</button>
          {user.isAdmin && <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>🛠 Admin</button>}
        </nav>
      )}
    </div>
  );
}
