import { EventEmitter } from 'node:events';
import { Connection } from '@solana/web3.js';
import { redactUrl } from '../config/env.js';

/** Holds the active RPC connection; the dashboard can switch endpoints at runtime. */
// Fail fast on 429 so callers can fall back instead of stalling ~7s in retries.
const CONN_OPTS = { commitment: 'confirmed' as const, disableRetryOnRateLimit: true };

export class Rpc extends EventEmitter {
  private conn: Connection;
  private current: string;
  pingMs: number | null = null;

  constructor(private endpoints: Record<string, string>, initial: string) {
    super();
    this.current = endpoints[initial] ? initial : Object.keys(endpoints)[0]!;
    this.conn = new Connection(endpoints[this.current]!, CONN_OPTS);
  }

  get connection() {
    return this.conn;
  }

  get name() {
    return this.current;
  }

  list() {
    return Object.entries(this.endpoints).map(([name, url]) => ({ name, url: redactUrl(url) }));
  }

  use(name: string) {
    const url = this.endpoints[name];
    if (!url) throw new Error(`Unknown RPC "${name}"`);
    this.current = name;
    this.conn = new Connection(url, CONN_OPTS);
    this.pingMs = null;
    this.emit('changed');
  }

  async ping(): Promise<number | null> {
    const t0 = performance.now();
    try {
      await this.conn.getSlot('processed');
      this.pingMs = Math.round(performance.now() - t0);
    } catch {
      this.pingMs = null;
    }
    return this.pingMs;
  }
}
