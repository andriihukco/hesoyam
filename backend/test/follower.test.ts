import { describe, expect, it } from 'vitest';
import { PostExitFollower, type FollowEnd } from '../src/recording/follower.js';

const MIN = 60_000;

function setup(opts: { canPoll?: () => boolean; poll?: () => number | null } = {}) {
  const clock = { t: 1_000_000 };
  const ticks: { id: number; ts: number; price: number }[] = [];
  const ends: { id: number; reason: FollowEnd }[] = [];
  const released: string[] = [];
  let polls = 0;
  const f = new PostExitFollower({
    now: () => clock.t,
    pollPrice: async () => { polls++; return opts.poll ? opts.poll() : 1; },
    canPoll: opts.canPoll,
    addTick: (id, ts, price) => ticks.push({ id, ts, price }),
    end: (id, reason) => ends.push({ id, reason }),
    release: (m) => released.push(m),
  });
  const at = (dt: number) => { clock.t = 1_000_000 + dt; };
  return { f, clock, at, ticks, ends, released, polls: () => polls };
}
const curve = (id = 1, mint = 'M') => ({ positionId: id, mint, route: 'pump-curve' as const, closedAt: 1_000_000, exitPrice: 1 });

describe('PostExitFollower', () => {
  it('writes thinned ticks after exit', () => {
    const { f, at, ticks } = setup();
    f.follow(curve());
    at(1000); f.onPrice('M', 1.0);
    at(2000); f.onPrice('M', 1.005);
    at(3000); f.onPrice('M', 1.02);
    at(9000); f.onPrice('M', 1.02);
    expect(ticks.map((t) => t.ts - 1_000_000)).toEqual([1000, 3000, 9000]);
  });

  it('ends rugged at 10 % of the post-exit peak and releases once', () => {
    const { f, at, ends, released } = setup();
    f.follow(curve());
    at(1000); f.onPrice('M', 3);
    at(7000); f.onPrice('M', 0.3);
    at(13000); f.onPrice('M', 0.2);
    expect(ends).toEqual([{ id: 1, reason: 'rugged' }]);
    expect(released).toEqual(['M']);
    expect(f.isFollowing('M')).toBe(false);
  });

  it('does not end rugged above 10 % of peak', () => {
    const { f, at, ends } = setup();
    f.follow(curve());
    at(1000); f.onPrice('M', 3);
    at(7000); f.onPrice('M', 0.31);
    expect(ends).toEqual([]);
    expect(f.isFollowing('M')).toBe(true);
  });

  it('uses the exit price as the peak floor', () => {
    const { f, at, ends } = setup();
    f.follow(curve());
    at(1000); f.onPrice('M', 0.1);
    expect(ends).toEqual([{ id: 1, reason: 'rugged' }]);
  });

  it('ends 24h after close', async () => {
    const { f, at, ends } = setup();
    f.follow(curve());
    for (let t = 0; t < 24 * 60; t += 20) { at(t * MIN + 1000); f.onPrice('M', 1 + (t % 40 ? 0.05 : 0)); }
    at(24 * 60 * MIN);
    await f.tick();
    expect(ends).toEqual([{ id: 1, reason: '24h' }]);
  });

  it('ends stale after 30 min without price', async () => {
    const { f, at, ends } = setup();
    f.follow(curve());
    at(30 * MIN - 1); await f.tick();
    expect(ends).toEqual([]);
    at(30 * MIN); await f.tick();
    expect(ends).toEqual([{ id: 1, reason: 'stale' }]);
  });

  it('polls graduated every 60 s and skips during cooldown', async () => {
    let cool = false;
    const { f, at, polls, ticks } = setup({ canPoll: () => !cool });
    f.follow({ ...curve(), route: 'jupiter' });
    at(0); await f.tick();
    at(30_000); await f.tick();
    at(60_000); cool = true; await f.tick();
    expect(polls()).toBe(1);
    cool = false; at(61_000); await f.tick();
    expect(polls()).toBe(2);
    expect(ticks).toHaveLength(2);
  });

  it('a null poll does not refresh the stale clock', async () => {
    const { f, at, ends } = setup({ poll: () => null });
    f.follow({ ...curve(), route: 'jupiter' });
    for (let t = 0; t < 30; t++) { at(t * MIN); await f.tick(); }
    at(30 * MIN); await f.tick();
    expect(ends).toEqual([{ id: 1, reason: 'stale' }]);
  });

  it('two positions on one mint release only after both end', async () => {
    const { f, at, released, ends } = setup();
    f.follow(curve(1));
    f.follow({ ...curve(2), closedAt: 1_000_000 + 20 * MIN });
    at(30 * MIN); await f.tick();
    expect(ends).toEqual([{ id: 1, reason: 'stale' }]);
    expect(released).toEqual([]);
    at(50 * MIN); await f.tick();
    expect(released).toEqual(['M']);
  });

  it('follow is idempotent per position', () => {
    const { f, at, ticks } = setup();
    f.follow(curve());
    f.follow(curve());
    at(1000); f.onPrice('M', 1);
    expect(ticks).toHaveLength(1);
  });

  it('a follow resumed after restart starts its stale clock at resume time', async () => {
    const { f, at, ends } = setup();
    at(13 * 60 * MIN);
    f.follow({ ...curve(), resumedAt: 1_000_000 + 13 * 60 * MIN });
    at(13 * 60 * MIN + 5_000); await f.tick();
    expect(ends).toEqual([]);
    at(13 * 60 * MIN + 30 * MIN); await f.tick();
    expect(ends).toEqual([{ id: 1, reason: 'stale' }]);
  });
});
