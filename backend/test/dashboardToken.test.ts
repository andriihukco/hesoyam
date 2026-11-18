import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/db.js';
import { DashboardToken } from '../src/api/token.js';

const ENV = 'env-token-123';

describe('DashboardToken', () => {
  it('accepts only the env token before any rotation', () => {
    const t = new DashboardToken(new Db(':memory:'), { envToken: ENV, reset: false });
    expect(t.check(ENV)).toBe(true);
    expect(t.check('nope')).toBe(false);
    expect(t.check(undefined)).toBe(false);
    expect(t.status()).toEqual({ source: 'env', rotatedAt: null });
  });

  it('rotate returns 64 hex chars and revokes the env token at once', () => {
    const t = new DashboardToken(new Db(':memory:'), { envToken: ENV, reset: false, now: () => 42 });
    const fresh = t.rotate();
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(t.check(fresh)).toBe(true);
    expect(t.check(ENV)).toBe(false);
    expect(t.status()).toEqual({ source: 'rotated', rotatedAt: 42 });
  });

  it('a second rotation revokes the first rotated token', () => {
    const t = new DashboardToken(new Db(':memory:'), { envToken: ENV, reset: false });
    const a = t.rotate();
    const b = t.rotate();
    expect(a).not.toBe(b);
    expect(t.check(a)).toBe(false);
    expect(t.check(b)).toBe(true);
  });

  it('stores only a hash, never the token', () => {
    const db = new Db(':memory:');
    const fresh = new DashboardToken(db, { envToken: ENV, reset: false }).rotate();
    const raw = (db.sql.prepare("SELECT value FROM settings WHERE key = 'dashboardToken'").get() as { value: string }).value;
    expect(raw).not.toContain(fresh);
  });

  it('survives a restart (same db)', () => {
    const db = new Db(':memory:');
    const fresh = new DashboardToken(db, { envToken: ENV, reset: false }).rotate();
    const again = new DashboardToken(db, { envToken: ENV, reset: false });
    expect(again.check(fresh)).toBe(true);
    expect(again.check(ENV)).toBe(false);
  });

  it('reset flag drops the rotated token so the env token works again; old rotated stays revoked', () => {
    const db = new Db(':memory:');
    const fresh = new DashboardToken(db, { envToken: ENV, reset: false }).rotate();
    const recovered = new DashboardToken(db, { envToken: ENV, reset: true });
    expect(recovered.check(ENV)).toBe(true);
    expect(recovered.check(fresh)).toBe(false);
    expect(recovered.status().source).toBe('env');
  });

  it('without any token configured everything is allowed until a rotation', () => {
    const t = new DashboardToken(new Db(':memory:'), { envToken: undefined, reset: false });
    expect(t.check(undefined)).toBe(true);
    expect(t.status().source).toBe('none');
    const fresh = t.rotate();
    expect(t.check(undefined)).toBe(false);
    expect(t.check(fresh)).toBe(true);
  });
});
