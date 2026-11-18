import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db.js';

const KEY = 'dashboardToken';
const sha256 = (s: string) => createHash('sha256').update(s).digest();

interface Stored { hash: string; rotatedAt: number }

export interface TokenStatus { source: 'none' | 'env' | 'rotated'; rotatedAt: number | null }

/**
 * Dashboard access token. Starts as DASHBOARD_TOKEN from env; "rotate" replaces it with a fresh
 * 32-byte hex token (same as `openssl rand -hex 32`) stored only as a SHA-256 hash, and revokes
 * the previous one at once. DASHBOARD_TOKEN_RESET=1 drops the rotated token on boot so the env
 * token works again (lock-out recovery).
 */
export class DashboardToken {
  private readonly envToken: string | undefined;
  private readonly now: () => number;

  constructor(private readonly db: Db, o: { envToken: string | undefined; reset: boolean; now?: () => number }) {
    this.envToken = o.envToken || undefined;
    this.now = o.now ?? Date.now;
    if (o.reset) this.db.sql.prepare('DELETE FROM settings WHERE key = ?').run(KEY);
  }

  private stored(): Stored | undefined {
    return this.db.getSetting<Stored>(KEY);
  }

  check(token: string | undefined): boolean {
    const s = this.stored();
    const expected = s ? Buffer.from(s.hash, 'hex') : this.envToken ? sha256(this.envToken) : null;
    if (!expected) return true;
    if (!token) return false;
    return timingSafeEqual(sha256(token), expected);
  }

  /** New token, returned once. Only its hash is kept. */
  rotate(): string {
    const token = randomBytes(32).toString('hex');
    this.db.setSetting(KEY, { hash: sha256(token).toString('hex'), rotatedAt: this.now() } satisfies Stored);
    return token;
  }

  status(): TokenStatus {
    const s = this.stored();
    if (s) return { source: 'rotated', rotatedAt: s.rotatedAt };
    return { source: this.envToken ? 'env' : 'none', rotatedAt: null };
  }
}
