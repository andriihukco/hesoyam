import { describe, expect, it } from 'vitest';
import { computeStats, Db } from '../src/db/db.js';

const row = (id: number, cost: number, realized: number, ladder = 0) =>
  ({ id, symbol: `T${id}`, mint: `m${id}`, cost, realized, ladder, opened: id * 1000, closed: id * 1000 + 500 });

describe('computeStats', () => {
  it('handles no trades', () => {
    const s = computeStats([]);
    expect(s).toMatchObject({ count: 0, winRate: 0, biggestWin: null, biggestLoss: null, kda: 0, profitFactor: null });
  });

  it('computes pnl, extremes, streaks, kda and drawdown', () => {
    // pnl: +0.5, +0.2, -0.3, -0.1, -0.4, +1.0
    const s = computeStats([row(1, 1, 1.5, 2), row(2, 1, 1.2, 1), row(3, 1, 0.7), row(4, 1, 0.9), row(5, 1, 0.6), row(6, 1, 2, 3)]);
    expect(s.count).toBe(6);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(3);
    expect(s.winRate).toBeCloseTo(50);
    expect(s.pnlSol).toBeCloseTo(0.9);
    expect(s.biggestWin?.id).toBe(6);
    expect(s.biggestLoss?.id).toBe(5);
    expect(s.longestWinStreak).toBe(2);
    expect(s.longestLossStreak).toBe(3);
    expect(s.currentStreak).toBe(1);
    expect(s.assists).toBe(6);
    expect(s.kda).toBeCloseTo((3 + 6) / 3);
    expect(s.profitFactor).toBeCloseTo(1.7 / 0.8);
    expect(s.maxDrawdownSol).toBeCloseTo(0.8);
    expect(s.avgHoldMs).toBe(500);
  });
});

describe('activity log', () => {
  it('persists, pages and searches', () => {
    const db = new Db(':memory:');
    for (let i = 1; i <= 5; i++) db.addActivity(i, i % 2 ? 'info' : 'trade', `line ${i}${i === 3 ? ' 50%_off' : ''}`);
    expect(db.activityCount()).toBe(5);
    const first = db.activity({ limit: 2 });
    expect(first.map((a) => a.text)).toEqual(['line 5', 'line 4']);
    expect(db.activity({ before: first[1]!.id, limit: 10 }).map((a) => a.id)).toEqual([3, 2, 1]);
    expect(db.activity({ q: '%_' })).toHaveLength(1);
    expect(db.activity({ level: 'trade' })).toHaveLength(2);
  });
});
