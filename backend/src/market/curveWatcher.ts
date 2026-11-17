import { EventEmitter } from 'node:events';
import { PublicKey } from '@solana/web3.js';
import type { Rpc } from '../lib/rpc.js';
import { log } from '../lib/util.js';
import { bondingCurvePda, decodeCurve, spotPriceSol, LAMPORTS, type CurveState } from './pump.js';
import type { PumpTrade } from './pumpportalWs.js';

/**
 * Free trade feed: RPC websocket `accountSubscribe` on each token's bonding-curve account.
 * Every change is a trade; the SOL reserve delta gives side and size, reserves give exact price.
 * Batched trades in one slot arrive as one change (count is a lower bound).
 */
export class CurveWatcher extends EventEmitter {
  private subs = new Map<string, { id: number; last: CurveState | null }>();

  constructor(private rpc: Rpc) {
    super();
    rpc.on('changed', () => this.resubscribeAll());
  }

  get tracked() {
    return this.subs.size;
  }

  get connected() {
    return this.rpc.pingMs !== null;
  }

  subscribe(mint: string) {
    if (this.subs.has(mint)) return;
    const entry = { id: -1, last: null as CurveState | null };
    this.subs.set(mint, entry);
    const pda = bondingCurvePda(new PublicKey(mint));
    entry.id = this.rpc.connection.onAccountChange(pda, (info) => {
      let c: CurveState;
      try {
        c = decodeCurve(info.data);
      } catch {
        return;
      }
      const prev = entry.last;
      entry.last = c;
      if (!prev) return;
      const dSol = Number(c.realSolReserves - prev.realSolReserves) / LAMPORTS;
      const dTok = Number(prev.realTokenReserves - c.realTokenReserves) / 1e6;
      if (dSol === 0 && !c.complete) return;
      this.emit('trade', {
        mint, txType: dSol >= 0 ? 'buy' : 'sell', solAmount: Math.abs(dSol), tokenAmount: Math.abs(dTok),
        priceSol: c.complete ? null : spotPriceSol(c), pool: c.complete ? 'complete' : 'pump', ts: Date.now(),
      } satisfies PumpTrade);
    }, { commitment: 'processed' });
    // Seed the baseline so the first change yields a delta.
    void this.rpc.connection.getAccountInfo(pda, 'processed').then((i) => {
      if (i && !entry.last) entry.last = decodeCurve(i.data);
    }).catch(() => {});
  }

  unsubscribe(mint: string) {
    const e = this.subs.get(mint);
    if (!e) return;
    this.subs.delete(mint);
    void this.rpc.connection.removeAccountChangeListener(e.id).catch(() => {});
  }

  private resubscribeAll() {
    const mints = [...this.subs.keys()];
    this.subs.clear(); // old connection is dropped with its listeners
    for (const m of mints) this.subscribe(m);
    log('curve', `resubscribed ${mints.length} curves on new RPC`);
  }
}
