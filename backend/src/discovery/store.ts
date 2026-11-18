import type { Db } from '../db/db.js';
import { boardOf, passes, trendScore, type Board, type DiscoveredToken, type DiscoveryFilter, type Market } from './score.js';

const DAY = 24 * 3_600_000;
const HOUR = 3_600_000;

export type DiscoveryBoard = Exclude<Board, 'mid' | 'old'> | 'trending' | 'promoted';
export type CreatedEvent = Omit<DiscoveredToken, 'migratedAt' | 'promoted' | 'market' | 'origin'>;

/** Discovered tokens: in memory for the boards, mirrored to SQLite so a restart keeps the last 24 h. */
export class DiscoveryStore {
  private tokens = new Map<string, DiscoveredToken>();
  private dirty = new Set<string>();
  private promoted: string[] = [];

  constructor(private readonly db: Db, private readonly now: () => number = Date.now, private readonly cap = 2000) {
    db.sql.exec(`CREATE TABLE IF NOT EXISTS discovered_tokens (
      mint TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, touched_at INTEGER NOT NULL)`);
  }

  get(mint: string): DiscoveredToken | undefined {
    return this.tokens.get(mint);
  }

  get size(): number {
    return this.tokens.size;
  }

  load(): void {
    const rows = this.db.sql.prepare('SELECT data FROM discovered_tokens WHERE touched_at >= ?').all(this.now() - DAY) as { data: string }[];
    for (const r of rows) {
      try {
        const t = JSON.parse(r.data) as DiscoveredToken;
        if (t?.mint) this.tokens.set(t.mint, { ...t, origin: t.origin ?? 'created', promoted: false });
      } catch {
        /* skip a corrupt row */
      }
    }
    this.enforceCap();
  }

  private touch(mint: string) {
    this.dirty.add(mint);
  }

  addCreated(ev: CreatedEvent): void {
    const cur = this.tokens.get(ev.mint);
    if (cur && cur.origin === 'created') return;
    this.tokens.set(ev.mint, { ...ev, migratedAt: cur?.migratedAt ?? null, promoted: cur?.promoted ?? false, market: cur?.market ?? null, origin: 'created' });
    this.touch(ev.mint);
    this.enforceCap();
  }

  /** Placeholder for tokens first seen through a migration or a promotion. */
  ensure(mint: string, createdAt = this.now()): DiscoveredToken {
    let t = this.tokens.get(mint);
    if (!t) {
      t = { mint, symbol: '', name: '', creator: '', createdAt, devBuyPct: 0, firstMcSol: 0, bondingPct: 0, realSol: 0, migratedAt: null, promoted: false, market: null, origin: 'other' };
      this.tokens.set(mint, t);
      this.touch(mint);
      this.enforceCap();
    }
    return t;
  }

  markMigrated(mint: string, ts: number): void {
    const t = this.ensure(mint, ts);
    if (t.origin === 'other') t.origin = 'migrated';
    t.migratedAt ??= ts;
    t.bondingPct = 100;
    this.touch(mint);
  }

  /** `complete`: the curve finished; for a token we saw created that means it graduated (time ≈ now). */
  applyCurve(mint: string, pct: number, realSol: number, complete = false): void {
    const t = this.tokens.get(mint);
    if (!t) return;
    t.bondingPct = pct;
    t.realSol = realSol;
    if (complete && t.origin === 'created' && t.migratedAt === null) t.migratedAt = this.now();
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

  /**
   * Market-data refresh order (DexScreener): coins on a board first, by relevance, then the newest.
   * 1) curve coins ≥ 30 % bonded (most bonded first), 2) graduated < 2 h and promoted, 3) coins with 5-min
   * volume, 4) the newest launches. At ~1,000 launches an hour, age alone would starve every board but New.
   */
  refreshCandidates(limit: number): string[] {
    const now = this.now();
    const live = [...this.tokens.values()].filter((t) => boardOf(t, now) !== 'old');
    const tier = (t: DiscoveredToken) => {
      const b = boardOf(t, now);
      if ((b === 'soon' || b === 'mid')) return 0;
      if ((b === 'graduated' && now - (t.migratedAt ?? 0) < 2 * HOUR) || t.promoted) return 1;
      if ((t.market?.vol5mUsd ?? 0) > 0) return 2;
      return 3;
    };
    const key = (t: DiscoveredToken, k: number) => (k === 0 ? t.bondingPct : k === 1 ? Math.max(t.migratedAt ?? 0, t.createdAt) : k === 2 ? t.market!.vol5mUsd : t.createdAt);
    return live
      .map((t) => ({ t, k: tier(t) }))
      .sort((a, b) => a.k - b.k || key(b.t, b.k) - key(a.t, a.k))
      .slice(0, limit)
      .map((x) => x.t.mint);
  }

  /** Curve reads (cheap, 100 per RPC call): every live curve coin, climbing ones first, then newest. */
  curveCandidates(limit: number): string[] {
    const now = this.now();
    return [...this.tokens.values()]
      .filter((t) => t.origin === 'created' && t.migratedAt === null && boardOf(t, now) !== 'old')
      .sort((a, b) => Number(b.bondingPct >= 30) - Number(a.bondingPct >= 30) || (a.bondingPct >= 30 ? b.bondingPct - a.bondingPct : b.createdAt - a.createdAt))
      .slice(0, limit)
      .map((t) => t.mint);
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

  /**
   * Over the cap: drop dead launches first (low bonding, no market activity, oldest first), then the
   * rest by age. Never a promoted coin, a coin ≥ 70 % bonded, or one graduated in the last 24 h.
   */
  private enforceCap() {
    if (this.tokens.size <= this.cap) return;
    const now = this.now();
    const keep = (t: DiscoveredToken) => t.promoted || boardOf(t, now) === 'soon' || boardOf(t, now) === 'graduated';
    const dead = (t: DiscoveredToken) => t.bondingPct < 30 && !((t.market?.vol5mUsd ?? 0) > 0);
    const order = [...this.tokens.values()].filter((t) => !keep(t))
      .sort((a, b) => Number(dead(b)) - Number(dead(a)) || a.createdAt - b.createdAt);
    for (const t of order.slice(0, this.tokens.size - this.cap)) this.tokens.delete(t.mint);
  }
}
