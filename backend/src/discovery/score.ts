/** Pure Discovery rules: bonding progress, board placement, trend score, filters. */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Pump.fun curves start with 793.1 M tokens for sale (6 decimals). */
const INITIAL_REAL_TOKENS = 793_100_000n * 1_000_000n;

export interface Market {
  priceUsd: number | null; mcUsd: number | null; liqUsd: number | null;
  vol5mUsd: number; vol1hUsd: number; buys5m: number; sells5m: number; change5mPct: number;
  socials: string[]; updatedAt: number;
}

export interface DiscoveredToken {
  mint: string; symbol: string; name: string; creator: string; createdAt: number;
  /** Dev's first buy as % of supply. */
  devBuyPct: number;
  firstMcSol: number;
  bondingPct: number; realSol: number;
  migratedAt: number | null;
  promoted: boolean;
  market: Market | null;
}

export type Board = 'new' | 'mid' | 'soon' | 'graduated' | 'old';
export interface DiscoveryFilter { minMc?: number; maxMc?: number; maxAgeMin?: number; socials?: boolean; maxDevPct?: number }

export function bondingPct(c: { realTokenReserves: bigint; complete: boolean }): number {
  if (c.complete) return 100;
  const left = Number(c.realTokenReserves) / Number(INITIAL_REAL_TOKENS);
  return Math.min(100, Math.max(0, (1 - left) * 100));
}

export function boardOf(t: DiscoveredToken, now: number): Board {
  if (t.migratedAt !== null) return now - t.migratedAt < DAY ? 'graduated' : 'old';
  if (t.bondingPct >= 70) return 'soon';
  if (t.bondingPct < 30) return 'new';
  return 'mid';
}

/**
 * 0–100 from DexScreener 5-min activity: volume (log), buy share, txns (log), price change.
 * Under 10 txns in 5 min = 0; younger than 5 min or under $5k liquidity = halved (easy to fake).
 */
export function trendScore(t: DiscoveredToken, now: number): number {
  const m = t.market;
  if (!m) return 0;
  const txns = m.buys5m + m.sells5m;
  if (txns < 10) return 0;
  const vol = Math.min(1, Math.log10(1 + m.vol5mUsd) / 6) * 40;
  const buys = (m.buys5m / txns) * 25;
  const tx = Math.min(1, Math.log10(1 + txns) / 3) * 20;
  const chg = ((Math.min(100, Math.max(-50, m.change5mPct)) + 50) / 150) * 15;
  const thin = now - t.createdAt < 5 * MIN || (m.liqUsd ?? 0) < 5_000;
  return Math.min(100, (vol + buys + tx + chg) * (thin ? 0.5 : 1));
}

/** Market-cap filters apply only once DexScreener has data; "has socials" needs that data too. */
export function passes(t: DiscoveredToken, f: DiscoveryFilter, now: number): boolean {
  const mc = t.market?.mcUsd ?? null;
  if (mc !== null && f.minMc !== undefined && mc < f.minMc) return false;
  if (mc !== null && f.maxMc !== undefined && mc > f.maxMc) return false;
  if (f.maxAgeMin !== undefined && now - t.createdAt > f.maxAgeMin * MIN) return false;
  if (f.socials && !(t.market?.socials.length)) return false;
  if (f.maxDevPct !== undefined && t.devBuyPct > f.maxDevPct) return false;
  return true;
}
