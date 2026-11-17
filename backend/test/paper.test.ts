import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY } from '../src/config/strategy.js';
import type { Quote, Quoter } from '../src/market/quoter.js';
import { ATA_RENT_SOL, BASE_FEE_SOL, PaperExecutor } from '../src/trading/paper.js';
import { SlippageError } from '../src/trading/executor.js';

const S = { ...DEFAULT_STRATEGY, simulatedLatencyMs: 0 };

function fakeQuoter(buyOuts: bigint[], sellOut = 0n): Quoter {
  let i = 0;
  const q = (outRaw: bigint): Quote => ({ route: 'pump-curve', inRaw: 0n, outRaw, impactPct: 1, spotPriceSol: null });
  return {
    route: async () => 'pump-curve',
    quoteBuy: async () => q(buyOuts[Math.min(i++, buyOuts.length - 1)]!),
    quoteSell: async () => q(sellOut),
  };
}

const memStore = () => {
  let w = { balanceSol: 10, startingSol: 10 };
  return { load: () => w, save: (x: typeof w) => (w = { ...x }) };
};

describe('PaperExecutor', () => {
  it('buy debits SOL + fees + rent; full sell refunds rent', async () => {
    const ex = new PaperExecutor(fakeQuoter([1_000_000_000n], 150_000_000n), memStore(), () => S);
    const f = await ex.buy('M', 0.1, 6);
    expect(f.tokens).toBe(1000);
    const fee = BASE_FEE_SOL + S.priorityFeeSol + S.jitoTipSol;
    expect(ex.balanceSol()).toBeCloseTo(10 - 0.1 - fee - ATA_RENT_SOL, 9);
    const s = await ex.sell('M', 1_000_000_000n, 6, true);
    expect(s.sol).toBeCloseTo(0.15 - fee, 9);
    expect(ex.balanceSol()).toBeCloseTo(10 - 0.1 - fee + 0.15 - fee, 9);
  });
  it('rejects a buy when price moves past max slippage during latency', async () => {
    const ex = new PaperExecutor(fakeQuoter([1_000_000_000n, 800_000_000n]), memStore(), () => S);
    await expect(ex.buy('M', 0.1, 6)).rejects.toBeInstanceOf(SlippageError);
    expect(ex.balanceSol()).toBe(10);
  });
});
