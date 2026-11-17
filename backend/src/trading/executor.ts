import type { Route } from '../types.js';

export interface Fill {
  route: Route;
  /** Buy: SOL spent excl. fees. Sell: SOL received after fees, excl. rent refund. */
  sol: number;
  /** Whole tokens bought or sold. */
  tokens: number;
  rawTokens: bigint;
  priceSol: number;
  /** Network + priority + tip (+ ATA rent on open, negative rent on close). */
  feeSol: number;
  impactPct: number;
  slippagePct: number;
  latencyMs: number;
}

export interface Executor {
  readonly mode: 'paper' | 'live';
  balanceSol(): number;
  buy(mint: string, sol: number, decimals: number): Promise<Fill>;
  sell(mint: string, rawTokens: bigint, decimals: number, closeAccount: boolean): Promise<Fill>;
}

export class SlippageError extends Error {}
