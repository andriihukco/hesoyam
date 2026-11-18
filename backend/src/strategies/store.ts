import { DEFAULT_STRATEGY, presetValues, type Preset, type PresetValues } from '../config/strategy.js';
import type { Db } from '../db/db.js';
import { slug } from '../lib/util.js';
import { diffValues, type Author, type Stage, type StrategyRow, type VersionRow } from './types.js';

type Row = Record<string, unknown>;

const toStrategy = (r: Row): StrategyRow => ({
  id: r.id as string, name: r.name as string, description: r.description as string,
  builtIn: r.built_in === 1, archived: r.archived === 1, createdAt: r.created_at as number,
});

const toVersion = (r: Row): VersionRow => ({
  id: r.id as number, strategyId: r.strategy_id as string, version: r.version as number,
  parentId: (r.parent_id as number | null) ?? null, values: JSON.parse(r.values_json as string) as PresetValues,
  author: r.author as Author, note: r.note as string, stage: r.stage as Stage, createdAt: r.created_at as number,
});

/** Versions written by the user trade right away; agent versions start as drafts and must pass the gates. */
const stageFor = (author: Author): Stage => (author === 'user' ? 'paper' : 'draft');

export const CUSTOM_ID = 'custom';

export class StrategyStore {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  private insertStrategy(id: string, name: string, description: string, builtIn: boolean) {
    this.db.sql
      .prepare('INSERT INTO strategies(id, name, description, built_in, created_at) VALUES(?, ?, ?, ?, ?)')
      .run(id, name, description, builtIn ? 1 : 0, this.now());
  }

  private insertVersion(strategyId: string, version: number, parentId: number | null, values: PresetValues, author: Author, note: string): VersionRow {
    const r = this.db.sql
      .prepare(`INSERT INTO strategy_versions(strategy_id, version, parent_id, values_json, author, note, stage, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(strategyId, version, parentId, JSON.stringify(values), author, note, stageFor(author), this.now());
    return this.get(Number(r.lastInsertRowid))!;
  }

  private strategy(id: string): StrategyRow | undefined {
    const r = this.db.sql.prepare('SELECT * FROM strategies WHERE id = ?').get(id) as Row | undefined;
    return r ? toStrategy(r) : undefined;
  }

  private latest(strategyId: string): VersionRow | undefined {
    const r = this.db.sql
      .prepare('SELECT * FROM strategy_versions WHERE strategy_id = ? ORDER BY version DESC LIMIT 1')
      .get(strategyId) as Row | undefined;
    return r ? toVersion(r) : undefined;
  }

  /** Built-ins get v1 once; when their values change in code, a new version is added (old trades keep theirs). */
  ensureBuiltIns(presets: Preset[]): void {
    for (const p of presets) {
      const values = p.values as PresetValues;
      if (!this.strategy(p.id)) {
        this.insertStrategy(p.id, p.name, p.description, true);
        this.insertVersion(p.id, 1, null, values, 'user', 'built-in');
        continue;
      }
      this.db.sql.prepare('UPDATE strategies SET name = ?, description = ? WHERE id = ?').run(p.name, p.description, p.id);
      const cur = this.latest(p.id)!;
      if (diffValues(cur.values, values).length) this.insertVersion(p.id, cur.version + 1, cur.id, values, 'user', 'built-in updated');
    }
  }

  /** Presets saved in settings before versions existed become strategies with v1. Idempotent. */
  migrateSavedPresets(saved: Preset[]): void {
    if (this.db.getSetting<boolean>('presetsMigrated')) return;
    for (const p of saved) {
      if (this.strategy(p.id)) continue;
      this.insertStrategy(p.id, p.name, p.description, false);
      this.insertVersion(p.id, 1, null, p.values as PresetValues, 'user', 'migrated preset');
    }
    this.db.setSetting('presetsMigrated', true);
  }

  private ensureCustom(): VersionRow {
    if (!this.strategy(CUSTOM_ID)) {
      this.insertStrategy(CUSTOM_ID, 'Custom', 'Settings that matched no preset.', true);
      return this.insertVersion(CUSTOM_ID, 1, null, presetValues(DEFAULT_STRATEGY), 'user', 'custom settings');
    }
    return this.latest(CUSTOM_ID)!;
  }

  /** Version that was current when a position opened; the oldest one if the position predates all versions. */
  private versionAt(strategyId: string, ts: number): VersionRow | undefined {
    const r = (this.db.sql
      .prepare('SELECT * FROM strategy_versions WHERE strategy_id = ? AND created_at <= ? ORDER BY version DESC LIMIT 1')
      .get(strategyId, ts) ??
      this.db.sql.prepare('SELECT * FROM strategy_versions WHERE strategy_id = ? ORDER BY version LIMIT 1').get(strategyId)) as Row | undefined;
    return r ? toVersion(r) : undefined;
  }

  /** Fill positions.version_id: by lane (strategy id), then preset name, else Custom. Returns rows updated. */
  backfillPositionVersions(): number {
    const rows = this.db.sql
      .prepare('SELECT id, lane, preset, opened_at FROM positions WHERE version_id IS NULL')
      .all() as { id: number; lane: string | null; preset: string | null; opened_at: number }[];
    const set = this.db.sql.prepare('UPDATE positions SET version_id = ? WHERE id = ?');
    for (const p of rows) {
      let sid = p.lane && this.strategy(p.lane) ? p.lane : null;
      if (!sid && p.preset) {
        const r = this.db.sql.prepare('SELECT id FROM strategies WHERE lower(name) = lower(?)').get(p.preset) as Row | undefined;
        sid = (r?.id as string | undefined) ?? null;
      }
      const v = sid ? this.versionAt(sid, p.opened_at) : this.ensureCustom();
      set.run(v!.id, p.id);
    }
    return rows.length;
  }

  list(includeArchived = false): (StrategyRow & { latest: VersionRow })[] {
    const rows = this.db.sql
      .prepare(`SELECT * FROM strategies ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY built_in DESC, created_at`)
      .all() as Row[];
    return rows.map((r) => ({ ...toStrategy(r), latest: this.latest(r.id as string)! }));
  }

  versions(strategyId: string): VersionRow[] {
    return (this.db.sql.prepare('SELECT * FROM strategy_versions WHERE strategy_id = ? ORDER BY version DESC').all(strategyId) as Row[]).map(toVersion);
  }

  get(versionId: number): VersionRow | undefined {
    const r = this.db.sql.prepare('SELECT * FROM strategy_versions WHERE id = ?').get(versionId) as Row | undefined;
    return r ? toVersion(r) : undefined;
  }

  create(name: string, description: string, values: PresetValues, author: Author, note: string): VersionRow {
    const n = name.trim().slice(0, 40);
    if (!n) throw new Error('name required');
    const taken = this.db.sql.prepare('SELECT 1 FROM strategies WHERE lower(name) = lower(?)').get(n);
    const id = `user-${slug(n)}`;
    if (taken || this.strategy(id)) throw new Error('name taken');
    this.insertStrategy(id, n, description.slice(0, 160), false);
    return this.insertVersion(id, 1, null, values, author, note);
  }

  addVersion(strategyId: string, values: PresetValues, author: Author, note: string): VersionRow {
    const cur = this.latest(strategyId);
    if (!cur) throw new Error('strategy not found');
    if (!diffValues(cur.values, values).length) return cur;
    return this.insertVersion(strategyId, cur.version + 1, cur.id, values, author, note.slice(0, 200));
  }

  setStage(versionId: number, stage: Stage): void {
    this.db.sql.prepare('UPDATE strategy_versions SET stage = ? WHERE id = ?').run(stage, versionId);
  }

  archive(strategyId: string): void {
    const s = this.strategy(strategyId);
    if (!s) throw new Error('strategy not found');
    if (s.builtIn) throw new Error('built-in strategies cannot be archived');
    this.db.sql.prepare('UPDATE strategies SET archived = 1 WHERE id = ?').run(strategyId);
  }
}
