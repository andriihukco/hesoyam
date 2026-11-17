import { describe, expect, it } from 'vitest';
import { curveBuyOut, curveSellOut, spotPriceSol, type CurveState } from '../src/market/pump.js';

// Pump.fun launch state: 30 SOL virtual, 1.073B virtual tokens (6 decimals).
const c: CurveState = {
  virtualTokenReserves: 1_073_000_000_000_000n,
  virtualSolReserves: 30_000_000_000n,
  realTokenReserves: 793_100_000_000_000n,
  realSolReserves: 0n,
  tokenTotalSupply: 1_000_000_000_000_000n,
  complete: false,
};

describe('bonding curve math', () => {
  it('spot price at launch ≈ 2.8e-8 SOL', () => {
    expect(spotPriceSol(c)).toBeCloseTo(30 / 1.073e9, 12);
  });
  it('1 SOL buy (no fee) ≈ 34.6M tokens', () => {
    const out = Number(curveBuyOut(c, 1_000_000_000n, 0)) / 1e6;
    expect(out).toBeGreaterThan(34.5e6);
    expect(out).toBeLessThan(34.7e6);
  });
  it('fee reduces output', () => {
    expect(curveBuyOut(c, 1_000_000_000n, 100)).toBeLessThan(curveBuyOut(c, 1_000_000_000n, 0));
  });
  it('buy then sell back on an untraded curve returns ~SOL in minus fees (regression)', () => {
    // Curve with zero real SOL (nobody bought yet): paper sell must not return 0.
    const odd: CurveState = { ...c, virtualSolReserves: 899_682_524_070n };
    const out = curveBuyOut(odd, 100_000_000n, 100);
    const back = curveSellOut(odd, out, 100);
    expect(Number(back) / 1e9).toBeGreaterThan(0.097);
    expect(Number(back) / 1e9).toBeLessThan(0.1);
  });
});
