import { env } from '../config/env.js';
import type { Strategy } from '../config/strategy.js';
import type { PriceFeed } from '../market/priceFeed.js';
import { errMsg, fetchJson, memo, sleep } from '../lib/util.js';
import type { CheckResult, Route } from '../types.js';

export type MomentumResult = CheckResult & { ratio: number; symbol?: string | null };

interface DexPair {
  baseToken?: { address: string; symbol?: string };
  txns?: { m5?: { buys: number; sells: number } };
  volume?: { m5?: number };
}

/** Pure: momentum from curve trade stats. */
export function curveMomentum(st: { trades: number; buyVolSol: number }, s: Strategy): MomentumResult {
  const tr = s.minTrades60s ? st.trades / s.minTrades60s : 1;
  const vr = s.minBuyVolumeSol60s ? st.buyVolSol / s.minBuyVolumeSol60s : 1;
  return {
    name: 'momentum',
    pass: tr >= 1 && vr >= 1,
    ratio: Math.min(1, (Math.min(tr, 1) + Math.min(vr, 1)) / 2),
    detail: `${st.trades} trades / ${st.buyVolSol.toFixed(2)} SOL bought in 60s (need ${s.minTrades60s} / ${s.minBuyVolumeSol60s})`,
  };
}

export async function momentum(mint: string, route: Route, feed: PriceFeed, s: Strategy): Promise<MomentumResult> {
  if (route === 'pump-curve') {
    // Make sure we watched the tape for a minimum time before judging.
    const since = feed.trackedSince(mint) ?? Date.now();
    const wait = s.momentumObserveSec * 1000 - (Date.now() - since);
    if (wait > 0) await sleep(wait);
    return curveMomentum(feed.stats(mint), s);
  }
  try {
    const data = await memo(`dex:${mint}`, 15_000, () =>
      fetchJson<DexPair[] | { pairs?: DexPair[] }>(`${env.DEXSCREENER_API_URL}/tokens/v1/solana/${mint}`, { timeoutMs: 4000 }));
    const pairs = Array.isArray(data) ? data : (data.pairs ?? []);
    const trades = pairs.reduce((a, p) => a + (p.txns?.m5?.buys ?? 0) + (p.txns?.m5?.sells ?? 0), 0);
    const volUsd = pairs.reduce((a, p) => a + (p.volume?.m5 ?? 0), 0);
    const tr = s.minTrades60s ? trades / (s.minTrades60s * 5) : 1;
    const vr = s.minGraduatedVolumeUsd5m ? volUsd / s.minGraduatedVolumeUsd5m : 1;
    return {
      name: 'momentum',
      pass: tr >= 1 && vr >= 1,
      ratio: Math.min(1, (Math.min(tr, 1) + Math.min(vr, 1)) / 2),
      detail: `${trades} txns / $${Math.round(volUsd)} in 5m (need ${s.minTrades60s * 5} / $${s.minGraduatedVolumeUsd5m})`,
      symbol: pairs[0]?.baseToken?.symbol ?? null,
    };
  } catch (e) {
    return { name: 'momentum', pass: false, ratio: 0, detail: `dexscreener unavailable: ${errMsg(e)}` };
  }
}
