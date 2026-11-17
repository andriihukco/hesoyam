import { PublicKey } from '@solana/web3.js';
import { env } from '../config/env.js';
import type { Rpc } from '../lib/rpc.js';
import { fetchJson } from '../lib/util.js';
import type { Route } from '../types.js';
import { bondingCurvePda, curveBuyOut, curveSellOut, decodeCurve, spotPriceSol, LAMPORTS, PUMP_PROGRAM_ID, type CurveState } from './pump.js';

export const WSOL = 'So11111111111111111111111111111111111111112';

export interface Quote {
  route: Route;
  inRaw: bigint;
  outRaw: bigint;
  /** Price impact vs. spot, percent (positive = worse). */
  impactPct: number;
  /** Mid/spot price in SOL per whole token when known. */
  spotPriceSol: number | null;
}

export interface Quoter {
  route(mint: string): Promise<Route>;
  quoteBuy(mint: string, lamports: bigint, decimals: number, feeBps: number, slippageBps: number): Promise<Quote>;
  quoteSell(mint: string, rawTokens: bigint, decimals: number, feeBps: number, slippageBps: number): Promise<Quote>;
}

interface JupQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
}

/**
 * Bonding curve (not complete) → exact curve math from on-chain state.
 * Anything else (PumpSwap, Raydium, …) → Jupiter quote.
 */
export class MarketQuoter implements Quoter {
  constructor(private rpc: Rpc) {}

  async curve(mint: string): Promise<CurveState | null> {
    const info = await this.rpc.connection.getAccountInfo(bondingCurvePda(new PublicKey(mint)));
    if (!info || !info.owner.equals(PUMP_PROGRAM_ID)) return null;
    return decodeCurve(info.data);
  }

  async route(mint: string): Promise<Route> {
    const c = await this.curve(mint);
    return c && !c.complete ? 'pump-curve' : 'jupiter';
  }

  async quoteBuy(mint: string, lamports: bigint, decimals: number, feeBps: number, slippageBps: number): Promise<Quote> {
    const c = await this.curve(mint);
    if (c && !c.complete) {
      const out = curveBuyOut(c, lamports, feeBps);
      const spot = spotPriceSol(c);
      const eff = Number(lamports) / LAMPORTS / (Number(out) / 10 ** decimals);
      return { route: 'pump-curve', inRaw: lamports, outRaw: out, impactPct: (eff / spot - 1) * 100, spotPriceSol: spot };
    }
    const q = await this.jupiter(WSOL, mint, lamports, slippageBps);
    return { route: 'jupiter', inRaw: lamports, outRaw: BigInt(q.outAmount), impactPct: Number(q.priceImpactPct) * 100, spotPriceSol: null };
  }

  async quoteSell(mint: string, rawTokens: bigint, decimals: number, feeBps: number, slippageBps: number): Promise<Quote> {
    const c = await this.curve(mint);
    if (c && !c.complete) {
      const out = curveSellOut(c, rawTokens, feeBps);
      const spot = spotPriceSol(c);
      const eff = Number(out) / LAMPORTS / (Number(rawTokens) / 10 ** decimals);
      return { route: 'pump-curve', inRaw: rawTokens, outRaw: out, impactPct: (1 - eff / spot) * 100, spotPriceSol: spot };
    }
    const q = await this.jupiter(mint, WSOL, rawTokens, slippageBps);
    return { route: 'jupiter', inRaw: rawTokens, outRaw: BigInt(q.outAmount), impactPct: Number(q.priceImpactPct) * 100, spotPriceSol: null };
  }

  private jupiter(input: string, output: string, amount: bigint, slippageBps: number) {
    const url = `${env.JUPITER_API_URL}/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=${slippageBps}`;
    const headers: Record<string, string> = env.JUPITER_API_KEY ? { 'x-api-key': env.JUPITER_API_KEY } : {};
    return fetchJson<JupQuote>(url, { headers, timeoutMs: 5000 });
  }
}
