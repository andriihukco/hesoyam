import { PublicKey } from '@solana/web3.js';

export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_TOKEN_DECIMALS = 6;
export const LAMPORTS = 1_000_000_000;

export interface CurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export function bondingCurvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP_PROGRAM_ID)[0];
}

/** Layout: 8-byte discriminator, 5 × u64, bool. */
export function decodeCurve(data: Buffer): CurveState {
  if (data.length < 49) throw new Error('bonding curve account too small');
  return {
    virtualTokenReserves: data.readBigUInt64LE(8),
    virtualSolReserves: data.readBigUInt64LE(16),
    realTokenReserves: data.readBigUInt64LE(24),
    realSolReserves: data.readBigUInt64LE(32),
    tokenTotalSupply: data.readBigUInt64LE(40),
    complete: data[48] === 1,
  };
}

/** SOL per whole token at the current curve point. */
export function spotPriceSol(c: CurveState): number {
  return Number(c.virtualSolReserves) / LAMPORTS / (Number(c.virtualTokenReserves) / 10 ** PUMP_TOKEN_DECIMALS);
}

/** Constant-product buy. Fee taken from SOL in. Returns raw token units. */
export function curveBuyOut(c: CurveState, lamportsIn: bigint, feeBps: number): bigint {
  const net = (lamportsIn * BigInt(10_000 - Math.round(feeBps))) / 10_000n;
  if (net <= 0n) return 0n;
  const k = c.virtualTokenReserves * c.virtualSolReserves;
  const newVT = k / (c.virtualSolReserves + net) + 1n;
  let out = c.virtualTokenReserves - newVT;
  if (out > c.realTokenReserves) out = c.realTokenReserves;
  return out > 0n ? out : 0n;
}

/**
 * Constant-product sell. Fee taken from SOL out. Returns lamports.
 * Not capped by realSolReserves: when we sell tokens we bought, our own buy funded the curve.
 * (A paper buy does not change the real curve, so capping would wrongly return 0 on untraded curves.)
 */
export function curveSellOut(c: CurveState, tokensIn: bigint, feeBps: number): bigint {
  if (tokensIn <= 0n) return 0n;
  const k = c.virtualTokenReserves * c.virtualSolReserves;
  const newVS = k / (c.virtualTokenReserves + tokensIn) + 1n;
  const gross = c.virtualSolReserves - newVS;
  if (gross <= 0n) return 0n;
  return (gross * BigInt(10_000 - Math.round(feeBps))) / 10_000n;
}
