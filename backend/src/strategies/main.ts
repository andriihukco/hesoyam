import { DEFAULT_STRATEGY, presetValues, type Preset, type PresetValues } from '../config/strategy.js';
import { diffValues, type VersionRow } from './types.js';

const full = (v: Partial<PresetValues>): PresetValues => ({ ...presetValues(DEFAULT_STRATEGY), ...v });
const same = (a: Partial<PresetValues>, b: Partial<PresetValues>) => diffValues(full(a), full(b)).length === 0;

/**
 * Which version the main strategy's trades belong to. The version the user applied wins while the
 * settings still equal it (so an older version or a copy of a built-in is credited correctly);
 * otherwise the first preset with equal values; otherwise none (caller uses Custom).
 */
export function resolveMain(
  current: PresetValues,
  applied: VersionRow | undefined,
  presets: Preset[],
): { versionId: number | null; presetId: string | null } {
  if (applied && same(current, applied.values)) {
    return { versionId: applied.id, presetId: presets.some((p) => p.id === applied.strategyId) ? applied.strategyId : null };
  }
  const p = presets.find((x) => same(current, x.values));
  return p ? { versionId: p.versionId ?? null, presetId: p.id } : { versionId: null, presetId: null };
}
