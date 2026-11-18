import { PublicKey } from '@solana/web3.js';
import { LAMPORTS, bondingCurvePda, decodeCurve } from '../market/pump.js';
import { errMsg, log } from '../lib/util.js';
import { bondingPct, type Market } from './score.js';
import type { CreatedEvent, DiscoveryStore } from './store.js';

/** Pump.fun: 1 B supply, curve starts with 1,073 M virtual / 793.1 M real tokens and 30 virtual SOL. */
const SUPPLY = 1_000_000_000;
const VIRTUAL_TOKEN_OFFSET = 279_900_000;
const REAL_TOKENS = 793_100_000;
const VIRTUAL_SOL = 30;

export interface SocketLike {
  on(ev: 'open' | 'close' | 'error', fn: () => void): unknown;
  on(ev: 'message', fn: (data: unknown) => void): unknown;
  send(s: string): void;
  close(): void;
}

export interface FeedDeps {
  connect: () => SocketLike;
  getAccounts: (pubkeys: string[]) => Promise<(Buffer | null)[]>;
  fetchJson: (url: string) => Promise<unknown>;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => NodeJS.Timeout;
  dexUrl?: string;
}

/** Node's built-in WebSocket wrapped in the small event interface the feed uses. */
export function nativeSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const on: SocketLike['on'] = (ev: string, fn: (data?: unknown) => void) => {
    if (ev === 'message') ws.addEventListener('message', (e) => fn((e as MessageEvent).data));
    else ws.addEventListener(ev as 'open' | 'close' | 'error', () => fn());
    return undefined;
  };
  return { on, send: (d) => ws.readyState === WebSocket.OPEN && ws.send(d), close: () => ws.close() };
}

type Msg = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export function parseCreate(m: Msg, now: number): CreatedEvent | null {
  if (m.txType !== 'create' || typeof m.mint !== 'string') return null;
  const vTokens = num(m.vTokensInBondingCurve);
  const pct = vTokens > 0 ? Math.min(100, Math.max(0, (1 - (vTokens - VIRTUAL_TOKEN_OFFSET) / REAL_TOKENS) * 100)) : 0;
  return {
    mint: m.mint, symbol: String(m.symbol ?? ''), name: String(m.name ?? ''), creator: String(m.traderPublicKey ?? ''),
    createdAt: now, devBuyPct: (num(m.initialBuy) / SUPPLY) * 100, firstMcSol: num(m.marketCapSol),
    bondingPct: pct, realSol: Math.max(0, num(m.vSolInBondingCurve) - VIRTUAL_SOL),
  };
}

export function parseMigration(m: Msg, now: number): { mint: string; ts: number } | null {
  return m.txType === 'migrate' && typeof m.mint === 'string' ? { mint: m.mint, ts: now } : null;
}

interface DexPair {
  baseToken?: { address?: string; symbol?: string; name?: string };
  liquidity?: { usd?: number }; marketCap?: number; priceUsd?: string;
  txns?: { m5?: { buys?: number; sells?: number } }; volume?: { m5?: number; h1?: number }; priceChange?: { m5?: number };
  info?: { socials?: { type?: string }[]; websites?: unknown[] };
}

/** Several pools per token: use the most liquid one. */
export function pickPair(pairs: DexPair[], now: number): { market: Market; names: { symbol: string; name: string } } | null {
  const p = [...pairs].sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0];
  if (!p) return null;
  const socials = [...(p.info?.socials ?? []).map((s) => String(s.type ?? '')).filter(Boolean), ...(p.info?.websites?.length ? ['web'] : [])];
  return {
    market: {
      priceUsd: p.priceUsd ? Number(p.priceUsd) : null, mcUsd: p.marketCap ?? null, liqUsd: p.liquidity?.usd ?? null,
      vol5mUsd: num(p.volume?.m5), vol1hUsd: num(p.volume?.h1), buys5m: num(p.txns?.m5?.buys), sells5m: num(p.txns?.m5?.sells),
      change5mPct: num(p.priceChange?.m5), socials, updatedAt: now,
    },
    names: { symbol: p.baseToken?.symbol ?? '', name: p.baseToken?.name ?? '' },
  };
}

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * Free PumpPortal socket for new tokens and migrations, plus a 15 s refresher that reads bonding
 * curves (batches of 100) and DexScreener market data (batches of 30) for the most relevant tokens.
 */
export class DiscoveryFeed {
  private sock: SocketLike | null = null;
  private stopped = false;
  private timers: NodeJS.Timeout[] = [];
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => NodeJS.Timeout;
  private readonly dexUrl: string;
  connected = false;
  lastEventAt: number | null = null;

  constructor(private readonly store: DiscoveryStore, private readonly deps: FeedDeps) {
    this.now = deps.now ?? Date.now;
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.dexUrl = deps.dexUrl ?? 'https://api.dexscreener.com';
  }

  start(): void {
    this.store.load();
    this.connect();
    const every = (fn: () => unknown, ms: number) => this.timers.push(setInterval(() => void Promise.resolve(fn()).catch((e) => log('discovery', errMsg(e))), ms));
    every(() => this.refresh(), 15_000);
    every(() => this.refreshPromoted(), 120_000);
    every(() => this.store.prune(), 600_000);
    void this.refreshPromoted().catch((e) => log('discovery', errMsg(e)));
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.sock?.close();
  }

  connect(): void {
    const s = this.deps.connect();
    this.sock = s;
    s.on('open', () => {
      this.connected = true;
      s.send(JSON.stringify({ method: 'subscribeNewToken' }));
      s.send(JSON.stringify({ method: 'subscribeMigration' }));
    });
    s.on('message', (data) => this.onMessage(data));
    s.on('error', () => undefined);
    s.on('close', () => {
      this.connected = false;
      if (this.sock === s && !this.stopped) this.schedule(() => !this.stopped && this.connect(), 3_000);
    });
  }

  private onMessage(data: unknown) {
    let m: Msg;
    try {
      m = JSON.parse(String(data)) as Msg;
    } catch {
      return;
    }
    const now = this.now();
    const c = parseCreate(m, now);
    if (c) {
      this.store.addCreated(c);
      this.lastEventAt = now;
      return;
    }
    const mg = parseMigration(m, now);
    if (mg) {
      this.store.markMigrated(mg.mint, mg.ts);
      this.lastEventAt = now;
    }
  }

  async refresh(): Promise<void> {
    const mints = this.store.refreshCandidates(300);
    const now = this.now();
    const curveMints = mints.filter((m) => this.store.get(m)?.migratedAt == null);
    for (const batch of chunks(curveMints, 100)) {
      const pdas: string[] = [];
      const ok: string[] = [];
      for (const m of batch) {
        try {
          pdas.push(bondingCurvePda(new PublicKey(m)).toBase58());
          ok.push(m);
        } catch {
          /* not a valid key */
        }
      }
      const accs = await this.deps.getAccounts(pdas).catch(() => pdas.map(() => null));
      accs.forEach((buf, i) => {
        if (!buf) return;
        try {
          const c = decodeCurve(buf);
          this.store.applyCurve(ok[i]!, bondingPct(c), Number(c.realSolReserves) / LAMPORTS, c.complete);
        } catch {
          /* not a curve account */
        }
      });
    }
    for (const batch of chunks(mints, 30)) {
      const pairs = (await this.deps.fetchJson(`${this.dexUrl}/tokens/v1/solana/${batch.join(',')}`).catch(() => [])) as DexPair[];
      const byMint = new Map<string, DexPair[]>();
      for (const p of Array.isArray(pairs) ? pairs : []) {
        const a = p.baseToken?.address;
        if (a) byMint.set(a, [...(byMint.get(a) ?? []), p]);
      }
      for (const [m, ps] of byMint) {
        const r = pickPair(ps, now);
        if (r) this.store.applyMarket(m, r.market, r.names);
      }
    }
    this.store.persist();
  }

  /** Paid DexScreener boosts on Solana, shown as "Promoted" only. */
  async refreshPromoted(): Promise<void> {
    const rows = (await this.deps.fetchJson(`${this.dexUrl}/token-boosts/top/v1`)) as { chainId?: string; tokenAddress?: string }[];
    const mints = (Array.isArray(rows) ? rows : []).filter((r) => r.chainId === 'solana' && r.tokenAddress).map((r) => r.tokenAddress!);
    this.store.setPromoted([...new Set(mints)].slice(0, 30));
  }
}
