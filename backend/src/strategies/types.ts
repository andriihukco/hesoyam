import type { PresetValues } from '../config/strategy.js';

export type Author = 'user' | 'optimizer' | 'advisor';
export type Stage = 'draft' | 'replay-passed' | 'paper' | 'live-canary' | 'live' | 'retired';

export interface StrategyRow {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  archived: boolean;
  createdAt: number;
}

/** One immutable set of values. Edits create version + 1; values are never updated in place. */
export interface VersionRow {
  id: number;
  strategyId: string;
  version: number;
  parentId: number | null;
  values: PresetValues;
  author: Author;
  note: string;
  stage: Stage;
  createdAt: number;
}

export interface ValueDiff { key: string; from: unknown; to: unknown }

/** Keys whose values differ. Objects and arrays (the ladder) compare as one key. */
export function diffValues(a: PresetValues, b: PresetValues): ValueDiff[] {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])];
  return keys
    .filter((k) => JSON.stringify(ra[k]) !== JSON.stringify(rb[k]))
    .map((k) => ({ key: k, from: ra[k], to: rb[k] }));
}
