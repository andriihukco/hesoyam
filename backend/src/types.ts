export type Mode = 'paper' | 'live';
export type Route = 'pump-curve' | 'jupiter';

export interface Mention {
  id?: number;
  mint: string;
  channelId: string;
  channelName: string;
  ts: number;
  snippet: string;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  /** Hard failures never get re-evaluated (e.g. mint authority enabled). */
  hard?: boolean;
  /** Arena: lane id this line summarises, and that lane's decision. */
  lane?: string;
  decision?: string;
}

export type Decision = 'pending' | 'buy' | 'reject' | 'error' | 'skipped';

export interface SignalRecord {
  mint: string;
  symbol: string | null;
  firstSeen: number;
  channels: string[];
  score: number;
  decision: Decision;
  reasons: CheckResult[];
  firstPriceSol: number | null;
  decisionPriceSol: number | null;
  updatedAt: number;
}

export interface Position {
  id: number;
  mint: string;
  symbol: string | null;
  mode: Mode;
  route: Route;
  status: 'open' | 'closed';
  openedAt: number;
  closedAt: number | null;
  decimals: number;
  costSol: number;
  entryPriceSol: number;
  initialTokens: number;
  tokensHeld: number;
  realizedSol: number;
  ladderDone: number;
  peakPriceSol: number;
  lastPriceSol: number;
  lastActivityAt: number;
  closeReason: string | null;
  /** Preset name active when the position was opened; null = custom settings. */
  preset: string | null;
  /** Arena lane (preset id) that owns the position; null = the main strategy. */
  lane: string | null;
  /** Strategy version whose rules opened the position (null only before migration). */
  versionId: number | null;
  /** Exit rules in force when the position opened (null for positions from before this was stored). */
  rules: ExitRules | null;
}

export interface ExitRules {
  hardStopLossPct: number;
  trailingStopPct: number;
  takeProfitLadder: { roiPct: number; sellPct: number }[];
}

export interface Trade {
  id?: number;
  positionId: number;
  side: 'buy' | 'sell';
  route: Route;
  sol: number;
  tokens: number;
  priceSol: number;
  feeSol: number;
  impactPct: number;
  slippagePct: number;
  latencyMs: number;
  reason: string;
  ts: number;
}
