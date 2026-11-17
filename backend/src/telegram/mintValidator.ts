import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, MINT_SIZE } from '@solana/spl-token';
import type { Rpc } from '../lib/rpc.js';

export interface MintInfo {
  mint: string;
  programId: string;
}

/** Confirms a candidate is a live SPL / Token-2022 mint. Results are cached (also negatives). */
export class MintValidator {
  private cache = new Map<string, MintInfo | null>();

  constructor(private rpc: Rpc) {}

  async validate(candidate: string): Promise<MintInfo | null> {
    if (this.cache.has(candidate)) return this.cache.get(candidate)!;
    const info = await this.rpc.connection.getAccountInfo(new PublicKey(candidate));
    let result: MintInfo | null = null;
    if (info) {
      const owner = info.owner.toBase58();
      const isLegacy = owner === TOKEN_PROGRAM_ID.toBase58() && info.data.length === MINT_SIZE;
      const is2022 = owner === TOKEN_2022_PROGRAM_ID.toBase58() && info.data.length >= MINT_SIZE;
      if (isLegacy || is2022) result = { mint: candidate, programId: owner };
    }
    // Note: a not-yet-created mint returns null; it is cached as negative. Rare for calls.
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(candidate, result);
    return result;
  }
}
