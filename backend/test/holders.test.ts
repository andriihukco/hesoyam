import { describe, expect, it } from 'vitest';
import { scoreHolders, walletActivity, type WalletInfo } from '../src/holders/score.js';
import { Db } from '../src/db/db.js';

const NOW = 1_800_000_000_000;
const w = (owner: string, p: Partial<WalletInfo> = {}): WalletInfo => ({
  owner, pct: 1, solBalance: 1, txCount: 10, firstSeenTs: NOW - 30 * 86_400_000, fundedBy: null,
  buys: 1, sells: 0, boughtTokens: 100, soldTokens: 0, solIn: 0, solOut: 0.5,
  otherTokenCount: 0, otherTokens: [], rugLinks: 0, flags: [], ...p,
});

describe('scoreHolders', () => {
  it('scores clean, old, independent holders at 0', () => {
    const r = scoreHolders([w('A'), w('B'), w('C')], NOW);
    expect(r.riskScore).toBe(0);
    expect(r.flags).toEqual([]);
  });

  it('flags a bundle of fresh wallets funded by one wallet', () => {
    const fresh = { firstSeenTs: NOW - 3_600_000, fundedBy: 'FUNDERxxxxxxxxxx' };
    const ws = [w('A', { ...fresh, pct: 5 }), w('B', { ...fresh, pct: 5 }), w('C', { ...fresh, pct: 5 }), w('D')];
    const r = scoreHolders(ws, NOW);
    expect(r.flags[0]).toMatch(/^3 holders funded by FUND/);
    expect(r.flags).toContain('3 fresh wallets (< 3 days)');
    expect(ws[0]!.flags).toEqual(['fresh', 'same funder FUND…']);
    expect(r.riskScore).toBe(Math.min(40, 3 * 8 + 15) + 15);
  });

  it('weights rug links, dumping and no-SOL whales, capped at 100', () => {
    const ws = Array.from({ length: 10 }, (_, i) =>
      w(`W${i}`, { rugLinks: 2, sells: 1, soldTokens: 100, pct: 3, solBalance: 0.001, firstSeenTs: NOW, fundedBy: 'F' }));
    expect(scoreHolders(ws, NOW).riskScore).toBe(100);
  });
});

describe('walletActivity', () => {
  const owner = 'OWN', mint = 'MINT';
  const txs = [
    { timestamp: 300, tokenTransfers: [{ fromUserAccount: owner, toUserAccount: 'POOL', mint, tokenAmount: 60 }],
      nativeTransfers: [{ fromUserAccount: 'POOL', toUserAccount: owner, amount: 0.8e9 }] },
    { timestamp: 200, tokenTransfers: [{ fromUserAccount: 'POOL', toUserAccount: owner, mint, tokenAmount: 100 }],
      nativeTransfers: [{ fromUserAccount: owner, toUserAccount: 'POOL', amount: 0.5e9 }] },
    { timestamp: 100, nativeTransfers: [{ fromUserAccount: 'CEX', toUserAccount: owner, amount: 1e9 }] },
  ];

  it('counts buys, sells and SOL legs, and finds the funder of a complete history', () => {
    const a = walletActivity(owner, mint, txs, true);
    expect(a).toMatchObject({ buys: 1, sells: 1, boughtTokens: 100, soldTokens: 60, solOut: 0.5, solIn: 0.8, fundedBy: 'CEX', firstSeenTs: 100_000 });
  });

  it('does not guess age or funder when history was cut off', () => {
    const a = walletActivity(owner, mint, txs, false);
    expect(a.firstSeenTs).toBeNull();
    expect(a.fundedBy).toBeNull();
  });
});

describe('rug wallet memory', () => {
  it('remembers holders and funders of a rugged coin and counts links', () => {
    const db = new Db(':memory:');
    const base = { at: NOW, riskScore: 0, flags: [], summary: null, summaryAt: null };
    db.saveHolderReport({ ...base, mint: 'M1', wallets: [w('A', { fundedBy: 'F' }), w('B')] });
    db.saveHolderReport({ ...base, mint: 'M2', wallets: [w('A')] });
    expect(db.markRugged('M1')).toBe(3);
    expect(db.markRugged('M1')).toBe(0);
    db.markRugged('M2');
    const links = db.rugLinks(['A', 'B', 'F', 'Z']);
    expect(Object.fromEntries(links)).toEqual({ A: 2, B: 1, F: 1 });
    expect(db.holderReport('M1')?.wallets).toHaveLength(2);
  });
});
