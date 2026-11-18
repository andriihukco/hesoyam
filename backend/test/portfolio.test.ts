import { describe, expect, it } from 'vitest';
import { Db, type ClosedRow } from '../src/db/db.js';
import { buildPortfolio, exitGroup, rangeStart } from '../src/portfolio/portfolio.js';

const DAY = 86_400_000;
const row = (o: Partial<ClosedRow>): ClosedRow => ({
  id: 1, mint: 'M', symbol: null, route: 'pump-curve', versionId: 1, cost: 0.1, realized: 0.1, ladder: 0,
  opened: 0, closed: 1, closeReason: 'hard stop -16.4%', ...o,
});
const snap = (ts: number, total: number) => ({ ts, cashSol: total, openSol: 0, totalSol: total });
const name = (id: number | null) => (id === null ? 'Custom' : `v${id}`);

describe('buildPortfolio', () => {
  it('empty input gives empty series and zero stats', () => {
    const p = buildPortfolio({ snapshots: [], closed: [], versionName: name });
    expect(p.equity).toEqual([]);
    expect(p.drawdown).toEqual([]);
    expect(p.daily).toEqual([]);
    expect(p.byVersion).toEqual([]);
    expect(p.stats.count).toBe(0);
  });

  it('drawdown is distance below running peak', () => {
    const p = buildPortfolio({ snapshots: [snap(1, 10), snap(2, 12), snap(3, 9), snap(4, 13)], closed: [], versionName: name });
    expect(p.drawdown.map((d) => d.dd)).toEqual([0, 0, -3, 0]);
    expect(p.equity.map((e) => e.total)).toEqual([10, 12, 9, 13]);
  });

  it('daily groups by UTC day', () => {
    const d0 = Date.UTC(2026, 10, 17, 23, 0);
    const d1 = Date.UTC(2026, 10, 18, 1, 0);
    const p = buildPortfolio({
      snapshots: [],
      closed: [row({ id: 1, closed: d0, realized: 0.2 }), row({ id: 2, closed: d1, realized: 0.05 }), row({ id: 3, closed: d1 + 1, realized: 0.15 })],
      versionName: name,
    });
    expect(p.daily.map((d) => d.day)).toEqual(['2026-11-17', '2026-11-18']);
    expect(p.daily[1]!.count).toBe(2);
    expect(p.daily[1]!.wins).toBe(1);
    expect(p.daily[1]!.pnl).toBeCloseTo(0, 9);
  });

  it('exit reasons are grouped without numbers', () => {
    const p = buildPortfolio({
      snapshots: [],
      closed: [row({ id: 1, closeReason: 'hard stop -16.4%' }), row({ id: 2, closeReason: 'hard stop -18.3%' }), row({ id: 3, closeReason: 'TP1 +50%' })],
      versionName: name,
    });
    expect(p.byExit.map((g) => [g.name, g.count])).toEqual([['hard stop', 2], ['tp', 1]]);
  });

  it('groups by version name and route', () => {
    const p = buildPortfolio({
      snapshots: [],
      closed: [row({ id: 1, versionId: 4, realized: 0.2 }), row({ id: 2, versionId: 4, realized: 0.05, route: 'jupiter' }), row({ id: 3, versionId: null })],
      versionName: name,
    });
    const v4 = p.byVersion.find((g) => g.name === 'v4')!;
    expect(v4.count).toBe(2);
    expect(v4.pnl).toBeCloseTo(0.05, 9);
    expect(v4.winRate).toBe(50);
    expect(p.byRoute.map((g) => g.name).sort()).toEqual(['Curve', 'Jupiter']);
  });
});

describe('helpers', () => {
  it('exitGroup normalises and handles null', () => {
    expect(exitGroup('Trailing stop -12.0% from peak')).toBe('trailing stop from peak');
    expect(exitGroup(null)).toBe('other');
  });
  it('rangeStart 7d is now − 7 days, all is 0', () => {
    expect(rangeStart('7d', 10 * DAY)).toBe(3 * DAY);
    expect(rangeStart('1d', 10 * DAY)).toBe(9 * DAY);
    expect(rangeStart('all', 10 * DAY)).toBe(0);
  });
});

describe('db storage', () => {
  it('equity snapshots round-trip and filter by mode and since', () => {
    const db = new Db(':memory:');
    db.addEquitySnapshot({ ts: 1, mode: 'paper', cashSol: 9, openSol: 1, totalSol: 10 });
    db.addEquitySnapshot({ ts: 5, mode: 'paper', cashSol: 8, openSol: 3, totalSol: 11 });
    db.addEquitySnapshot({ ts: 6, mode: 'live', cashSol: 1, openSol: 0, totalSol: 1 });
    expect(db.equitySnapshots('paper', 2)).toEqual([{ ts: 5, cashSol: 8, openSol: 3, totalSol: 11 }]);
  });

  it('followCandidates returns recent unended closes only', () => {
    const db = new Db(':memory:');
    const ins = (closedAt: number, status = 'closed') => db.sql
      .prepare(`INSERT INTO positions(mint, mode, route, status, opened_at, closed_at, decimals, cost_sol, entry_price, initial_tokens,
        tokens_held, realized_sol, ladder_done, peak_price, last_price, last_activity_at) VALUES('M', 'paper', 'pump-curve', ?, 0, ?, 6, 0.1, 1, 1, 0, 0.1, 0, 1, 0.5, 0)`)
      .run(status, closedAt).lastInsertRowid;
    const recent = Number(ins(100));
    const ended = Number(ins(100));
    ins(10);
    ins(100, 'open');
    db.setFollowEnd(ended, 'rugged', 150);
    const c = db.followCandidates(50);
    expect(c.map((x) => x.id)).toEqual([recent]);
    expect(c[0]).toMatchObject({ mint: 'M', route: 'pump-curve', closedAt: 100, lastPrice: 0.5 });
    expect(db.position(ended)).toMatchObject({ followEnd: 'rugged' });
  });

  it('closedSince maps rows for the portfolio', () => {
    const db = new Db(':memory:');
    db.sql.prepare(`INSERT INTO positions(mint, symbol, mode, route, status, opened_at, closed_at, decimals, cost_sol, entry_price, initial_tokens,
      tokens_held, realized_sol, ladder_done, peak_price, last_price, last_activity_at, close_reason, version_id)
      VALUES('M', 'S', 'paper', 'jupiter', 'closed', 5, 200, 6, 0.1, 1, 1, 0, 0.12, 1, 1, 1, 0, 'TP1', 3)`).run();
    expect(db.closedSince('paper', 100)).toEqual([{ id: 1, mint: 'M', symbol: 'S', route: 'jupiter', versionId: 3, cost: 0.1, realized: 0.12, ladder: 1, opened: 5, closed: 200, closeReason: 'TP1' }]);
    expect(db.closedSince('paper', 300)).toEqual([]);
  });
});
