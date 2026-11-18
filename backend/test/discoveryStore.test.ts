import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/db.js';
import { DiscoveryStore } from '../src/discovery/store.js';
import type { Market } from '../src/discovery/score.js';

const MIN = 60_000;
const created = (mint: string, createdAt: number, o: Record<string, unknown> = {}) => ({
  mint, symbol: mint.toUpperCase(), name: mint, creator: 'dev', createdAt, devBuyPct: 2, firstMcSol: 30, bondingPct: 5, realSol: 0.5, ...o,
});
const market = (o: Partial<Market> = {}): Market => ({
  priceUsd: 0.001, mcUsd: 30_000, liqUsd: 9_000, vol5mUsd: 5_000, vol1hUsd: 9_000, buys5m: 50, sells5m: 20, change5mPct: 10, socials: ['x'], updatedAt: 0, ...o,
});

function setup(cap = 2000) {
  const clock = { t: 1_000 * MIN };
  const db = new Db(':memory:');
  return { db, clock, store: new DiscoveryStore(db, () => clock.t, cap) };
}

describe('DiscoveryStore', () => {
  it('adds and lists new tokens newest first, idempotent', () => {
    const { store, clock } = setup();
    store.addCreated(created('a', clock.t - 2 * MIN));
    store.addCreated(created('b', clock.t - MIN));
    store.addCreated(created('a', clock.t - 2 * MIN));
    expect(store.list('new', {}, 60).map((t) => t.mint)).toEqual(['b', 'a']);
  });

  it('migration moves a token to graduated, creating it if unknown', () => {
    const { store, clock } = setup();
    store.addCreated(created('a', clock.t - 10 * MIN));
    store.markMigrated('a', clock.t);
    store.markMigrated('z', clock.t);
    expect(store.list('new', {}, 60)).toEqual([]);
    expect(store.list('graduated', {}, 60).map((t) => t.mint).sort()).toEqual(['a', 'z']);
  });

  it('curve progress moves a token to about-to-graduate', () => {
    const { store, clock } = setup();
    store.addCreated(created('a', clock.t));
    store.applyCurve('a', 80, 60);
    expect(store.list('soon', {}, 60).map((t) => t.mint)).toEqual(['a']);
  });

  it('trending ranks by score and excludes promoted', () => {
    const { store, clock } = setup();
    store.addCreated(created('hot', clock.t - 30 * MIN));
    store.addCreated(created('warm', clock.t - 30 * MIN));
    store.addCreated(created('paid', clock.t - 30 * MIN));
    store.applyMarket('hot', market({ vol5mUsd: 90_000, buys5m: 400 }));
    store.applyMarket('warm', market());
    store.applyMarket('paid', market({ vol5mUsd: 900_000 }));
    store.setPromoted(['paid']);
    expect(store.list('trending', {}, 60).map((t) => t.mint)).toEqual(['hot', 'warm']);
    expect(store.list('promoted', {}, 60).map((t) => t.mint)).toEqual(['paid']);
  });

  it('cap drops oldest first', () => {
    const { store, clock } = setup(3);
    for (const [i, m] of ['a', 'b', 'c', 'd'].entries()) store.addCreated(created(m, clock.t - (10 - i) * MIN));
    expect(store.list('new', {}, 60).map((t) => t.mint)).toEqual(['d', 'c', 'b']);
  });

  it('prune drops curve tokens older than 24 h and graduates older than 24 h', () => {
    const { store, clock } = setup();
    store.addCreated(created('old', clock.t - 25 * 60 * MIN));
    store.addCreated(created('fresh', clock.t - MIN));
    store.addCreated(created('grad', clock.t - 30 * 60 * MIN));
    store.markMigrated('grad', clock.t - 25 * 60 * MIN);
    store.prune();
    expect(store.size).toBe(1);
  });

  it('survives a restart via the table', () => {
    const { store, db, clock } = setup();
    store.addCreated(created('a', clock.t - MIN));
    store.applyMarket('a', market());
    store.persist();
    const again = new DiscoveryStore(db, () => clock.t, 2000);
    again.load();
    expect(again.list('new', {}, 60)[0]).toMatchObject({ mint: 'a', market: { mcUsd: 30_000 } });
  });

  it('refreshCandidates puts tokens with trading activity above dead new launches', () => {
    const { store, clock } = setup();
    store.addCreated(created('quietOld', clock.t - 20 * 60 * MIN));
    store.addCreated(created('activeOld', clock.t - 20 * 60 * MIN));
    store.applyMarket('activeOld', market());
    store.addCreated(created('new', clock.t - MIN));
    expect(store.refreshCandidates(2)).toEqual(['activeOld', 'new']);
  });

  it('promoted tokens we never saw created stay off the curve boards', () => {
    const { store, clock } = setup();
    store.setPromoted(['ext']);
    store.applyCurve('ext', 100, 0);
    expect(store.list('soon', {}, 60)).toEqual([]);
    expect(store.list('new', {}, 60)).toEqual([]);
    expect(store.list('promoted', {}, 60).map((t) => t.mint)).toEqual(['ext']);
    void clock;
  });

  it('a created token whose curve completes counts as graduated', () => {
    const { store, clock } = setup();
    store.addCreated(created('a', clock.t - MIN));
    store.applyCurve('a', 100, 85, true);
    expect(store.list('soon', {}, 60)).toEqual([]);
    expect(store.list('graduated', {}, 60).map((t) => t.mint)).toEqual(['a']);
  });

  it('curve candidates put climbing coins first, then the newest', () => {
    const { store, clock } = setup();
    for (let i = 0; i < 5; i++) store.addCreated(created(`n${i}`, clock.t - i * 1000));
    store.addCreated(created('climber', clock.t - 40 * MIN));
    store.applyCurve('climber', 55, 30);
    store.addCreated(created('almost', clock.t - 90 * MIN));
    store.applyCurve('almost', 85, 70);
    expect(store.curveCandidates(4)).toEqual(['almost', 'climber', 'n0', 'n1']);
  });

  it('market candidates rank board coins above dead launches', () => {
    const { store, clock } = setup();
    for (let i = 0; i < 5; i++) store.addCreated(created(`n${i}`, clock.t - i * 1000));
    store.addCreated(created('soon', clock.t - 50 * MIN));
    store.applyCurve('soon', 80, 60);
    store.markMigrated('grad', clock.t - 30 * MIN);
    expect(store.refreshCandidates(3)).toEqual(['soon', 'grad', 'n0']);
  });

  it('cap evicts dead low-bonded launches before board coins, even older ones', () => {
    const { store, clock } = setup(3);
    store.addCreated(created('grad', clock.t - 10 * 60 * MIN));
    store.markMigrated('grad', clock.t - 60 * MIN);
    store.addCreated(created('soon', clock.t - 5 * 60 * MIN));
    store.applyCurve('soon', 80, 60);
    store.addCreated(created('dead1', clock.t - 2 * MIN));
    store.addCreated(created('dead2', clock.t - MIN));
    expect(store.size).toBe(3);
    expect(store.get('grad')).toBeDefined();
    expect(store.get('soon')).toBeDefined();
    expect(store.get('dead1')).toBeUndefined();
  });

  it('load skips a corrupt row instead of failing', () => {
    const { store, db, clock } = setup();
    store.addCreated(created('a', clock.t));
    store.persist();
    db.sql.prepare("INSERT INTO discovered_tokens VALUES('bad', '{not json', 0, ?)").run(clock.t);
    const again = new DiscoveryStore(db, () => clock.t, 2000);
    expect(() => again.load()).not.toThrow();
    expect(again.size).toBe(1);
  });
});
