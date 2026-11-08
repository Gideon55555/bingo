import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, toast, confirmBox, haptic } from './api.js';
import { fmt, toCents } from '../../shared/money.js';
import { fmtX } from '../../shared/crash.js';

const fmtDate = (s) => new Date(s * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
const name = (u) => [u.first_name, u.username && `@${u.username}`].filter(Boolean).join(' ') || u.user_id || u.id;
const TYPE = { deposit: 'Deposit', withdraw: 'Withdrawal', bet: 'Bet / entry', win: 'Win', refund: 'Refund', adjust: 'Adjustment', bonus: 'Bonus' };

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
    ['risk', '🚩 Risk'],
    ['broadcast', '📣 Broadcast'],
    ['log', '📜 Admin log'],
    ['errors', '🐞 App errors'],
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
          {tab === 'log' && <AdminLog />}
          {tab === 'risk' && <Risk cfg={cfg} />}
          {tab === 'errors' && <ClientErrors />}
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

      <ServerHealth />

      <div className="seg small-seg">
        <button className={range === 'today' ? 'active' : ''} onClick={() => setRange('today')}>Today</button>
        <button className={range === 'allTime' ? 'active' : ''} onClick={() => setRange('allTime')}>All time</button>
      </div>

      <div className="tiles">
        <Tile label="House earnings" value={c(r.houseEarnings)} accent />
        <Tile label="· from Bingo" value={c(r.bingoEarnings)} />
        <Tile label={`· from ${cfg.crash?.name || 'Aviator'}`} value={c(r.crashEarnings)} />
        <Tile label="· from Keno" value={c(r.kenoEarnings)} />
        <Tile label="· from Ludo" value={c(r.ludoEarnings)} />
        <Tile label="· from Pool" value={c(r.poolEarnings)} />
        <Tile label="· from Kerenbula" value={c(r.kerenbulaEarnings)} />
        <Tile label="Bonuses paid (referral, daily)" value={c(r.bonusesPaid || 0)} />
        <Tile label="Deposits" value={c(r.deposits)} />
        <Tile label="Withdrawals" value={c(r.withdrawals)} />
        <Tile label="Net cash in" value={c(r.deposits - r.withdrawals)} />
        <Tile label="Bingo games" value={r.games} />
        <Tile label={`${cfg.crash?.name || 'Aviator'} rounds (with bets)`} value={r.crashRounds} />
        <Tile label="Keno draws (with tickets)" value={r.kenoRounds} />
        <Tile label="Ludo games" value={r.ludoGames} />
        <Tile label="Pool matches" value={r.poolGames} />
        <Tile label="Kerenbula matches" value={r.kerenbulaGames} />
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
            <b>✈️ {cfg.crash?.name || 'Aviator'} — round #{s.crash.round} · <span className={`pill ${s.crash.phase === 'flying' ? 'playing' : s.crash.phase}`}>{s.crash.phase}</span></b>
            <span className="small">{s.crash.players} bettor(s) · bets {c(s.crash.betsTotal)} · paid {c(s.crash.paidOut)}</span>
          </div>
          <div className="rc-chips">{s.crash.last.map((p, i) => <span key={i} className={`x-chip ${p < 200 ? 'x-low' : p < 1000 ? 'x-mid' : 'x-high'}`}>{fmtX(p)}</span>)}</div>
        </div>
      )}
      {s.ludo && (
        <div className="tile rk-admin">
          <div className="row-between">
            <b>🎲 Ludo — {s.ludo.games.length} game(s) in progress</b>
            <span className="small">{s.ludo.waiting.map((w) => `${fmt(w.stake)} ${w.size === 2 ? '1v1' : '4p'}: ${w.waiting} waiting`).join(' · ') || 'no one waiting'}</span>
          </div>
          {s.ludo.games.map((g) => (
            <div key={g.id} className="small muted">#{g.id} · {fmt(g.stake)} × {g.size} · {g.players} · {g.rolls} rolls · {g.minutes} min</div>
          ))}
        </div>
      )}
      {s.pool && (
        <div className="tile rk-admin">
          <div className="row-between">
            <b>🎱 Pool — {s.pool.games.length} match(es) in progress</b>
            <span className="small">{s.pool.waiting.map((w) => `${fmt(w.stake)}: ${w.waiting} waiting`).join(' · ') || 'no one waiting'}</span>
          </div>
          {s.pool.games.map((g) => <div key={g.id} className="small muted">#{g.id} · {fmt(g.stake)} · {g.players} · {g.shots} shots · {g.minutes} min</div>)}
        </div>
      )}
      {s.kerenbula && (
        <div className="tile rk-admin">
          <div className="row-between">
            <b>🔴 Kerenbula — {s.kerenbula.games.length} match(es) in progress</b>
            <span className="small">{s.kerenbula.waiting.map((w) => `${fmt(w.stake)}: ${w.waiting} waiting`).join(' · ') || 'no one waiting'}</span>
          </div>
          {s.kerenbula.games.map((g) => <div key={g.id} className="small muted">#{g.id} · {fmt(g.stake)} · {g.players} · frame {g.frame} · {g.rolls} rolls · {g.minutes} min</div>)}
        </div>
      )}
      {s.keno && (
        <div className="tile rk-admin">
          <div className="row-between">
            <b>🎯 Keno — draw #{s.keno.round} · <span className={`pill ${s.keno.phase === 'drawing' ? 'playing' : s.keno.phase}`}>{s.keno.phase}</span></b>
            <span className="small">{s.keno.players} ticket(s) · {c(s.keno.betsTotal)} in play{s.keno.paidOut ? ` · paid ${c(s.keno.paidOut)}` : ''}</span>
          </div>
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

/** Live server health: how busy and how responsive the server is right now. */
function ServerHealth() {
  const [m] = usePoll(adminApi.metrics, 10000);
  if (!m) return null;
  const lag = m.eventLoopMs.p99;
  const state = lag > 200 ? 'bad' : lag > 50 ? 'warn' : 'good';
  const up = m.uptimeSec > 86400 ? `${Math.floor(m.uptimeSec / 86400)} d` : m.uptimeSec > 3600 ? `${Math.floor(m.uptimeSec / 3600)} h` : `${Math.floor(m.uptimeSec / 60)} min`;
  return (
    <div className={`health-strip ${state}`}>
      <span title="How quickly the server reacts (99% of the time)">⚡ {state === 'good' ? 'Fast' : state === 'warn' ? 'Busy' : 'Overloaded'} · {lag} ms</span>
      <span>👥 {m.playersOnline} online</span>
      <span>🎮 {m.matches.ludo + m.matches.pool + m.matches.kerenbula} matches</span>
      <span>🧠 {m.memoryMb.rss} MB</span>
      <span>🗄 {m.dbMb} MB</span>
      <span>⏱ up {up}</span>
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
      const r = await adminApi.decide(kind, t.id, approve);
      haptic('success');
      if (r.awaitingSecond) toast('First approval recorded. A second admin must approve this withdrawal before you send the money.');
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
                {t.flags?.length > 0 && (
                  <div className="risk-flags">{t.flags.map((f) => <div key={f}>🚩 {f}</div>)}</div>
                )}
                {t.approvals && JSON.parse(t.approvals).length > 0 && (
                  <div className="warn small">☑️ Approved by {JSON.parse(t.approvals).map((a) => a.name).join(', ')} — needs a second admin</div>
                )}
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

  const toggleFreeze = async () => {
    const on = !data.user.frozen;
    let reason = '';
    if (on) { reason = window.prompt('Why are you freezing this account? (shown in the admin log)') ?? null; if (reason === null) return; }
    else if (!(await confirmBox('Un-freeze this account? They can play and withdraw again.'))) return;
    try { await adminApi.freeze(id, on, reason); toast(on ? 'Account frozen' : 'Account un-frozen'); reload(); } catch (e) { toast(e.message); }
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
      {(u.frozen || data.flags?.length > 0) && (
        <div className="risk-flags">
          {u.frozen ? <div>🧊 Frozen{u.frozen_reason ? ` — ${u.frozen_reason}` : ''}</div> : null}
          {data.flags.filter((f) => f !== 'Account is frozen').map((f) => <div key={f}>🚩 {f}</div>)}
        </div>
      )}
      <button className={u.frozen ? 'primary sm' : 'danger sm'} onClick={toggleFreeze}>{u.frozen ? '🔓 Un-freeze account' : '🧊 Freeze account (no play, no withdrawals)'}</button>
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

      {data.linked?.length > 0 && (
        <>
          <h3>Other accounts on the same {data.linked.some((l) => l.via === 'device') ? 'phone / network' : 'network'}</h3>
          <div className="small muted">Same network (IP) is common for mobile users and is not proof by itself. Same phone is a strong sign.</div>
          <div className="linked">
            {data.linked.map((l) => <span key={`${l.id}-${l.via}`} className={`chip ${l.via === 'device' ? 'bad' : ''}`}>{l.via === 'device' ? '📱' : '🌐'} {l.name} <span className="muted">({l.id})</span>{l.frozen ? ' 🧊' : ''}</span>)}
          </div>
        </>
      )}

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
        <button className={which === 'rocket' ? 'active' : ''} onClick={() => setWhich('rocket')}>✈️ {cfg.crash?.name || 'Aviator'}</button>
        <button className={which === 'keno' ? 'active' : ''} onClick={() => setWhich('keno')}>🎯 Keno</button>
        <button className={which === 'ludo' ? 'active' : ''} onClick={() => setWhich('ludo')}>🎲 Ludo</button>
        <button className={which === 'pool' ? 'active' : ''} onClick={() => setWhich('pool')}>🎱 Pool</button>
        <button className={which === 'kerenbula' ? 'active' : ''} onClick={() => setWhich('kerenbula')}>🔴 Kerenbula</button>
      </div>
      {which === 'bingo' ? <BingoGames cfg={cfg} /> : which === 'rocket' ? <RocketRounds cfg={cfg} />
        : which === 'keno' ? <KenoRounds cfg={cfg} /> : which === 'ludo' ? <LudoGames cfg={cfg} /> : which === 'kerenbula' ? <KerenbulaGames cfg={cfg} /> : <PoolGames cfg={cfg} />}
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

function PoolGames({ cfg }) {
  const [data] = usePoll(adminApi.poolGames, 10000);
  if (!data) return <div className="muted">Loading…</div>;
  if (!data.items.length) return <div className="empty">No pool matches yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Time</th><th>Table</th><th>Players</th><th>Winner</th><th>How</th><th>Paid</th><th>House</th><th>Length</th></tr></thead>
        <tbody>
          {data.items.map((g) => {
            const w = g.players.find((p) => p.userId === g.winner_id);
            return (
              <tr key={g.id}>
                <td className="muted">{g.id}</td>
                <td className="nowrap">{fmtDate(g.created_at)}</td>
                <td>{fmt(g.stake)}</td>
                <td className="small">{g.players.map((p) => `${p.name}${p.group ? ` (${p.group})` : ''}`).join(' vs ')}</td>
                <td><b>{w?.name || '—'}</b></td>
                <td className="small muted">{g.how}</td>
                <td>{fmt(g.payout)}</td>
                <td className="pos">{fmt(g.house)}</td>
                <td className="small">{Math.round(g.duration_sec / 60)} min · {g.shots} shots</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small" style={{ padding: '0 10px' }}>Amounts in {cfg.currency}.</p>
    </div>
  );
}

function LudoGames({ cfg }) {
  const [data] = usePoll(adminApi.ludoGames, 10000);
  if (!data) return <div className="muted">Loading…</div>;
  if (!data.items.length) return <div className="empty">No Ludo games yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Time</th><th>Table</th><th>Players</th><th>Winner</th><th>Pot</th><th>Paid</th><th>House</th><th>Length</th></tr></thead>
        <tbody>
          {data.items.map((g) => {
            const w = g.players.find((p) => p.userId === g.winner_id);
            return (
              <tr key={g.id}>
                <td className="muted">{g.id}</td>
                <td className="nowrap">{fmtDate(g.created_at)}</td>
                <td>{fmt(g.stake)} × {g.size}</td>
                <td className="small">{g.players.map((p) => `${p.name}${p.out ? ' (left)' : ''}`).join(', ')}</td>
                <td><b>{w?.name || '—'}</b></td>
                <td>{fmt(g.pot)}</td>
                <td>{fmt(g.payout)}</td>
                <td className="pos">{fmt(g.house)}</td>
                <td className="small">{Math.round(g.duration_sec / 60)} min · {g.rolls} rolls</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small" style={{ padding: '0 10px' }}>Amounts in {cfg.currency}.</p>
    </div>
  );
}

function KenoRounds({ cfg }) {
  const [data] = usePoll(adminApi.kenoRounds, 5000);
  if (!data) return <div className="muted">Loading…</div>;
  if (!data.items.length) return <div className="empty">No draws yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Time</th><th>Tickets</th><th>Bets</th><th>Paid out</th><th>House</th><th>Numbers drawn</th></tr></thead>
        <tbody>
          {data.items.map((r) => (
            <tr key={r.id}>
              <td className="muted">{r.id}</td>
              <td className="nowrap">{fmtDate(r.created_at)}</td>
              <td>{r.players}</td>
              <td>{fmt(r.bets_total)}</td>
              <td>{fmt(r.payout_total)}</td>
              <td className={r.bets_total - r.payout_total >= 0 ? 'pos' : 'neg'}>{fmt(r.bets_total - r.payout_total)}</td>
              <td className="small muted">{[...r.drawn].sort((a, b) => a - b).join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small" style={{ padding: '0 10px' }}>Amounts in {cfg.currency}.</p>
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

function KerenbulaGames({ cfg }) {
  const [data] = usePoll(adminApi.kerenbulaGames, 10000);
  if (!data) return <div className="muted">Loading…</div>;
  if (!data.items.length) return <div className="empty">No Kerenbula matches yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Time</th><th>Table</th><th>Players (score)</th><th>Winner</th><th>How</th><th>Frames</th><th>Paid</th><th>House</th><th>Length</th></tr></thead>
        <tbody>
          {data.items.map((g) => {
            const w = g.players.find((p) => p.userId === g.winner_id);
            return (
              <tr key={g.id}>
                <td className="muted">{g.id}</td>
                <td className="nowrap">{fmtDate(g.created_at)}</td>
                <td>{fmt(g.stake)}</td>
                <td>{g.players.map((p) => `${p.name} (${p.color} ${p.score})`).join(' vs ')}</td>
                <td>{w?.name || '—'}</td>
                <td className="small">{g.how}</td>
                <td>{g.frames}</td>
                <td>{fmt(g.payout)}</td>
                <td className="pos">{fmt(g.house)}</td>
                <td className="nowrap">{Math.round(g.duration_sec / 60)} min</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small" style={{ padding: '0 10px' }}>Amounts in {cfg.currency}.</p>
    </div>
  );
}

const LOG_LABEL = {
  approve_deposit: '✅ Approved deposit', reject_deposit: '❌ Rejected deposit', approve_withdraw: '✅ Paid withdrawal',
  reject_withdraw: '❌ Rejected withdrawal', withdraw_first_approval: '☑️ First approval (withdrawal)', adjust_balance: '✏️ Balance change',
  pause_games: '⏸ Paused games', resume_games: '▶️ Resumed games', broadcast: '📣 Broadcast', backup: '🗄 Backup',
  login: '🔑 Login', login_failed: '🚫 Failed login', flag_user: '🚩 Flag', unflag_user: '🏳️ Cleared flag',
};
/** Everything admins did, newest first — kept permanently in the database. */
function AdminLog() {
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(true);
  const load = async (before) => {
    const r = await adminApi.log(before);
    setItems((prev) => (before ? [...(prev || []), ...r.items] : r.items));
    setMore(r.items.length >= 200);
  };
  useEffect(() => { load().catch((e) => toast(e.message)); }, []);
  if (!items) return <div className="muted">Loading…</div>;
  if (!items.length) return <div className="empty">No admin actions yet.</div>;
  const detail = (d) => {
    if (!d) return '';
    try {
      const o = JSON.parse(d);
      if (typeof o !== 'object') return String(o);
      return Object.entries(o).filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => (k === 'amount' || k === 'newBalance' ? `${k} ${fmt(v)}` : `${k} ${v}`)).join(' · ');
    } catch { return d; }
  };
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id} className={l.action === 'login_failed' ? 'neg' : ''}>
              <td className="nowrap">{fmtDate(l.created_at)}</td>
              <td>{l.admin}</td>
              <td className="nowrap">{LOG_LABEL[l.action] || l.action}</td>
              <td className="mono small">{l.target || '—'}</td>
              <td className="small">{detail(l.detail)}</td>
              <td className="mono small muted">{l.ip || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more && <button className="ghost" onClick={() => load(items[items.length - 1].id)}>Load older</button>}
    </div>
  );
}

/** Fraud & collusion signals. */
function Risk({ cfg }) {
  const [data, reload] = usePoll(adminApi.risk, 30000);
  const freeze = async (u) => {
    const reason = window.prompt(`Freeze ${u.name}? Reason (shown in the admin log):`);
    if (reason === null) return;
    try { await adminApi.freeze(u.id, true, reason); toast(`${u.name} frozen`); reload(); } catch (e) { toast(e.message); }
  };
  const Who = ({ u }) => <span className="nowrap"><b>{u.name}</b> <span className="muted small">{u.id}</span>{u.frozen ? ' 🧊' : <button className="link-btn" onClick={() => freeze(u)}>freeze</button>}</span>;
  if (!data) return <div className="muted">Loading…</div>;
  return (
    <div className="admin-section">
      <p className="muted small">Warning signs, not proof — check the player's history before acting. Accounts that used the same phone are
        already blocked from sitting at the same Ludo / pool / Kerenbula table.</p>

      <h3>📱 Several accounts on one phone ({data.sharedDevices.length})</h3>
      {!data.sharedDevices.length ? <div className="empty">None found.</div> : (
        <div className="table-wrap"><table><thead><tr><th>Phone</th><th>Accounts</th><th>Last seen</th></tr></thead><tbody>
          {data.sharedDevices.map((d) => (
            <tr key={d.device}><td className="mono small">{d.device}…</td><td>{d.users.map((u) => <div key={u.id}><Who u={u} /></div>)}</td><td className="nowrap">{fmtDate(d.lastAt)}</td></tr>
          ))}
        </tbody></table></div>
      )}

      <h3>🤝 Pairs who keep playing each other, one side winning (last 30 days)</h3>
      {!data.pairs.length ? <div className="empty">None found.</div> : (
        <div className="table-wrap"><table><thead><tr><th>Keeps winning</th><th>Keeps losing</th><th>Matches</th><th>Win %</th><th>Staked</th><th></th></tr></thead><tbody>
          {data.pairs.map((p) => (
            <tr key={`${p.winner.id}-${p.loser.id}`} className={p.samePhone ? 'neg' : ''}>
              <td><Who u={p.winner} /></td><td><Who u={p.loser} /></td><td>{p.games}</td><td>{p.winnerShare}%</td>
              <td>{fmt(p.staked)} {cfg.currency}</td><td className="small">{p.samePhone ? '📱 same phone!' : ''} {Object.entries(p.byGame).map(([g, n]) => `${g} ${n}`).join(', ')}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}

      <h3>💸 Deposited and cashed out without really playing</h3>
      {!data.lowPlay.length ? <div className="empty">None found.</div> : (
        <div className="table-wrap"><table><thead><tr><th>Player</th><th>Deposited</th><th>Withdrawn / requested</th><th>Played</th></tr></thead><tbody>
          {data.lowPlay.map((r) => (
            <tr key={r.user.id}><td><Who u={r.user} /></td><td>{fmt(r.deposited)}</td><td>{fmt(r.withdrawn)}</td><td>{fmt(r.wagered)} ({Math.round((r.wagered / Math.max(1, r.deposited)) * 100)}%)</td></tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  );
}

/** Errors that happened in the app on players' phones (grouped). */
function ClientErrors() {
  const [data] = usePoll(adminApi.clientErrors, 30000);
  const [open, setOpen] = useState(null);
  if (!data) return <div className="muted">Loading…</div>;
  if (!data.items.length) return <div className="empty">No app errors reported in the last 30 days 🎉</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Last seen</th><th>Times</th><th>Error</th><th>Screen</th><th>Phone</th></tr></thead>
        <tbody>
          {data.items.map((e) => (
            <React.Fragment key={e.id}>
              <tr onClick={() => setOpen(open === e.id ? null : e.id)} style={{ cursor: 'pointer' }}>
                <td className="nowrap">{fmtDate(e.last_at)}</td><td>{e.count}</td><td className="small">{e.message}</td>
                <td className="mono small">{e.path}</td><td className="small muted">{(e.ua || '').replace(/.*\((.*?)\).*/, '$1').slice(0, 40)}</td>
              </tr>
              {open === e.id && <tr><td colSpan={5}><pre className="mono small break" style={{ whiteSpace: 'pre-wrap' }}>{e.stack || '(no stack)'}</pre></td></tr>}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
