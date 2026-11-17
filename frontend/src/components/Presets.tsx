import { useState } from 'react';
import { call, sol } from '../lib/api';
import type { Preset, Snapshot } from '../lib/types';
import { Group } from './ui';

export function Presets({ s, dirty, onError }: { s: Snapshot; dirty: boolean; onError: (e: string) => void }) {
  const [name, setName] = useState('');
  const run = (fn: () => Promise<unknown>) => fn().catch((e) => onError((e as Error).message));
  const stat = (p: Preset) => s.presetStats.find((x) => x.preset === p.name);
  const custom = s.presetStats.find((x) => x.preset === null);

  const apply = (p: Preset) => {
    if (p.id === s.activePresetId) return;
    if (dirty && !confirm('Discard unsaved changes and apply this preset?')) return;
    if (s.positions.length && !confirm(`Apply "${p.name}"? Open positions will use its exit rules from now on.`)) return;
    void run(() => call('POST', `/api/presets/${encodeURIComponent(p.id)}/apply`));
  };
  const save = () => run(async () => {
    await call('POST', '/api/presets', { name });
    setName('');
  });

  return (
    <Group title="Presets" footer={`${s.activePresetId ? '' : 'Current settings match no preset (Custom). '}Presets set filters and exits; RPC and cost settings are kept. Results are per preset active at entry.`}>
      {s.presets.map((p) => {
        const active = p.id === s.activePresetId;
        const st = stat(p);
        return (
          <div key={p.id} className="row-sep flex items-start gap-3 px-4 py-2.5">
            <button className="min-w-0 flex-1 text-left" onClick={() => apply(p)} aria-pressed={active}>
              <span className="flex items-center gap-1.5 text-[15px] font-medium">
                {p.name}
                {!p.builtIn && <span className="rounded bg-fill px-1.5 text-[11px] font-normal text-label-2">saved</span>}
              </span>
              {p.description && <span className="block text-[12px] leading-snug text-label-2">{p.description}</span>}
              {st && <StatLine {...st} />}
            </button>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              {active && <span className="text-[17px] text-tint" aria-label="active">✓</span>}
              {!p.builtIn && (
                <button className="text-[13px] text-neg" aria-label={`Delete ${p.name}`}
                  onClick={() => confirm(`Delete preset "${p.name}"?`) && void run(() => call('DELETE', `/api/presets/${encodeURIComponent(p.id)}`))}>
                  Delete
                </button>
              )}
            </div>
          </div>
        );
      })}
      {custom && (
        <div className="row-sep px-4 py-2 text-[13px] text-label-2">Custom settings <StatLine {...custom} inline /></div>
      )}
      <form className="row-sep flex items-center gap-2 px-4 py-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input className="field min-w-0 flex-1 px-3 py-1.5 text-[15px]" placeholder={dirty ? 'Save changes first' : 'Save current as…'}
          value={name} maxLength={40} disabled={dirty} onChange={(e) => setName(e.target.value)} aria-label="New preset name" />
        <button className="btn btn-filled" disabled={dirty || !name.trim()}>Save</button>
      </form>
    </Group>
  );
}

function StatLine({ count, wins, pnl, avgPnlPct, inline }: { count: number; wins: number; pnl: number; avgPnlPct: number; inline?: boolean }) {
  return (
    <span className={`${inline ? '' : 'mt-0.5 block'} text-[12px] tabular-nums text-label-2`}>
      {count} trades · {Math.round((wins / count) * 100)}% win · avg {avgPnlPct >= 0 ? '+' : ''}{avgPnlPct.toFixed(0)}% ·{' '}
      <span className={pnl >= 0 ? 'text-pos' : 'text-neg'}>{pnl >= 0 ? '+' : ''}{sol(pnl)} SOL</span>
    </span>
  );
}
