import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t, useLang, crashName } from './i18n.js';
import { GAME_ART } from './GameArt.jsx';
import GrowthCards from './Growth.jsx';
import { api, tg } from './api.js';
import { fmt } from '../../shared/money.js';

const GAME_ICON = { aviator: '✈️', bingo: '🔢', keno: '🎯', ludo: '🎲', pool: '🎱', kerenbula: '🔴', crash: '✈️' };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Promo carousel: the admin's uploaded banners, or built-in slides for the games that are on. */
function Promo({ cfg, user, onOpen, onWallet }) {
  useLang();
  const [uploaded, setUploaded] = useState(null);
  const [i, setI] = useState(0);
  const track = useRef(null);
  const touched = useRef(false);
  useEffect(() => { api.banners().then((r) => setUploaded(r.items)).catch(() => setUploaded([])); }, []);

  const builtIn = useMemo(() => [
    cfg.crash && { id: 'b-aviator', target: 'aviator', art: 'aviator', title: t('promoAviator', { x: Math.round(cfg.crash.maxMultiplier / 100) }), subtitle: t('promoAviatorSub'), cta: t('playNow') },
    { id: 'b-bingo', target: 'bingo', art: 'bingo', title: t('promoBingo', { n: cfg.maxCards || 1 }), subtitle: t('promoBingoSub'), cta: t('playNow') },
    cfg.growth?.signupBonus > 0 && { id: 'b-signup', target: 'wallet', art: 'keno', title: t('promoSignup', { amount: `${fmt(cfg.growth.signupBonus)} ${cfg.currency}` }), subtitle: t('promoSignupSub'), cta: t('deposit') },
    cfg.kerenbula && { id: 'b-kb', target: 'kerenbula', art: 'kerenbula', title: t('promoKb'), subtitle: t('promoKbSub'), cta: t('playNow') },
    cfg.growth?.referralBonus > 0 && cfg.botUsername && { id: 'b-ref', target: 'invite', art: 'ludo', title: t('promoRef', { amount: `${fmt(cfg.growth.referralBonus)} ${cfg.currency}` }), subtitle: t('promoRefSub'), cta: t('share') },
  ].filter(Boolean), [cfg, useLang()]);
  const slides = uploaded?.length ? uploaded : builtIn;

  const go = (target) => {
    if (!target) return;
    if (target === 'wallet') return onWallet();
    if (target === 'invite') {
      const link = `https://t.me/${cfg.botUsername}?start=ref_${user.id}`;
      const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('refShareText'))}`;
      return tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, '_blank');
    }
    if (target === 'aviator' ? cfg.crash : target === 'bingo' || cfg[target]) onOpen(target);
  };
  const scrollTo = (k) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: k * (el.firstChild?.offsetWidth + 10 || el.clientWidth), behavior: reduced() ? 'auto' : 'smooth' });
  };
  // Auto-advance every 5 s until the player swipes themselves
  useEffect(() => {
    if (slides.length < 2 || reduced()) return;
    const iv = setInterval(() => { if (!touched.current && document.visibilityState === 'visible') scrollTo((i + 1) % slides.length); }, 5000);
    return () => clearInterval(iv);
  }, [i, slides.length]);
  const onScroll = () => {
    const el = track.current;
    const w = el.firstChild?.offsetWidth + 10 || el.clientWidth;
    setI(Math.round(el.scrollLeft / w));
  };
  if (!slides.length) return null;
  return (
    <div className="promo">
      <div className="promo-track" ref={track} onScroll={onScroll} onTouchStart={() => { touched.current = true; }}>
        {slides.map((s) => {
          const Art = s.art && GAME_ART[s.art];
          return (
            <button key={s.id} className="slide" onClick={() => go(s.target)}>
              {s.url ? <img src={s.url} alt={s.title || ''} loading="lazy" /> : Art && <div className="slide-art"><Art /></div>}
              {(s.title || s.subtitle || s.cta) && <div className="slide-shade" />}
              <div className="slide-text">
                {s.title && <div className="slide-title">{s.title}</div>}
                {s.subtitle && <div className="slide-sub">{s.subtitle}</div>}
                {s.cta && s.target && <span className="slide-cta">{s.cta}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {slides.length > 1 && (
        <div className="promo-dots">
          {slides.map((s, k) => <button key={s.id} className={k === i ? 'on' : ''} aria-label={`${k + 1}`} onClick={() => { touched.current = true; scrollTo(k); }} />)}
        </div>
      )}
    </div>
  );
}

/** Live winners ticker (real recent wins, names shortened). */
function Winners({ cfg }) {
  useLang();
  const [items, setItems] = useState([]);
  useEffect(() => {
    const load = () => api.recentWins().then((r) => setItems(r.items)).catch(() => {});
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);
  if (!items.length) return null;
  const gname = (g) => (g === 'crash' ? crashName(cfg) : t(`g_${g}`));
  const row = items.map((w, k) => (
    <span key={k} className="ticker-item">
      {GAME_ICON[w.game] || '🏆'} <b>{w.name}</b> {t('tickerWon')} <span className="won">{fmt(w.amount)} {cfg.currency}</span> · {gname(w.game)}
    </span>
  ));
  return (
    <div className="ticker" aria-label={t('liveWins')}>
      <span className="ticker-live">{t('live')}</span>
      <div className="ticker-view">
        <div className="ticker-row" style={{ '--dur': `${Math.max(20, items.length * 4)}s` }}>{row}{row}</div>
      </div>
    </div>
  );
}

/** Home screen: promos, live winners, categories and the game grid. */
export default function Home({ cfg, live, rooms, onOpen, onWallet, user }) {
  useLang();
  const [cat, setCat] = useState('all');
  const bingoPlayers = rooms.reduce((s, r) => s + (r.players || 0), 0);
  const tiles = [
    cfg.crash && {
      id: 'aviator', cat: 'luck', name: crashName(cfg), tag: t('tag_aviator'),
      status: live.aviator?.phase === 'flying' ? { text: t('live'), cls: 'hot' } : { text: t('st_betting'), cls: 'open' },
    },
    { id: 'bingo', cat: 'luck', name: t('g_bingo'), tag: t('tag_bingo'), status: bingoPlayers ? { text: t('playingNow', { n: bingoPlayers }), cls: 'hot' } : { text: t('st_open'), cls: 'open' } },
    cfg.keno && {
      id: 'keno', cat: 'luck', name: t('g_keno'), tag: t('tag_keno'),
      status: live.keno?.phase === 'drawing' ? { text: t('st_drawing'), cls: 'hot' } : { text: t('st_open'), cls: 'open' },
    },
    cfg.ludo && { id: 'ludo', cat: 'skill', name: t('g_ludo'), tag: t('tag_ludo'), status: live.ludo?.playing ? { text: t('playingNow', { n: live.ludo.playing }), cls: 'hot' } : { text: t('st_pvp'), cls: 'open' } },
    cfg.pool && { id: 'pool', cat: 'skill', name: t('g_pool'), tag: t('tag_pool'), status: live.pool?.playing ? { text: t('playingNow', { n: live.pool.playing }), cls: 'hot' } : { text: t('st_skill'), cls: 'open' } },
    cfg.kerenbula && { id: 'kerenbula', cat: 'skill', name: t('g_kerenbula'), tag: t('tag_kerenbula'), status: live.kerenbula?.playing ? { text: t('playingNow', { n: live.kerenbula.playing }), cls: 'hot' } : { text: t('st_new'), cls: 'new' } },
  ].filter(Boolean);
  const shown = tiles.filter((g) => cat === 'all' || g.cat === cat);
  const paused = live.aviator?.paused || live.ludo?.paused || live.pool?.paused || live.kerenbula?.paused || rooms[0]?.paused;

  return (
    <div className="home">
      {paused && <div className="banner">⏸ {t('paused')}</div>}
      <Promo cfg={cfg} user={user} onOpen={onOpen} onWallet={onWallet} />
      <Winners cfg={cfg} />
      <div className="chips" role="tablist">
        {[['all', t('catAll')], ['luck', t('catLuck')], ['skill', t('catSkill')]].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={cat === k} className={`chip-btn ${cat === k ? 'on' : ''}`} onClick={() => setCat(k)}>{label}</button>
        ))}
        {live.online > 1 && <span className="online-pill">{t('online', { n: live.online })}</span>}
      </div>
      <div className="game-grid">
        {shown.map((g) => {
          const Art = GAME_ART[g.id];
          return (
            <button key={g.id} className={`game-tile ${g.status.cls === 'hot' ? 'hot' : ''}`} onClick={() => onOpen(g.id)}>
              <div className="tile-art"><Art /></div>
              <span className={`tile-status ${g.status.cls}`}>{g.status.text}</span>
              <div className="tile-text">
                <div className="tile-name">{g.name}</div>
                <div className="tile-tag">{g.tag}</div>
              </div>
            </button>
          );
        })}
      </div>
      {user && <GrowthCards cfg={cfg} user={user} />}
      <p className="muted small center-text">{t('ageNote', { age: cfg.minAge })}{cfg.supportContact ? ` · ${t('help')}: ${cfg.supportContact}` : ''}</p>
    </div>
  );
}
