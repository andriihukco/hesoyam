import type { Db } from '../db/db.js';
import { boardOf, passes, trendScore, type Board, type DiscoveredToken, type DiscoveryFilter, type Market } from './score.js';

const DAY = 24 * 3_600_000;
const HOUR = 3_600_000;

export type DiscoveryBoard = Exclude<Board, 'mid' | 'old'> | 'trending' | 'promoted';
export type CreatedEvent = Omit<DiscoveredToken, 'migratedAt' | 'promoted' | 'market'>;

/** Discovered tokens: in memory for the boards, mirrored to SQLite so a restart keeps the last 24 h. */
export class DiscoveryStore {
  private tokens = new Map<string, DiscoveredToken>();
  private dirty = new Set<string>();
  private promoted: string[] = [];

  constructor(private readonly db: Db, private readonly now: () => number = Date.now, private readonly cap = 2000) {
    db.sql.exec(`CREATE TABLE IF NOT EXISTS discovered_tokens (
      mint TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, touched_at INTEGER NOT NULL)`);
  }

  get size(): number {
    return this.tokens.size;
  }

  load(): void {
    const rows = this.db.sql.prepare('SELECT data FROM discovered_tokens WHERE touched_at >= ?').all(this.now() - DAY) as { data: string }[];
    for (const r of rows) {
      const t = JSON.parse(r.data) as DiscoveredToken;
      this.tokens.set(t.mint, { ...t, promoted: false });
    }
    this.enforceCap();
  }

  private touch(mint: string) {
    this.dirty.add(mint);
  }

  addCreated(ev: CreatedEvent): void {
    if (this.tokens.has(ev.mint)) return;
    this.tokens.set(ev.mint, { ...ev, migratedAt: null, promoted: false, market: null });
    this.touch(ev.mint);
    this.enforceCap();
  }

  /** Placeholder for tokens first seen through a migration or a promotion. */
  ensure(mint: string, createdAt = this.now()): DiscoveredToken {
    let t = this.tokens.get(mint);
    if (!t) {
      t = { mint, symbol: '', name: '', creator: '', createdAt, devBuyPct: 0, firstMcSol: 0, bondingPct: 0, realSol: 0, migratedAt: null, promoted: false, market: null };
      this.tokens.set(mint, t);
      this.touch(mint);
      this.enforceCap();
    }
    return t;
  }

  markMigrated(mint: string, ts: number): void {
    const t = this.ensure(mint, ts);
    t.migratedAt = ts;
    t.bondingPct = 100;
    this.touch(mint);
  }

  applyCurve(mint: string, pct: number, realSol: number): void {
    const t = this.tokens.get(mint);
    if (!t) return;
    t.bondingPct = pct;
    t.realSol = realSol;
    this.touch(mint);
  }

  applyMarket(mint: string, m: Market, names?: { symbol?: string; name?: string }): void {
    const t = this.tokens.get(mint);
    if (!t) return;
    t.market = m;
    if (names?.symbol && !t.symbol) t.symbol = names.symbol;
    if (names?.name && !t.name) t.name = names.name;
    this.touch(mint);
  }

  setPromoted(mints: string[]): void {
    for (const t of this.tokens.values()) t.promoted = false;
    this.promoted = mints;
    for (const m of mints) this.ensure(m).promoted = true;
  }

  /** Tokens to refresh: everything younger than 2 h (newest first), then older ones with activity. */
  refreshCandidates(limit: number): string[] {
    const now = this.now();
    const live = [...this.tokens.values()].filter((t) => boardOf(t, now) !== 'old');
    const last = (t: DiscoveredToken) => Math.max(t.createdAt, t.migratedAt ?? 0);
    const recent = live.filter((t) => now - last(t) < 2 * HOUR || t.promoted).sort((a, b) => last(b) - last(a));
    const active = live.filter((t) => !recent.includes(t) && (t.market?.vol5mUsd ?? 0) > 0)
      .sort((a, b) => (b.market?.vol5mUsd ?? 0) - (a.market?.vol5mUsd ?? 0));
    return [...recent, ...active].slice(0, limit).map((t) => t.mint);
  }

  list(board: DiscoveryBoard, filter: DiscoveryFilter, limit: number): DiscoveredToken[] {
    const now = this.now();
    const all = [...this.tokens.values()].filter((t) => passes(t, filter, now));
    let out: DiscoveredToken[];
    if (board === 'promoted') {
      const order = new Map(this.promoted.map((m, i) => [m, i]));
      out = all.filter((t) => t.promoted).sort((a, b) => (order.get(a.mint) ?? 0) - (order.get(b.mint) ?? 0));
    } else if (board === 'trending') {
      out = all.filter((t) => !t.promoted && boardOf(t, now) !== 'old' && trendScore(t, now) > 0)
        .sort((a, b) => trendScore(b, now) - trendScore(a, now));
    } else {
      out = all.filter((t) => boardOf(t, now) === board)
        .sort((a, b) => (board === 'graduated' ? (b.migratedAt ?? 0) - (a.migratedAt ?? 0) : b.createdAt - a.createdAt));
    }
    return out.slice(0, limit);
  }

  prune(): void {
    const now = this.now();
    for (const t of [...this.tokens.values()]) {
      const expired = t.migratedAt !== null ? boardOf(t, now) === 'old' : now - t.createdAt > DAY;
      if (expired && !t.promoted) this.tokens.delete(t.mint);
    }
    this.db.sql.prepare('DELETE FROM discovered_tokens WHERE touched_at < ?').run(now - DAY);
  }

  /** Write changed tokens in one transaction. */
  persist(): void {
    if (!this.dirty.size) return;
    const now = this.now();
    const up = this.db.sql.prepare(`INSERT INTO discovered_tokens(mint, data, created_at, touched_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(mint) DO UPDATE SET data = excluded.data, touched_at = excluded.touched_at`);
    this.db.sql.exec('BEGIN');
    try {
      for (const m of this.dirty) {
        const t = this.tokens.get(m);
        if (t) up.run(m, JSON.stringify(t), t.createdAt, now);
      }
      this.db.sql.exec('COMMIT');
    } catch (e) {
      this.db.sql.exec('ROLLBACK');
      throw e;
    }
    this.dirty.clear();
  }

  /** Over the cap: drop the oldest tokens (by creation), never a promoted one. */
  private enforceCap() {
    if (this.tokens.size <= this.cap) return;
    const byAge = [...this.tokens.values()].filter((t) => !t.promoted).sort((a, b) => a.createdAt - b.createdAt);
    for (const t of byAge.slice(0, this.tokens.size - this.cap)) this.tokens.delete(t.mint);
  }
}
