import { computeStats, type AllTimeStats, type ClosedRow } from '../db/db.js';

export type Range = '1d' | '7d' | '30d' | 'all';
export const RANGES: Range[] = ['1d', '7d', '30d', 'all'];
const DAY = 86_400_000;

export function rangeStart(range: Range, now: number): number {
  return range === 'all' ? 0 : now - { '1d': 1, '7d': 7, '30d': 30 }[range] * DAY;
}

/** Close reasons carry numbers ("hard stop -16.4%"); group by the words only. */
export function exitGroup(reason: string | null): string {
  if (!reason) return 'other';
  return reason.toLowerCase().replace(/[-+]?\d+(\.\d+)?%?/g, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'other';
}

export interface Group { name: string; count: number; pnl: number; winRate: number }
export interface Portfolio {
  /** pnl = total − starting balance: stays comparable when the wallet basis changes (Arena on/off, reset). */
  equity: { ts: number; total: number; cash: number; open: number; pnl: number }[];
  drawdown: { ts: number; dd: number }[];
  daily: { day: string; pnl: number; count: number; wins: number }[];
  byVersion: Group[];
  byRoute: Group[];
  byExit: Group[];
  stats: AllTimeStats;
}

function groupBy(rows: ClosedRow[], key: (r: ClosedRow) => string): Group[] {
  const m = new Map<string, { count: number; pnl: number; wins: number }>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { count: 0, pnl: 0, wins: 0 };
    const pnl = r.realized - r.cost;
    g.count++;
    g.pnl += pnl;
    if (pnl > 0) g.wins++;
    m.set(k, g);
  }
  return [...m.entries()]
    .map(([name, g]) => ({ name, count: g.count, pnl: g.pnl, winRate: (g.wins / g.count) * 100 }))
    .sort((a, b) => b.count - a.count || b.pnl - a.pnl);
}

/** Pure: equity/drawdown from snapshots, everything else from closed positions (oldest first). */
export function buildPortfolio(i: {
  snapshots: { ts: number; cashSol: number; openSol: number; totalSol: number; startingSol: number }[];
  closed: ClosedRow[];
  versionName: (id: number | null) => string;
}): Portfolio {
  let peak = -Infinity;
  const equity = i.snapshots.map((s) => ({ ts: s.ts, total: s.totalSol, cash: s.cashSol, open: s.openSol, pnl: s.totalSol - s.startingSol }));
  const drawdown = equity.map((e) => {
    peak = Math.max(peak, e.pnl);
    return { ts: e.ts, dd: e.pnl - peak };
  });
  const days = new Map<string, { pnl: number; count: number; wins: number }>();
  for (const r of i.closed) {
    const day = new Date(r.closed).toISOString().slice(0, 10);
    const d = days.get(day) ?? { pnl: 0, count: 0, wins: 0 };
    const pnl = r.realized - r.cost;
    d.pnl += pnl;
    d.count++;
    if (pnl > 0) d.wins++;
    days.set(day, d);
  }
  return {
    equity,
    drawdown,
    daily: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({ day, ...d })),
    byVersion: groupBy(i.closed, (r) => i.versionName(r.versionId)),
    byRoute: groupBy(i.closed, (r) => (r.route === 'pump-curve' ? 'Curve' : 'Jupiter')),
    byExit: groupBy(i.closed, (r) => exitGroup(r.closeReason)),
    stats: computeStats(i.closed.map((r) => ({
      id: r.id, symbol: r.symbol, mint: r.mint, cost: r.cost, realized: r.realized, ladder: r.ladder, opened: r.opened, closed: r.closed,
    }))),
  };
}
