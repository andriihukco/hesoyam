import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS, DEFAULT_STRATEGY as S, StrategySchema, presetValues } from '../src/config/strategy.js';
import { entryChecks } from '../src/signals/entry.js';

describe('built-in presets', () => {
  it('all validate against the schema', () => {
    for (const p of BUILT_IN_PRESETS) expect(StrategySchema.safeParse({ ...S, ...p.values }).success, p.id).toBe(true);
  });
  it('never touch infra or cost settings', () => {
    for (const p of BUILT_IN_PRESETS) {
      for (const k of ['rpc', 'priorityFeeSol', 'jitoTipSol', 'pumpFeeBps', 'simulatedLatencyMs']) expect(k in p.values).toBe(false);
    }
  });
  it('Original equals the defaults', () => {
    expect(BUILT_IN_PRESETS[0]!.values).toEqual(presetValues(S));
  });
});

describe('entryChecks', () => {
  const s = { ...S, maxSignalAgeSec: 120, maxRunupFromFirstPct: 50, routes: 'curve' as const };
  it('is empty when all limits are off', () => {
    expect(entryChecks({ ageSec: 9999, runupPct: 900, route: 'jupiter' }, S)).toEqual([]);
  });
  it('passes a fresh, un-pumped curve token', () => {
    expect(entryChecks({ ageSec: 30, runupPct: 10, route: 'pump-curve' }, s).every((c) => c.pass)).toBe(true);
  });
  it('rejects too old, too pumped, wrong route — all hard', () => {
    const r = entryChecks({ ageSec: 121, runupPct: 51, route: 'jupiter' }, s);
    expect(r.filter((c) => !c.pass).map((c) => c.name)).toEqual(['route filter', 'signal age', 'run-up']);
    expect(r.every((c) => c.hard)).toBe(true);
  });
  it('unknown first price does not block', () => {
    expect(entryChecks({ ageSec: 1, runupPct: null, route: 'pump-curve' }, s).every((c) => c.pass)).toBe(true);
  });
});
