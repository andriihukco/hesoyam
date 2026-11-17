import { PublicKey } from '@solana/web3.js';

// Base58 run of 32–44 chars, not part of a longer base58 run (avoids slices of tx signatures).
const CA_REGEX = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;

/** Well-known mints and programs that are never a "call". */
export const IGNORED = new Set([
  'So11111111111111111111111111111111111111112', // wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // pump.fun program
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUJoi5QNyVTaV4',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
]);

/**
 * Pull candidate Solana addresses out of message text. Only syntax is checked here
 * (valid 32-byte base58); whether it is a token mint is checked on-chain later.
 */
export function extractCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CA_REGEX)) {
    const s = m[0];
    if (IGNORED.has(s) || out.has(s)) continue;
    try {
      if (new PublicKey(s).toBase58() === s) out.add(s);
    } catch {
      // not a valid 32-byte key
    }
  }
  return [...out];
}

export function snippet(text: string, around: string, width = 60): string {
  const i = text.indexOf(around);
  const start = Math.max(0, i - width);
  const end = Math.min(text.length, (i < 0 ? 0 : i + around.length) + width);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}
