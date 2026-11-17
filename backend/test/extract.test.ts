import { describe, expect, it } from 'vitest';
import { extractCandidates, snippet } from '../src/telegram/extract.js';

const MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';

describe('extractCandidates', () => {
  it('finds a CA in text and in a pump.fun link', () => {
    expect(extractCandidates(`CA: ${MINT} 🚀`)).toEqual([MINT]);
    expect(extractCandidates(`https://pump.fun/coin/${MINT}`)).toEqual([MINT]);
  });
  it('dedupes and ignores wSOL / USDC', () => {
    const t = `${MINT} ${MINT} So11111111111111111111111111111111111111112 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`;
    expect(extractCandidates(t)).toEqual([MINT]);
  });
  it('does not take slices of a tx signature', () => {
    const sig = '5'.repeat(10) + 'VERYLONGbase58signature'.replace(/[0OIl]/g, 'x') + 'a'.repeat(50);
    expect(extractCandidates(sig)).toEqual([]);
  });
  it('rejects base58 strings that are not 32 bytes', () => {
    expect(extractCandidates('z'.repeat(44))).toEqual([]); // decodes to >32 bytes
    expect(extractCandidates('hello world no address here')).toEqual([]);
  });
  it('snippet shows context', () => {
    expect(snippet(`buy ${MINT} now`, MINT)).toContain('buy');
  });
});
