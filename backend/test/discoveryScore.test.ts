import { describe, expect, it } from 'vitest';
import { bondingPct, boardOf, passes, trendScore, type DiscoveredToken } from '../src/discovery/score.js';

const MIN = 60_000;
const NOW = 10_000 * MIN;
const INITIAL = 793_100_000n * 1_000_000n;

const tok = (o: Partial<DiscoveredToken> = {}): DiscoveredToken => ({
  mint: 'M', symbol: 'S', name: 'N', creator: 'C', createdAt: NOW - 30 * MIN, devBuyPct: 2, firstMcSol: 30,
  bondingPct: 10, realSol: 1, migratedAt: null, promoted: false, origin: 'created',
  market: { priceUsd: 0.0001, mcUsd: 20_000, liqUsd: 8_000, vol5mUsd: 4_000, vol1hUsd: 20_000, buys5m: 40, sells5m: 20, change5mPct: 12, socials: ['x'], updatedAt: NOW },
  ...o,
});

describe('bondingPct', () => {
  it('is 0 at start, 50 halfway, 100 when complete', () => {
    expect(bondingPct({ realTokenReserves: INITIAL, complete: false })).toBe(0);
    expect(bondingPct({ realTokenReserves: INITIAL / 2n, complete: false })).toBeCloseTo(50, 6);
    expect(bondingPct({ realTokenReserves: INITIAL, complete: true })).toBe(100);
  });
  it('bonding clamps for custom-reserve curves', () => {
    expect(bondingPct({ realTokenReserves: INITIAL * 2n, complete: false })).toBe(0);
    expect(bondingPct({ realTokenReserves: -1n, complete: false })).toBe(100);
  });
});

describe('boardOf', () => {
  it('sorts by bonding and migration', () => {
    expect(boardOf(tok({ bondingPct: 10 }), NOW)).toBe('new');
    expect(boardOf(tok({ bondingPct: 50 }), NOW)).toBe('mid');
    expect(boardOf(tok({ bondingPct: 75 }), NOW)).toBe('soon');
    expect(boardOf(tok({ migratedAt: NOW - 60 * MIN, bondingPct: 100 }), NOW)).toBe('graduated');
    expect(boardOf(tok({ migratedAt: NOW - 25 * 60 * MIN }), NOW)).toBe('old');
  });
});

describe('trendScore', () => {
  it('ranks an active token above a quiet one', () => {
    const quiet = tok({ market: { ...tok().market!, vol5mUsd: 300, buys5m: 6, sells5m: 6, change5mPct: 0 } });
    expect(trendScore(tok(), NOW)).toBeGreaterThan(trendScore(quiet, NOW));
  });
  it('is 0 below 10 txns in 5 min and without market data', () => {
    expect(trendScore(tok({ market: { ...tok().market!, buys5m: 5, sells5m: 4 } }), NOW)).toBe(0);
    expect(trendScore(tok({ market: null }), NOW)).toBe(0);
  });
  it('halves young or thin tokens', () => {
    const base = trendScore(tok(), NOW);
    expect(trendScore(tok({ createdAt: NOW - 2 * MIN }), NOW)).toBeCloseTo(base / 2, 6);
    expect(trendScore(tok({ market: { ...tok().market!, liqUsd: 1_000 } }), NOW)).toBeCloseTo(base / 2, 6);
  });
  it('stays within 0..100', () => {
    const hot = tok({ market: { ...tok().market!, vol5mUsd: 1e9, buys5m: 10_000, sells5m: 1, change5mPct: 5_000 } });
    expect(trendScore(hot, NOW)).toBeLessThanOrEqual(100);
  });
});

describe('passes', () => {
  it('applies market cap, age, socials and dev filters', () => {
    expect(passes(tok(), {}, NOW)).toBe(true);
    expect(passes(tok(), { minMc: 30_000 }, NOW)).toBe(false);
    expect(passes(tok(), { maxMc: 10_000 }, NOW)).toBe(false);
    expect(passes(tok(), { maxAgeMin: 10 }, NOW)).toBe(false);
    expect(passes(tok({ market: { ...tok().market!, socials: [] } }), { socials: true }, NOW)).toBe(false);
    expect(passes(tok({ devBuyPct: 9 }), { maxDevPct: 5 }, NOW)).toBe(false);
  });
  it('uses the curve market cap estimate when DexScreener has no data yet', () => {
    expect(passes(tok({ market: null }), { minMc: 1 }, NOW)).toBe(true);
    expect(passes(tok({ market: null }), { socials: true }, NOW)).toBe(false);
  });
});
