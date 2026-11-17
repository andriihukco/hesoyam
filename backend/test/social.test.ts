import { afterEach, describe, expect, it, vi } from 'vitest';
import { countableChannels } from '../src/signals/aggregator.js';
import { normHandle } from '../src/social/types.js';
import { buildXQueries, XSource } from '../src/social/xSource.js';
import { threadsIntervalMs, ThreadsSource } from '../src/social/threadsSource.js';
import type { TgMessage } from '../src/telegram/client.js';

describe('countableChannels', () => {
  const ids = ['tg1', 'x:a', 'x:b', 'threads:c'];
  it('off: only Telegram counts', () => expect(countableChannels(ids, 'off')).toEqual(['tg1']));
  it('one: all social accounts count once', () => expect(countableChannels(ids, 'one')).toEqual(['tg1', 'social']));
  it('one: no social, no extra', () => expect(countableChannels(['tg1'], 'one')).toEqual(['tg1']));
  it('each: every account counts', () => expect(countableChannels(ids, 'each')).toEqual(ids));
});

describe('normHandle', () => {
  it.each([
    ['@Foo', 'foo'],
    ['https://x.com/Foo', 'foo'],
    ['https://twitter.com/foo/status/1', 'foo'],
    ['https://www.threads.net/@bar', 'bar'],
    ['https://www.threads.com/@bar', 'bar'],
  ])('%s -> %s', (i, o) => expect(normHandle(i)).toBe(o));
});

describe('buildXQueries', () => {
  it('puts handles in one OR query when short', () => {
    expect(buildXQueries(['a', 'b'])).toEqual(['(from:a OR from:b)']);
  });
  it('splits so each query plus since_id stays under the limit', () => {
    const hs = Array.from({ length: 60 }, (_, i) => `handle_number_${i}`);
    const qs = buildXQueries(hs);
    expect(qs.length).toBeGreaterThan(1);
    for (const q of qs) expect(`${q} -filter:replies since_id:9999999999999999999`.length).toBeLessThanOrEqual(512);
    expect(qs.join(' ').match(/from:/g)!.length).toBe(60);
  });
});

describe('threadsIntervalMs', () => {
  it('spreads requests over the day within 90% of the limit', () => {
    expect(threadsIntervalMs(10, 1000)).toBe(960_000); // 10 accounts -> each every 16 min
    expect(threadsIntervalMs(1, 2200)).toBe(60_000); // floor of 60 s
    expect(threadsIntervalMs(0, 1000)).toBe(0);
  });
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('XSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('skips tweets present at start, then emits only newer ones with since_id', async () => {
    const urls: string[] = [];
    const replies = [
      { tweets: [{ id: '100', text: 'old', createdAt: 'Tue Dec 10 07:00:30 +0000 2024', author: { userName: 'Caller' } }] },
      { tweets: [
        { id: '102', text: 'ca 2', author: { userName: 'Caller' }, entities: { urls: [{ expanded_url: 'https://pump.fun/coin/M2' }] } },
        { id: '101', text: 'ca 1', author: { userName: 'Caller' } },
      ] },
    ];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return json(replies.shift() ?? { tweets: [] }); }));
    const src = new XSource({ apiKey: 'k', apiUrl: 'https://api.test', handles: ['@Caller'], pollSec: 3600 });
    const got: TgMessage[] = [];
    src.on('message', (m: TgMessage) => got.push(m));
    await src.start();
    expect(got).toEqual([]);
    await (src as unknown as { poll(p: boolean): Promise<void> }).poll(false);
    src.stop();
    expect(decodeURIComponent(urls[1]!)).toContain('since_id:100');
    expect(got.map((m) => m.text)).toEqual(['ca 1', 'ca 2 https://pump.fun/coin/M2']);
    expect(got[0]).toMatchObject({ channelId: 'x:caller', channelName: '@caller', folder: 'X' });
    expect(src.status.state).toBe('polling');
  });

  it('stays off without a key', async () => {
    const src = new XSource({ apiUrl: 'https://api.test', handles: ['a'], pollSec: 15 });
    await src.start();
    expect(src.status.state).toBe('disabled');
  });

  it('reports errors without the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 429 })));
    const src = new XSource({ apiKey: 'secret-key', apiUrl: 'https://api.test', handles: ['a'], pollSec: 3600 });
    await src.start();
    src.stop();
    expect(src.status.state).toBe('error');
    expect(src.status.error).toContain('429');
    expect(src.status.error).not.toContain('secret-key');
  });
});

describe('ThreadsSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('emits each post once and never puts the token in errors', async () => {
    const posts = { data: [{ id: 't1', text: 'buy M1', timestamp: '2026-11-18T10:00:00+0000', username: 'Bar' }] };
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async () => (fail ? new Response('x', { status: 500 }) : json(posts))));
    const src = new ThreadsSource({ accessToken: 'tok-secret', apiUrl: 'https://graph.test', handles: ['bar'], keywords: [] });
    const got: TgMessage[] = [];
    src.on('message', (m: TgMessage) => got.push(m));
    const run = (src as unknown as { run(j: unknown): Promise<void> }).run.bind(src);
    await run({ kind: 'profile', handle: 'bar' });
    await run({ kind: 'profile', handle: 'bar' });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ channelId: 'threads:bar', folder: 'Threads', text: 'buy M1' });
    fail = true;
    await run({ kind: 'profile', handle: 'bar' });
    expect(src.status.state).toBe('error');
    expect(src.status.error).not.toContain('tok-secret');
  });
});
