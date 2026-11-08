import React, { useEffect, useState } from 'react';
import { api, tg, toast, haptic } from './api.js';
import { fmt } from '../../shared/money.js';
import { t, useLang } from './i18n.js';
import { sfx } from './sound.js';

/** Home: daily reward, invite friends, weekly leaderboard. */
export default function GrowthCards({ cfg, user }) {
  useLang();
  const [g, setG] = useState(null);
  const [lb, setLb] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const load = () => Promise.all([api.growth().then(setG), api.leaderboard().then(setLb)]).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!g) return null;
  const ref = g.referral;
  const link = cfg.botUsername ? `https://t.me/${cfg.botUsername}?start=${ref.code}` : null;
  const claim = async () => {
    try { const r = await api.claimDaily(); haptic('success'); sfx('cash'); toast(t('dailyClaimed', { amount: `${fmt(r.amount)} ${cfg.currency}` })); load(); } catch (e) { toast(e.message); }
  };
  const share = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('refShareText'))}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank');
  };
  const rows = lb?.rows || [];
  return (
    <div className="growth">
      {g.daily.amount > 0 && g.daily.reason !== 'off' && (
        <div className={`gcard daily ${g.daily.available ? 'ready' : ''}`}>
          <div>
            <b>🎁 {t('dailyTitle')}</b>
            <div className="small muted">{g.daily.available ? t('dailyReady', { amount: `${fmt(g.daily.amount)} ${cfg.currency}` })
              : g.daily.reason === 'claimed' ? t('dailyTomorrow') : t('dailyDepositFirst')}</div>
          </div>
          {g.daily.available && <button className="primary sm" onClick={claim}>{t('claim')}</button>}
        </div>
      )}

      {ref.bonus > 0 && link && (
        <div className="gcard">
          <div>
            <b>👥 {t('refTitle', { amount: `${fmt(ref.bonus)} ${cfg.currency}` })}</b>
            <div className="small muted">{t('refHow', { min: `${fmt(ref.minDeposit)} ${cfg.currency}` })}</div>
            {ref.invited > 0 && <div className="small">{t('refStats', { invited: ref.invited, qualified: ref.qualified, earned: `${fmt(ref.earned)} ${cfg.currency}` })}</div>}
          </div>
          <button className="primary sm" onClick={share}>📤 {t('share')}</button>
        </div>
      )}

      <div className="gcard lb">
        <b>🏆 {t('lbTitle')}</b>
        {!rows.length ? <div className="small muted">{t('lbEmpty')}</div> : (
          <ol className="lb-list">
            {(showAll ? rows : rows.slice(0, 5)).map((r, i) => (
              <li key={r.id} className={r.id === String(user.id) ? 'me' : ''}>
                <span className="lb-rank">{['🥇', '🥈', '🥉'][i] || i + 1}</span>
                <span className="lb-name">{r.name}</span>
                <span className="lb-net pos">+{fmt(r.net)} {cfg.currency}</span>
              </li>
            ))}
          </ol>
        )}
        {rows.length > 5 && <button className="link-btn" onClick={() => setShowAll(!showAll)}>{showAll ? t('showLess') : t('showAll')}</button>}
      </div>
    </div>
  );
}
