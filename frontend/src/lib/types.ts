export interface Check { name: string; pass: boolean; detail: string; hard?: boolean }
export interface Ladder { roiPct: number; sellPct: number }
export interface Strategy {
  buyAmountSol: number; maxSlippagePct: number; minChannels: number; windowSec: number; socialMentions: 'off' | 'one' | 'each'; minScore: number;
  maxSignalAgeSec: number; maxRunupFromFirstPct: number; routes: 'any' | 'curve' | 'graduated'; markStaleSec: number;
  maxTop10HolderPct: number; requireMintAuthorityDisabled: boolean; requireFreezeAuthorityDisabled: boolean;
  rugcheckEnabled: boolean; holderAnalysisEnabled: boolean; maxHolderRisk: number; momentumObserveSec: number; minTrades60s: number; minBuyVolumeSol60s: number;
  minGraduatedVolumeUsd5m: number; takeProfitLadder: Ladder[]; trailingStopPct: number; hardStopLossPct: number;
  stagnationSec: number; maxOpenPositions: number; maxDailyLossSol: number; priorityFeeSol: number;
  jitoTipSol: number; pumpFeeBps: number; simulatedLatencyMs: number; rpc: string;
}
export interface Position {
  id: number; mint: string; symbol: string | null; mode: string; route: string; status: string;
  openedAt: number; closedAt: number | null; costSol: number; entryPriceSol: number; initialTokens: number;
  tokensHeld: number; realizedSol: number; ladderDone: number; peakPriceSol: number; lastPriceSol: number;
  lastActivityAt: number; closeReason: string | null; preset: string | null; lane: string | null; versionId: number | null; followUntil: number | null; followEnd: 'rugged' | 'stale' | '24h' | null;
  rules: { hardStopLossPct: number; trailingStopPct: number; takeProfitLadder: Ladder[] } | null;
}
export interface Signal {
  mint: string; symbol: string | null; firstSeen: number; channels: string[]; score: number;
  decision: string; reasons: Check[]; firstPriceSol: number | null; decisionPriceSol: number | null; updatedAt: number;
}
export interface Mention { id: number; mint: string; channelName: string; ts: number; snippet: string }
export interface ChatLine {
  id: number; ts: number; channelName: string; folder: string | null; text: string;
  cas: { address: string; status: 'checking' | 'mint' | 'not-mint' | 'error' }[];
}
export interface Trade {
  id: number; positionId: number; side: 'buy' | 'sell'; route: string; sol: number; tokens: number; priceSol: number;
  feeSol: number; impactPct: number; slippagePct: number; latencyMs: number; reason: string; ts: number;
}
export interface PositionDetail {
  position: Position; trades: Trade[]; ticks: { ts: number; price: number }[];
  rules: { hardStopLossPct: number; trailingStopPct: number; takeProfitLadder: Ladder[] } | null; serverTime: number;
  followEnd: 'rugged' | 'stale' | '24h' | null; followUntil: number | null; postExit: { peakPct: number; lowPct: number } | null;
}
export interface Activity { id?: number; ts: number; level: string; text: string }
export interface TradeRef { id: number; symbol: string | null; mint: string; pnlSol: number; pnlPct: number; closedAt: number }
export interface AllTimeStats {
  mode: string; count: number; wins: number; losses: number; winRate: number;
  pnlSol: number; grossWinSol: number; grossLossSol: number; profitFactor: number | null;
  avgWinSol: number; avgLossSol: number; expectancySol: number; avgPnlPct: number;
  biggestWin: TradeRef | null; biggestLoss: TradeRef | null; bestPct: TradeRef | null; worstPct: TradeRef | null;
  longestWinStreak: number; longestLossStreak: number; currentStreak: number;
  kills: number; deaths: number; assists: number; kda: number;
  avgHoldMs: number; maxDrawdownSol: number; firstAt: number | null; lastAt: number | null;
}
export interface Preset { id: string; name: string; description: string; builtIn: boolean; values: Partial<Strategy>; versionId?: number; version?: number }
export type Author = 'user' | 'optimizer' | 'advisor';
export type Stage = 'draft' | 'replay-passed' | 'paper' | 'live-canary' | 'live' | 'retired';
export type PresetValues = Omit<Strategy, 'rpc' | 'priorityFeeSol' | 'jitoTipSol' | 'pumpFeeBps' | 'simulatedLatencyMs'>;
export interface VersionRow {
  id: number; strategyId: string; version: number; parentId: number | null; values: PresetValues;
  author: Author; note: string; stage: Stage; createdAt: number;
}
export interface StrategyRow { id: string; name: string; description: string; builtIn: boolean; archived: boolean; createdAt: number; latest: VersionRow }
export interface VersionStat { versionId: number; count: number; wins: number; pnl: number; avgPnlPct: number; maxDrawdownSol: number }
export interface StrategyDetail { strategy: StrategyRow; versions: VersionRow[]; stats: VersionStat[]; curves: Record<string, { ts: number; pnl: number }[]> }
export interface HardLimits {
  agentLiveEnabled: boolean; maxBuySol: number | null; maxDailyLossSol: number | null; maxOpen: number | null;
  canaryBuySol: number | null; rollbackLossSol: number | null;
}
export interface ArenaLane {
  id: string; name: string; balanceSol: number; startingSol: number; open: number; count: number; wins: number;
  pnl: number; avgPnlPct: number; worstPct: number; avgPeakPct: number; rank: number; qualified: boolean;
}
export interface Arena { enabled: boolean; autoSelect: boolean; leader: { id: string; since: number } | null; minTrades: number; lanes: ArenaLane[] }
export interface Stats { pnl: number; wins: number; count: number }
export interface SocialStatus {
  state: 'disabled' | 'polling' | 'error'; accounts: string[]; lastMessageAt: number | null;
  lastPollAt: number | null; pollSec: number; error: string | null;
}
export interface TgFolder { link: string; title: string | null; channels: number; error: string | null }
export interface Snapshot {
  mode: 'paper' | 'live'; liveAvailable: boolean; killSwitch: boolean;
  wallet: { balanceSol: number; startingSol: number };
  rpc: { current: string; pingMs: number | null; options: { name: string; url: string }[] };
  feed: { source: string; connected: boolean; tracked: number };
  telegram: { state: string; channels: { id: string; title: string; folder: string | null }[]; folders: TgFolder[]; lastMessageAt: number | null; recoveredByPoll: number; error: string | null };
  social: { x: SocialStatus; threads: SocialStatus };
  strategy: Strategy; presets: Preset[]; activePresetId: string | null; mainVersionId: number | null; versionStats: VersionStat[]; hardLimits: HardLimits;
  tokenStatus: { source: 'none' | 'env' | 'rotated'; rotatedAt: number | null }; arena: Arena;
  positions: Position[]; closed: Position[]; signals: Signal[]; mentions: Mention[];
  activity: Activity[]; activityTotal: number; chats: ChatLine[]; stats: { today: Stats; all: Stats }; serverTime: number;
}

export interface HolderWallet {
  owner: string; pct: number; solBalance: number | null; txCount: number; firstSeenTs: number | null; fundedBy: string | null;
  buys: number; sells: number; boughtTokens: number; soldTokens: number; solIn: number; solOut: number;
  otherTokenCount: number; otherTokens: string[]; rugLinks: number; flags: string[];
}
export interface HolderReport {
  mint: string; at: number; wallets: HolderWallet[]; riskScore: number; flags: string[]; summary: string | null; summaryAt: number | null;
}

export type PortfolioRange = '1d' | '7d' | '30d' | 'all';
export interface PortfolioGroup { name: string; count: number; pnl: number; winRate: number }
export interface Portfolio {
  range: PortfolioRange; mode: string;
  equity: { ts: number; total: number; cash: number; open: number; pnl: number }[];
  drawdown: { ts: number; dd: number }[];
  daily: { day: string; pnl: number; count: number; wins: number }[];
  byVersion: PortfolioGroup[]; byRoute: PortfolioGroup[]; byExit: PortfolioGroup[];
  stats: AllTimeStats;
  closed: {
    id: number; mint: string; symbol: string | null; route: string; versionId: number | null; cost: number; realized: number;
    ladder: number; opened: number; closed: number; closeReason: string | null; followEnd: string | null; strategy: string;
  }[];
}

export type DiscoveryBoard = 'new' | 'soon' | 'graduated' | 'trending' | 'promoted';
export interface DiscoveryToken {
  mint: string; symbol: string; name: string; creator: string; createdAt: number; devBuyPct: number; firstMcSol: number;
  bondingPct: number; realSol: number; migratedAt: number | null; promoted: boolean; origin: string;
  market: { priceUsd: number | null; mcUsd: number | null; liqUsd: number | null; vol5mUsd: number; vol1hUsd: number;
    buys5m: number; sells5m: number; change5mPct: number; socials: string[]; updatedAt: number } | null;
  board: string; score: number; decision: string | null;
}
export interface DiscoveryList {
  board: DiscoveryBoard; tokens: DiscoveryToken[]; serverTime: number;
  status: { enabled: boolean; connected: boolean; lastEventAt: number | null; tracked: number };
}
