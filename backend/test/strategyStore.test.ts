import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/db.js';
import { BUILT_IN_PRESETS, DEFAULT_STRATEGY, presetValues, type Preset } from '../src/config/strategy.js';
import { StrategyStore } from '../src/strategies/store.js';
import { diffValues } from '../src/strategies/types.js';

const fresh = () => {
  let t = 1000;
  const db = new Db(':memory:');
  return { db, store: new StrategyStore(db, () => (t += 1000)) };
};
const base = presetValues(DEFAULT_STRATEGY);
const saved: Preset = { id: 'user-my-pick', name: 'My pick', description: 'd', builtIn: false, values: { ...base, buyAmountSol: 0.2 } };

function addPosition(db: Db, o: { lane?: string | null; preset?: string | null; opened: number }) {
  db.sql
    .prepare(
      `INSERT INTO positions(mint, mode, route, status, opened_at, decimals, cost_sol, entry_price, initial_tokens, tokens_held,
        realized_sol, ladder_done, peak_price, last_price, last_activity_at, preset, lane)
       VALUES('m', 'paper', 'pump-curve', 'closed', ?, 6, 0.1, 1, 1, 0, 0.1, 0, 1, 1, ?, ?, ?)`,
    )
    .run(o.opened, o.opened, o.preset ?? null, o.lane ?? null);
}
const versionIds = (db: Db) => (db.sql.prepare('SELECT version_id AS v FROM positions ORDER BY id').all() as { v: number | null }[]).map((r) => r.v);

describe('StrategyStore', () => {
  it('creates v1 for every built-in', () => {
    const { store } = fresh();
    store.ensureBuiltIns(BUILT_IN_PRESETS);
    const list = store.list();
    expect(list.map((s) => s.id).sort()).toEqual(BUILT_IN_PRESETS.map((p) => p.id).sort());
    for (const s of list) {
      expect(s.builtIn).toBe(true);
      expect(s.latest.version).toBe(1);
      expect(s.latest.stage).toBe('paper');
      expect(s.latest.parentId).toBeNull();
    }
    expect(store.list().find((s) => s.id === 'scalp')!.latest.values).toEqual(BUILT_IN_PRESETS.find((p) => p.id === 'scalp')!.values);
  });

  it('migration runs twice without duplicates', () => {
    const { db, store } = fresh();
    addPosition(db, { lane: 'scalp', opened: 50_000 });
    for (let i = 0; i < 2; i++) {
      store.ensureBuiltIns(BUILT_IN_PRESETS);
      store.migrateSavedPresets([saved]);
      store.backfillPositionVersions();
    }
    const n = (t: string) => (db.sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(n('strategies')).toBe(BUILT_IN_PRESETS.length + 1);
    expect(n('strategy_versions')).toBe(BUILT_IN_PRESETS.length + 1);
    expect(db.getSetting('presetsMigrated')).toBe(true);
  });

  it('changed built-in gets v2 and keeps v1', () => {
    const { store } = fresh();
    store.ensureBuiltIns(BUILT_IN_PRESETS);
    const v1 = store.versions('scalp')[0]!;
    const changed = BUILT_IN_PRESETS.map((p) => (p.id === 'scalp' ? { ...p, values: { ...p.values, hardStopLossPct: 9 } } : p));
    store.ensureBuiltIns(changed);
    const [v2, old] = store.versions('scalp');
    expect(v2!.version).toBe(2);
    expect(v2!.parentId).toBe(v1.id);
    expect(v2!.note).toBe('built-in updated');
    expect(v2!.values.hardStopLossPct).toBe(9);
    expect(old!.values).toEqual(v1.values);
  });

  it('identical values return latest without a new version', () => {
    const { store } = fresh();
    const v1 = store.create('Mine', '', base, 'user', 'first');
    const again = store.addVersion(v1.strategyId, { ...base }, 'user', 'same');
    expect(again.id).toBe(v1.id);
    expect(store.versions(v1.strategyId)).toHaveLength(1);
  });

  it('addVersion increments and diffValues lists the changed key', () => {
    const { store } = fresh();
    const v1 = store.create('Mine', '', base, 'user', '');
    const v2 = store.addVersion(v1.strategyId, { ...base, trailingStopPct: 22 }, 'optimizer', 'wider trail');
    expect(v2.version).toBe(2);
    expect(v2.author).toBe('optimizer');
    expect(v2.stage).toBe('draft');
    expect(diffValues(v1.values, v2.values)).toEqual([{ key: 'trailingStopPct', from: base.trailingStopPct, to: 22 }]);
  });

  it('diffValues treats the ladder as one key', () => {
    const b = { ...base, takeProfitLadder: [{ roiPct: 30, sellPct: 50 }] };
    expect(diffValues(base, b).map((d) => d.key)).toEqual(['takeProfitLadder']);
  });

  it('create rejects a duplicate name case-insensitively, archived included', () => {
    const { store } = fresh();
    const v = store.create('Mine', '', base, 'user', '');
    store.archive(v.strategyId);
    expect(() => store.create('MINE', '', base, 'user', '')).toThrow('name taken');
  });

  it('backfill maps lane, then preset name, then custom', () => {
    const { db, store } = fresh();
    store.ensureBuiltIns(BUILT_IN_PRESETS);
    store.migrateSavedPresets([saved]);
    addPosition(db, { lane: 'scalp', opened: 999_999 });
    addPosition(db, { preset: 'My pick', opened: 999_999 });
    addPosition(db, { opened: 999_999 });
    expect(store.backfillPositionVersions()).toBe(3);
    const [a, b, c] = versionIds(db);
    expect(store.get(a!)!.strategyId).toBe('scalp');
    expect(store.get(b!)!.strategyId).toBe('user-my-pick');
    expect(store.get(c!)!.strategyId).toBe('custom');
    expect(store.get(c!)!.values).toEqual(base);
  });

  it('backfill picks the version that existed when the position opened', () => {
    const { db, store } = fresh();
    store.ensureBuiltIns(BUILT_IN_PRESETS); // v1 created at ~2000..8000
    const v1 = store.versions('scalp')[0]!;
    addPosition(db, { lane: 'scalp', opened: v1.createdAt + 1 });
    store.addVersion('scalp', { ...v1.values, hardStopLossPct: 9 }, 'user', '');
    store.backfillPositionVersions();
    expect(versionIds(db)[0]).toBe(v1.id);
  });

  it('archive refuses a built-in and hides archived from list', () => {
    const { store } = fresh();
    store.ensureBuiltIns(BUILT_IN_PRESETS);
    expect(() => store.archive('scalp')).toThrow('built-in');
    const v = store.create('Gone', '', base, 'user', '');
    store.archive(v.strategyId);
    expect(store.list().some((s) => s.id === v.strategyId)).toBe(false);
    expect(store.list(true).some((s) => s.id === v.strategyId)).toBe(true);
  });

  it('setStage updates only the stage', () => {
    const { store } = fresh();
    const v = store.create('Mine', '', base, 'user', '');
    store.setStage(v.id, 'retired');
    expect(store.get(v.id)!.stage).toBe('retired');
    expect(store.get(v.id)!.values).toEqual(base);
  });
});
