import { PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { env } from '../config/env.js';
import type { Strategy } from '../config/strategy.js';
import type { Rpc } from '../lib/rpc.js';
import { errMsg, fetchJson, memo } from '../lib/util.js';
import type { CheckResult } from '../types.js';

export interface MintFacts {
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export function loadMint(rpc: Rpc, mint: string, programId: string): Promise<MintFacts> {
  return memo(`mint:${mint}`, 60_000, () => loadMintRaw(rpc, mint, programId));
}

async function loadMintRaw(rpc: Rpc, mint: string, programId: string): Promise<MintFacts> {
  const m = await getMint(rpc.connection, new PublicKey(mint), 'confirmed', new PublicKey(programId));
  return {
    decimals: m.decimals,
    supply: m.supply,
    mintAuthority: m.mintAuthority?.toBase58() ?? null,
    freezeAuthority: m.freezeAuthority?.toBase58() ?? null,
  };
}

export function authorityChecks(f: MintFacts, s: Strategy): CheckResult[] {
  const out: CheckResult[] = [];
  if (s.requireMintAuthorityDisabled) {
    out.push({ name: 'mint authority', pass: f.mintAuthority === null, hard: true,
      detail: f.mintAuthority ? `enabled (${f.mintAuthority.slice(0, 6)}…)` : 'disabled' });
  }
  if (s.requireFreezeAuthorityDisabled) {
    out.push({ name: 'freeze authority', pass: f.freezeAuthority === null, hard: true,
      detail: f.freezeAuthority ? `enabled (${f.freezeAuthority.slice(0, 6)}…)` : 'disabled' });
  }
  return out;
}

export interface Holder {
  amount: number;
  owner: string | undefined;
}

/** Pure: top-10 share of supply, skipping accounts owned by PDAs (curves, AMM vaults, lockers). */
export function top10Share(holders: Holder[], supply: number): { pct: number; excluded: number } {
  let excluded = 0;
  const people: number[] = [];
  for (const h of [...holders].sort((a, b) => b.amount - a.amount)) {
    if (h.owner && !PublicKey.isOnCurve(new PublicKey(h.owner).toBytes())) {
      excluded++;
      continue;
    }
    people.push(h.amount);
  }
  const top = people.slice(0, 10).reduce((x, y) => x + y, 0);
  return { pct: supply > 0 ? (top / supply) * 100 : 100, excluded };
}

async function holdersFromRpc(rpc: Rpc, mint: string): Promise<Holder[]> {
  const largest = await rpc.connection.getTokenLargestAccounts(new PublicKey(mint), 'confirmed');
  const accounts = largest.value.slice(0, 20);
  const parsed = await rpc.connection.getMultipleParsedAccounts(accounts.map((a) => a.address));
  return accounts.map((a, i) => {
    const data = parsed.value[i]?.data;
    const owner = data && 'parsed' in data ? (data.parsed?.info?.owner as string | undefined) : undefined;
    return { amount: Number(a.amount), owner };
  });
}

async function holdersFromRugcheck(mint: string): Promise<Holder[]> {
  const r = await fetchJson<{ topHolders?: { amount: number; owner?: string }[] }>(
    `${env.RUGCHECK_API_URL}/tokens/${mint}/report`, { timeoutMs: 6000 });
  if (!r.topHolders?.length) throw new Error('no holder data');
  return r.topHolders.map((h) => ({ amount: Number(h.amount), owner: h.owner }));
}

/** RPC first; if it fails (public RPC rate-limits this call), RugCheck's holder list. Fails closed. */
/** Top-10 holder share in %, or null when holders cannot be loaded. Shares the holderCheck cache. */
export async function holderTop10(rpc: Rpc, mint: string, f: MintFacts): Promise<number | null> {
  const r = await memo(`holders:${mint}`, 60_000, () => loadHolders(rpc, mint));
  return 'error' in r ? null : top10Share(r.holders, Number(f.supply)).pct;
}

export async function holderCheck(rpc: Rpc, mint: string, f: MintFacts, s: Strategy): Promise<CheckResult> {
  const r = await memo(`holders:${mint}`, 60_000, () => loadHolders(rpc, mint));
  if ('error' in r) return { name: 'top10 holders', pass: false, detail: r.error };
  const { pct, excluded } = top10Share(r.holders, Number(f.supply));
  const via = r.via;
  return {
    name: 'top10 holders',
    pass: pct <= s.maxTop10HolderPct,
    detail: `${pct.toFixed(1)}% (limit ${s.maxTop10HolderPct}%, ${excluded} program accts excluded, via ${via})`,
  };
}

async function loadHolders(rpc: Rpc, mint: string): Promise<{ holders: Holder[]; via: string } | { error: string }> {
  try {
    return { holders: await holdersFromRpc(rpc, mint), via: 'rpc' };
  } catch (rpcErr) {
    try {
      return { holders: await holdersFromRugcheck(mint), via: 'rugcheck (rpc failed)' };
    } catch (e) {
      return { error: `unknown: rpc ${errMsg(rpcErr).slice(0, 40)}; rugcheck ${errMsg(e)}` };
    }
  }
}

interface RugSummary {
  score?: number;
  score_normalised?: number;
  risks?: { name: string; level: string; description?: string }[];
}

/** Raw RugCheck summary (cached 60 s). Throws on network failure. */
export function rugcheckSummary(mint: string): Promise<RugSummary> {
  return memo(`rug:${mint}`, 60_000, () =>
    fetchJson<RugSummary>(`${env.RUGCHECK_API_URL}/tokens/${mint}/report/summary`, { timeoutMs: 4000 }));
}

/** Second opinion. Network failure does not block (reported as pass with a note). */
export async function rugcheck(mint: string, s: Strategy): Promise<CheckResult | null> {
  if (!s.rugcheckEnabled) return null;
  try {
    const r = await rugcheckSummary(mint);
    const danger = (r.risks ?? []).filter((x) => x.level === 'danger');
    return {
      name: 'rugcheck',
      pass: danger.length === 0,
      detail: danger.length ? danger.map((d) => d.name).join(', ') : `no danger risks (score ${r.score_normalised ?? r.score ?? '?'})`,
    };
  } catch (e) {
    return { name: 'rugcheck', pass: true, detail: `unavailable: ${errMsg(e)} (not blocking)` };
  }
}
