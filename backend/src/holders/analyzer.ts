import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { env } from '../config/env.js';
import { Rpc } from '../lib/rpc.js';
import { fetchJson, memo } from '../lib/util.js';
import { loadHolders } from '../risk/checks.js';
import { scoreHolders, walletActivity, type HolderReport, type ParsedTx, type WalletInfo } from './score.js';

/** Wallets looked at per token. Each costs one Helius enhanced-transactions call (~100 credits). */
const MAX_WALLETS = 10;
const TX_LIMIT = 100;

/** HELIUS_API_KEY, or the api-key of a Helius URL in RPC_ENDPOINTS. */
export function heliusKey(): string | null {
  if (env.HELIUS_API_KEY) return env.HELIUS_API_KEY;
  for (const url of Object.values(env.rpcEndpoints)) {
    try {
      const u = new URL(url);
      if (u.host.includes('helius')) return u.searchParams.get('api-key');
    } catch {
      /* skip bad url */
    }
  }
  return null;
}

let conn: Connection | null = null;
let rpc: Rpc | null = null;
function heliusRpc(key: string): Rpc {
  if (!rpc) {
    const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
    rpc = new Rpc({ helius: url }, 'helius');
    conn = rpc.connection;
  }
  return rpc;
}

async function walletTxs(key: string, owner: string): Promise<ParsedTx[]> {
  return memo(`htx:${owner}`, 10 * 60_000, () =>
    fetchJson<ParsedTx[]>(`https://api.helius.xyz/v0/addresses/${owner}/transactions?api-key=${key}&limit=${TX_LIMIT}`, { timeoutMs: 8000 }));
}

async function otherTokens(owner: string, mint: string): Promise<string[]> {
  const pk = new PublicKey(owner);
  const lists = await Promise.all([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
    conn!.getParsedTokenAccountsByOwner(pk, { programId }).then((r) => r.value).catch(() => [])));
  const out: string[] = [];
  for (const a of lists.flat()) {
    const info = (a.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } }).parsed?.info;
    if (info?.mint && info.mint !== mint && (info.tokenAmount?.uiAmount ?? 0) > 0) out.push(info.mint);
  }
  return out;
}

/**
 * Look at the top holders of `mint`: SOL balance, age, who funded them, what they did with this coin,
 * what else they hold, and whether they were top holders of coins that rugged before.
 */
export async function analyzeHolders(mint: string, rugLinks: (wallets: string[]) => Map<string, number>): Promise<HolderReport> {
  const key = heliusKey();
  if (!key) throw new Error('holder analysis needs a Helius key (HELIUS_API_KEY or a helius= RPC endpoint)');
  const r = heliusRpc(key);
  const [loaded, supplyRes] = await Promise.all([loadHolders(r, mint), conn!.getTokenSupply(new PublicKey(mint))]);
  if ('error' in loaded) throw new Error(loaded.error);
  const supply = Number(supplyRes.value.amount);

  // People only: skip program-owned accounts (bonding curve, AMM vaults, lockers).
  const people = loaded.holders
    .filter((h) => h.owner && PublicKey.isOnCurve(new PublicKey(h.owner).toBytes()))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, MAX_WALLETS);
  const owners = people.map((h) => h.owner!);

  const held = new Map<string, string[]>();
  const balances = await conn!.getMultipleAccountsInfo(owners.map((o) => new PublicKey(o))).catch(() => null);
  const wallets: WalletInfo[] = await Promise.all(people.map(async (h, i): Promise<WalletInfo> => {
    const owner = h.owner!;
    const [txs, others] = await Promise.all([
      walletTxs(key, owner).catch(() => [] as ParsedTx[]),
      otherTokens(owner, mint).catch(() => [] as string[]),
    ]);
    held.set(owner, others);
    const act = walletActivity(owner, mint, txs, txs.length > 0 && txs.length < TX_LIMIT);
    return {
      owner,
      pct: supply > 0 ? (h.amount / supply) * 100 : 0,
      solBalance: balances ? (balances[i]?.lamports ?? 0) / 1e9 : null,
      txCount: txs.length,
      ...act,
      otherTokenCount: others.length,
      otherTokens: others.slice(0, 5),
      rugLinks: 0,
      flags: [],
    };
  }));

  const links = rugLinks([...owners, ...wallets.map((w) => w.fundedBy).filter((x): x is string => !!x)]);
  for (const w of wallets) w.rugLinks = (links.get(w.owner) ?? 0) + (w.fundedBy ? links.get(w.fundedBy) ?? 0 : 0);

  // Same "other" token held by several top holders = likely one operator.
  const shared = new Map<string, number>();
  for (const list of held.values()) for (const m of new Set(list)) shared.set(m, (shared.get(m) ?? 0) + 1);

  const { riskScore, flags } = scoreHolders(wallets);
  const overlap = [...shared].filter(([, n]) => n >= 3);
  if (overlap.length) flags.push(`${overlap.length} other token${overlap.length > 1 ? 's' : ''} held by 3+ of the same top holders`);
  return { mint, at: Date.now(), wallets, riskScore, flags, summary: null, summaryAt: null };
}
