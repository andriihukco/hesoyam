import type { Strategy } from '../config/strategy.js';

export interface GuardInput {
  killSwitch: boolean;
  openPositions: number;
  hasPositionInMint: boolean;
  balanceSol: number;
  dailyPnlSol: number;
}

/** Returns a reason to block the buy, or null when allowed. */
export function buyBlocked(g: GuardInput, s: Strategy, estFeesSol: number): string | null {
  if (g.killSwitch) return 'kill switch is on';
  if (g.hasPositionInMint) return 'already holding this token';
  if (g.openPositions >= s.maxOpenPositions) return `max open positions (${s.maxOpenPositions})`;
  if (g.dailyPnlSol <= -s.maxDailyLossSol) return `daily loss limit hit (${g.dailyPnlSol.toFixed(3)} SOL)`;
  if (g.balanceSol < s.buyAmountSol + estFeesSol) return `insufficient balance (${g.balanceSol.toFixed(3)} SOL)`;
  return null;
}
