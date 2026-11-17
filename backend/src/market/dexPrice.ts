import { env } from '../config/env.js';
import { fetchJson, memo } from '../lib/util.js';

interface Pair {
  quoteToken?: { symbol?: string };
  priceNative?: string;
  liquidity?: { usd?: number };
}

/**
 * Spot price in SOL per token from the deepest SOL-quoted pool on DexScreener.
 * Fallback mark when Jupiter rate-limits; ignores our own size impact, so it is slightly optimistic.
 */
export function dexPriceSol(mint: string): Promise<number> {
  return memo(`dexpx:${mint}`, 2_500, async () => {
    const data = await fetchJson<Pair[] | { pairs?: Pair[] }>(`${env.DEXSCREENER_API_URL}/tokens/v1/solana/${mint}`, { timeoutMs: 4000 });
    const pairs = (Array.isArray(data) ? data : (data.pairs ?? []))
      .filter((p) => p.quoteToken?.symbol === 'SOL' && Number(p.priceNative) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const px = Number(pairs[0]?.priceNative);
    if (!(px > 0)) throw new Error('no SOL pool on DexScreener');
    return px;
  });
}
