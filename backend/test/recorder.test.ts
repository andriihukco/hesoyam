import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/db.js';
import { SignalRecorder } from '../src/recording/recorder.js';
import { captureFacts } from '../src/recording/facts.js';

type PathRow = { mint: string; ts: number; price: number | null; trades: number; buy_sol: number; sell_sol: number };

function setup() {
  const db = new Db(':memory:');
  const clock = { t: 1_000_000 };
  const released: string[] = [];
  const flowCalls: number[] = [];
  let price = 1;
  const rec = new SignalRecorder({
    db,
    now: () => clock.t,
    pollPrice: async () => price,
    flow: (_m, since) => {
      flowCalls.push(since);
      return { trades: 2, buySol: 0.5, sellSol: 0.1 };
    },
    release: (m) => released.push(m),
  });
  const rows = () => db.sql.prepare('SELECT * FROM signal_paths ORDER BY ts').all() as PathRow[];
  return { db, clock, rec, rows, released, flowCalls, setPrice: (p: number) => (price = p) };
}

describe('SignalRecorder', () => {
  it('throttles curve samples to 1 per second', () => {
    const { clock, rec, rows } = setup();
    rec.start('A', 'pump-curve');
    for (let i = 0; i < 5; i++) {
      clock.t += 180;
      rec.onPrice('A', 1 + i);
    }
    expect(rows()).toHaveLength(1);
    clock.t += 1000;
    rec.onPrice('A', 9);
    expect(rows().map((r) => r.price)).toEqual([1, 9]);
  });

  it('ignores prices for mints it is not recording', () => {
    const { rec, rows } = setup();
    rec.onPrice('Z', 1);
    expect(rows()).toHaveLength(0);
  });

  it('polls graduated every 10 s', async () => {
    const { clock, rec, rows } = setup();
    rec.start('G', 'jupiter');
    await rec.tick();
    clock.t += 5_000;
    await rec.tick();
    clock.t += 5_000;
    await rec.tick();
    expect(rows()).toHaveLength(2);
  });

  it('stops after 30 min and calls release once', async () => {
    const { clock, rec, released } = setup();
    rec.start('A', 'pump-curve');
    clock.t += 30 * 60_000 - 1;
    await rec.tick();
    expect(rec.isRecording('A')).toBe(true);
    clock.t += 1;
    await rec.tick();
    await rec.tick();
    expect(rec.isRecording('A')).toBe(false);
    expect(released).toEqual(['A']);
  });

  it('flow columns are deltas since the last sample', () => {
    const { clock, rec, rows, flowCalls } = setup();
    const t0 = clock.t;
    rec.start('A', 'pump-curve');
    clock.t += 1500;
    rec.onPrice('A', 1);
    clock.t += 1500;
    rec.onPrice('A', 2);
    expect(flowCalls).toEqual([t0, t0 + 1500]);
    expect(rows()[0]).toMatchObject({ trades: 2, buy_sol: 0.5, sell_sol: 0.1 });
  });

  it('start is idempotent', () => {
    const { clock, rec, rows } = setup();
    rec.start('A', 'pump-curve');
    clock.t += 1500;
    rec.onPrice('A', 1);
    rec.start('A', 'pump-curve');
    rec.onPrice('A', 2);
    expect(rows()).toHaveLength(1);
  });

  it('prune deletes rows older than 90 days only', () => {
    const { db, clock, rec } = setup();
    const ins = db.sql.prepare('INSERT INTO signal_paths(mint, ts, price, trades, buy_sol, sell_sol) VALUES(?, ?, 1, 0, 0, 0)');
    const day = 86_400_000;
    ins.run('old', clock.t - 90 * day - 1);
    ins.run('new', clock.t - 90 * day + 1);
    expect(rec.prune()).toBe(1);
    expect((db.sql.prepare('SELECT mint FROM signal_paths').all() as { mint: string }[]).map((r) => r.mint)).toEqual(['new']);
  });
});

describe('captureFacts', () => {
  const facts = (db: Db) => db.sql.prepare('SELECT * FROM signal_facts').all() as Record<string, unknown>[];

  it('writes authorities, top10 and rugcheck', async () => {
    const db = new Db(':memory:');
    await captureFacts({
      db, now: () => 5,
      loadMint: async () => ({ decimals: 6, supply: 1n, mintAuthority: null, freezeAuthority: 'X' }),
      top10: async () => 22.5,
      rugcheck: async () => ({ score: 3 }),
    }, 'M', 'pump-curve');
    expect(facts(db)[0]).toMatchObject({
      mint: 'M', decimals: 6, route_at_first: 'pump-curve', mint_auth_off: 1, freeze_auth_off: 0, top10_pct: 22.5,
      rugcheck: '{"score":3}', captured_at: 5,
    });
  });

  it('writes a row with nulls when rpc throws, and keeps the first row', async () => {
    const db = new Db(':memory:');
    const boom = async () => { throw new Error('429'); };
    await captureFacts({ db, now: () => 5, loadMint: boom, top10: boom, rugcheck: boom }, 'M', 'jupiter');
    expect(facts(db)[0]).toMatchObject({ decimals: null, mint_auth_off: null, top10_pct: null, rugcheck: null, route_at_first: 'jupiter' });
    await captureFacts({
      db, now: () => 9,
      loadMint: async () => ({ decimals: 6, supply: 1n, mintAuthority: null, freezeAuthority: null }),
      top10: async () => 1, rugcheck: async () => ({}),
    }, 'M', 'jupiter');
    expect(facts(db)).toHaveLength(1);
  });
});
