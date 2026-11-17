import type { Strategy } from '../config/strategy.js';
import type { CheckResult } from '../types.js';

export interface ScoreInput {
  uniqueChannels: number;
  risk: CheckResult[];
  momentum: CheckResult & { ratio: number };
}

/**
 * Score 0–100: channels 40, risk 30, momentum 30.
 * Buying needs every gate to pass AND score >= minScore; the score alone never buys.
 */
export function score(input: ScoreInput, s: Strategy): { score: number; buy: boolean; failed: CheckResult[] } {
  const channelPart = 40 * Math.min(1, input.uniqueChannels / s.minChannels);
  const riskPart = input.risk.length ? (30 * input.risk.filter((r) => r.pass).length) / input.risk.length : 30;
  const momentumPart = 30 * Math.max(0, Math.min(1, input.momentum.ratio));
  const total = Math.round(channelPart + riskPart + momentumPart);

  const failed: CheckResult[] = [];
  if (input.uniqueChannels < s.minChannels) {
    failed.push({ name: 'channels', pass: false, detail: `${input.uniqueChannels}/${s.minChannels} channels in ${s.windowSec}s` });
  }
  failed.push(...input.risk.filter((r) => !r.pass));
  if (!input.momentum.pass) failed.push(input.momentum);
  if (total < s.minScore) failed.push({ name: 'score', pass: false, detail: `${total} < ${s.minScore}` });
  return { score: total, buy: failed.length === 0, failed };
}
