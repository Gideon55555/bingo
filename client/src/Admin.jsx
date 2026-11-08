import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, toast, confirmBox, haptic } from './api.js';
import { fmt, toCents } from '../../shared/money.js';
import { fmtX } from '../../shared/crash.js';

const fmtDate = (s) => new Date(s * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
const name = (u) => [u.first_name, u.username && `@${u.username}`].filter(Boolean).join(' ') || u.user_id || u.id;
const TYPE = { deposit: 'Deposit', withdraw: 'Withdrawal', bet: 'Bet / entry', win: 'Win', refund: 'Refund', adjust: 'Adjustment' };

/** Poll a loader every `ms` and return [data, reload, error] */
function usePoll(loader, ms, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => loader().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), deps);
  useEffect(() => {
    load();
    if (!ms) return;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load]);
  return [data, load, error];
}

export default function Admin({ cfg, onLogout }) {
  const [tab, setTab] = useState('overview');
  const [stats, reloadStats, err] = usePoll(adminApi.stats, 5000);
  const pendingCount = stats ? stats.pendingDeposits.n + stats.pendingWithdrawals.n : 0;

  if (err && !stats) return <div className="center muted">{err}</div>;
  const tabs = [
    ['overview', '📊 Overview'],
    ['requests', `💰 Requests${pendingCount ? ` (${pendingCount})` : ''}`],
    ['players', '👥 Players'],
    ['games', '🎱 Games'],
    ['broadcast', '📣 Broadcast'],
  ];

  return (
    <div className="admin">
      <div className="admin-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
        {onLogout && <button onClick={onLogout}>Log out</button>}
      </div>
      {!stats ? <div className="center muted">Loading…</div> : (
        <>
          {tab === 'overview' && <Overview stats={stats} cfg={cfg} reload={reloadStats} goRequests={() => setTab('requests')} />}
          {tab === 'requests' && <Requests cfg={cfg} onChange={reloadStats} />}
          {tab === 'players' && <Players cfg={cfg} />}
          {tab === 'games' && <Games cfg={cfg} />}
          {tab === 'broadcast' && <Broadcast users={stats.users} />}
        </>
      )}
    </div>
  );
}

// ---------------- Overview ----------------
function Overview({ stats: s, cfg, reload, goRequests }) {
  const [range, setRange] = useState('today');
  const r = s[range];
  const c = (n) => `${fmt(n)} ${cfg.currency}`;
  const pending = s.pendingDeposits.n + s.pendingWithdrawals.n;

  const togglePause = async () => {
    if (s.paused) {
      await adminApi.resume();
    } else {
      if (!(await confirmBox('Pause all games? Players waiting in rooms will be refunded. Games already running will finish.'))) return;
      const { refunded } = await adminApi.pause();
      toast(`Games paused. ${refunded} waiting player(s) refunded.`);
    }
    reload();
  };

  return (
    <div className="admin-section">
      {pending > 0 && (
        <button className="alert-card" onClick={goRequests}>
          ⏳ {s.pendingDeposits.n} deposit(s) · {c(s.pendingDeposits.total)} &nbsp;|&nbsp;
          {s.pendingWithdrawals.n} withdrawal(s) · {c(s.pendingWithdrawals.total)} — review →
        </button>
      )}

      <div className="seg small-seg">
        <button className={range === 'today' ? 'active' : ''} onClick={() => setRange('today')}>Today</button>
        <button className={range === 'allTime' ? 'active' : ''} onClick={() => setRange('allTime')}>All time</button>
      </div>

      <div className="tiles">
        <Tile label="House earnings" value={c(r.houseEarnings)} accent />
        <Tile label="· from Bingo" value={c(r.bingoEarnings)} />
        <Tile label="· from Rocket" value={c(r.crashEarnings)} />
        <Tile label="Deposits" value={c(r.deposits)} />
        <Tile label="Withdrawals" value={c(r.withdrawals)} />
        <Tile label="Net cash in" value={c(r.deposits - r.withdrawals)} />
        <Tile label="Bingo games" value={r.games} />
        <Tile label="Rocket rounds (with bets)" value={r.crashRounds} />
        <Tile label="Total bets" value={c(r.totalBets)} />
        <Tile label="Active players" value={r.activePlayers} />
        <Tile label="New users" value={r.newUsers} />
      </div>
      <div className="tiles two">
        <Tile label="Total users" value={s.users} />
        <Tile label="Player balances (you owe)" value={c(s.playerBalances)} hint="Money players could withdraw" />
      </div>

      <div className="row-between">
        <h3>Live rooms {s.paused && <span className="pill rejected">PAUSED</span>}</h3>
        <button className={s.paused ? 'primary sm' : 'danger sm'} onClick={togglePause}>
          {s.paused ? '▶️ Resume games' : '⏸ Pause games'}
        </button>
      </div>
      {s.crash && (
        <div className="tile rk-admin">
          <div className="row-between">
            <b>🚀 Rocket — round #{s.crash.round} · <span className={`pill ${s.crash.phase === 'flying' ? 'playing' : s.crash.phase}`}>{s.crash.phase}</span></b>
            <span className="small">{s.crash.players} bettor(s) · bets {c(s.crash.betsTotal)} · paid {c(s.crash.paidOut)}</span>
          </div>
          <div className="rc-chips">{s.crash.last.map((p, i) => <span key={i} className={`x-chip ${p < 200 ? 'x-low' : p < 1000 ? 'x-mid' : 'x-high'}`}>{fmtX(p)}</span>)}</div>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Room</th><th>Status</th><th>Players</th><th>Prize</th><th>Called</th><th>Cards</th></tr></thead>
          <tbody>
            {s.rooms.map((rm) => (
              <tr key={rm.stake}>
                <td><b>{fmt(rm.stake)}</b></td>
                <td><span className={`pill ${rm.state}`}>{rm.state}</span></td>
                <td>{rm.players}</td>
                <td>{fmt(rm.prize)}</td>
                <td>{rm.state === 'playing' ? `${rm.called}/75` : '—'}</td>
                <td className="small muted">{rm.cards.map((p) => `#${p.card} ${p.name}${p.disqualified ? ' ❌' : ''}`).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, accent, hint }) {
  return (
    <div className={`tile ${accent ? 'accent-tile' : ''}`} title={hint}>
      <div className="muted small">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}

// ---------------- Requests (pending deposits / withdrawals) ----------------
function Requests({ cfg, onChange }) {
  const [pending, reload] = usePoll(adminApi.pending, 5000);
  const [filter, setFilter] = useState({ type: '', status: '' });
  const [log, reloadLog] = usePoll(() => adminApi.transactions({ ...filter, limit: 100 }), 0, [filter.type, filter.status]);
  const [busy, setBusy] = useState(0);

  const decide = async (t, approve) => {
    const kind = t.type === 'deposit' ? 'deposit' : 'withdraw';
    const amt = fmt(Math.abs(t.amount));
    const q = kind === 'deposit'
      ? (approve ? `Approve deposit of ${amt} ${cfg.currency} (ref ${t.reference})?\n\nOnly approve if the money is in your account.` : `Reject deposit #${t.id}?`)
      : (approve ? `Did you send ${amt} ${cfg.currency} to ${t.phone}?` : `Reject withdrawal #${t.id} and refund ${amt} ${cfg.currency}?`);
    if (!(await confirmBox(q))) return;
    setBusy(t.id);
    try {
      await adminApi.decide(kind, t.id, approve);
      haptic('success');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(0);
      reload(); reloadLog(); onChange();
    }
  };

  return (
    <div className="admin-section">
      <h3>Waiting for you</h3>
      {!pending ? <div className="muted">Loading…</div> : pending.items.length === 0 ? (
        <div className="empty">No pending requests 🎉</div>
      ) : (
        <div className="req-list">
          {pending.items.map((t) => (
            <div key={t.id} className={`req ${t.type}`}>
              <div className="req-head">
                <span className="req-type">{t.type === 'deposit' ? '💰 Deposit' : '🏧 Withdrawal'} #{t.id}</span>
                <span className="req-amt">{fmt(Math.abs(t.amount))} {cfg.currency}</span>
              </div>
              <div className="small">{name(t)} <span className="muted">· id {t.user_id}</span></div>
              <div className="small">
                {t.type === 'deposit' ? <>Ref: <b className="mono">{t.reference}</b></> : <>Send to: <b className="mono">{t.phone}</b></>}
                <span className="muted"> · {fmtDate(t.created_at)}</span>
              </div>
              <div className="req-actions">
                <button className="primary sm" disabled={busy === t.id} onClick={() => decide(t, true)}>
                  {t.type === 'deposit' ? '✅ Approve' : '✅ Mark paid'}
                </button>
                <button className="danger sm" disabled={busy === t.id} onClick={() => decide(t, false)}>
                  {t.type === 'deposit' ? '❌ Reject' : '❌ Reject & refund'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="row-between">
        <h3>All transactions</h3>
        <div className="filters">
          <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
            <option value="">All types</option>
            {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option><option value="approved">Approved</option>
            <option value="rejected">Rejected</option><option value="done">Done</option>
          </select>
        </div>
      </div>
      <TxTable items={log?.items} showUser />
    </div>
  );
}

function TxTable({ items, showUser }) {
  if (!items) return <div className="muted">Loading…</div>;
  if (!items.length) return <div className="empty">Nothing here yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Date</th>{showUser && <th>Player</th>}<th>Type</th><th>Amount</th><th>Status</th><th>Details</th></tr></thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td className="muted">{t.id}</td>
              <td className="nowrap">{fmtDate(t.created_at)}</td>
              {showUser && <td>{name(t)}</td>}
              <td>{TYPE[t.type] || t.type}</td>
              <td className={t.amount >= 0 ? 'pos' : 'neg'}>{t.amount > 0 ? '+' : ''}{fmt(t.amount)}</td>
              <td><span className={`pill ${t.status}`}>{t.status}</span></td>
              <td className="small muted">{t.reference || t.phone || t.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Players ----------------
function Players({ cfg }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [list] = usePoll(() => adminApi.users(q), 0, [q]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  if (selected) return <PlayerDetail id={selected} cfg={cfg} onBack={() => setSelected(null)} />;

  return (
    <div className="admin-section">
      <input placeholder="Search by name, @username or Telegram id" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="muted small" style={{ margin: '8px 0' }}>{list ? `${list.total} player(s)` : 'Loading…'}</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Balance</th><th>Deposited</th><th>Withdrawn</th><th>Games</th><th>Wins</th><th>Joined</th></tr></thead>
          <tbody>
            {list?.rows.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => setSelected(u.id)}>
                <td>{name(u)}<div className="muted small">{u.id}</div></td>
                <td><b>{fmt(u.balance)}</b></td>
                <td>{fmt(u.deposited)}</td>
                <td>{fmt(u.withdrawn)}</td>
                <td>{u.games_played}</td>
                <td>{u.games_won}</td>
                <td className="nowrap small">{fmtDate(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlayerDetail({ id, cfg, onBack }) {
  const [data, reload, err] = usePoll(() => adminApi.user(id), 0, [id]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const adjust = async (sign) => {
    const n = Math.abs(toCents(amount));
    if (!n) return toast('Enter an amount');
    const amt = sign * n;
    if (!(await confirmBox(`${amt > 0 ? 'Add' : 'Subtract'} ${fmt(n)} ${cfg.currency} ${amt > 0 ? 'to' : 'from'} this player?`))) return;
    setBusy(true);
    try {
      await adminApi.adjust(id, amt, note);
      haptic('success');
      setAmount(''); setNote('');
      reload();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  if (err) return <div className="admin-section"><button className="ghost sm" onClick={onBack}>← Back</button><p>{err}</p></div>;
  if (!data) return <div className="muted">Loading…</div>;
  const u = data.user;
  return (
    <div className="admin-section">
      <button className="ghost sm" onClick={onBack}>← All players</button>
      <div className="player-card">
        <div>
          <h2 style={{ margin: 0 }}>{u.first_name || 'Player'}</h2>
          <div className="muted small">{u.username ? `@${u.username} · ` : ''}id {u.id} · joined {fmtDate(u.created_at)}</div>
        </div>
        <div className="huge">{fmt(u.balance)} <small>{cfg.currency}</small></div>
      </div>
      <div className="tiles">
        <Tile label="Deposited" value={fmt(u.deposited ?? 0)} />
        <Tile label="Withdrawn" value={fmt(u.withdrawn ?? 0)} />
        <Tile label="Games" value={u.games_played ?? 0} />
        <Tile label="Wins" value={u.games_won ?? 0} />
      </div>

      <h3>Adjust balance</h3>
      <div className="adjust">
        <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        <input placeholder="Note (e.g. welcome bonus, correction)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="primary sm" disabled={busy} onClick={() => adjust(1)}>＋ Add</button>
        <button className="danger sm" disabled={busy} onClick={() => adjust(-1)}>－ Subtract</button>
      </div>
      <p className="muted small">The player gets a Telegram message about the change.</p>

      <h3>History</h3>
      <TxTable items={data.history} />
    </div>
  );
}

// ---------------- Games ----------------
function Games({ cfg }) {
  const [which, setWhich] = useState('bingo');
  return (
    <div className="admin-section">
      <div className="seg small-seg">
        <button className={which === 'bingo' ? 'active' : ''} onClick={() => setWhich('bingo')}>🎱 Bingo</button>
        <button className={which === 'rocket' ? 'active' : ''} onClick={() => setWhich('rocket')}>🚀 Rocket</button>
      </div>
      {which === 'bingo' ? <BingoGames cfg={cfg} /> : <RocketRounds cfg={cfg} />}
    </div>
  );
}

function RocketRounds({ cfg }) {
  const [data] = usePoll(adminApi.crashRounds, 5000);
  if (!data) return <div className="muted">Loading…</div>;
  if (!data.items.length) return <div className="empty">No rounds yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Time</th><th>Crash</th><th>Players</th><th>Bets</th><th>Paid out</th><th>House</th><th>Seed (fairness)</th></tr></thead>
        <tbody>
          {data.items.map((r) => (
            <tr key={r.id}>
              <td className="muted">{r.id}</td>
              <td className="nowrap">{fmtDate(r.created_at)}</td>
              <td><span className={`x-chip ${r.crash_point < 200 ? 'x-low' : r.crash_point < 1000 ? 'x-mid' : 'x-high'}`}>{fmtX(r.crash_point)}</span></td>
              <td>{r.players}</td>
              <td>{fmt(r.bets_total)}</td>
              <td>{fmt(r.payout_total)}</td>
              <td className={r.bets_total - r.payout_total >= 0 ? 'pos' : 'neg'}>{fmt(r.bets_total - r.payout_total)}</td>
              <td className="mono small muted" title={r.seed}>{r.seed.slice(0, 12)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small" style={{ padding: '0 10px' }}>Amounts in {cfg.currency}. Rounds where nobody bet show 0.</p>
    </div>
  );
}

function BingoGames({ cfg }) {
  const [data] = usePoll(adminApi.games, 10000);
  if (!data) return <div className="muted">Loading…</div>;
  if (!data.items.length) return <div className="empty">No games played yet.</div>;
  return (
    <div className="admin-section">
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Room</th><th>Players</th><th>Pot</th><th>Paid out</th><th>House</th><th>Calls</th><th>Winner(s)</th></tr></thead>
          <tbody>
            {data.items.map((g) => (
              <tr key={g.id}>
                <td className="muted">{g.id}</td>
                <td className="nowrap">{fmtDate(g.created_at)}</td>
                <td>{fmt(g.stake)}</td>
                <td>{g.players}</td>
                <td>{fmt(g.pot)}</td>
                <td>{fmt(g.payout)}</td>
                <td className="pos">{fmt(g.house)}</td>
                <td>{g.calls}</td>
                <td className="small">{g.winners.map((w) => `${name(w)} (#${w.card})`).join(', ') || <span className="muted">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Currency: {cfg.currency}</p>
    </div>
  );
}

// ---------------- Broadcast ----------------
function Broadcast({ users }) {
  const [text, setText] = useState('');
  const [job, setJob] = useState(null);

  useEffect(() => {
    adminApi.broadcastStatus().then((j) => j.total !== undefined && setJob(j)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!job?.running) return;
    const t = setInterval(() => adminApi.broadcastStatus().then(setJob).catch(() => {}), 1000);
    return () => clearInterval(t);
  }, [job?.running]);

  const send = async () => {
    if (!text.trim()) return;
    if (!(await confirmBox(`Send this message to all ${users} players?`))) return;
    try {
      setJob(await adminApi.broadcast(text));
      setText('');
    } catch (e) { toast(e.message); }
  };

  return (
    <div className="admin-section">
      <p className="muted small">Sends a Telegram message from your bot to every player ({users}).</p>
      <textarea rows={5} placeholder="e.g. 🎉 New 200 ETB room is open! Come play now." value={text} onChange={(e) => setText(e.target.value)} />
      <button className="primary" disabled={!text.trim() || job?.running} onClick={send}>📣 Send to all players</button>
      {job && (
        <div className="banner info">
          {job.running ? '⏳ Sending…' : '✅ Finished.'} {job.sent} sent, {job.failed} failed, of {job.total}.
          {job.failed > 0 && !job.running && <div className="muted small">Failures are usually players who blocked the bot.</div>}
        </div>
      )}
    </div>
  );
}
