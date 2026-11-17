import { EventEmitter } from 'node:events';
import type { TgMessage } from '../telegram/client.js';
import { errMsg, fetchJson, log } from '../lib/util.js';
import { normHandle, type SocialStatus } from './types.js';

export interface ThreadsOptions {
  accessToken?: string;
  apiUrl: string;
  handles: string[];
  keywords: string[];
}

/** Meta's rolling 24 h limits per user; we plan for 90% of each. */
const PROFILE_POSTS_PER_DAY = 1000;
const KEYWORD_SEARCHES_PER_DAY = 2200;
const BUDGET = 0.9;
const MIN_INTERVAL_MS = 60_000;

/** Time between requests so `jobs` requests per cycle stay inside a daily limit. */
export function threadsIntervalMs(jobs: number, perDay: number): number {
  if (jobs <= 0) return 0;
  return Math.max(MIN_INTERVAL_MS, Math.ceil((86_400_000 * jobs) / (perDay * BUDGET)));
}

interface ThreadsPost {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
}

type Job = { kind: 'profile'; handle: string } | { kind: 'keyword'; q: string };

/**
 * Reads Threads posts through Meta's official API. Needs `threads_profile_discovery`
 * (profile posts) and/or `threads_keyword_search` approved for the app; without approval
 * Meta returns only your own or Meta's posts. Polls slowly to stay inside the daily limits.
 */
export class ThreadsSource extends EventEmitter {
  status: SocialStatus;
  private handles: string[];
  private keywords: string[];
  private seen = new Set<string>();
  private since = new Map<string, number>(); // job key -> unix seconds of the last poll
  private timers: NodeJS.Timeout[] = [];
  private profileIdx = 0;
  private keywordIdx = 0;

  constructor(private opts: ThreadsOptions) {
    super();
    this.handles = [...new Set(opts.handles.map(normHandle).filter(Boolean))];
    this.keywords = [...new Set(opts.keywords.map((k) => k.trim()).filter(Boolean))];
    const cycleMs = Math.max(
      threadsIntervalMs(this.handles.length, PROFILE_POSTS_PER_DAY),
      threadsIntervalMs(this.keywords.length, KEYWORD_SEARCHES_PER_DAY),
    );
    this.status = {
      state: 'disabled',
      accounts: [...this.handles.map((h) => `@${h}`), ...this.keywords.map((k) => `"${k}"`)],
      lastMessageAt: null, lastPollAt: null, pollSec: Math.round(cycleMs / 1000), error: null,
    };
  }

  async start() {
    if (!this.opts.accessToken || (!this.handles.length && !this.keywords.length)) {
      this.status.error = !this.opts.accessToken ? 'Set THREADS_ACCESS_TOKEN and THREADS_HANDLES or THREADS_KEYWORDS in .env' : 'Set THREADS_HANDLES or THREADS_KEYWORDS in .env';
      log('threads', 'not configured, source disabled');
      return;
    }
    this.status.state = 'polling';
    const now = Math.floor(Date.now() / 1000);
    for (const h of this.handles) this.since.set(`p:${h}`, now);
    for (const k of this.keywords) this.since.set(`k:${k}`, now);
    // One request per tick, round-robin, so the daily budget is spread evenly.
    if (this.handles.length) {
      const tick = Math.ceil(threadsIntervalMs(this.handles.length, PROFILE_POSTS_PER_DAY) / this.handles.length);
      this.timers.push(setInterval(() => void this.run({ kind: 'profile', handle: this.handles[this.profileIdx++ % this.handles.length]! }), tick));
    }
    if (this.keywords.length) {
      const tick = Math.ceil(threadsIntervalMs(this.keywords.length, KEYWORD_SEARCHES_PER_DAY) / this.keywords.length);
      this.timers.push(setInterval(() => void this.run({ kind: 'keyword', q: this.keywords[this.keywordIdx++ % this.keywords.length]! }), tick));
    }
    log('threads', `polling ${this.handles.length} accounts and ${this.keywords.length} keywords, each about every ${this.status.pollSec}s`);
  }

  stop() {
    this.timers.forEach(clearInterval);
  }

  private async run(job: Job) {
    const key = job.kind === 'profile' ? `p:${job.handle}` : `k:${job.q}`;
    const since = this.since.get(key) ?? Math.floor(Date.now() / 1000);
    const startedAt = Math.floor(Date.now() / 1000);
    const p = new URLSearchParams({ fields: 'id,text,timestamp,username', since: String(since), limit: '25', access_token: this.opts.accessToken! });
    if (job.kind === 'profile') p.set('username', job.handle);
    else { p.set('q', job.q); p.set('search_type', 'RECENT'); }
    const path = job.kind === 'profile' ? 'profile_posts' : 'keyword_search';
    try {
      // fetchJson drops the query string from error messages, so the token never reaches logs.
      const res = await fetchJson<{ data?: ThreadsPost[] }>(`${this.opts.apiUrl}/${path}?${p}`, { timeoutMs: 10_000 });
      this.since.set(key, startedAt);
      const posts = (res.data ?? []).filter((x) => x?.id && !this.seen.has(x.id));
      posts.sort((a, b) => Date.parse(a.timestamp ?? '') - Date.parse(b.timestamp ?? ''));
      for (const post of posts) this.emitPost(post, job.kind === 'profile' ? job.handle : undefined);
      this.status = { ...this.status, state: 'polling', lastPollAt: Date.now(), error: null };
    } catch (e) {
      this.status = { ...this.status, state: 'error', error: `${path}: ${errMsg(e)}` };
      log('threads', `${path} failed`, errMsg(e));
    }
  }

  private emitPost(post: ThreadsPost, fallbackHandle?: string) {
    this.seen.add(post.id);
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    const handle = normHandle(post.username ?? fallbackHandle ?? '');
    if (!handle || !post.text?.trim()) return;
    const ts = Date.parse(post.timestamp ?? '') || Date.now();
    this.status.lastMessageAt = Date.now();
    this.emit('message', { channelId: `threads:${handle}`, channelName: `@${handle}`, folder: 'Threads', text: post.text, ts } satisfies TgMessage);
  }
}
