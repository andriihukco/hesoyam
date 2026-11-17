export interface Check { name: string; pass: boolean; detail: string; hard?: boolean }
export interface Ladder { roiPct: number; sellPct: number }
export interface Strategy {
  buyAmountSol: number; maxSlippagePct: number; minChannels: number; windowSec: number; minScore: number;
  maxSignalAgeSec: number; maxRunupFromFirstPct: number; routes: 'any' | 'curve' | 'graduated'; markStaleSec: number;
  maxTop10HolderPct: number; requireMintAuthorityDisabled: boolean; requireFreezeAuthorityDisabled: boolean;
  rugcheckEnabled: boolean; momentumObserveSec: number; minTrades60s: number; minBuyVolumeSol60s: number;
  minGraduatedVolumeUsd5m: number; takeProfitLadder: Ladder[]; trailingStopPct: number; hardStopLossPct: number;
  stagnationSec: number; maxOpenPositions: number; maxDailyLossSol: number; priorityFeeSol: number;
  jitoTipSol: number; pumpFeeBps: number; simulatedLatencyMs: number; rpc: string;
}
export interface Position {
  id: number; mint: string; symbol: string | null; mode: string; route: string; status: string;
  openedAt: number; closedAt: number | null; costSol: number; entryPriceSol: number; initialTokens: number;
  tokensHeld: number; realizedSol: number; ladderDone: number; peakPriceSol: number; lastPriceSol: number;
  lastActivityAt: number; closeReason: string | null; preset: string | null; lane: string | null;
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
export interface Preset { id: string; name: string; description: string; builtIn: boolean; values: Partial<Strategy> }
export interface PresetStat { preset: string | null; count: number; wins: number; pnl: number; avgPnlPct: number }
export interface ArenaLane {
  id: string; name: string; balanceSol: number; startingSol: number; open: number; count: number; wins: number;
  pnl: number; avgPnlPct: number; worstPct: number; avgPeakPct: number; rank: number; qualified: boolean;
}
export interface Arena { enabled: boolean; autoSelect: boolean; leader: { id: string; since: number } | null; minTrades: number; lanes: ArenaLane[] }
export interface Stats { pnl: number; wins: number; count: number }
export interface Snapshot {
  mode: 'paper' | 'live'; liveAvailable: boolean; killSwitch: boolean;
  wallet: { balanceSol: number; startingSol: number };
  rpc: { current: string; pingMs: number | null; options: { name: string; url: string }[] };
  feed: { source: string; connected: boolean; tracked: number };
  telegram: { state: string; channels: { id: string; title: string; folder: string | null }[]; lastMessageAt: number | null; recoveredByPoll: number; error: string | null };
  strategy: Strategy; presets: Preset[]; activePresetId: string | null; presetStats: PresetStat[]; arena: Arena;
  positions: Position[]; closed: Position[]; signals: Signal[]; mentions: Mention[];
  activity: Activity[]; activityTotal: number; chats: ChatLine[]; stats: { today: Stats; all: Stats }; serverTime: number;
}
