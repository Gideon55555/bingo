import React from 'react';
import { tg, toast, haptic } from './api.js';
import { t, useLang } from './i18n.js';

/** "Practice vs bot" and "Invite a friend" buttons above a game's table list. */
export function SocialBar({ onPractice, inviteMode, setInviteMode, busy }) {
  useLang();
  return (
    <>
      <div className="social-bar">
        <button className="ghost" disabled={busy} onClick={onPractice}>🤖 {t('practiceFree')}</button>
        <button className={inviteMode ? 'primary' : 'ghost'} disabled={busy} onClick={() => setInviteMode(!inviteMode)}>👥 {t('inviteFriend')}</button>
      </div>
      {inviteMode && <div className="banner info">{t('inviteHow')}</div>}
    </>
  );
}

/** Shown while waiting at a private table: the link to send to a friend. */
export function InviteBox({ prefix, code, cfg }) {
  useLang();
  if (!code) return null;
  const link = cfg.botUsername ? `https://t.me/${cfg.botUsername}?start=${prefix}_${code}` : null;
  const share = () => {
    haptic('light');
    const text = t('inviteShareText');
    const url = `https://t.me/share/url?url=${encodeURIComponent(link || code)}&text=${encodeURIComponent(text)}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank');
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link || code); toast(t('copied')); } catch { toast(link || code); }
  };
  return (
    <div className="invite-box">
      <div className="small muted">{t('inviteCode')}</div>
      <div className="invite-code">{code}</div>
      {link && <div className="mono small break">{link}</div>}
      <div className="social-bar">
        {link && <button className="primary" onClick={share}>📤 {t('sendInvite')}</button>}
        <button className="ghost" onClick={copy}>📋 {t('copyLink')}</button>
      </div>
      <p className="small muted">{t('inviteExpires')}</p>
    </div>
  );
}
