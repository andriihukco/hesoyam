/** Arena: every preset trades the same signals at once in paper mode, each with its own wallet. */

export const ARENA_MIN_TRADES = 30;
export const ARENA_LEAD_HOLD_MS = 24 * 3600_000;
export const ARENA_MAX_LANES = 8;

export interface ArenaState {
  enabled: boolean;
  /** Apply the leader as the main strategy once it has led for ARENA_LEAD_HOLD_MS. */
  autoSelect: boolean;
  leader: { id: string; since: number } | null;
}

export const DEFAULT_ARENA: ArenaState = { enabled: false, autoSelect: false, leader: null };

export interface LaneStats {
  id: string;
  count: number;
  wins: number;
  pnl: number;
  avgPnlPct: number;
}

/**
 * Rank by total PnL (then average PnL per trade). Win rate is NOT used: a strategy that
 * takes profit early wins often but small. Only lanes with enough closed trades qualify.
 */
export function rankLanes<T extends LaneStats>(lanes: T[], minTrades = ARENA_MIN_TRADES): (T & { rank: number; qualified: boolean })[] {
  return [...lanes]
    .sort((a, b) => {
      const qa = a.count >= minTrades ? 1 : 0;
      const qb = b.count >= minTrades ? 1 : 0;
      return qb - qa || b.pnl - a.pnl || b.avgPnlPct - a.avgPnlPct;
    })
    .map((l, i) => ({ ...l, rank: i + 1, qualified: l.count >= minTrades }));
}

/** Track who leads and decide whether auto-select should apply them now. Pure. */
export function leaderStep(
  state: ArenaState,
  ranked: { id: string; qualified: boolean }[],
  activePresetId: string | null,
  now: number,
): { leader: ArenaState['leader']; apply: string | null } {
  const top = ranked[0];
  if (!top?.qualified) return { leader: null, apply: null };
  const leader = state.leader?.id === top.id ? state.leader : { id: top.id, since: now };
  const apply = state.autoSelect && now - leader.since >= ARENA_LEAD_HOLD_MS && activePresetId !== top.id ? top.id : null;
  return { leader, apply };
}
