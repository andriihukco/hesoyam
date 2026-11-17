import { describe, expect, it } from 'vitest';
import { SignalAggregator } from '../src/signals/aggregator.js';

describe('SignalAggregator', () => {
  const agg = () => new SignalAggregator(() => 30_000);

  it('counts unique channels in the window', () => {
    const a = agg();
    expect(a.add('M', 'c1', 0).channelsInWindow).toEqual(['c1']);
    expect(a.add('M', 'c1', 1000).newChannel).toBe(false);
    const r = a.add('M', 'c2', 20_000);
    expect(r.channelsInWindow.sort()).toEqual(['c1', 'c2']);
    expect(r.newChannel).toBe(true);
  });

  it('drops mentions older than the window', () => {
    const a = agg();
    a.add('M', 'c1', 0);
    const r = a.add('M', 'c2', 31_000);
    expect(r.channelsInWindow).toEqual(['c2']);
    expect(r.isFirstMention).toBe(false);
  });
});
