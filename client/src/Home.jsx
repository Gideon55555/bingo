import React from 'react';
import { t, useLang, crashName } from './i18n.js';
import { GAME_ART } from './GameArt.jsx';

/** Home screen: a grid of square game tiles, each with its own illustration. */
export default function Home({ cfg, live, rooms, onOpen }) {
  useLang();
  const bingoPlayers = rooms.reduce((s, r) => s + (r.players || 0), 0);
  const tiles = [
    cfg.crash && {
      id: 'aviator', name: crashName(cfg), tag: t('tag_aviator'),
      status: live.aviator?.phase === 'flying' ? { text: t('live'), cls: 'hot' } : { text: t('st_betting'), cls: 'open' },
    },
    { id: 'bingo', name: t('g_bingo'), tag: t('tag_bingo'), status: bingoPlayers ? { text: t('playingNow', { n: bingoPlayers }), cls: 'hot' } : { text: t('st_open'), cls: 'open' } },
    cfg.keno && {
      id: 'keno', name: t('g_keno'), tag: t('tag_keno'),
      status: live.keno?.phase === 'drawing' ? { text: t('st_drawing'), cls: 'hot' } : { text: t('st_open'), cls: 'open' },
    },
    cfg.ludo && { id: 'ludo', name: t('g_ludo'), tag: t('tag_ludo'), status: live.ludo?.playing ? { text: t('playingNow', { n: live.ludo.playing }), cls: 'hot' } : { text: t('st_pvp'), cls: 'open' } },
    cfg.pool && { id: 'pool', name: t('g_pool'), tag: t('tag_pool'), status: live.pool?.playing ? { text: t('playingNow', { n: live.pool.playing }), cls: 'hot' } : { text: t('st_skill'), cls: 'open' } },
  ].filter(Boolean);
  const paused = live.aviator?.paused || live.ludo?.paused || live.pool?.paused || rooms[0]?.paused;

  return (
    <div className="home">
      {paused && <div className="banner">⏸ {t('paused')}</div>}
      <div className="game-grid">
        {tiles.map((g) => {
          const Art = GAME_ART[g.id];
          return (
            <button key={g.id} className="game-tile" onClick={() => onOpen(g.id)}>
              <div className="tile-art"><Art /></div>
              <span className={`tile-status ${g.status.cls}`}>{g.status.text}</span>
              <div className="tile-text">
                <div className="tile-name">{g.name}</div>
                <div className="tile-tag">{g.tag}</div>
              </div>
            </button>
          );
        })}
        {tiles.length % 2 === 1 && (
          <div className="game-tile soon">
            <div className="tile-art soon-art">✨🃏♟️</div>
            <div className="tile-text"><div className="tile-name">{t('moreSoon')}</div><div className="tile-tag">{t('moreSoonTag')}</div></div>
          </div>
        )}
      </div>
      <p className="muted small center-text">{t('ageNote', { age: cfg.minAge })}{cfg.supportContact ? ` · ${t('help')}: ${cfg.supportContact}` : ''}</p>
    </div>
  );
}
