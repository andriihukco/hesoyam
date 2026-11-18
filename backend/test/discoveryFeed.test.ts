import { EventEmitter } from 'node:events';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/db.js';
import { DiscoveryStore } from '../src/discovery/store.js';
import { DiscoveryFeed, parseCreate, parseMigration, pickPair, type SocketLike } from '../src/discovery/feed.js';

class FakeSocket extends EventEmitter implements SocketLike {
  sent: string[] = [];
  send(s: string) { this.sent.push(s); }
  close() { this.emit('close'); }
}

const MINT = '7krcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApump';

describe('parsers', () => {
  it('parses a create event', () => {
    const t = parseCreate({
      txType: 'create', mint: MINT, traderPublicKey: 'DEV', initialBuy: 35_000_000, solAmount: 1,
      vTokensInBondingCurve: 1_073_000_000 - 35_000_000, vSolInBondingCurve: 31, marketCapSol: 29.9, name: 'Buckz', symbol: 'BUCKZ',
    }, 1000)!;
    expect(t).toMatchObject({ mint: MINT, symbol: 'BUCKZ', name: 'Buckz', creator: 'DEV', createdAt: 1000, firstMcSol: 29.9 });
    expect(t.devBuyPct).toBeCloseTo(3.5, 6);
    expect(t.bondingPct).toBeGreaterThan(4);
    expect(t.bondingPct).toBeLessThan(5);
    expect(t.realSol).toBeCloseTo(1, 6);
  });
  it('ignores non-create messages', () => {
    expect(parseCreate({ message: 'Successfully subscribed' }, 1)).toBeNull();
    expect(parseCreate({ txType: 'buy', mint: MINT }, 1)).toBeNull();
  });
  it('parses a migration event', () => {
    expect(parseMigration({ txType: 'migrate', mint: MINT, pool: 'pump-amm' }, 5)).toEqual({ mint: MINT, ts: 5 });
    expect(parseMigration({ txType: 'create', mint: MINT }, 5)).toBeNull();
  });
  it('picks the most liquid pair and maps it to market data', () => {
    const p = pickPair([
      { baseToken: { address: MINT, symbol: 'B', name: 'Bz' }, liquidity: { usd: 100 }, marketCap: 1, txns: { m5: { buys: 1, sells: 1 } }, volume: { m5: 1, h1: 2 }, priceChange: { m5: 1 }, priceUsd: '0.1' },
      { baseToken: { address: MINT, symbol: 'B', name: 'Bz' }, liquidity: { usd: 9000 }, marketCap: 25_000, txns: { m5: { buys: 30, sells: 10 } },
        volume: { m5: 4000, h1: 9000 }, priceChange: { m5: 12 }, priceUsd: '0.00002', info: { socials: [{ type: 'twitter' }], websites: [{ url: 'x' }] } },
    ], 77)!;
    expect(p.market).toEqual({ priceUsd: 0.00002, mcUsd: 25_000, liqUsd: 9000, vol5mUsd: 4000, vol1hUsd: 9000, buys5m: 30, sells5m: 10, change5mPct: 12, socials: ['twitter', 'web'], updatedAt: 77 });
    expect(p.names).toEqual({ symbol: 'B', name: 'Bz' });
  });
});

describe('DiscoveryFeed', () => {
  const mk = (over: Partial<ConstructorParameters<typeof DiscoveryFeed>[1]> = {}) => {
    const db = new Db(':memory:');
    const store = new DiscoveryStore(db, () => 1_000_000);
    const sockets: FakeSocket[] = [];
    const calls = { accounts: [] as number[], dex: [] as string[] };
    const feed = new DiscoveryFeed(store, {
      connect: () => { const s = new FakeSocket(); sockets.push(s); return s; },
      getAccounts: async (keys) => { calls.accounts.push(keys.length); return keys.map(() => null); },
      fetchJson: async (url) => { calls.dex.push(url); return []; },
      now: () => 1_000_000,
      schedule: (fn) => { fn(); return 0 as unknown as NodeJS.Timeout; },
      ...over,
    });
    return { store, feed, sockets, calls };
  };

  it('subscribes on open and resubscribes after reconnect', () => {
    const { feed, sockets } = mk({ schedule: (fn) => { queueMicrotask(fn); return 0 as unknown as NodeJS.Timeout; } });
    feed.connect();
    sockets[0]!.emit('open');
    expect(sockets[0]!.sent.map((s) => JSON.parse(s).method)).toEqual(['subscribeNewToken', 'subscribeMigration']);
    sockets[0]!.emit('close');
    return Promise.resolve().then(() => {
      expect(sockets).toHaveLength(2);
      sockets[1]!.emit('open');
      expect(sockets[1]!.sent.map((s) => JSON.parse(s).method)).toEqual(['subscribeNewToken', 'subscribeMigration']);
      feed.stop();
    });
  });

  it('feeds create and migration messages into the store', () => {
    const { feed, sockets, store } = mk();
    feed.connect();
    sockets[0]!.emit('message', JSON.stringify({ txType: 'create', mint: MINT, traderPublicKey: 'D', initialBuy: 0, vTokensInBondingCurve: 1_073_000_000, vSolInBondingCurve: 30, marketCapSol: 28, name: 'n', symbol: 's' }));
    expect(store.list('new', {}, 10).map((t) => t.mint)).toEqual([MINT]);
    sockets[0]!.emit('message', JSON.stringify({ txType: 'migrate', mint: MINT }));
    expect(store.list('graduated', {}, 10).map((t) => t.mint)).toEqual([MINT]);
    sockets[0]!.emit('message', 'not json');
    feed.stop();
  });

  it('refresh batches curve reads by 100 and DexScreener by 30', async () => {
    const { feed, store, calls } = mk();
    for (let i = 0; i < 250; i++) {
      store.addCreated({ mint: Keypair.generate().publicKey.toBase58(), symbol: '', name: '', creator: '', createdAt: 1_000_000 - i, devBuyPct: 0, firstMcSol: 0, bondingPct: 0, realSol: 0 });
    }
    await feed.refresh();
    expect(Math.max(...calls.accounts)).toBeLessThanOrEqual(100);
    expect(calls.accounts.reduce((a, b) => a + b, 0)).toBe(250);
    expect(calls.dex).toHaveLength(Math.ceil(250 / 30));
    expect(calls.dex.every((u) => u.split('/').at(-1)!.split(',').length <= 30)).toBe(true);
  });
});
