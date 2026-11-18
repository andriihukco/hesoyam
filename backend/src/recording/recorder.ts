import type { Db } from '../db/db.js';
import type { Route } from '../types.js';

export interface RecorderDeps {
  db: Db;
  now: () => number;
  /** Price for graduated tokens (Jupiter quote path). */
  pollPrice: (mint: string) => Promise<number | null>;
  /** Trade flow seen by the price feed since a timestamp. */
  flow: (mint: string, sinceMs: number) => { trades: number; buySol: number; sellSol: number };
  /** Called once when recording ends; the bot untracks the mint unless a position holds it. */
  release: (mint: string) => void;
  /** False while the price source is cooling down (e.g. Jupiter 429); polls wait without losing their turn. */
  canPoll?: () => boolean;
}

export interface RecorderOpts {
  windowMs?: number;
  curveMinGapMs?: number;
  pollMs?: number;
  retentionMs?: number;
}

/** One rule for every place that may drop a price-feed subscription (exit close, mention prune, recording end). */
export function canUntrack(o: { held: boolean; recording: boolean; inMentionWindow: boolean }): boolean {
  return !o.held && !o.recording && !o.inMentionWindow;
}

interface Rec { route: Route; startedAt: number; lastSampleAt: number | null; lastPollAt: number | null }

/**
 * Records what happens after every signal for a fixed window, bought or not, so any config can be
 * replayed later. One signal_paths row per sample; flow columns cover the time since the previous sample.
 */
export class SignalRecorder {
  private recs = new Map<string, Rec>();
  private readonly windowMs: number;
  private readonly curveMinGapMs: number;
  private readonly pollMs: number;
  private readonly retentionMs: number;

  constructor(private readonly deps: RecorderDeps, opts: RecorderOpts = {}) {
    this.windowMs = opts.windowMs ?? 30 * 60_000;
    this.curveMinGapMs = opts.curveMinGapMs ?? 1_000;
    this.pollMs = opts.pollMs ?? 10_000;
    this.retentionMs = opts.retentionMs ?? 90 * 86_400_000;
  }

  start(mint: string, route: Route): void {
    if (this.recs.has(mint)) return;
    this.recs.set(mint, { route, startedAt: this.deps.now(), lastSampleAt: null, lastPollAt: null });
  }

  isRecording(mint: string): boolean {
    return this.recs.has(mint);
  }

  get active(): number {
    return this.recs.size;
  }

  onPrice(mint: string, price: number): void {
    const r = this.recs.get(mint);
    if (!r) return;
    const now = this.deps.now();
    if (r.lastSampleAt !== null && now - r.lastSampleAt < this.curveMinGapMs) return;
    this.sample(mint, r, price, now);
  }

  async tick(): Promise<void> {
    const now = this.deps.now();
    const polls: Promise<void>[] = [];
    for (const [mint, r] of this.recs) {
      if (now - r.startedAt >= this.windowMs) {
        this.recs.delete(mint);
        this.deps.release(mint);
        continue;
      }
      if (r.route !== 'jupiter' || (r.lastPollAt !== null && now - r.lastPollAt < this.pollMs)) continue;
      if (this.deps.canPoll && !this.deps.canPoll()) continue;
      r.lastPollAt = now;
      polls.push(
        this.deps.pollPrice(mint).then(
          (p) => { if (this.recs.get(mint) === r) this.sample(mint, r, p, this.deps.now()); },
          () => undefined,
        ),
      );
    }
    await Promise.all(polls);
  }

  /** Delete samples older than the retention period. Returns rows removed. */
  prune(): number {
    const r = this.deps.db.sql.prepare('DELETE FROM signal_paths WHERE ts < ?').run(this.deps.now() - this.retentionMs);
    return Number(r.changes);
  }

  private sample(mint: string, r: Rec, price: number | null, now: number) {
    const f = this.deps.flow(mint, r.lastSampleAt ?? r.startedAt);
    this.deps.db.sql
      .prepare('INSERT INTO signal_paths(mint, ts, price, trades, buy_sol, sell_sol) VALUES(?, ?, ?, ?, ?, ?)')
      .run(mint, now, price, f.trades, f.buySol, f.sellSol);
    r.lastSampleAt = now;
  }
}
