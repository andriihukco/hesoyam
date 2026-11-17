import type { Strategy } from '../config/strategy.js';
import type { Position } from '../types.js';

export interface ExitAction {
  tokens: number;
  reason: string;
  closeAll: boolean;
  /** Set when this sell completes a ladder step (new ladderDone value). */
  ladderStep?: number;
}

/** Below this share of the original size, a partial sell takes everything (avoid dust). */
const DUST_SHARE = 0.01;
/** Float tolerance so exactly -20% / +50% hit their thresholds. */
const EPS = 1e-9;

/**
 * Pure exit rules, checked in priority order:
 * 1. hard stop loss, 2. stagnation, 3. next take-profit ladder step,
 * 4. trailing stop (only after all ladder steps are done).
 */
export function evaluateExit(p: Position, priceSol: number, now: number, s: Strategy): { peak: number; action: ExitAction | null } {
  const peak = Math.max(p.peakPriceSol, priceSol);
  if (p.status !== 'open' || p.tokensHeld <= 0 || p.entryPriceSol <= 0) return { peak, action: null };

  const roiPct = (priceSol / p.entryPriceSol - 1) * 100;
  const all = (reason: string): ExitAction => ({ tokens: p.tokensHeld, reason, closeAll: true });

  if (roiPct <= -s.hardStopLossPct + EPS) return { peak, action: all(`hard stop ${roiPct.toFixed(1)}%`) };

  const idleSec = (now - p.lastActivityAt) / 1000;
  if (idleSec >= s.stagnationSec) return { peak, action: all(`stagnant ${Math.round(idleSec)}s`) };

  const ladder = [...s.takeProfitLadder].sort((a, b) => a.roiPct - b.roiPct);
  const next = ladder[p.ladderDone];
  if (next && roiPct >= next.roiPct - EPS) {
    const want = (p.initialTokens * next.sellPct) / 100;
    const tokens = Math.min(p.tokensHeld, want);
    const closeAll = p.tokensHeld - tokens <= p.initialTokens * DUST_SHARE;
    return {
      peak,
      action: {
        tokens: closeAll ? p.tokensHeld : tokens,
        reason: `TP${p.ladderDone + 1} +${roiPct.toFixed(1)}% (sell ${next.sellPct}%)`,
        closeAll,
        ladderStep: p.ladderDone + 1,
      },
    };
  }

  if (p.ladderDone >= ladder.length) {
    const drawdownPct = (1 - priceSol / peak) * 100;
    if (drawdownPct >= s.trailingStopPct - EPS) return { peak, action: all(`trailing stop -${drawdownPct.toFixed(1)}% from peak`) };
  }
  return { peak, action: null };
}
