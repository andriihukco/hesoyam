import { useCallback, useEffect, useMemo, useState } from 'react';
import { call, dur, pct, short, sol, tone } from '../lib/api';
import type { Activity, AllTimeStats, Snapshot, TradeRef } from '../lib/types';

const color: Record<string, string> = { trade: 'text-pos', warn: 'text-warn', info: 'text-label-2' };
const PAGE = 200;

/** All-time stats on top, then the full activity log (stored in the DB), newest first. */
export function ActivityList({ s }: { s: Snapshot }) {
  const [older, setOlder] = useState<Activity[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const [found, setFound] = useState<Activity[] | null>(null);

  // Live lines arrive with each snapshot; older pages are fetched on demand.
  const live = s.activity;
  const lines = useMemo(() => {
    if (found) return found;
    const oldest = live.at(-1)?.id;
    const rest = oldest ? older.filter((a) => (a.id ?? 0) < oldest) : older;
    return [...live, ...rest].filter((a) => !level || a.level === level);
  }, [live, older, found, level]);

  const loadOlder = useCallback(async () => {
    const before = (found ?? [...live, ...older]).at(-1)?.id;
    if (!before) return setDone(true);
    setLoading(true);
    try {
      const params = new URLSearchParams({ before: String(before), limit: String(PAGE) });
      if (q.trim()) params.set('q', q.trim());
      if (level) params.set('level', level);
      const page = await call<Activity[]>('GET', `/api/activity?${params}`);
      if (found) setFound([...found, ...page]);
      else setOlder((o) => [...o, ...page]);
      if (page.length < PAGE) setDone(true);
    } finally {
      setLoading(false);
    }
  }, [live, older, found, q, level]);

  // Search runs on the server so it covers the whole history.
  useEffect(() => {
    const text = q.trim();
    setDone(false);
    if (!text) return setFound(null);
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ q: text, limit: String(PAGE) });
      if (level) params.set('level', level);
      const page = await call<Activity[]>('GET', `/api/activity?${params}`).catch(() => [] as Activity[]);
      setFound(page);
      setDone(page.length < PAGE);
    }, 250);
    return () => clearTimeout(t);
  }, [q, level]);

  return (
    <div className="scroll-y min-h-0 flex-1">
      <StatsPanel s={s} />
      <div className="sticky top-0 z-10 flex gap-2 border-y border-sep bg-card p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search activity"
          placeholder={`Search ${(s.activityTotal ?? 0).toLocaleString()} lines`}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="field min-w-0 flex-1 text-[13px]"
        />
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by level" className="field w-auto text-[13px]">
          <option value="">All</option>
          <option value="trade">Trades</option>
          <option value="warn">Warnings</option>
          <option value="info">Info</option>
        </select>
      </div>
      <div className="mono space-y-1 px-4 py-3 text-[12px] leading-relaxed">
        {lines.map((a, i) => (
          <div key={a.id ?? `l${i}`} className={`break-words ${color[a.level]}`}>
            <span className="text-label-3">{stamp(a.ts)}</span> {a.text}
          </div>
        ))}
        {!lines.length && <div className="py-10 text-center font-sans text-[15px] text-label-3">Nothing yet</div>}
        {lines.length > 0 && !done && (found || level || lines.length < (s.activityTotal ?? 0)) && (
          <button className="btn btn-tinted mt-2 w-full font-sans" disabled={loading} onClick={() => void loadOlder()}>
            {loading ? 'Loading…' : 'Load older'}
          </button>
        )}
        {done && lines.length > 0 && <div className="py-3 text-center font-sans text-[12px] text-label-3">Start of log</div>}
      </div>
    </div>
  );
}

/** Today shows the time only; older lines show the date too. */
function stamp(ts: number) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour12: false });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function StatsPanel({ s }: { s: Snapshot }) {
  const [st, setSt] = useState<AllTimeStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = `${s.mode}|${s.stats.all.count}|${s.stats.all.pnl}`;

  // Refetch only when a position closes (count or pnl changes) or the mode flips.
  useEffect(() => {
    call<AllTimeStats>('GET', '/api/stats').then(setSt, (e: Error) => setErr(e.message));
  }, [key]);

  if (err && !st) return <div className="px-4 py-3 text-[13px] text-neg">Stats: {err}</div>;
  if (!st) return <div className="px-4 py-3 text-[13px] text-label-3">Loading stats…</div>;
  if (!st.count) return <div className="px-4 py-3 text-[13px] text-label-3">No closed trades yet ({st.mode}).</div>;

  const streak = st.currentStreak > 0 ? `W${st.currentStreak}` : `L${-st.currentStreak}`;
  return (
    <div className="px-3 py-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <span className="text-[13px] font-semibold">All-time · {st.mode}</span>
        <span className="text-[11px] text-label-3">
          {st.count} trades{st.firstAt ? ` since ${new Date(st.firstAt).toLocaleDateString()}` : ''}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Total PnL" value={`${sol(st.pnlSol)} SOL`} cls={tone(st.pnlSol)} sub={`avg ${pct(st.avgPnlPct)} / trade`} />
        <Tile label="Win rate" value={`${st.winRate.toFixed(1)}%`} sub={`${st.wins}W · ${st.losses}L`} />
        <Tile
          label="KDA"
          value={st.kda.toFixed(2)}
          sub={`${st.kills} / ${st.deaths} / ${st.assists}`}
          title="K = winning trades, D = losing trades, A = take-profit steps hit. KDA = (K + A) / D."
        />
        <Tile
          label="Profit factor"
          value={st.profitFactor === null ? '∞' : st.profitFactor.toFixed(2)}
          sub={`exp ${sol(st.expectancySol)} / trade`}
          title="Gross wins ÷ gross losses. Expectancy = average SOL per trade."
        />
        <RefTile label="Biggest win" r={st.biggestWin} />
        <RefTile label="Biggest loss" r={st.biggestLoss} />
        <Tile label="Win streak" value={`${st.longestWinStreak}`} cls="text-pos" sub={`now ${streak}`} />
        <Tile
          label="Loss streak"
          value={`${st.longestLossStreak}`}
          cls="text-neg"
          sub={`max DD ${sol(st.maxDrawdownSol)}`}
          title="Max drawdown: largest drop of cumulative PnL from its peak, in SOL."
        />
        <Tile label="Avg win" value={sol(st.avgWinSol)} cls="text-pos" sub={st.bestPct ? `best ${pct(st.bestPct.pnlPct)}` : ''} />
        <Tile label="Avg loss" value={sol(st.avgLossSol)} cls="text-neg" sub={st.worstPct ? `worst ${pct(st.worstPct.pnlPct)}` : ''} />
        <Tile label="Avg hold" value={dur(st.avgHoldMs)} />
        <Tile label="Gross" value={`+${st.grossWinSol.toFixed(2)}`} cls="text-pos" sub={`−${st.grossLossSol.toFixed(2)} SOL`} />
      </div>
    </div>
  );
}

function Tile({ label, value, sub, cls = '', title }: { label: string; value: string; sub?: string; cls?: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-card-2 px-3 py-2" title={title}>
      <div className="truncate text-[11px] text-label-2">{label}</div>
      <div className={`mono truncate text-[15px] font-semibold ${cls}`}>{value}</div>
      {sub && <div className="mono truncate text-[11px] text-label-3">{sub}</div>}
    </div>
  );
}

function RefTile({ label, r }: { label: string; r: TradeRef | null }) {
  if (!r) return <Tile label={label} value="—" />;
  return (
    <Tile
      label={label}
      value={`${sol(r.pnlSol)} SOL`}
      cls={tone(r.pnlSol)}
      sub={`${r.symbol ? `$${r.symbol}` : short(r.mint)} ${pct(r.pnlPct)}`}
      title={`${r.mint} · ${new Date(r.closedAt).toLocaleString()}`}
    />
  );
}
