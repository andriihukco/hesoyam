import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY as S } from '../src/config/strategy.js';
import { evaluateExit } from '../src/trading/exitEngine.js';
import type { Position } from '../src/types.js';

const NOW = 1_000_000;
const pos = (o: Partial<Position> = {}): Position => ({
  id: 1, mint: 'M', symbol: null, mode: 'paper', route: 'pump-curve', status: 'open', openedAt: NOW, closedAt: null,
  decimals: 6, costSol: 1, entryPriceSol: 1, initialTokens: 100, tokensHeld: 100, realizedSol: 0, ladderDone: 0,
  peakPriceSol: 1, lastPriceSol: 1, lastActivityAt: NOW, closeReason: null, preset: null, lane: null, versionId: null, followUntil: null, followEnd: null, rules: null, ...o,
});

describe('evaluateExit', () => {
  it('holds inside the band', () => {
    expect(evaluateExit(pos(), 1.2, NOW, S).action).toBeNull();
  });
  it('hard stop at -20% sells all', () => {
    const a = evaluateExit(pos(), 0.8, NOW, S).action!;
    expect(a.closeAll).toBe(true);
    expect(a.reason).toMatch(/hard stop/);
  });
  it('TP1 at +50% sells 50% of original', () => {
    const a = evaluateExit(pos(), 1.5, NOW, S).action!;
    expect(a.tokens).toBe(50);
    expect(a.ladderStep).toBe(1);
    expect(a.closeAll).toBe(false);
  });
  it('TP2 at +100% sells 25% of original', () => {
    const a = evaluateExit(pos({ ladderDone: 1, tokensHeld: 50 }), 2, NOW, S).action!;
    expect(a.tokens).toBe(25);
    expect(a.ladderStep).toBe(2);
  });
  it('no trailing stop before ladder is done', () => {
    expect(evaluateExit(pos({ peakPriceSol: 1.4 }), 1.1, NOW, S).action).toBeNull();
  });
  it('trailing 15% from peak on the remainder', () => {
    const p = pos({ ladderDone: 2, tokensHeld: 25, peakPriceSol: 3 });
    expect(evaluateExit(p, 2.6, NOW, S).action).toBeNull();
    const a = evaluateExit(p, 2.5, NOW, S).action!;
    expect(a.closeAll).toBe(true);
    expect(a.reason).toMatch(/trailing/);
  });
  it('tracks the peak', () => {
    expect(evaluateExit(pos(), 1.3, NOW, S).peak).toBe(1.3);
  });
  it('stagnation after 3 minutes without trades', () => {
    const a = evaluateExit(pos(), 1.1, NOW + 181_000, S).action!;
    expect(a.reason).toMatch(/stagnant/);
  });
  it('hard stop wins over stagnation', () => {
    expect(evaluateExit(pos(), 0.5, NOW + 999_000, S).action!.reason).toMatch(/hard stop/);
  });
});
