import { useEffect, useMemo, useState } from 'react';
import { ago, call, pct, short, sol, tone } from '../lib/api';
import type { Portfolio as P, PortfolioGroup, PortfolioRange, Snapshot } from '../lib/types';
import { Group, Segmented } from '../components/ui';
import { LineChart } from '../components/LineChart';
import { DailyBars } from '../components/DailyBars';

const KEY = '1mbot.portfolioRange';
const readRange = (): PortfolioRange => {
  try {
    const v = localStorage.getItem(KEY);
    return v === '1d' || v === '7d' || v === '30d' || v === 'all' ? v : '7d';
  } catch {
    return '7d';
  }
};

/** Portfolio over time: equity, drawdown, daily PnL, breakdowns and every closed trade. */
export function Portfolio({ s, onError, onOpen }: { s: Snapshot; onError: (e: string) => void; onOpen: (id: number) => void }) {
  const [range, setRange] = useState<PortfolioRange>(readRange);
  const [p, setP] = useState<P | null>(null);
  const [filter, setFilter] = useState<'all' | 'win' | 'loss'>('all');
  const [strategy, setStrategy] = useState('*');
  const refreshKey = `${s.stats.all.count}|${s.mode}`;

  useEffect(() => {
    try { localStorage.setItem(KEY, range); } catch { /* private mode */ }
    // Ignore a slower answer for a range the user already left.
    let live = true;
    call<P>('GET', `/api/portfolio?range=${range}`).then((r) => live && setP(r), (e) => live && onError((e as Error).message));
    return () => { live = false; };
  }, [range, refreshKey]);

  const strategies = useMemo(() => [...new Set((p?.closed ?? []).map((c) => c.strategy))], [p]);
  const closed = useMemo(() => (p?.closed ?? []).filter((c) => {
    const pnl = c.realized - c.cost;
    return (filter === 'all' || (filter === 'win' ? pnl > 0 : pnl <= 0)) && (strategy === '*' || c.strategy === strategy);
  }), [p, filter, strategy]);

  const st = p?.stats;
  const last = p?.equity.at(-1);
  const first = p?.equity[0];
  const change = last && first ? last.pnl - first.pnl : 0;
  const maxDd = p ? Math.min(0, ...p.drawdown.map((d) => d.dd)) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight">Portfolio</h2>
          <p className="text-[13px] text-label-2">{s.mode === 'paper' ? 'Paper' : 'Live'} wallet · snapshots every 5 min and at each close</p>
        </div>
        <Segmented label="Range" value={range} onChange={setRange}
          options={[{ value: '1d', label: '1D' }, { value: '7d', label: '7D' }, { value: '30d', label: '30D' }, { value: 'all', label: 'All' }]} />
      </div>

      <Group title="Equity (PnL vs starting balance)" footer="Charted as PnL so switching Arena on or off, or resetting the wallet, does not look like a gain or loss.">
        <div className="px-4 pt-3">
          <div className="flex items-baseline gap-2">
            <span className={`text-[28px] font-bold tabular-nums ${last ? tone(last.pnl) : ''}`}>{last ? `${last.pnl >= 0 ? '+' : ''}${sol(last.pnl, 3)}` : '—'}</span>
            <span className="text-[13px] text-label-2">SOL total PnL</span>
            {last && first && <span className={`text-[13px] font-semibold tabular-nums ${tone(change)}`}>{change >= 0 ? '+' : ''}{sol(change, 3)} in range</span>}
          </div>
          {last && <div className="text-[12px] text-label-2">wallet {sol(last.total, 3)} SOL · cash {sol(last.cash, 3)} · in positions {sol(last.open, 3)}</div>}
        </div>
        <div className="px-4 pb-2 pt-2"><LineChart label="Total PnL" fill points={(p?.equity ?? []).map((e) => ({ ts: e.ts, v: e.pnl }))} /></div>
        <div className="row-sep px-4 pb-3 pt-2">
          <div className="pb-1 text-[12px] text-label-2">Drawdown from peak · worst {sol(maxDd, 3)} SOL</div>
          <LineChart label="Drawdown" tone="neg" height={70} points={(p?.drawdown ?? []).map((d) => ({ ts: d.ts, v: d.dd }))} />
        </div>
      </Group>

      <Group title="Results" footer="Profit factor = gross wins ÷ gross losses. Expectancy = average SOL per trade, after fees.">
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="PnL" value={st ? `${st.pnlSol >= 0 ? '+' : ''}${sol(st.pnlSol, 3)}` : '—'} cls={st ? tone(st.pnlSol) : ''} />
          <Tile label="Trades" value={String(st?.count ?? 0)} />
          <Tile label="Win rate" value={st?.count ? `${st.winRate.toFixed(0)}%` : '—'} />
          <Tile label="Profit factor" value={!st?.count ? '—' : st.profitFactor === null ? '∞' : st.profitFactor.toFixed(2)} />
          <Tile label="Expectancy" value={st?.count ? sol(st.expectancySol, 4) : '—'} cls={st ? tone(st.expectancySol) : ''} />
          <Tile label="Max DD (trades)" value={st?.count ? sol(st.maxDrawdownSol, 3) : '—'} />
        </div>
      </Group>

      <Group title="PnL per day (UTC)"><div className="px-3 py-3"><DailyBars days={p?.daily ?? []} /></div></Group>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-3">
        <Breakdown title="By strategy" rows={p?.byVersion ?? []} />
        <Breakdown title="By route" rows={p?.byRoute ?? []} />
        <Breakdown title="By exit" rows={p?.byExit ?? []} />
      </div>

      <Group title="Closed trades" footer="In the selected range, newest first (up to 200). Tap a trade to see its chart, including what the price did after the exit.">
        <div className="row-sep flex flex-wrap items-center gap-2 p-2">
          <div className="min-w-[200px] flex-1">
            <Segmented fill label="Outcome" value={filter} onChange={setFilter}
              options={[{ value: 'all', label: 'All' }, { value: 'win', label: 'Wins' }, { value: 'loss', label: 'Losses' }]} />
          </div>
          {strategies.length > 1 && (
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} aria-label="Strategy" className="field px-2 py-1 text-[13px]">
              <option value="*">All strategies</option>
              {strategies.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
        </div>
        {closed.map((c) => {
          const pnl = c.realized - c.cost;
          return (
            <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="row-sep flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] active:bg-fill">
              <span className="mono w-24 shrink-0 truncate">{c.symbol ? `$${c.symbol}` : short(c.mint)}</span>
              <span className="min-w-0 flex-1 truncate text-label-2">
                {c.strategy} · {c.closeReason}
                {c.followEnd === 'rugged' && <span className="ml-1 text-neg">· rugged after exit</span>}
              </span>
              <span className={tone(pnl)}>{pct((pnl / c.cost) * 100)}</span>
              <span className="hidden w-10 text-right text-label-3 sm:inline">{ago(c.closed, s.serverTime)}</span>
            </button>
          );
        })}
        {!closed.length && <div className="px-4 py-8 text-center text-[13px] text-label-3">No closed trades in this range yet.</div>}
      </Group>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: PortfolioGroup[] }) {
  return (
    <Group title={title}>
      {rows.map((r) => (
        <div key={r.name} className="row-sep flex items-center gap-2 px-4 py-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
          <span className="text-label-2 tabular-nums">{r.count} · {r.winRate.toFixed(0)}%</span>
          <span className={`w-16 text-right tabular-nums ${tone(r.pnl)}`}>{r.pnl >= 0 ? '+' : ''}{sol(r.pnl, 3)}</span>
        </div>
      ))}
      {!rows.length && <div className="px-4 py-4 text-center text-[13px] text-label-3">—</div>}
    </Group>
  );
}

function Tile({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-card-2 px-3 py-2">
      <div className="truncate text-[11px] text-label-2">{label}</div>
      <div className={`mono truncate text-[15px] font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
