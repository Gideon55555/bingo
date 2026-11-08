import { PlaySafe } from './Responsible.jsx';
import React, { useEffect, useState } from 'react';
import { api, haptic, toast } from './api.js';
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

  const load = () => api.history().then((r) => setItems(r.items)).catch(() => {});
  useEffect(() => { load(); }, [balance]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'deposit') {
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
        {mode === 'deposit' ? (
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
          </>
        )}
        <button className="primary" disabled={busy}>{busy ? t('sending') : mode === 'deposit' ? t('submitDeposit') : t('requestWithdraw')}</button>
      </form>

      <PlaySafe cfg={cfg} />

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
