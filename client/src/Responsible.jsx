import React, { useEffect, useRef, useState } from 'react';
import { api, toast, confirmBox, haptic, tg } from './api.js';
import { fmt, toCents } from '../../shared/money.js';
import { t, useLang } from './i18n.js';
import { soundSettings, setSound, sfx } from './sound.js';
import { lowData, setLowData } from './prefs.js';

const dateOf = (s) => new Date(s * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** Shown once: the player must confirm they are 18+ before anything else. */
export function AgeGate({ cfg, onConfirmed }) {
  useLang();
  const [no, setNo] = useState(false);
  const [busy, setBusy] = useState(false);
  if (no) {
    return (
      <div className="overlay solid"><div className="result">
        <h2>🔞</h2>
        <p>{t('ageNo', { age: cfg.minAge })}</p>
        <button className="ghost" onClick={() => setNo(false)}>{t('back')}</button>
      </div></div>
    );
  }
  return (
    <div className="overlay solid"><div className="result">
      <h2>🔞 {t('ageTitle', { age: cfg.minAge })}</h2>
      <p className="muted">{t('ageText', { age: cfg.minAge })}</p>
      <button className="primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api.confirmAge(); onConfirmed(); } catch (e) { toast(e.message); } finally { setBusy(false); }
      }}>{t('ageYes', { age: cfg.minAge })}</button>
      <button className="ghost" onClick={() => setNo(true)}>{t('ageUnder', { age: cfg.minAge })}</button>
    </div></div>
  );
}

/**
 * Play-time reminder: after `minutes` of active play, show how long they've played and today's result.
 * Only counts time while the app is visible.
 */
export function RealityCheck({ minutes, cfg }) {
  useLang();
  const [show, setShow] = useState(null);
  const active = useRef(0);
  const sessionStart = useRef(Date.now());
  useEffect(() => {
    if (!minutes) return;
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      active.current += 15;
      if (active.current >= minutes * 60) {
        active.current = 0;
        api.rgToday().then((s) => setShow({ ...s, mins: Math.round((Date.now() - sessionStart.current) / 60000) })).catch(() => {});
      }
    }, 15000);
    return () => clearInterval(tick);
  }, [minutes]);
  if (!show) return null;
  return (
    <div className="overlay"><div className="result">
      <h2>⏰ {t('rcTitle')}</h2>
      <p>{t('rcPlayed', { min: show.mins })}</p>
      <div className="rc-grid">
        <div><div className="muted small">{t('rcStaked')}</div><b>{fmt(show.played)} {cfg.currency}</b></div>
        <div><div className="muted small">{t('rcWon')}</div><b>{fmt(show.won)} {cfg.currency}</b></div>
        <div><div className="muted small">{t('rcNet')}</div><b className={show.net >= 0 ? 'pos' : 'neg'}>{show.net > 0 ? '+' : ''}{fmt(show.net)} {cfg.currency}</b></div>
      </div>
      <button className="primary" onClick={() => setShow(null)}>{t('rcContinue')}</button>
      <button className="ghost" onClick={() => { setShow(null); tg?.close ? tg.close() : null; }}>{t('rcBreak')}</button>
    </div></div>
  );
}

/** "Play responsibly" section in the wallet: deposit limits, reminder, self-exclusion. */
export function PlaySafe({ cfg }) {
  useLang();
  const [l, setL] = useState(null);
  const [day, setDay] = useState('');
  const [week, setWeek] = useState('');
  const [open, setOpen] = useState(false);
  const load = () => api.rg().then((r) => { setL(r); setDay(r.day ? String(r.day / 100) : ''); setWeek(r.week ? String(r.week / 100) : ''); });
  useEffect(() => { load().catch(() => {}); }, []);
  if (!l) return null;
  const cur = (v) => (v === null ? t('noLimit') : `${fmt(v)} ${cfg.currency}`);
  const save = async () => {
    try {
      const r = await api.setLimits(day ? toCents(day) : null, week ? toCents(week) : null);
      setL(r); haptic('success');
      toast(r.pending ? t('limitRaiseLater', { when: new Date(r.pending.at * 1000).toLocaleString() }) : t('limitSaved'));
    } catch (e) { toast(e.message); }
  };
  const exclude = async (days) => {
    if (!(await confirmBox(t('excludeConfirm', { days })))) return;
    try { const r = await api.selfExclude(days); setL(r); toast(t('excludedUntil', { date: dateOf(r.excludedUntil) })); } catch (e) { toast(e.message); }
  };
  return (
    <div className="playsafe">
      <button className="playsafe-head" onClick={() => setOpen(!open)}>
        <span>🛡 {t('playSafe')}</span><span className="muted">{open ? '▲' : '▼'}</span>
      </button>
      {l.excludedUntil && <div className="banner">{t('excludedBanner', { date: dateOf(l.excludedUntil) })}</div>}
      {open && (
        <div className="playsafe-body">
          <h4>{t('depLimits')}</h4>
          <p className="muted small">{t('depLimitsHelp')}</p>
          <div className="limit-row">
            <label>{t('perDay')} <small className="muted">({t('now')}: {cur(l.day)} · {t('used')} {fmt(l.usedDay)})</small></label>
            <input inputMode="decimal" placeholder={t('noLimit')} value={day} onChange={(e) => setDay(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
          <div className="limit-row">
            <label>{t('perWeek')} <small className="muted">({t('now')}: {cur(l.week)} · {t('used')} {fmt(l.usedWeek)})</small></label>
            <input inputMode="decimal" placeholder={t('noLimit')} value={week} onChange={(e) => setWeek(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
          {l.pending && <div className="small warn">{t('limitPending', { when: new Date(l.pending.at * 1000).toLocaleString() })}</div>}
          <button className="primary sm" onClick={save}>{t('saveLimits')}</button>

          <h4>{t('reminderTitle')}</h4>
          <div className="seg small-seg">
            {[0, 30, 60, 120].map((m) => (
              <button key={m} className={l.reminderMin === m ? 'active' : ''} onClick={async () => setL(await api.setReminder(m))}>
                {m ? t('everyMin', { m }) : t('off')}
              </button>
            ))}
          </div>

          <h4>{t('takeBreak')}</h4>
          <p className="muted small">{t('takeBreakHelp')}</p>
          <div className="seg small-seg">
            {l.exclusionDays.map((d) => <button key={d} onClick={() => exclude(d)}>{d >= 180 ? t('months6') : t('nDays', { n: d })}</button>)}
          </div>
          {cfg.supportContact && <p className="muted small">{t('needHelp')} {cfg.supportContact}</p>}
        </div>
      )}
    </div>
  );
}

/** Wallet → Settings: sound effects, bingo voice, low-data mode. */
export function DeviceSettings() {
  useLang();
  const [s, setS] = useState(() => ({ ...soundSettings(), lowData: lowData() }));
  const toggle = (k) => {
    const on = !s[k];
    if (k === 'lowData') setLowData(on); else setSound(k, on);
    setS({ ...s, [k]: on });
    if (k === 'effects' && on) sfx('pick');
  };
  const Row = ({ k, label, help }) => (
    <label className="setting-row">
      <span><b>{label}</b>{help && <small className="muted"> — {help}</small>}</span>
      <input type="checkbox" checked={!!s[k]} onChange={() => toggle(k)} />
    </label>
  );
  return (
    <div className="playsafe">
      <div className="playsafe-head"><span>⚙️ {t('settings')}</span></div>
      <div className="playsafe-body">
        <Row k="effects" label={t('setEffects')} />
        <Row k="voice" label={t('setVoice')} help={t('setVoiceHelp')} />
        <Row k="lowData" label={t('setLowData')} help={t('setLowDataHelp')} />
      </div>
    </div>
  );
}
