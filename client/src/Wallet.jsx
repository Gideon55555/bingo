import { PlaySafe, DeviceSettings } from './Responsible.jsx';
import React, { useEffect, useState } from 'react';
import { api, haptic, toast, tg } from './api.js';
import { fmt, toCents } from '../../shared/money.js';
import { t, useLang } from './i18n.js';

const cleanAmount = (v) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2}).*/, '$1');

export default function Wallet({ cfg, balance }) {
  useLang();
  const [mode, setMode] = useState('deposit');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);

  const [lock, setLock] = useState(null);
  // Online payment through Chapa (Telebirr, CBE Birr…) when the operator has turned it on
  const [method, setMethod] = useState(cfg.chapa ? 'online' : 'manual');
  const [waiting, setWaiting] = useState(null); // txRef of a checkout we're waiting for
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await api.chapaStatus(waiting);
        if (r.status === 'approved') { setWaiting(null); haptic('success'); toast(t('paidOnline')); load(); }
        else if (r.status === 'rejected') { setWaiting(null); toast(t('payFailed')); load(); }
      } catch { /* keep waiting */ }
      if (++n > 120) setWaiting(null); // stop after ~10 minutes
    };
    const iv = setInterval(check, 5000);
    const onVis = () => check();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [waiting]);
  const load = () => {
    api.growth().then((g) => setLock(g.wallet)).catch(() => {});
    return api.history().then((r) => setItems(r.items)).catch(() => {});
  };
  useEffect(() => { load(); }, [balance]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'deposit' && method === 'online') {
        const r = await api.chapaDeposit(toCents(amount));
        setWaiting(r.txRef);
        if (tg?.openLink) tg.openLink(r.checkoutUrl); else window.open(r.checkoutUrl, '_blank');
        toast(t('payOpened'));
      } else if (mode === 'deposit') {
        await api.deposit(toCents(amount), ref);
        toast(t('depositSent'));
        setRef('');
      } else {
        await api.withdraw(toCents(amount), phone);
        toast(t('withdrawSent'));
      }
      haptic('success');
      setAmount('');
      load();
    } catch (err) {
      haptic('error');
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wallet">
      <div className="balance-card">
        <div className="muted small">{t('balance')}</div>
        <div className="huge">{fmt(balance)} <small>{cfg.currency}</small></div>
      </div>

      <div className="seg">
        <button className={mode === 'deposit' ? 'active' : ''} onClick={() => setMode('deposit')}>{t('deposit')}</button>
        <button className={mode === 'withdraw' ? 'active' : ''} onClick={() => setMode('withdraw')}>{t('withdraw')}</button>
      </div>

      <form className="form" onSubmit={submit}>
        {mode === 'deposit' && cfg.chapa && (
          <div className="seg small-seg">
            <button type="button" className={method === 'online' ? 'active' : ''} onClick={() => setMethod('online')}>⚡ {t('payOnline')}</button>
            <button type="button" className={method === 'manual' ? 'active' : ''} onClick={() => setMethod('manual')}>{t('payManual')}</button>
          </div>
        )}
        {mode === 'deposit' && method === 'online' ? (
          <>
            <div className="howto">{t('payOnlineHow')}</div>
            <input inputMode="decimal" placeholder={t('amountMin', { min: fmt(cfg.minDeposit) })} value={amount}
              onChange={(e) => setAmount(cleanAmount(e.target.value))} required />
            {waiting && (
              <div className="banner info">
                <div className="spinner sm" /> {t('payWaiting')}
                <button type="button" className="ghost sm" onClick={() => api.chapaStatus(waiting).then((r) => { if (r.status === 'approved') { setWaiting(null); toast(t('paidOnline')); load(); } else toast(t('payNotYet')); })}>{t('payCheck')}</button>
              </div>
            )}
          </>
        ) : mode === 'deposit' ? (
          <>
            <div className="howto">
              <b>1.</b> {t('sendMoneyTo')}
              <div className="payinfo">{cfg.paymentInfo}</div>
              <b>2.</b> {t('depositStep2')}
            </div>
            <input inputMode="decimal" placeholder={t('amountMin', { min: fmt(cfg.minDeposit) })} value={amount}
              onChange={(e) => setAmount(cleanAmount(e.target.value))} required />
            <input placeholder={t('txId')} value={ref} onChange={(e) => setRef(e.target.value)} required />
          </>
        ) : (
          <>
            <input inputMode="decimal" placeholder={t('amountMin', { min: fmt(cfg.minWithdraw) })} value={amount}
              onChange={(e) => setAmount(cleanAmount(e.target.value))} required />
            <input inputMode="tel" placeholder={t('phoneReceive')} value={phone} onChange={(e) => setPhone(e.target.value)} required />
            {lock?.locked > 0 && <div className="small warn">{t('bonusLocked', { amount: `${fmt(lock.withdrawable)} ${cfg.currency}`, toPlay: `${fmt(lock.toPlay)} ${cfg.currency}` })}</div>}
          </>
        )}
        <button className="primary" disabled={busy}>{busy ? t('sending') : mode === 'deposit' ? (method === 'online' ? `⚡ ${t('payNow')}` : t('submitDeposit')) : t('requestWithdraw')}</button>
        {mode === 'withdraw' && cfg.chapa?.autoPayoutMax > 0 && <div className="small muted">{t('autoPayoutNote', { max: `${fmt(cfg.chapa.autoPayoutMax)} ${cfg.currency}` })}</div>}
      </form>

      <PlaySafe cfg={cfg} />
      <DeviceSettings />

      <h3>{t('history')}</h3>
      <div className="history">
        {items.length === 0 && <div className="muted small">{t('noTx')}</div>}
        {items.map((tx) => (
          <div key={tx.id} className="tx">
            <div>
              <div>{t(`tx_${tx.type}`)}</div>
              <div className="muted small">
                {new Date(tx.created_at * 1000).toLocaleString()} {tx.reference ? `· ${tx.reference}` : ''}
              </div>
            </div>
            <div className="right">
              <div className={tx.amount >= 0 ? 'pos' : 'neg'}>{tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}</div>
              {tx.status !== 'done' && <div className={`pill ${tx.status}`}>{t(`s_${tx.status}`)}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
