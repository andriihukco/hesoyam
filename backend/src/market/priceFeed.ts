import { EventEmitter } from 'node:events';
import type { PumpTrade } from './pumpportalWs.js';

export interface TradeSource {
  subscribe(mint: string): void;
  unsubscribe(mint: string): void;
  on(ev: 'trade', fn: (t: PumpTrade) => void): unknown;
  readonly tracked: number;
  readonly connected: boolean;
}

interface MintState {
  trades: { ts: number; side: string; sol: number }[];
  priceSol: number | null;
  lastTradeAt: number | null;
  trackedSince: number;
}

/** Live per-mint price + trade stats from PumpPortal trades (curve and PumpSwap). */
export class PriceFeed extends EventEmitter {
  private mints = new Map<string, MintState>();

  constructor(readonly source: TradeSource, readonly sourceName: string) {
    super();
    source.on('trade', (t: PumpTrade) => this.onTrade(t));
  }

  track(mint: string) {
    if (!this.mints.has(mint)) this.mints.set(mint, { trades: [], priceSol: null, lastTradeAt: null, trackedSince: Date.now() });
    this.source.subscribe(mint);
  }

  untrack(mint: string) {
    this.mints.delete(mint);
    this.source.unsubscribe(mint);
  }

  isTracked(mint: string) {
    return this.mints.has(mint);
  }

  trackedSince(mint: string): number | null {
    return this.mints.get(mint)?.trackedSince ?? null;
  }

  price(mint: string): number | null {
    return this.mints.get(mint)?.priceSol ?? null;
  }

  lastTradeAt(mint: string): number | null {
    return this.mints.get(mint)?.lastTradeAt ?? null;
  }

  /** Externally sourced price (e.g. Jupiter poll for graduated tokens). */
  setPrice(mint: string, priceSol: number, activity: boolean) {
    const s = this.mints.get(mint);
    if (!s) return;
    s.priceSol = priceSol;
    if (activity) s.lastTradeAt = Date.now();
    this.emit('price', mint, priceSol);
  }

  stats(mint: string, windowMs = 60_000, now = Date.now()) {
    const s = this.mints.get(mint);
    const recent = (s?.trades ?? []).filter((t) => now - t.ts <= windowMs);
    return {
      trades: recent.length,
      buyVolSol: recent.filter((t) => t.side === 'buy').reduce((a, t) => a + t.sol, 0),
      sellVolSol: recent.filter((t) => t.side === 'sell').reduce((a, t) => a + t.sol, 0),
      observedMs: s ? now - s.trackedSince : 0,
    };
  }

  /** Trade flow strictly after `sinceMs` (signal recorder: flow between two samples). */
  flowSince(mint: string, sinceMs: number) {
    const recent = (this.mints.get(mint)?.trades ?? []).filter((t) => t.ts > sinceMs);
    return {
      trades: recent.length,
      buySol: recent.filter((t) => t.side === 'buy').reduce((a, t) => a + t.sol, 0),
      sellSol: recent.filter((t) => t.side === 'sell').reduce((a, t) => a + t.sol, 0),
    };
  }

  private onTrade(t: PumpTrade) {
    const s = this.mints.get(t.mint);
    if (!s) return;
    s.trades.push({ ts: t.ts, side: t.txType, sol: t.solAmount });
    if (s.trades.length > 2000) s.trades.splice(0, s.trades.length - 2000);
    s.lastTradeAt = t.ts;
    if (t.priceSol) s.priceSol = t.priceSol;
    this.emit('price', t.mint, s.priceSol);
  }
}
