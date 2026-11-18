import { useState } from 'react';
import { call, sol, tone } from '../lib/api';
import type { Snapshot, Stage, StrategyRow, VersionRow } from '../lib/types';
import { Arena } from '../components/Arena';
import { Group } from '../components/ui';
import { StrategyDetail } from './StrategyDetail';

export const stageStyle: Record<Stage, string> = {
  draft: 'bg-fill text-label-2',
  'replay-passed': 'bg-tint/15 text-tint',
  paper: 'bg-tint/15 text-tint',
  'live-canary': 'bg-warn-solid/15 text-warn',
  live: 'bg-pos-solid/15 text-pos',
  retired: 'bg-fill text-label-3',
};
export const authorLabel: Record<VersionRow['author'], string> = { user: 'you', optimizer: 'optimizer', advisor: 'advisor' };

/** Strategy list with per-version paper results; tap opens the detail page. Arena sits on top. */
export function Strategies({ s, onError }: { s: Snapshot; onError: (e: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (open) return <StrategyDetail id={open} s={s} onBack={() => setOpen(null)} onError={onError} />;

  const create = async () => {
    setBusy(true);
    try {
      const v = await call<VersionRow>('POST', '/api/strategies', { name });
      setName('');
      setOpen(v.strategyId);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="px-4">
        <h2 className="text-[22px] font-bold tracking-tight">Strategies</h2>
        <p className="text-[13px] text-label-2">
          Main: {s.presets.find((p) => p.id === s.activePresetId)?.name ?? 'Custom settings'}. Each edit saves a new version; old trades keep theirs.
        </p>
      </div>

      <Arena s={s} onError={onError} />

      <Group title="All strategies" footer="Paper results of the latest version. Results are matched by version, so renaming or editing never mixes them.">
        {s.presets.map((p) => {
          const st = s.versionStats.find((x) => x.versionId === p.versionId);
          return (
            <button key={p.id} type="button" onClick={() => setOpen(p.id)}
              className="row-sep flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-fill">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[15px] font-medium">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-[12px] font-normal text-label-2">v{p.version ?? 1}</span>
                  {s.activePresetId === p.id && <span className="shrink-0 rounded bg-tint/15 px-1.5 text-[11px] font-semibold text-tint">MAIN</span>}
                </div>
                {p.description && <div className="truncate text-[12px] text-label-2">{p.description}</div>}
              </div>
              <div className="shrink-0 text-right text-[12px] tabular-nums">
                {st ? (
                  <>
                    <div className={`text-[15px] font-semibold ${tone(st.pnl)}`}>{st.pnl >= 0 ? '+' : ''}{sol(st.pnl, 3)}</div>
                    <div className="text-label-2">{st.count} trades · {Math.round((st.wins / st.count) * 100)}% win</div>
                  </>
                ) : <div className="text-label-3">no trades</div>}
              </div>
              <span className="text-label-3" aria-hidden>›</span>
            </button>
          );
        })}
        <form className="row-sep flex items-center gap-2 px-4 py-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input className="field min-w-0 flex-1 px-3 py-1.5 text-[15px]" placeholder="New strategy from current settings…"
            value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="New strategy name" />
          <button className="btn btn-filled" disabled={busy || !name.trim()}>Create</button>
        </form>
      </Group>
    </div>
  );
}

export type { StrategyRow };
