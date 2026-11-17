import type { Strategy } from '../config/strategy.js';
import type { Quoter } from '../market/quoter.js';
import { LAMPORTS } from '../market/pump.js';
import { sleep } from '../lib/util.js';
import { SlippageError, type Executor, type Fill } from './executor.js';

export const BASE_FEE_SOL = 0.000005;
export const ATA_RENT_SOL = 0.00203928;

export interface WalletStore {
  load(): { balanceSol: number; startingSol: number };
  save(w: { balanceSol: number; startingSol: number }): void;
}

/**
 * Virtual wallet with fills from real market state:
 * quote → wait simulated latency → re-quote (price moved meanwhile) → fill at the second quote.
 * Not modelled: dropped/failed txs, MEV, our own price impact on later ticks.
 */
export class PaperExecutor implements Executor {
  readonly mode = 'paper' as const;
  private w: { balanceSol: number; startingSol: number };

  constructor(private quoter: Quoter, private store: WalletStore, private strategy: () => Strategy) {
    this.w = store.load();
  }

  balanceSol() {
    return this.w.balanceSol;
  }

  startingSol() {
    return this.w.startingSol;
  }

  reset(startingSol: number) {
    this.w = { balanceSol: startingSol, startingSol };
    this.store.save(this.w);
  }

  private txFee(s: Strategy) {
    return BASE_FEE_SOL + s.priorityFeeSol + s.jitoTipSol;
  }

  async buy(mint: string, sol: number, decimals: number): Promise<Fill> {
    const s = this.strategy();
    const slippageBps = Math.round(s.maxSlippagePct * 100);
    const lamports = BigInt(Math.floor(sol * LAMPORTS));
    const q0 = await this.quoter.quoteBuy(mint, lamports, decimals, s.pumpFeeBps, slippageBps);
    const t0 = performance.now();
    await sleep(s.simulatedLatencyMs);
    const q1 = await this.quoter.quoteBuy(mint, lamports, decimals, s.pumpFeeBps, slippageBps);
    const latencyMs = Math.round(performance.now() - t0);
    if (q1.outRaw <= 0n) throw new Error('quote returned zero tokens');
    const slippagePct = q0.outRaw > 0n ? (Number(q0.outRaw - q1.outRaw) / Number(q0.outRaw)) * 100 : 0;
    if (slippagePct > s.maxSlippagePct) throw new SlippageError(`slippage ${slippagePct.toFixed(2)}% > ${s.maxSlippagePct}%`);

    const feeSol = this.txFee(s) + ATA_RENT_SOL;
    if (this.w.balanceSol < sol + feeSol) throw new Error('insufficient paper balance');
    this.w.balanceSol -= sol + feeSol;
    this.store.save(this.w);
    const tokens = Number(q1.outRaw) / 10 ** decimals;
    return { route: q1.route, sol, tokens, rawTokens: q1.outRaw, priceSol: sol / tokens, feeSol, impactPct: q1.impactPct, slippagePct, latencyMs };
  }

  async sell(mint: string, rawTokens: bigint, decimals: number, closeAccount: boolean): Promise<Fill> {
    const s = this.strategy();
    const slippageBps = Math.round(s.maxSlippagePct * 100);
    const q0 = await this.quoter.quoteSell(mint, rawTokens, decimals, s.pumpFeeBps, slippageBps);
    const t0 = performance.now();
    await sleep(s.simulatedLatencyMs);
    const q1 = await this.quoter.quoteSell(mint, rawTokens, decimals, s.pumpFeeBps, slippageBps);
    const latencyMs = Math.round(performance.now() - t0);
    const slippagePct = q0.outRaw > 0n ? (Number(q0.outRaw - q1.outRaw) / Number(q0.outRaw)) * 100 : 0;
    // Exits are not rejected on slippage: a stop loss must get out.
    const gross = Number(q1.outRaw) / LAMPORTS;
    const fee = this.txFee(s);
    const rentBack = closeAccount ? ATA_RENT_SOL : 0;
    const sol = gross - fee;
    this.w.balanceSol += sol + rentBack;
    this.store.save(this.w);
    const tokens = Number(rawTokens) / 10 ** decimals;
    return { route: q1.route, sol, tokens, rawTokens, priceSol: tokens > 0 ? gross / tokens : 0, feeSol: fee - rentBack, impactPct: q1.impactPct, slippagePct, latencyMs };
  }
}
