import { call, sol, tone } from '../lib/api';
import type { ArenaLane, Snapshot } from '../lib/types';
import { Group, Switch } from './ui';
import { useConfirm } from './ConfirmSheet';

/** Arena: every preset paper-trades the same signals at once; leaderboard ranked by total PnL. */
export function Arena({ s, onError }: { s: Snapshot; onError: (e: string) => void }) {
  const a = s.arena;
  const run = (fn: () => Promise<unknown>) => void fn().catch((e) => onError((e as Error).message));
  const set = (patch: { enabled?: boolean; autoSelect?: boolean }) => run(() => call('POST', '/api/arena', patch));
  const ask = useConfirm();
  const use = async (l: ArenaLane) => {
    if (await ask({ title: `Make "${l.name}" your main strategy?`, body: 'Open positions keep their own exit rules.', confirm: 'Use' }))
      run(() => call('POST', `/api/presets/${encodeURIComponent(l.id)}/apply`));
  };
  const leaderHours = a.leader ? (s.serverTime - a.leader.since) / 3_600_000 : 0;

  return (
    <Group
      title="Arena"
      footer={a.enabled
        ? `Ranked by total PnL. A lane counts only after ${a.minTrades} closed trades; before that the order is mostly luck. Win % is shown but not used to rank.`
        : 'Runs every preset at the same time on the same signals, each with its own 10 SOL paper wallet, and ranks them. Your main strategy pauses new buys while Arena runs.'}
    >
      <div className="row-sep flex items-center justify-between gap-3 px-4 py-2 text-[15px]">
        <span>Test all presets in parallel</span>
        <Switch label="Arena mode" checked={a.enabled} onChange={(v) => set({ enabled: v })} />
      </div>
      {a.enabled && (
        <>
          <div className="row-sep flex items-center justify-between gap-3 px-4 py-2 text-[15px]">
            <span>
              Auto-select best
              <span className="block text-[12px] text-label-2">Applies the leader after it leads for 24 h</span>
            </span>
            <Switch label="Auto-select best" checked={a.autoSelect} onChange={(v) => set({ autoSelect: v })} />
          </div>
          {a.lanes.map((l) => {
            const isLeader = a.leader?.id === l.id;
            const isMain = s.activePresetId === l.id;
            return (
              <div key={l.id} className="row-sep flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold ${isLeader ? 'bg-pos-solid text-white' : 'bg-fill text-label-2'}`}>
                  {l.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[15px] font-medium">
                    <span className="truncate">{l.name}</span>
                    {isMain && <span className="shrink-0 rounded bg-tint/15 px-1.5 text-[11px] font-semibold text-tint">MAIN</span>}
                    {isLeader && <span className="shrink-0 text-[11px] font-semibold text-pos">leader {leaderHours.toFixed(0)}h</span>}
                  </div>
                  <div className="text-[12px] tabular-nums text-label-2">
                    {l.count} trades{!l.qualified && ` / ${a.minTrades}`}
                    {l.count > 0 && <> · {Math.round((l.wins / l.count) * 100)}% win · avg {l.avgPnlPct >= 0 ? '+' : ''}{l.avgPnlPct.toFixed(0)}% · worst {l.worstPct.toFixed(0)}%</>}
                    {l.open > 0 && <> · {l.open} open</>}
                  </div>
                  {!l.qualified && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-fill" aria-hidden>
                      <div className="h-full rounded-full bg-tint" style={{ width: `${Math.min(100, (l.count / a.minTrades) * 100)}%` }} />
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-[15px] font-semibold tabular-nums ${tone(l.pnl)}`}>{l.pnl >= 0 ? '+' : ''}{sol(l.pnl, 3)}</div>
                  <div className="text-[11px] text-label-3">{sol(l.balanceSol, 2)} SOL</div>
                  {!isMain && l.count > 0 && (
                    <button className="mt-0.5 text-[13px] font-medium text-tint" onClick={() => void use(l)}>Use</button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </Group>
  );
}
