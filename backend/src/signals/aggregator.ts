import { isSocialChannel } from '../social/types.js';

/**
 * Channel ids that count toward minChannels under a strategy's social rule.
 * 'one' folds every X / Threads account into a single 'social' channel, so a wave of
 * reposts cannot pass the filter on its own.
 */
export function countableChannels(ids: string[], mode: 'off' | 'one' | 'each'): string[] {
  if (mode === 'each') return ids;
  const tg = ids.filter((id) => !isSocialChannel(id));
  return mode === 'one' && tg.length < ids.length ? [...tg, 'social'] : tg;
}

export interface AggregateResult {
  mint: string;
  /** Unique channels that mentioned the mint inside the window ending now. */
  channelsInWindow: string[];
  /** True when this mention added a new channel to the window. */
  newChannel: boolean;
  firstSeen: number;
  isFirstMention: boolean;
}

interface Entry {
  firstSeen: number;
  hits: { channelId: string; ts: number }[];
}

/** Sliding-window count of unique channels per mint. Pure; clock is passed in. */
export class SignalAggregator {
  private byMint = new Map<string, Entry>();

  constructor(private windowMs: () => number) {}

  add(mint: string, channelId: string, ts: number): AggregateResult {
    const win = this.windowMs();
    let e = this.byMint.get(mint);
    const isFirstMention = !e;
    if (!e) {
      e = { firstSeen: ts, hits: [] };
      this.byMint.set(mint, e);
    }
    e.hits = e.hits.filter((h) => ts - h.ts <= win);
    const before = new Set(e.hits.map((h) => h.channelId));
    e.hits.push({ channelId, ts });
    const after = new Set(e.hits.map((h) => h.channelId));
    return {
      mint,
      channelsInWindow: [...after],
      newChannel: !before.has(channelId),
      firstSeen: e.firstSeen,
      isFirstMention,
    };
  }

  /**
   * Unique channels with a hit in [ts - winMs, ts]. With `beforeLatest`, the newest hit is ignored,
   * which gives the state just before the current mention (to tell whether its channel is new).
   */
  channels(mint: string, winMs: number, ts: number, beforeLatest = false): string[] {
    const e = this.byMint.get(mint);
    if (!e) return [];
    const hits = beforeLatest ? e.hits.slice(0, -1) : e.hits;
    return [...new Set(hits.filter((h) => ts - h.ts <= winMs).map((h) => h.channelId))];
  }

  /** Drop mints with no hits for `idleMs`. */
  prune(now: number, idleMs: number) {
    for (const [mint, e] of this.byMint) {
      const last = e.hits.at(-1)?.ts ?? e.firstSeen;
      if (now - last > idleMs) this.byMint.delete(mint);
    }
  }
}
