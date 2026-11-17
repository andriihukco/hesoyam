import { useEffect, useState, type CSSProperties } from 'react';
import { call } from '../lib/api';
import type { Snapshot, Strategy } from '../lib/types';
import { Group, Segmented, Switch } from './ui';
import { Presets } from './Presets';
import { Arena } from './Arena';
import { TelegramFolders } from './TelegramFolders';

type NumKey = { [K in keyof Strategy]: Strategy[K] extends number ? K : never }[keyof Strategy];
type Slider = { key: NumKey; label: string; min: number; max: number; step: number; unit: string; zeroOff?: boolean };

const groups: { title: string; footer?: string; sliders: Slider[] }[] = [
  {
    title: 'Entry',
    sliders: [
      { key: 'buyAmountSol', label: 'Buy amount', min: 0.01, max: 2, step: 0.01, unit: 'SOL' },
      { key: 'maxSlippagePct', label: 'Max slippage', min: 1, max: 50, step: 0.5, unit: '%' },
    ],
  },
  {
    title: 'Exits',
    footer: 'Hard stop is checked first, then stagnation, then the ladder. Trailing stop starts after the last ladder step.',
    sliders: [
      { key: 'hardStopLossPct', label: 'Hard stop loss', min: 5, max: 60, step: 1, unit: '%' },
      { key: 'trailingStopPct', label: 'Trailing stop', min: 5, max: 50, step: 1, unit: '%' },
      { key: 'stagnationSec', label: 'Dump if no trades for', min: 30, max: 900, step: 10, unit: 's' },
      { key: 'markStaleSec', label: 'Dump if no price for', min: 5, max: 120, step: 5, unit: 's' },
    ],
  },
  {
    title: 'Entry timing',
    footer: 'Measured from the first mention in any channel. Late re-shills of an already-pumped token are the most common losing entry. 0 = off.',
    sliders: [
      { key: 'maxSignalAgeSec', label: 'Max age of first call', min: 0, max: 1800, step: 30, unit: 's', zeroOff: true },
      { key: 'maxRunupFromFirstPct', label: 'Max run-up since first call', min: 0, max: 500, step: 10, unit: '%', zeroOff: true },
    ],
  },
  {
    title: 'Signal filter',
    sliders: [
      { key: 'minChannels', label: 'Min channels', min: 1, max: 6, step: 1, unit: '' },
      { key: 'windowSec', label: 'Within', min: 5, max: 300, step: 5, unit: 's' },
      { key: 'minScore', label: 'Min score', min: 0, max: 100, step: 5, unit: '' },
    ],
  },
  {
    title: 'Risk & momentum',
    sliders: [
      { key: 'maxTop10HolderPct', label: 'Max top-10 holders', min: 5, max: 80, step: 1, unit: '%' },
      { key: 'minTrades60s', label: 'Min trades / 60s', min: 0, max: 100, step: 1, unit: '' },
      { key: 'minBuyVolumeSol60s', label: 'Min buy volume / 60s', min: 0, max: 50, step: 0.5, unit: 'SOL' },
    ],
  },
  {
    title: 'Limits',
    footer: 'Paper latency is the wait between quote and fill, so price movement during a real transaction is simulated.',
    sliders: [
      { key: 'maxOpenPositions', label: 'Max open positions', min: 1, max: 20, step: 1, unit: '' },
      { key: 'maxDailyLossSol', label: 'Daily loss limit', min: 0.1, max: 10, step: 0.1, unit: 'SOL' },
      { key: 'simulatedLatencyMs', label: 'Paper latency', min: 0, max: 3000, step: 50, unit: 'ms' },
    ],
  },
];

const toggles: { key: 'requireMintAuthorityDisabled' | 'requireFreezeAuthorityDisabled' | 'rugcheckEnabled'; label: string }[] = [
  { key: 'requireMintAuthorityDisabled', label: 'Require mint authority off' },
  { key: 'requireFreezeAuthorityDisabled', label: 'Require freeze authority off' },
  { key: 'rugcheckEnabled', label: 'RugCheck second opinion' },
];

export function StrategyConfig({ s, onError }: { s: Snapshot; onError: (e: string) => void }) {
  const [draft, setDraft] = useState<Strategy>(s.strategy);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(s.strategy);
  }, [s.strategy, dirty]);

  const set = <K extends keyof Strategy>(k: K, v: Strategy[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };
  const save = async () => {
    try {
      await call('PUT', '/api/strategy', draft);
      setDirty(false);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const sliderRow = (c: Slider) => {
    const v = draft[c.key];
    const p = ((v - c.min) / (c.max - c.min)) * 100;
    return (
      <label key={c.key} className="row-sep block px-4 pb-1 pt-2.5">
        <span className="flex justify-between text-[15px]">
          {c.label}
          <span className="text-label-2">{c.zeroOff && v === 0 ? 'off' : <>{v}{c.unit && ` ${c.unit}`}</>}</span>
        </span>
        <input type="range" min={c.min} max={c.max} step={c.step} value={v} aria-label={c.label}
          style={{ '--p': `${p}%` } as CSSProperties} onChange={(e) => set(c.key, Number(e.target.value))} />
      </label>
    );
  };

  return (
    <aside className="flex flex-col gap-5">
      <div className="px-4">
        <h2 className="text-[22px] font-bold tracking-tight">Strategy</h2>
        <p className="text-[13px] text-label-2">
          {s.presets.find((p) => p.id === s.activePresetId)?.name ?? 'Custom settings'}{dirty && ' · unsaved changes'}
        </p>
      </div>

      <Arena s={s} onError={onError} />

      <Presets s={s} dirty={dirty} onError={onError} />

      <Group title="Mode" footer="Test mode uses a virtual wallet. Fills use live curve state and Jupiter quotes; failed transactions and MEV are not modelled.">
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-[15px]">
          Trading
          <Segmented label="Trading mode" value={s.mode}
            onChange={(m) => void call('POST', '/api/mode', { mode: m }).catch((e) => onError((e as Error).message))}
            options={[{ value: 'paper', label: 'Test' }, { value: 'live', label: 'Live', title: 'Live engine not built yet (PLAN.md phase 7)' }]} />
        </div>
      </Group>

      <TelegramFolders s={s} onError={onError} />

      <Group title="RPC" footer="Public RPC is rate-limited; holder checks fall back to RugCheck.">
        <label className="flex items-center justify-between gap-3 px-4 py-2.5 text-[15px]">
          Endpoint
          <select value={draft.rpc} onChange={(e) => set('rpc', e.target.value)} className="min-w-0 max-w-[60%] bg-transparent text-right text-label-2 outline-none">
            {s.rpc.options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
          </select>
        </label>
      </Group>

      {groups.slice(0, 1).map((g) => <Group key={g.title} title={g.title} footer={g.footer}>{g.sliders.map(sliderRow)}</Group>)}

      <Group title="Take-profit ladder" footer="Sell % is a share of the original position size.">
        {draft.takeProfitLadder.map((step, i) => (
          <div key={i} className="row-sep flex items-center gap-1.5 whitespace-nowrap px-4 py-2 text-[15px]">
            <span className="w-9 font-medium">TP{i + 1}</span>
            <span className="text-label-2">+</span>
            <NumInput label={`TP${i + 1} profit %`} value={step.roiPct} onChange={(v) => set('takeProfitLadder', draft.takeProfitLadder.map((x, j) => (j === i ? { ...x, roiPct: v } : x)))} />
            <span className="text-label-2">% → sell</span>
            <NumInput label={`TP${i + 1} sell % of position`} value={step.sellPct} onChange={(v) => set('takeProfitLadder', draft.takeProfitLadder.map((x, j) => (j === i ? { ...x, sellPct: v } : x)))} />
            <span className="text-label-2">%</span>
            <button className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neg-solid text-[15px] leading-none text-white" aria-label={`Remove TP${i + 1}`}
              onClick={() => set('takeProfitLadder', draft.takeProfitLadder.filter((_, j) => j !== i))}>−</button>
          </div>
        ))}
        {draft.takeProfitLadder.length < 6 && (
          <button className="row-sep w-full px-4 py-2.5 text-left text-[15px] text-tint"
            onClick={() => set('takeProfitLadder', [...draft.takeProfitLadder, { roiPct: 200, sellPct: 10 }])}>
            Add step
          </button>
        )}
      </Group>

      {groups.slice(1, 2).map((g) => <Group key={g.title} title={g.title} footer={g.footer}>{g.sliders.map(sliderRow)}</Group>)}

      <Group title={groups[2]!.title} footer={groups[2]!.footer}>
        <div className="row-sep flex items-center justify-between gap-3 px-4 py-2 text-[15px]">
          Route
          <Segmented label="Allowed route" value={draft.routes} onChange={(v) => set('routes', v)}
            options={[{ value: 'any', label: 'Any' }, { value: 'curve', label: 'Curve', title: 'Pump.fun bonding curve only' }, { value: 'graduated', label: 'Graduated', title: 'PumpSwap / Raydium via Jupiter only' }]} />
        </div>
        {groups[2]!.sliders.map(sliderRow)}
      </Group>

      <Group title={groups[3]!.title} footer={groups[3]!.footer}>{groups[3]!.sliders.map(sliderRow)}</Group>

      <Group title={groups[4]!.title}>
        {toggles.map((t) => (
          <div key={t.key} className="row-sep flex items-center justify-between gap-3 px-4 py-2 text-[15px]">
            {t.label}
            <Switch label={t.label} checked={draft[t.key]} onChange={(v) => set(t.key, v)} />
          </div>
        ))}
        {groups[4]!.sliders.map(sliderRow)}
      </Group>

      <Group title={groups[5]!.title} footer={groups[5]!.footer}>{groups[5]!.sliders.map(sliderRow)}</Group>

      {dirty && (
        <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 lg:bottom-2">
          <div className="card flex items-center gap-2 px-4 py-2 shadow-lg ring-1 ring-sep">
            <span className="mr-auto text-[13px] text-label-2">Unsaved changes</span>
            <button className="btn text-tint" onClick={() => setDirty(false)}>Cancel</button>
            <button className="btn btn-filled" onClick={save}>Save</button>
          </div>
        </div>
      )}

      <Group>
        <button className="w-full px-4 py-2.5 text-center text-[15px] text-neg"
          onClick={() => confirm('Reset the paper wallet to 10 SOL and delete paper trade history?') &&
            call('POST', '/api/paper/reset').catch((e) => onError((e as Error).message))}>
          Reset paper wallet
        </button>
      </Group>
    </aside>
  );
}

function NumInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <input type="number" inputMode="decimal" enterKeyHint="done" value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}
      className="field w-14 px-2 py-1 text-right text-[15px]" />
  );
}
