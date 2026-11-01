import React, { useEffect, useState } from 'react';
import { api, haptic, toast } from './api.js';

const LABELS = { deposit: 'Deposit', withdraw: 'Withdrawal', bet: 'Game entry', win: 'Win', refund: 'Refund', adjust: 'Bonus / adjustment' };

export default function Wallet({ cfg, balance }) {
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
        await api.deposit(Number(amount), ref);
        toast('Deposit submitted! Your balance updates as soon as it is approved.');
        setRef('');
      } else {
        await api.withdraw(Number(amount), phone);
        toast('Withdrawal requested. You will be notified when it is sent.');
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
        <div className="muted small">Balance</div>
        <div className="huge">{balance} <small>{cfg.currency}</small></div>
      </div>

      <div className="seg">
        <button className={mode === 'deposit' ? 'active' : ''} onClick={() => setMode('deposit')}>Deposit</button>
        <button className={mode === 'withdraw' ? 'active' : ''} onClick={() => setMode('withdraw')}>Withdraw</button>
      </div>

      <form className="form" onSubmit={submit}>
        {mode === 'deposit' ? (
          <>
            <div className="howto">
              <b>1.</b> Send money to:
              <div className="payinfo">{cfg.paymentInfo}</div>
              <b>2.</b> Enter the amount and the transaction ID from your confirmation SMS.
            </div>
            <input inputMode="numeric" placeholder={`Amount (min ${cfg.minDeposit})`} value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} required />
            <input placeholder="Transaction ID (e.g. CHK3A1B2C)" value={ref}
              onChange={(e) => setRef(e.target.value)} required />
          </>
        ) : (
          <>
            <input inputMode="numeric" placeholder={`Amount (min ${cfg.minWithdraw})`} value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} required />
            <input inputMode="tel" placeholder="Phone number to receive money" value={phone}
              onChange={(e) => setPhone(e.target.value)} required />
          </>
        )}
        <button className="primary" disabled={busy}>{busy ? 'Sending…' : mode === 'deposit' ? 'Submit deposit' : 'Request withdrawal'}</button>
      </form>

      <h3>History</h3>
      <div className="history">
        {items.length === 0 && <div className="muted small">No transactions yet.</div>}
        {items.map((t) => (
          <div key={t.id} className="tx">
            <div>
              <div>{LABELS[t.type] || t.type}</div>
              <div className="muted small">
                {new Date(t.created_at * 1000).toLocaleString()} {t.reference ? `· ${t.reference}` : ''}
              </div>
            </div>
            <div className="right">
              <div className={t.amount >= 0 ? 'pos' : 'neg'}>{t.amount > 0 ? '+' : ''}{t.amount}</div>
              {t.status !== 'done' && <div className={`pill ${t.status}`}>{t.status}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
