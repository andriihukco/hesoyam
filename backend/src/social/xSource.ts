import { EventEmitter } from 'node:events';
import type { TgMessage } from '../telegram/client.js';
import { errMsg, fetchJson, log } from '../lib/util.js';
import { normHandle, type SocialStatus } from './types.js';

export interface XOptions {
  apiKey?: string;
  apiUrl: string;
  handles: string[];
  pollSec: number;
}

/** twitterapi.io advanced search rejects queries longer than this. */
const MAX_QUERY = 512;

interface XTweet {
  id: string;
  text?: string;
  createdAt?: string;
  author?: { userName?: string };
  entities?: { urls?: { expanded_url?: string }[] };
}

/**
 * Group handles into as few `(from:a OR from:b)` queries as fit the length limit.
 * The `since_id` suffix is reserved in the budget so it can be appended later.
 */
export function buildXQueries(handles: string[], maxLen = MAX_QUERY): string[] {
  const suffix = ' -filter:replies since_id:9999999999999999999';
  const out: string[] = [];
  let cur: string[] = [];
  const len = (hs: string[]) => `(${hs.map((h) => `from:${h}`).join(' OR ')})`.length + suffix.length;
  for (const h of handles) {
    if (cur.length && len([...cur, h]) > maxLen) {
      out.push(`(${cur.map((x) => `from:${x}`).join(' OR ')})`);
      cur = [];
    }
    cur.push(h);
  }
  if (cur.length) out.push(`(${cur.map((x) => `from:${x}`).join(' OR ')})`);
  return out;
}

/** Larger of two numeric-string tweet ids. */
function maxId(a: string, b: string): string {
  return BigInt(a) >= BigInt(b) ? a : b;
}

/**
 * Reads new posts from a fixed list of X accounts through the twitterapi.io search API
 * (billed per tweet returned, so `since_id` keeps each poll to new tweets only). Read-only.
 */
export class XSource extends EventEmitter {
  status: SocialStatus;
  private handles: string[];
  private queries: string[];
  private sinceId: (string | null)[];
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private opts: XOptions) {
    super();
    this.handles = [...new Set(opts.handles.map(normHandle).filter(Boolean))];
    this.queries = buildXQueries(this.handles);
    this.sinceId = this.queries.map(() => null);
    this.status = { state: 'disabled', accounts: this.handles.map((h) => `@${h}`), lastMessageAt: null, lastPollAt: null, pollSec: opts.pollSec, error: null };
  }

  async start() {
    if (!this.opts.apiKey || !this.handles.length) {
      this.status.error = !this.opts.apiKey ? 'Set X_API_KEY and X_HANDLES in .env' : 'Set X_HANDLES in .env';
      log('x', 'not configured, source disabled');
      return;
    }
    this.status.state = 'polling';
    await this.poll(true);
    this.timer = setInterval(() => void this.poll(false), this.opts.pollSec * 1000);
    log('x', `polling ${this.handles.length} accounts every ${this.opts.pollSec}s`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** First poll only records the newest id, so old tweets are not treated as new calls. */
  private async poll(prime: boolean) {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let i = 0; i < this.queries.length; i++) {
        const since = this.sinceId[i];
        const q = `${this.queries[i]} -filter:replies${since ? ` since_id:${since}` : ''}`;
        const url = `${this.opts.apiUrl}/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(q)}`;
        const res = await fetchJson<{ tweets?: XTweet[] }>(url, { headers: { 'X-API-Key': this.opts.apiKey! }, timeoutMs: 10_000 });
        const tweets = (res.tweets ?? []).filter((t) => t?.id && /^\d+$/.test(t.id));
        for (const t of tweets) this.sinceId[i] = this.sinceId[i] ? maxId(this.sinceId[i]!, t.id) : t.id;
        if (prime || !since) continue;
        // Oldest first, so the aggregator sees mentions in time order.
        for (const t of [...tweets].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) this.emitTweet(t);
      }
      this.status = { ...this.status, state: 'polling', lastPollAt: Date.now(), error: null };
    } catch (e) {
      this.status = { ...this.status, state: 'error', error: errMsg(e) };
      log('x', 'poll failed', errMsg(e));
    } finally {
      this.busy = false;
    }
  }

  private emitTweet(t: XTweet) {
    const handle = normHandle(t.author?.userName ?? '');
    if (!handle) return;
    const urls = (t.entities?.urls ?? []).map((u) => u.expanded_url ?? '').filter(Boolean);
    const text = [t.text ?? '', ...urls].join(' ');
    if (!text.trim()) return;
    const ts = Date.parse(t.createdAt ?? '') || Date.now();
    this.status.lastMessageAt = Date.now();
    this.emit('message', { channelId: `x:${handle}`, channelName: `@${handle}`, folder: 'X', text, ts } satisfies TgMessage);
  }
}
