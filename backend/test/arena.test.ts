import { describe, expect, it } from 'vitest';
import { ARENA_LEAD_HOLD_MS, leaderStep, rankLanes } from '../src/trading/arena.js';
import { SignalAggregator } from '../src/signals/aggregator.js';

const lane = (id: string, count: number, pnl: number, avgPnlPct = 0, wins = 0) => ({ id, count, pnl, avgPnlPct, wins });

describe('rankLanes', () => {
  it('ranks qualified lanes first, then by total PnL, not win rate', () => {
    const r = rankLanes([lane('a', 40, 0.1, 5, 30), lane('b', 40, 0.5, 2, 10), lane('c', 5, 3, 50, 5)], 30);
    expect(r.map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(r[2]!.qualified).toBe(false);
  });
});

describe('leaderStep', () => {
  const base = { enabled: true, autoSelect: true, leader: null };
  it('no leader until someone qualifies', () => {
    expect(leaderStep(base, [{ id: 'a', qualified: false }], null, 0)).toEqual({ leader: null, apply: null });
  });
  it('new leader starts its hold timer and is not applied yet', () => {
    expect(leaderStep(base, [{ id: 'a', qualified: true }], null, 1000)).toEqual({ leader: { id: 'a', since: 1000 }, apply: null });
  });
  it('applies after holding the lead for the hold period, only if auto-select is on', () => {
    const st = { ...base, leader: { id: 'a', since: 0 } };
    expect(leaderStep(st, [{ id: 'a', qualified: true }], 'x', ARENA_LEAD_HOLD_MS).apply).toBe('a');
    expect(leaderStep({ ...st, autoSelect: false }, [{ id: 'a', qualified: true }], 'x', ARENA_LEAD_HOLD_MS).apply).toBeNull();
    expect(leaderStep(st, [{ id: 'a', qualified: true }], 'a', ARENA_LEAD_HOLD_MS).apply).toBeNull();
  });
  it('a change of leader resets the timer', () => {
    const st = { ...base, leader: { id: 'a', since: 0 } };
    expect(leaderStep(st, [{ id: 'b', qualified: true }], 'x', ARENA_LEAD_HOLD_MS)).toEqual({ leader: { id: 'b', since: ARENA_LEAD_HOLD_MS }, apply: null });
  });
});

describe('aggregator per-lane windows', () => {
  it('counts channels per window and tells whether the latest channel is new', () => {
    const a = new SignalAggregator(() => 120_000);
    a.add('M', 'c1', 0);
    a.add('M', 'c2', 90_000);
    expect(a.channels('M', 60_000, 90_000)).toEqual(['c2']);
    expect(a.channels('M', 120_000, 90_000).sort()).toEqual(['c1', 'c2']);
    expect(a.channels('M', 120_000, 90_000, true)).toEqual(['c1']);
  });
});
