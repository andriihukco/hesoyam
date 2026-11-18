import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/db.js';

const cols = (db: Db, t: string) => (db.sql.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

describe('schema for strategy versions and recording', () => {
  const db = new Db(':memory:');

  it('creates the new tables with the spec columns', () => {
    expect(cols(db, 'strategies')).toEqual(['id', 'name', 'description', 'built_in', 'archived', 'created_at']);
    expect(cols(db, 'strategy_versions')).toEqual(['id', 'strategy_id', 'version', 'parent_id', 'values_json', 'author', 'note', 'stage', 'created_at']);
    expect(cols(db, 'signal_paths')).toEqual(['mint', 'ts', 'price', 'trades', 'buy_sol', 'sell_sol']);
    expect(cols(db, 'signal_facts')).toEqual(['mint', 'decimals', 'route_at_first', 'mint_auth_off', 'freeze_auth_off', 'top10_pct', 'rugcheck', 'captured_at']);
    expect(cols(db, 'replay_runs')).toEqual(['id', 'version_id', 'from_ts', 'to_ts', 'split', 'metrics', 'created_at']);
    expect(cols(db, 'agent_events')).toEqual(['id', 'ts', 'agent', 'kind', 'version_id', 'detail']);
  });

  it('adds version_id to positions', () => {
    expect(cols(db, 'positions')).toContain('version_id');
  });

  it('rejects a duplicate (strategy_id, version)', () => {
    db.sql.exec(`INSERT INTO strategies(id, name, description, built_in, created_at) VALUES('s', 'S', '', 0, 1)`);
    const ins = () => db.sql.exec(`INSERT INTO strategy_versions(strategy_id, version, values_json, author, note, stage, created_at) VALUES('s', 1, '{}', 'user', '', 'draft', 1)`);
    ins();
    expect(ins).toThrow();
  });

  it('rejects an unknown author', () => {
    expect(() => db.sql.exec(`INSERT INTO strategy_versions(strategy_id, version, values_json, author, note, stage, created_at) VALUES('s', 2, '{}', 'robot', '', 'draft', 1)`)).toThrow();
  });
});
