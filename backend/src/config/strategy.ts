import { z } from 'zod';

export const LadderStep = z.object({
  roiPct: z.number().positive().max(100000),
  /** Percent of the ORIGINAL position size to sell at this step. */
  sellPct: z.number().min(1).max(100),
});

export const StrategySchema = z.object({
  // Entry
  buyAmountSol: z.number().min(0.001).max(100),
  maxSlippagePct: z.number().min(0.1).max(100),
  // Signal filter
  minChannels: z.number().int().min(1).max(50),
  windowSec: z.number().int().min(1).max(3600),
  /**
   * How X / Threads mentions count toward minChannels: 'off' = shown only, never count;
   * 'one' = all social accounts together count as one channel; 'each' = every account counts.
   */
  socialMentions: z.enum(['off', 'one', 'each']),
  minScore: z.number().min(0).max(100),
  // Entry timing (0 = off). Stops buying a token shilled again long after its first call.
  maxSignalAgeSec: z.number().int().min(0).max(86400),
  maxRunupFromFirstPct: z.number().min(0).max(100000),
  routes: z.enum(['any', 'curve', 'graduated']),
  // Risk
  maxTop10HolderPct: z.number().min(1).max(100),
  requireMintAuthorityDisabled: z.boolean(),
  requireFreezeAuthorityDisabled: z.boolean(),
  rugcheckEnabled: z.boolean(),
  /** Wallet-level holder analysis (Helius) for tokens that passed every other check. */
  holderAnalysisEnabled: z.boolean(),
  /** Reject when the holder risk score is above this (0 clean … 100 coordinated / rug-linked). */
  maxHolderRisk: z.number().min(0).max(100),
  // Momentum
  momentumObserveSec: z.number().int().min(0).max(120),
  minTrades60s: z.number().int().min(0).max(10000),
  minBuyVolumeSol60s: z.number().min(0).max(100000),
  minGraduatedVolumeUsd5m: z.number().min(0),
  // Exits
  takeProfitLadder: z.array(LadderStep).max(6),
  trailingStopPct: z.number().min(1).max(99),
  hardStopLossPct: z.number().min(1).max(99),
  stagnationSec: z.number().int().min(10).max(86400),
  /** Graduated tokens: sell if no successful price quote for this long (blind position). */
  markStaleSec: z.number().int().min(5).max(600),
  // Guards
  maxOpenPositions: z.number().int().min(1).max(100),
  maxDailyLossSol: z.number().min(0.01).max(1000),
  // Costs (paper mirrors live)
  priorityFeeSol: z.number().min(0).max(1),
  jitoTipSol: z.number().min(0).max(1),
  pumpFeeBps: z.number().min(0).max(1000),
  simulatedLatencyMs: z.number().int().min(0).max(10000),
  // Infra
  rpc: z.string(),
});

export type Strategy = z.infer<typeof StrategySchema>;
export type LadderStepT = z.infer<typeof LadderStep>;

export const DEFAULT_STRATEGY: Strategy = {
  buyAmountSol: 0.1,
  maxSlippagePct: 15,
  minChannels: 2,
  windowSec: 30,
  socialMentions: 'off',
  minScore: 70,
  maxSignalAgeSec: 0,
  maxRunupFromFirstPct: 0,
  routes: 'any',
  maxTop10HolderPct: 30,
  requireMintAuthorityDisabled: true,
  requireFreezeAuthorityDisabled: true,
  rugcheckEnabled: true,
  holderAnalysisEnabled: true,
  maxHolderRisk: 60,
  momentumObserveSec: 10,
  minTrades60s: 8,
  minBuyVolumeSol60s: 3,
  minGraduatedVolumeUsd5m: 5000,
  takeProfitLadder: [
    { roiPct: 50, sellPct: 50 },
    { roiPct: 100, sellPct: 25 },
  ],
  trailingStopPct: 15,
  hardStopLossPct: 20,
  stagnationSec: 180,
  markStaleSec: 20,
  maxOpenPositions: 5,
  maxDailyLossSol: 2,
  priorityFeeSol: 0.0005,
  jitoTipSol: 0.0005,
  // Assumption: Pump.fun bonding-curve fee ~1%. Check current fee and adjust.
  pumpFeeBps: 100,
  simulatedLatencyMs: 400,
  rpc: 'public',
};

export const STARTING_PAPER_SOL = 10;

/** Fields a preset never changes: infra and cost model stay as the user set them. */
export const NON_PRESET_KEYS = ['rpc', 'priorityFeeSol', 'jitoTipSol', 'pumpFeeBps', 'simulatedLatencyMs'] as const;
export type PresetValues = Omit<Strategy, (typeof NON_PRESET_KEYS)[number]>;

export interface Preset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  values: PresetValues;
  /** Latest version backing this preset (absent for code-defined built-ins before the store loads them). */
  versionId?: number;
  version?: number;
}

export function presetValues(s: Strategy): PresetValues {
  const v: Record<string, unknown> = { ...s };
  for (const k of NON_PRESET_KEYS) delete v[k];
  return v as PresetValues;
}

const base = presetValues(DEFAULT_STRATEGY);

/**
 * Built-in presets. These are hypotheses to test in paper mode, not proven edges.
 * They differ mainly in WHEN they enter (signal age, run-up since first call, route)
 * and HOW they exit (stop, ladder, trailing, stagnation).
 */
export const BUILT_IN_PRESETS: Preset[] = [
  {
    id: 'default',
    name: 'Original',
    description: 'The spec defaults. No entry-timing limits.',
    builtIn: true,
    values: base,
  },
  {
    id: 'original-social',
    name: 'Original + social',
    description: 'Original, but X and Threads mentions together count as one extra channel. Run next to Original in Arena to see whether social posts add edge.',
    builtIn: true,
    values: { ...base, socialMentions: 'one' },
  },
  {
    id: 'early-curve',
    name: 'Early curve',
    description: 'Bonding curve only, first 2 min after the first call, before a big run-up. Tight stop, quick partial profit.',
    builtIn: true,
    values: {
      ...base,
      minChannels: 2, windowSec: 60, routes: 'curve',
      maxSignalAgeSec: 120, maxRunupFromFirstPct: 40,
      momentumObserveSec: 8, minTrades60s: 10, minBuyVolumeSol60s: 4,
      takeProfitLadder: [{ roiPct: 30, sellPct: 50 }, { roiPct: 80, sellPct: 25 }],
      trailingStopPct: 15, hardStopLossPct: 15, stagnationSec: 90,
      maxOpenPositions: 5, maxDailyLossSol: 1,
    },
  },
  {
    id: 'first-call',
    name: 'First call',
    description: 'Buys on the first channel post (no confirmation), within 60 s and before a 30% run-up. Tests whether waiting for other channels helps.',
    builtIn: true,
    values: {
      ...base,
      minChannels: 1, windowSec: 30,
      maxSignalAgeSec: 60, maxRunupFromFirstPct: 30,
      momentumObserveSec: 6, minTrades60s: 6, minBuyVolumeSol60s: 2, minGraduatedVolumeUsd5m: 10000,
      takeProfitLadder: [{ roiPct: 30, sellPct: 50 }, { roiPct: 80, sellPct: 25 }],
      trailingStopPct: 15, hardStopLossPct: 15, stagnationSec: 90, markStaleSec: 20,
      maxOpenPositions: 6, maxDailyLossSol: 1,
    },
  },
  {
    id: 'confirmed-runner',
    name: 'Confirmed runner',
    description: 'Graduated tokens with strong 5-min volume, 3+ channels, entry within 5 min. Wider stop because pool prices gap.',
    builtIn: true,
    values: {
      ...base,
      minChannels: 3, windowSec: 120, routes: 'graduated',
      maxSignalAgeSec: 300, maxRunupFromFirstPct: 150,
      minGraduatedVolumeUsd5m: 25000,
      takeProfitLadder: [{ roiPct: 40, sellPct: 50 }, { roiPct: 100, sellPct: 25 }],
      trailingStopPct: 20, hardStopLossPct: 25, stagnationSec: 240, markStaleSec: 15,
      maxOpenPositions: 5, maxDailyLossSol: 1,
    },
  },
  {
    id: 'scalp',
    name: 'Scalp',
    description: 'Take most of the profit early: 70% at +25%, tight trailing, exit fast when it stalls.',
    builtIn: true,
    values: {
      ...base,
      minChannels: 2, windowSec: 60,
      maxSignalAgeSec: 180, maxRunupFromFirstPct: 80,
      takeProfitLadder: [{ roiPct: 25, sellPct: 70 }],
      trailingStopPct: 10, hardStopLossPct: 12, stagnationSec: 60, markStaleSec: 10,
      maxOpenPositions: 6, maxDailyLossSol: 1,
    },
  },
  {
    id: 'conservative',
    name: 'Conservative',
    description: 'Half size, 4+ channels, strict holders and volume, max 3 open, 0.5 SOL daily loss cap.',
    builtIn: true,
    values: {
      ...base,
      buyAmountSol: 0.05, minChannels: 4, windowSec: 120,
      maxSignalAgeSec: 300, maxRunupFromFirstPct: 100,
      maxTop10HolderPct: 20, minTrades60s: 15, minBuyVolumeSol60s: 6, minGraduatedVolumeUsd5m: 20000,
      takeProfitLadder: [{ roiPct: 40, sellPct: 50 }, { roiPct: 100, sellPct: 25 }],
      trailingStopPct: 15, hardStopLossPct: 15, stagnationSec: 120,
      maxOpenPositions: 3, maxDailyLossSol: 0.5,
    },
  },
];
