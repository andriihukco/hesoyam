import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY, presetValues, type Preset } from '../src/config/strategy.js';
import { resolveMain } from '../src/strategies/main.js';
import type { VersionRow } from '../src/strategies/types.js';

const base = presetValues(DEFAULT_STRATEGY);
const ver = (id: number, strategyId: string, values = base): VersionRow => ({
  id, strategyId, version: 1, parentId: null, values, author: 'user', note: '', stage: 'paper', createdAt: 0,
});
const preset = (id: string, versionId: number, values = base): Preset => ({ id, name: id, description: '', builtIn: false, values, versionId, version: 1 });

describe('resolveMain', () => {
  it('credits the applied older version while settings still equal it', () => {
    const old = ver(3, 'scalp', { ...base, hardStopLossPct: 9 });
    const r = resolveMain(old.values, old, [preset('scalp', 4, base)]);
    expect(r).toEqual({ versionId: 3, presetId: 'scalp' });
  });

  it('credits a new strategy with the same values as a built-in to the new one', () => {
    const mine = ver(9, 'user-mine');
    const r = resolveMain(base, mine, [preset('default', 1), preset('user-mine', 9)]);
    expect(r).toEqual({ versionId: 9, presetId: 'user-mine' });
  });

  it('falls back to the first matching preset once settings no longer equal the applied version', () => {
    const r = resolveMain(base, ver(3, 'scalp', { ...base, hardStopLossPct: 9 }), [preset('default', 1)]);
    expect(r).toEqual({ versionId: 1, presetId: 'default' });
  });

  it('fills keys missing from a partial version with defaults before comparing', () => {
    const { minScore: _drop, ...partial } = base;
    const r = resolveMain(base, ver(5, 'user-old', partial as typeof base), []);
    expect(r.versionId).toBe(5);
  });

  it('returns nulls when nothing matches (caller uses Custom)', () => {
    expect(resolveMain({ ...base, minChannels: 4 }, undefined, [preset('default', 1)])).toEqual({ versionId: null, presetId: null });
  });
});
