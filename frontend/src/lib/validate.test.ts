import { describe, expect, it } from 'vitest';
import { validateDraft } from './validate';
import type { Strategy } from './types';

const S: Strategy = {
  buyAmountSol: 0.1, maxSlippagePct: 15, minChannels: 2, windowSec: 30, socialMentions: 'off', minScore: 70,
  maxSignalAgeSec: 0, maxRunupFromFirstPct: 0, routes: 'any', maxTop10HolderPct: 30, requireMintAuthorityDisabled: true,
  requireFreezeAuthorityDisabled: true, rugcheckEnabled: true, momentumObserveSec: 10, minTrades60s: 8, minBuyVolumeSol60s: 3,
  minGraduatedVolumeUsd5m: 5000, takeProfitLadder: [{ roiPct: 50, sellPct: 50 }, { roiPct: 100, sellPct: 25 }],
  trailingStopPct: 15, hardStopLossPct: 20, stagnationSec: 180, markStaleSec: 20, maxOpenPositions: 5, maxDailyLossSol: 2,
  priorityFeeSol: 0.0005, jitoTipSol: 0.0005, pumpFeeBps: 100, simulatedLatencyMs: 400, rpc: 'public',
};

describe('validateDraft', () => {
  it('accepts the defaults', () => {
    expect(validateDraft(S)).toEqual({});
  });

  it('flags a zero take-profit ROI on its own field', () => {
    expect(Object.keys(validateDraft({ ...S, takeProfitLadder: [{ roiPct: 0, sellPct: 50 }] }))).toEqual(['takeProfitLadder.0.roiPct']);
  });

  it('flags a ladder selling more than 100% in total', () => {
    const e = validateDraft({ ...S, takeProfitLadder: [{ roiPct: 30, sellPct: 60 }, { roiPct: 80, sellPct: 50 }] });
    expect(Object.keys(e)).toEqual(['takeProfitLadder']);
  });

  it('flags a non-number (empty input) field', () => {
    expect(Object.keys(validateDraft({ ...S, buyAmountSol: Number.NaN }))).toEqual(['buyAmountSol']);
  });

  it('flags out-of-range and non-integer values', () => {
    const e = validateDraft({ ...S, hardStopLossPct: 100, minChannels: 1.5 });
    expect(Object.keys(e).sort()).toEqual(['hardStopLossPct', 'minChannels']);
  });
});
