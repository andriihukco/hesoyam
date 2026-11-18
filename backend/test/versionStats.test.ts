import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/db.js';

function closed(db: Db, versionId: number, pnl: number, closedAt: number, mode = 'paper') {
  db.sql
    .prepare(
      `INSERT INTO positions(mint, mode, route, status, opened_at, closed_at, decimals, cost_sol, entry_price, initial_tokens,
        tokens_held, realized_sol, ladder_done, peak_price, last_price, last_activity_at, version_id)
       VALUES('m', ?, 'pump-curve', 'closed', ?, ?, 6, 0.1, 1, 1, 0, ?, 0, 1, 1, ?, ?)`,
    )
    .run(mode, closedAt - 10, closedAt, 0.1 + pnl, closedAt, versionId);
}

describe('per-version stats', () => {
  const db = new Db(':memory:');
  closed(db, 7, 0.2, 100);
  closed(db, 7, -0.1, 200);
  closed(db, 7, 0.05, 300);
  closed(db, 8, 0.01, 150);
  closed(db, 7, 5, 400, 'live');

  it('statsByVersion sums per version and mode, with max drawdown', () => {
    const s = db.statsByVersion('paper');
    const v7 = s.find((x) => x.versionId === 7)!;
    expect(v7.count).toBe(3);
    expect(v7.wins).toBe(2);
    expect(v7.pnl).toBeCloseTo(0.15, 9);
    expect(v7.maxDrawdownSol).toBeCloseTo(0.1, 9);
    expect(s.find((x) => x.versionId === 8)!.count).toBe(1);
  });

  it('equityCurve is cumulative pnl in closed_at order', () => {
    const c = db.equityCurve(7, 'paper');
    expect(c.map((p) => p.ts)).toEqual([100, 200, 300]);
    expect(c.map((p) => Number(p.pnl.toFixed(9)))).toEqual([0.2, 0.1, 0.15]);
  });
});
