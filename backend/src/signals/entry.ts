import type { Strategy } from '../config/strategy.js';
import type { CheckResult, Route } from '../types.js';

export interface EntryFacts {
  ageSec: number;
  /** Current buy price vs the price at the first mention, in %; null if the first price is unknown. */
  runupPct: number | null;
  route: Route;
}

/** Entry-timing gates. All hard: once a token is too old or too pumped it will not improve. */
export function entryChecks(f: EntryFacts, s: Strategy): CheckResult[] {
  const out: CheckResult[] = [];
  if (s.routes !== 'any') {
    const want = s.routes === 'curve' ? 'pump-curve' : 'jupiter';
    out.push({ name: 'route filter', pass: f.route === want, hard: true, detail: `${f.route} (allowed: ${s.routes})` });
  }
  if (s.maxSignalAgeSec > 0) {
    out.push({ name: 'signal age', pass: f.ageSec <= s.maxSignalAgeSec, hard: true,
      detail: `${Math.round(f.ageSec)}s since first call (max ${s.maxSignalAgeSec}s)` });
  }
  if (s.maxRunupFromFirstPct > 0) {
    out.push(
      f.runupPct === null
        ? { name: 'run-up', pass: true, detail: 'first price unknown' }
        : { name: 'run-up', pass: f.runupPct <= s.maxRunupFromFirstPct, hard: true,
            detail: `${f.runupPct >= 0 ? '+' : ''}${f.runupPct.toFixed(0)}% since first call (max +${s.maxRunupFromFirstPct}%)` },
    );
  }
  return out;
}
