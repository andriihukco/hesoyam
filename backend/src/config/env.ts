import { resolve } from 'node:path';
import { z } from 'zod';

export const ROOT_DIR = resolve(import.meta.dirname, '../../..');

try {
  process.loadEnvFile(resolve(ROOT_DIR, '.env'));
} catch {
  // no .env file: rely on process env and defaults
}

const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);
const bool = (def: boolean) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true'), z.boolean());
/** Operator flag: 1 / true / yes (any case) = on; anything else = off. Only for flags where "=1" is the documented form. */
export const flag = z.preprocess((v) => ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase()), z.boolean());
const opt = <T extends z.ZodType>(t: T) => z.preprocess(emptyToUndef, t.optional());

const EnvSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(8787),
  DASHBOARD_TOKEN: opt(z.string()),
  /** Lock-out recovery: on boot, drop a token rotated in the dashboard so DASHBOARD_TOKEN works again. Remove after use. */
  DASHBOARD_TOKEN_RESET: flag,
  DB_PATH: z.string().default('data/1mbot.sqlite'),
  TG_API_ID: opt(z.coerce.number().int()),
  TG_API_HASH: opt(z.string()),
  TG_SESSION: opt(z.string()),
  TG_FOLDER_LINKS: z.string().default(''),
  TG_CHANNELS: z.string().default(''),
  TG_AUTO_JOIN: bool(true),
  X_API_KEY: opt(z.string()),
  X_API_URL: z.string().default('https://api.twitterapi.io'),
  X_HANDLES: z.string().default(''),
  X_POLL_SEC: z.coerce.number().int().min(5).max(3600).default(15),
  THREADS_ACCESS_TOKEN: opt(z.string()),
  THREADS_API_URL: z.string().default('https://graph.threads.com/v1.0'),
  THREADS_HANDLES: z.string().default(''),
  THREADS_KEYWORDS: z.string().default(''),
  RPC_ENDPOINTS: z.string().default('public=https://api.mainnet-beta.solana.com'),
  PUMPPORTAL_WS_URL: z.string().default('wss://pumpportal.fun/api/data'),
  /** Trade subscriptions need a funded PumpPortal key; without it the free RPC curve watcher is used. */
  PUMPPORTAL_API_KEY: opt(z.string()),
  JUPITER_API_URL: z.string().default('https://lite-api.jup.ag/swap/v1'),
  JUPITER_API_KEY: opt(z.string()),
  RUGCHECK_API_URL: z.string().default('https://api.rugcheck.xyz/v1'),
  DEXSCREENER_API_URL: z.string().default('https://api.dexscreener.com'),
  /** Holder analysis. Empty = taken from a helius RPC_ENDPOINTS url. */
  HELIUS_API_KEY: opt(z.string()),
  /** Claude summary of holder reports (on demand). Empty = summaries off. */
  ANTHROPIC_API_KEY: opt(z.string()),
  HOLDER_AI_MODEL: z.string().default('claude-opus-5-5'),
  LIVE_TRADING_ENABLED: bool(false),
  // Hard limits for agents and live trading. Only settable here; agents and the UI cannot change them.
  AGENT_LIVE_ENABLED: bool(false),
  LIVE_MAX_BUY_SOL: opt(z.coerce.number().positive()),
  LIVE_MAX_DAILY_LOSS_SOL: opt(z.coerce.number().positive()),
  LIVE_MAX_OPEN: opt(z.coerce.number().int().positive()),
  LIVE_CANARY_BUY_SOL: opt(z.coerce.number().positive()),
  LIVE_ROLLBACK_LOSS_SOL: opt(z.coerce.number().positive()),
  GEMINI_API_KEY: opt(z.string()),
  GEMINI_MODEL: z.string().default(''),
});

const parsed = EnvSchema.parse(process.env);

export const env = {
  ...parsed,
  DB_PATH: resolve(ROOT_DIR, parsed.DB_PATH),
  folderLinks: splitList(parsed.TG_FOLDER_LINKS),
  extraChannels: splitList(parsed.TG_CHANNELS),
  xHandles: splitList(parsed.X_HANDLES),
  threadsHandles: splitList(parsed.THREADS_HANDLES),
  threadsKeywords: splitList(parsed.THREADS_KEYWORDS),
  rpcEndpoints: parseRpcEndpoints(parsed.RPC_ENDPOINTS),
};

export function splitList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export function parseRpcEndpoints(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of splitList(s)) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  if (Object.keys(out).length === 0) out.public = 'https://api.mainnet-beta.solana.com';
  return out;
}

/** Hide API keys in RPC URLs (query or path) before showing them anywhere. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const hidden = u.pathname.length > 1 || u.search ? '/…' : '';
    return `${u.protocol}//${u.host}${hidden}`;
  } catch {
    return '***';
  }
}
