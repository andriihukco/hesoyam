/** One top holder of a token, as seen through its recent on-chain history. */
export interface WalletInfo {
  owner: string;
  /** Share of supply held, in percent. */
  pct: number;
  solBalance: number | null;
  /** Transactions found (capped at the fetch limit). */
  txCount: number;
  /** Oldest transaction time, only when the fetch reached the start of the wallet's history. */
  firstSeenTs: number | null;
  /** Wallet that sent this one its first SOL (≥ 0.05), when history was complete. */
  fundedBy: string | null;
  buys: number;
  sells: number;
  boughtTokens: number;
  soldTokens: number;
  solIn: number;
  solOut: number;
  /** Other tokens currently held (count) and a few of their mints. */
  otherTokenCount: number;
  otherTokens: string[];
  /** How many past rugged coins this wallet (or its funder) was a top holder of. */
  rugLinks: number;
  flags: string[];
}

export interface HolderReport {
  mint: string;
  at: number;
  wallets: WalletInfo[];
  riskScore: number;
  flags: string[];
  /** Claude's written summary, filled on request. */
  summary: string | null;
  summaryAt: number | null;
}

const DAY = 86_400_000;

/**
 * Pure rule score, 0 (clean) to 100 (very likely coordinated or rug-linked).
 * Sets per-wallet flags and returns token-level flags.
 */
export function scoreHolders(wallets: WalletInfo[], now = Date.now()): { riskScore: number; flags: string[] } {
  const flags: string[] = [];
  const byFunder = new Map<string, WalletInfo[]>();
  let fresh = 0, dust = 0, dump = 0, rug = 0, bundled = 0, bundledPct = 0;

  for (const w of wallets) {
    w.flags = [];
    if (w.firstSeenTs !== null && now - w.firstSeenTs < 3 * DAY) {
      w.flags.push('fresh');
      fresh++;
    }
    if (w.pct >= 2 && w.solBalance !== null && w.solBalance < 0.05) {
      w.flags.push('no SOL');
      dust++;
    }
    if (w.sells > 0 && w.soldTokens >= w.boughtTokens * 0.5 && w.boughtTokens > 0) {
      w.flags.push('dumping');
      dump++;
    }
    if (w.rugLinks > 0) {
      w.flags.push(`rug-linked ×${w.rugLinks}`);
      rug++;
    }
    if (w.fundedBy) byFunder.set(w.fundedBy, [...(byFunder.get(w.fundedBy) ?? []), w]);
  }

  for (const [funder, group] of byFunder) {
    if (group.length < 2) continue;
    const pct = group.reduce((a, w) => a + w.pct, 0);
    for (const w of group) w.flags.push(`same funder ${funder.slice(0, 4)}…`);
    bundled += group.length;
    bundledPct += pct;
    flags.push(`${group.length} holders funded by ${funder.slice(0, 4)}…${funder.slice(-4)} (${pct.toFixed(1)}% of supply)`);
  }
  if (fresh) flags.push(`${fresh} fresh wallet${fresh > 1 ? 's' : ''} (< 3 days)`);
  if (rug) flags.push(`${rug} holder${rug > 1 ? 's' : ''} linked to past rugs`);
  if (dump) flags.push(`${dump} holder${dump > 1 ? 's' : ''} already selling`);
  if (dust) flags.push(`${dust} large holder${dust > 1 ? 's' : ''} with almost no SOL`);

  const score =
    Math.min(40, bundled * 8 + bundledPct) +
    Math.min(25, fresh * 5) +
    Math.min(35, rug * 15) +
    Math.min(10, dump * 3) +
    Math.min(10, dust * 3);
  return { riskScore: Math.min(100, Math.round(score)), flags };
}

/** One parsed transaction, the subset of Helius' enhanced format we use. */
export interface ParsedTx {
  timestamp: number;
  nativeTransfers?: { fromUserAccount: string; toUserAccount: string; amount: number }[];
  tokenTransfers?: { fromUserAccount: string; toUserAccount: string; mint: string; tokenAmount: number }[];
}

/** Pure: what a wallet did with `mint`, where its first SOL came from, and how old it is. */
export function walletActivity(owner: string, mint: string, txs: ParsedTx[], complete: boolean) {
  let buys = 0, sells = 0, boughtTokens = 0, soldTokens = 0, solIn = 0, solOut = 0;
  for (const tx of txs) {
    const tt = (tx.tokenTransfers ?? []).filter((t) => t.mint === mint);
    if (!tt.length) continue;
    const got = tt.filter((t) => t.toUserAccount === owner).reduce((a, t) => a + t.tokenAmount, 0);
    const gave = tt.filter((t) => t.fromUserAccount === owner).reduce((a, t) => a + t.tokenAmount, 0);
    const nat = tx.nativeTransfers ?? [];
    const solOutTx = nat.filter((n) => n.fromUserAccount === owner).reduce((a, n) => a + n.amount, 0) / 1e9;
    const solInTx = nat.filter((n) => n.toUserAccount === owner).reduce((a, n) => a + n.amount, 0) / 1e9;
    if (got > gave) { buys++; boughtTokens += got - gave; solOut += solOutTx; }
    else if (gave > got) { sells++; soldTokens += gave - got; solIn += solInTx; }
  }
  let firstSeenTs: number | null = null;
  let fundedBy: string | null = null;
  if (complete && txs.length) {
    const oldestFirst = [...txs].sort((a, b) => a.timestamp - b.timestamp);
    firstSeenTs = oldestFirst[0]!.timestamp * 1000;
    for (const tx of oldestFirst) {
      const f = (tx.nativeTransfers ?? []).find((n) => n.toUserAccount === owner && n.fromUserAccount !== owner && n.amount >= 0.05e9);
      if (f) { fundedBy = f.fromUserAccount; break; }
    }
  }
  return { buys, sells, boughtTokens, soldTokens, solIn, solOut, firstSeenTs, fundedBy };
}
