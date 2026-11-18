import { useMemo, useState } from 'react';
import type { Strategy } from '../lib/types';
import { validateDraft } from '../lib/validate';
import { Group, Segmented, Switch } from './ui';
import { SliderRow, type SliderSpec } from './SliderRow';

type NumKey = { [K in keyof Strategy]: Strategy[K] extends number ? K : never }[keyof Strategy];
type Spec = SliderSpec & { key: NumKey };
type ToggleKey = 'requireMintAuthorityDisabled' | 'requireFreezeAuthorityDisabled' | 'rugcheckEnabled';

const S = {
  minChannels: { key: 'minChannels', label: 'Min channels', min: 1, max: 6, step: 1, unit: '' },
  windowSec: { key: 'windowSec', label: 'Within', min: 5, max: 300, step: 5, unit: 's' },
  minScore: { key: 'minScore', label: 'Min score', min: 0, max: 100, step: 5, unit: '' },
  maxSignalAgeSec: { key: 'maxSignalAgeSec', label: 'Max age of first call', min: 0, max: 1800, step: 30, unit: 's', zeroOff: true },
  maxRunupFromFirstPct: { key: 'maxRunupFromFirstPct', label: 'Max run-up since first call', min: 0, max: 500, step: 10, unit: '%', zeroOff: true },
  maxTop10HolderPct: { key: 'maxTop10HolderPct', label: 'Max top-10 holders', min: 5, max: 80, step: 1, unit: '%' },
  momentumObserveSec: { key: 'momentumObserveSec', label: 'Watch momentum for', min: 0, max: 120, step: 1, unit: 's' },
  minTrades60s: { key: 'minTrades60s', label: 'Min trades / 60s', min: 0, max: 100, step: 1, unit: '' },
  minBuyVolumeSol60s: { key: 'minBuyVolumeSol60s', label: 'Min buy volume / 60s', min: 0, max: 50, step: 0.5, unit: 'SOL' },
  minGraduatedVolumeUsd5m: { key: 'minGraduatedVolumeUsd5m', label: 'Graduated: min volume / 5 min', min: 0, max: 100000, step: 1000, unit: 'USD' },
  buyAmountSol: { key: 'buyAmountSol', label: 'Buy amount', min: 0.01, max: 2, step: 0.01, unit: 'SOL' },
  maxSlippagePct: { key: 'maxSlippagePct', label: 'Max slippage', min: 1, max: 50, step: 0.5, unit: '%' },
  hardStopLossPct: { key: 'hardStopLossPct', label: 'Hard stop loss', min: 5, max: 60, step: 1, unit: '%' },
  trailingStopPct: { key: 'trailingStopPct', label: 'Trailing stop', min: 5, max: 50, step: 1, unit: '%' },
  stagnationSec: { key: 'stagnationSec', label: 'Dump if no trades for', min: 30, max: 900, step: 10, unit: 's' },
  markStaleSec: { key: 'markStaleSec', label: 'Dump if no price for', min: 5, max: 120, step: 5, unit: 's' },
  maxOpenPositions: { key: 'maxOpenPositions', label: 'Max open positions', min: 1, max: 20, step: 1, unit: '' },
  maxDailyLossSol: { key: 'maxDailyLossSol', label: 'Daily loss limit', min: 0.1, max: 10, step: 0.1, unit: 'SOL' },
} satisfies Record<string, Spec>;

const toggles: { key: ToggleKey; label: string }[] = [
  { key: 'requireMintAuthorityDisabled', label: 'Require mint authority off' },
  { key: 'requireFreezeAuthorityDisabled', label: 'Require freeze authority off' },
  { key: 'rugcheckEnabled', label: 'RugCheck second opinion' },
];

const extraLabels: Record<string, string> = {
  takeProfitLadder: 'Take-profit ladder', routes: 'Route', socialMentions: 'X / Threads',
  ...Object.fromEntries(toggles.map((t) => [t.key, t.label])),
};

/** Human label for a strategy field (used in diffs). */
export const fieldLabel = (key: string): string => (S as Record<string, Spec>)[key]?.label ?? extraLabels[key] ?? key;

/**
 * Editor for one strategy version. Groups follow the order the bot decides in:
 * signal → timing → risk → entry → exits → limits. Save stays disabled while any field is invalid.
 */
export function StrategyEditor({ initial, onSave, onCancel, busy }: {
  initial: Strategy; onSave: (values: Strategy, note: string) => void; onCancel: () => void; busy?: boolean;
}) {
  const [d, setD] = useState<Strategy>(initial);
  const [note, setNote] = useState('');
  const errors = useMemo(() => validateDraft(d), [d]);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const set = <K extends keyof Strategy>(k: K, v: Strategy[K]) => setD((x) => ({ ...x, [k]: v }));
  const row = (c: Spec) => <SliderRow key={c.key} spec={c} value={d[c.key]} onChange={(v) => set(c.key, v)} error={errors[c.key]} />;
  const ladder = (i: number, k: 'roiPct' | 'sellPct', v: number) =>
    set('takeProfitLadder', d.takeProfitLadder.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const invalid = Object.keys(errors).length > 0;

  return (
    <div className="flex flex-col gap-5">
      <Group title="1 · Signal filter" footer="X / Threads: Off = shown in Chats only. As one = all social accounts together count as one channel. Each = every account counts.">
        {row(S.minChannels)}{row(S.windowSec)}{row(S.minScore)}
        <div className="row-sep flex items-center justify-between gap-3 px-4 py-2 text-[15px]">
          X / Threads
          <Segmented label="X and Threads mentions" value={d.socialMentions} onChange={(v) => set('socialMentions', v)}
            options={[{ value: 'off', label: 'Off' }, { value: 'one', label: 'As one' }, { value: 'each', label: 'Each' }]} />
        </div>
      </Group>

      <Group title="2 · Entry timing" footer="Measured from the first mention in any channel. Late re-shills of an already-pumped token are the most common losing entry. 0 = off.">
        <div className="row-sep flex items-center justify-between gap-3 px-4 py-2 text-[15px]">
          Route
          <Segmented label="Allowed route" value={d.routes} onChange={(v) => set('routes', v)}
            options={[{ value: 'any', label: 'Any' }, { value: 'curve', label: 'Curve', title: 'Pump.fun bonding curve only' }, { value: 'graduated', label: 'Graduated', title: 'PumpSwap / Raydium via Jupiter only' }]} />
        </div>
        {row(S.maxSignalAgeSec)}{row(S.maxRunupFromFirstPct)}
      </Group>

      <Group title="3 · Risk & momentum">
        {toggles.map((t) => (
          <div key={t.key} className="row-sep flex items-center justify-between gap-3 px-4 py-2 text-[15px]">
            {t.label}
            <Switch label={t.label} checked={d[t.key]} onChange={(v) => set(t.key, v)} />
          </div>
        ))}
        {row(S.maxTop10HolderPct)}{row(S.momentumObserveSec)}{row(S.minTrades60s)}{row(S.minBuyVolumeSol60s)}{row(S.minGraduatedVolumeUsd5m)}
      </Group>

      <Group title="4 · Entry">{row(S.buyAmountSol)}{row(S.maxSlippagePct)}</Group>

      <Group title="5 · Exits" footer="Hard stop is checked first, then stagnation, then the ladder. Trailing stop starts after the last ladder step. Sell % is a share of the original position.">
        {row(S.hardStopLossPct)}{row(S.trailingStopPct)}{row(S.stagnationSec)}{row(S.markStaleSec)}
        {d.takeProfitLadder.map((step, i) => (
          <div key={i} className="row-sep px-4 py-2 text-[15px]">
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-9 font-medium">TP{i + 1}</span>
              <span className="text-label-2">+</span>
              <NumInput label={`TP${i + 1} profit %`} value={step.roiPct} onChange={(v) => ladder(i, 'roiPct', v)} invalid={!!errors[`takeProfitLadder.${i}.roiPct`]} />
              <span className="text-label-2">% → sell</span>
              <NumInput label={`TP${i + 1} sell % of position`} value={step.sellPct} onChange={(v) => ladder(i, 'sellPct', v)} invalid={!!errors[`takeProfitLadder.${i}.sellPct`]} />
              <span className="text-label-2">%</span>
              <button type="button" className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neg-solid text-[15px] leading-none text-white" aria-label={`Remove TP${i + 1}`}
                onClick={() => set('takeProfitLadder', d.takeProfitLadder.filter((_, j) => j !== i))}>−</button>
            </div>
            {(errors[`takeProfitLadder.${i}.roiPct`] || errors[`takeProfitLadder.${i}.sellPct`]) && (
              <div className="pt-1 text-[12px] text-neg">{errors[`takeProfitLadder.${i}.roiPct`] ?? errors[`takeProfitLadder.${i}.sellPct`]}</div>
            )}
          </div>
        ))}
        {errors.takeProfitLadder && <div className="row-sep px-4 py-2 text-[12px] text-neg">{errors.takeProfitLadder}</div>}
        {d.takeProfitLadder.length < 6 && (
          <button type="button" className="row-sep w-full px-4 py-2.5 text-left text-[15px] text-tint"
            onClick={() => set('takeProfitLadder', [...d.takeProfitLadder, { roiPct: 200, sellPct: 10 }])}>
            Add take-profit step
          </button>
        )}
      </Group>

      <Group title="6 · Limits">{row(S.maxOpenPositions)}{row(S.maxDailyLossSol)}</Group>

      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 lg:bottom-2">
        <div className="card flex flex-wrap items-center gap-2 px-4 py-2 shadow-lg ring-1 ring-sep">
          <input className="field min-w-0 flex-1 px-3 py-1.5 text-[14px]" placeholder="What changed? (optional)" maxLength={200}
            value={note} onChange={(e) => setNote(e.target.value)} aria-label="Version note" />
          <button type="button" className="btn text-tint" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-filled" disabled={!dirty || invalid || busy} onClick={() => onSave(d, note)}
            title={invalid ? 'Fix the fields marked in red' : !dirty ? 'No changes' : undefined}>
            Save version
          </button>
        </div>
      </div>
    </div>
  );
}

function NumInput({ value, onChange, label, invalid }: { value: number; onChange: (v: number) => void; label: string; invalid?: boolean }) {
  return (
    <input type="number" inputMode="decimal" enterKeyHint="done" value={Number.isFinite(value) ? value : ''} aria-label={label}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      className={`field w-16 px-2 py-1 text-right text-[15px] ${invalid ? 'ring-2 ring-neg-solid' : ''}`} />
  );
}
