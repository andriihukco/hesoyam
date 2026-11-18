import type { Route } from '../types.js';

export type FollowEnd = '24h' | 'rugged' | 'stale';

export interface FollowDeps {
  now: () => number;
  /** Price for graduated tokens (Jupiter path). */
  pollPrice: (mint: string) => Promise<number | null>;
  /** False while the price source cools down; the poll waits without losing its turn. */
  canPoll?: () => boolean;
  addTick: (positionId: number, ts: number, price: number) => void;
  end: (positionId: number, reason: FollowEnd) => void;
  /** Called once when no followed position uses the mint any more. */
  release: (mint: string) => void;
}

export interface FollowOpts { maxMs?: number; rugFrac?: number; staleMs?: number; pollMs?: number; minGapMs?: number }

interface F {
  positionId: number; mint: string; route: Route; closedAt: number;
  peak: number; lastPriceAt: number; lastTick: { ts: number; price: number } | null; lastPollAt: number | null;
}

/**
 * Keeps writing price ticks for a position after it closed, so the chart shows what the coin did
 * next. Ends after maxMs, when the price drops to rugFrac of max(exit price, later peak), or after
 * staleMs without any price.
 */
export class PostExitFollower {
  private byId = new Map<number, F>();
  private byMint = new Map<string, Set<number>>();
  private readonly maxMs: number;
  private readonly rugFrac: number;
  private readonly staleMs: number;
  private readonly pollMs: number;
  private readonly minGapMs: number;

  constructor(private readonly deps: FollowDeps, o: FollowOpts = {}) {
    this.maxMs = o.maxMs ?? 24 * 3_600_000;
    this.rugFrac = o.rugFrac ?? 0.1;
    this.staleMs = o.staleMs ?? 30 * 60_000;
    this.pollMs = o.pollMs ?? 60_000;
    this.minGapMs = o.minGapMs ?? 5_000;
  }

  follow(p: { positionId: number; mint: string; route: Route; closedAt: number; exitPrice: number }): void {
    if (this.byId.has(p.positionId)) return;
    this.byId.set(p.positionId, {
      positionId: p.positionId, mint: p.mint, route: p.route, closedAt: p.closedAt,
      peak: p.exitPrice > 0 ? p.exitPrice : 0, lastPriceAt: p.closedAt, lastTick: null, lastPollAt: null,
    });
    const set = this.byMint.get(p.mint) ?? new Set<number>();
    set.add(p.positionId);
    this.byMint.set(p.mint, set);
  }

  isFollowing(mint: string): boolean {
    return this.byMint.has(mint);
  }

  get active(): number {
    return this.byId.size;
  }

  onPrice(mint: string, price: number): void {
    if (!(price > 0)) return;
    for (const id of [...(this.byMint.get(mint) ?? [])]) this.apply(this.byId.get(id)!, price, this.deps.now());
  }

  async tick(): Promise<void> {
    const now = this.deps.now();
    const polls: Promise<void>[] = [];
    for (const f of [...this.byId.values()]) {
      if (now - f.closedAt >= this.maxMs) { this.finish(f, '24h'); continue; }
      if (now - f.lastPriceAt >= this.staleMs) { this.finish(f, 'stale'); continue; }
      if (f.route !== 'jupiter' || (f.lastPollAt !== null && now - f.lastPollAt < this.pollMs)) continue;
      if (this.deps.canPoll && !this.deps.canPoll()) continue;
      f.lastPollAt = now;
      polls.push(this.deps.pollPrice(f.mint).then(
        (p) => { if (p && p > 0 && this.byId.get(f.positionId) === f) this.apply(f, p, this.deps.now()); },
        () => undefined,
      ));
    }
    await Promise.all(polls);
  }

  private apply(f: F, price: number, now: number) {
    f.lastPriceAt = now;
    f.peak = Math.max(f.peak, price);
    const last = f.lastTick;
    if (!last || now - last.ts >= this.minGapMs || Math.abs(price / last.price - 1) >= 0.01) {
      this.deps.addTick(f.positionId, now, price);
      f.lastTick = { ts: now, price };
    }
    if (price <= this.rugFrac * f.peak) this.finish(f, 'rugged');
  }

  private finish(f: F, reason: FollowEnd) {
    if (!this.byId.delete(f.positionId)) return;
    this.deps.end(f.positionId, reason);
    const set = this.byMint.get(f.mint);
    set?.delete(f.positionId);
    if (set && set.size === 0) {
      this.byMint.delete(f.mint);
      this.deps.release(f.mint);
    }
  }
}
