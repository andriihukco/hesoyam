import type { Db } from '../db/db.js';
import type { MintFacts } from '../risk/checks.js';
import type { Route } from '../types.js';

export interface FactsDeps {
  db: Db;
  now: () => number;
  loadMint: (mint: string) => Promise<MintFacts>;
  top10: (mint: string, f: MintFacts) => Promise<number | null>;
  rugcheck: (mint: string) => Promise<unknown>;
}

const settle = async <T>(p: () => Promise<T>): Promise<T | null> => {
  try {
    return await p();
  } catch {
    return null;
  }
};

/**
 * Risk facts captured once per signal, whatever the decision, so replay can re-apply any risk filter.
 * Never throws: what failed is stored as null. The first row for a mint wins.
 */
export async function captureFacts(deps: FactsDeps, mint: string, route: Route): Promise<void> {
  const f = await settle(() => deps.loadMint(mint));
  const [top10, rug] = await Promise.all([
    f ? settle(() => deps.top10(mint, f)) : Promise.resolve(null),
    settle(() => deps.rugcheck(mint)),
  ]);
  const bit = (x: boolean | undefined) => (x === undefined ? null : x ? 1 : 0);
  deps.db.sql
    .prepare(
      `INSERT OR IGNORE INTO signal_facts(mint, decimals, route_at_first, mint_auth_off, freeze_auth_off, top10_pct, rugcheck, captured_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(mint, f?.decimals ?? null, route, bit(f ? f.mintAuthority === null : undefined), bit(f ? f.freezeAuthority === null : undefined),
      top10, rug === null ? null : JSON.stringify(rug), deps.now());
}
