import type { Strategy } from './types';

type NumKey = { [K in keyof Strategy]: Strategy[K] extends number ? K : never }[keyof Strategy];
interface Bound { min: number; max: number; int?: boolean; minExclusive?: boolean }

/** Mirrors StrategySchema bounds in backend/src/config/strategy.ts. */
const bounds: Record<NumKey, Bound> = {
  buyAmountSol: { min: 0.001, max: 100 },
  maxSlippagePct: { min: 0.1, max: 100 },
  minChannels: { min: 1, max: 50, int: true },
  windowSec: { min: 1, max: 3600, int: true },
  minScore: { min: 0, max: 100 },
  maxSignalAgeSec: { min: 0, max: 86400, int: true },
  maxRunupFromFirstPct: { min: 0, max: 100000 },
  maxTop10HolderPct: { min: 1, max: 100 },
  maxHolderRisk: { min: 0, max: 100 },
  momentumObserveSec: { min: 0, max: 120, int: true },
  minTrades60s: { min: 0, max: 10000, int: true },
  minBuyVolumeSol60s: { min: 0, max: 100000 },
  minGraduatedVolumeUsd5m: { min: 0, max: Number.MAX_SAFE_INTEGER },
  trailingStopPct: { min: 1, max: 99 },
  hardStopLossPct: { min: 1, max: 99 },
  stagnationSec: { min: 10, max: 86400, int: true },
  markStaleSec: { min: 5, max: 600, int: true },
  maxOpenPositions: { min: 1, max: 100, int: true },
  maxDailyLossSol: { min: 0.01, max: 1000 },
  priorityFeeSol: { min: 0, max: 1 },
  jitoTipSol: { min: 0, max: 1 },
  pumpFeeBps: { min: 0, max: 1000 },
  simulatedLatencyMs: { min: 0, max: 10000, int: true },
};

function check(v: number, b: Bound): string | null {
  if (!Number.isFinite(v)) return 'Enter a number';
  if (b.int && !Number.isInteger(v)) return 'Whole number only';
  if (b.minExclusive ? v <= b.min : v < b.min) return b.minExclusive ? `Must be above ${b.min}` : `Min ${b.min}`;
  if (v > b.max) return `Max ${b.max}`;
  return null;
}

/** Field → message for every invalid value; empty object = valid. Ladder errors use `takeProfitLadder.<i>.<field>`. */
export function validateDraft(d: Strategy): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, b] of Object.entries(bounds) as [NumKey, Bound][]) {
    const e = check(d[k], b);
    if (e) out[k] = e;
  }
  if (d.takeProfitLadder.length > 6) out.takeProfitLadder = 'At most 6 steps';
  d.takeProfitLadder.forEach((s, i) => {
    const roi = check(s.roiPct, { min: 0, max: 100000, minExclusive: true });
    if (roi) out[`takeProfitLadder.${i}.roiPct`] = roi;
    const sell = check(s.sellPct, { min: 1, max: 100 });
    if (sell) out[`takeProfitLadder.${i}.sellPct`] = sell;
  });
  const total = d.takeProfitLadder.reduce((a, s) => a + (Number.isFinite(s.sellPct) ? s.sellPct : 0), 0);
  if (total > 100 && !out.takeProfitLadder) out.takeProfitLadder = `Steps sell ${total}% in total; max 100%`;
  return out;
}
