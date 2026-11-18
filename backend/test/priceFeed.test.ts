import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { PriceFeed, type TradeSource } from '../src/market/priceFeed.js';

class FakeSource extends EventEmitter implements TradeSource {
  tracked = 0;
  connected = true;
  subscribe() {}
  unsubscribe() {}
}

describe('PriceFeed.flowSince', () => {
  it('sums trades strictly after the timestamp', () => {
    const src = new FakeSource();
    const feed = new PriceFeed(src, 'fake');
    feed.track('M');
    const t = (ts: number, txType: string, solAmount: number) => src.emit('trade', { mint: 'M', txType, solAmount, tokenAmount: 1, priceSol: 1, ts });
    t(100, 'buy', 1);
    t(200, 'buy', 2);
    t(300, 'sell', 0.5);
    expect(feed.flowSince('M', 100)).toEqual({ trades: 2, buySol: 2, sellSol: 0.5 });
    expect(feed.flowSince('X', 0)).toEqual({ trades: 0, buySol: 0, sellSol: 0 });
  });
});
