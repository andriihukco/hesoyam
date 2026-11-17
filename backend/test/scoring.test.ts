import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY as S } from '../src/config/strategy.js';
import { score } from '../src/signals/scorer.js';
import { curveMomentum } from '../src/risk/momentum.js';
import { buyBlocked } from '../src/trading/guards.js';

const pass = { name: 'x', pass: true, detail: '' };

describe('scorer', () => {
  it('buys when all gates pass', () => {
    const m = curveMomentum({ trades: 20, buyVolSol: 10 }, S);
    const r = score({ uniqueChannels: 2, risk: [pass, pass], momentum: m }, S);
    expect(r.score).toBe(100);
    expect(r.buy).toBe(true);
  });
  it('single channel never buys', () => {
    const m = curveMomentum({ trades: 20, buyVolSol: 10 }, S);
    expect(score({ uniqueChannels: 1, risk: [pass], momentum: m }, S).buy).toBe(false);
  });
  it('a failed risk check blocks even with high score', () => {
    const m = curveMomentum({ trades: 20, buyVolSol: 10 }, S);
    const r = score({ uniqueChannels: 3, risk: [pass, pass, pass, { name: 'mint', pass: false, detail: '', hard: true }], momentum: m }, S);
    expect(r.buy).toBe(false);
    expect(r.failed.some((f) => f.hard)).toBe(true);
  });
  it('weak momentum blocks', () => {
    const m = curveMomentum({ trades: 2, buyVolSol: 0.5 }, S);
    expect(m.pass).toBe(false);
    expect(score({ uniqueChannels: 2, risk: [pass], momentum: m }, S).buy).toBe(false);
  });
});

describe('guards', () => {
  const g = { killSwitch: false, openPositions: 0, hasPositionInMint: false, balanceSol: 10, dailyPnlSol: 0 };
  it('allows a normal buy', () => expect(buyBlocked(g, S, 0.003)).toBeNull());
  it('kill switch blocks', () => expect(buyBlocked({ ...g, killSwitch: true }, S, 0.003)).toMatch(/kill/));
  it('daily loss blocks', () => expect(buyBlocked({ ...g, dailyPnlSol: -2 }, S, 0.003)).toMatch(/daily/));
  it('max positions blocks', () => expect(buyBlocked({ ...g, openPositions: 5 }, S, 0.003)).toMatch(/max/));
  it('balance blocks', () => expect(buyBlocked({ ...g, balanceSol: 0.05 }, S, 0.003)).toMatch(/balance/));
});

import { top10Share } from '../src/risk/checks.js';
import { bondingCurvePda } from '../src/market/pump.js';
import { PublicKey } from '@solana/web3.js';

describe('top10Share', () => {
  it('excludes PDA-owned accounts (bonding curve) and sums people', () => {
    const pda = bondingCurvePda(new PublicKey('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr')).toBase58();
    const person = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'; // on-curve wallet
    const r = top10Share([{ amount: 800, owner: pda }, { amount: 100, owner: person }, { amount: 50, owner: person }], 1000);
    expect(r.excluded).toBe(1);
    expect(r.pct).toBeCloseTo(15);
  });
});
