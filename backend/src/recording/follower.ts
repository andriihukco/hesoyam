import type { Route } from '../types.js';

export type FollowEnd = '24h' | 'rugged' | 'stale';

export interface FollowDeps {
  now: () => number;
  /** Price for graduated tokens (Jupiter path). */
  /** Sell-quote price for `size` (same basis as the exit fill), via curve or Jupiter. */
  pollPrice: (mint: string, size: { tokens: number; decimals: number }) => Promise<number | null>;
  /** False while the price source cools down; the poll waits without losing its turn. */
  canPoll?: () => boolean;
  addTick: (positionId: number, ts: number, price: number) => void;
  end: (positionId: number, reason: FollowEnd) => void;
  /** Called once when no followed position uses the mint any more. */
  release: (mint: string) => void;
}

export interface FollowOpts { maxMs?: number; rugFrac?: number; staleMs?: number; pollMs?: number; minGapMs?: number; quietPollMs?: number }

interface F {
  positionId: number; mint: string; route: Route; closedAt: number; tokens: number; decimals: number;
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
  private readonly quietPollMs: number;

  constructor(private readonly deps: FollowDeps, o: FollowOpts = {}) {
    this.maxMs = o.maxMs ?? 24 * 3_600_000;
    this.rugFrac = o.rugFrac ?? 0.1;
    this.staleMs = o.staleMs ?? 30 * 60_000;
    this.pollMs = o.pollMs ?? 60_000;
    this.minGapMs = o.minGapMs ?? 5_000;
    this.quietPollMs = o.quietPollMs ?? 120_000;
  }

  /**
   * `tokens`/`decimals`: size of the exit, so polled prices are sell quotes on the same basis.
   * On restart: `resumedAt` starts the stale clock then, and `peak` restores the highest price seen since exit.
   */
  follow(p: {
    positionId: number; mint: string; route: Route; closedAt: number; exitPrice: number;
    tokens: number; decimals: number; resumedAt?: number; peak?: number;
  }): void {
    if (this.byId.has(p.positionId)) return;
    this.byId.set(p.positionId, {
      positionId: p.positionId, mint: p.mint, route: p.route, closedAt: p.closedAt, tokens: p.tokens, decimals: p.decimals,
      peak: Math.max(p.exitPrice > 0 ? p.exitPrice : 0, p.peak ?? 0), lastPriceAt: Math.max(p.closedAt, p.resumedAt ?? p.closedAt), lastTick: null, lastPollAt: null,
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

  /** Drop every follow without ending it (paper reset deletes the positions). */
  clear(): void {
    this.byId.clear();
    this.byMint.clear();
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
      // Graduated coins have no trade stream here; a quiet curve coin may have graduated, so quote it too.
      const needsQuote = f.route === 'jupiter' || now - f.lastPriceAt >= this.quietPollMs;
      if (!needsQuote || (f.lastPollAt !== null && now - f.lastPollAt < this.pollMs)) continue;
      if (this.deps.canPoll && !this.deps.canPoll()) continue;
      f.lastPollAt = now;
      polls.push(this.deps.pollPrice(f.mint, { tokens: f.tokens, decimals: f.decimals }).then(
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
    // Thin: every minGapMs, or on a 1 % move but never more than once a second.
    const gap = last ? now - last.ts : Infinity;
    if (gap >= this.minGapMs || (gap >= 1_000 && Math.abs(price / last!.price - 1) >= 0.01)) {
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
