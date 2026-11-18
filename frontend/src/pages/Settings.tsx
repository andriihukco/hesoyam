import { useEffect, useState } from 'react';
import { call } from '../lib/api';
import type { HardLimits, Snapshot, Strategy } from '../lib/types';
import { Group, Segmented } from '../components/ui';
import { SliderRow, type SliderSpec } from '../components/SliderRow';
import { TelegramFolders } from '../components/TelegramFolders';
import { useConfirm } from '../components/ConfirmSheet';

type InfraKey = 'priorityFeeSol' | 'jitoTipSol' | 'pumpFeeBps' | 'simulatedLatencyMs';
type Infra = Pick<Strategy, InfraKey | 'rpc'>;

const costs: (SliderSpec & { key: InfraKey })[] = [
  { key: 'priorityFeeSol', label: 'Priority fee', min: 0, max: 0.01, step: 0.0001, unit: 'SOL' },
  { key: 'jitoTipSol', label: 'Jito tip', min: 0, max: 0.01, step: 0.0001, unit: 'SOL' },
  { key: 'pumpFeeBps', label: 'Pump.fun fee', min: 0, max: 300, step: 5, unit: 'bps' },
  { key: 'simulatedLatencyMs', label: 'Paper latency', min: 0, max: 3000, step: 50, unit: 'ms' },
];

const pick = (s: Strategy): Infra => ({
  rpc: s.rpc, priorityFeeSol: s.priorityFeeSol, jitoTipSol: s.jitoTipSol, pumpFeeBps: s.pumpFeeBps, simulatedLatencyMs: s.simulatedLatencyMs,
});

const limitRows: { key: keyof HardLimits; label: string; unit: string }[] = [
  { key: 'maxBuySol', label: 'Max live buy', unit: 'SOL' },
  { key: 'maxDailyLossSol', label: 'Max live loss per day', unit: 'SOL' },
  { key: 'maxOpen', label: 'Max open live positions', unit: '' },
  { key: 'canaryBuySol', label: 'Canary buy size', unit: 'SOL' },
  { key: 'rollbackLossSol', label: 'Rollback after loss of', unit: 'SOL' },
];

/** Infrastructure, costs, read-only hard limits and destructive actions. Strategy values live on the Strategies page. */
export function Settings({ s, onError }: { s: Snapshot; onError: (e: string) => void }) {
  const ask = useConfirm();
  const [draft, setDraft] = useState<Infra>(pick(s.strategy));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(pick(s.strategy));
  }, [s.strategy, dirty]);
  const set = <K extends keyof Infra>(k: K, v: Infra[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };
  const save = () => call('PUT', '/api/strategy', draft).then(() => setDirty(false), (e) => onError((e as Error).message));
  const reset = async () => {
    if (!(await ask({ title: 'Reset the paper wallet?', body: 'Sets the paper wallet back to 10 SOL and deletes all paper trade history. This cannot be undone.', confirm: 'Reset', danger: true }))) return;
    await call('POST', '/api/paper/reset').catch((e) => onError((e as Error).message));
  };
  const hl = s.hardLimits;

  return (
    <div className="flex flex-col gap-5">
      <h2 className="px-4 text-[22px] font-bold tracking-tight">Settings</h2>

      <Group title="Mode" footer="Paper mode uses a virtual wallet. Fills use live curve state and Jupiter quotes; failed transactions and MEV are not modelled.">
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-[15px]">
          Trading
          <Segmented label="Trading mode" value={s.mode}
            onChange={(m) => m === 'paper' && void call('POST', '/api/mode', { mode: m }).catch((e) => onError((e as Error).message))}
            options={[{ value: 'paper', label: 'Paper' }, { value: 'live', label: 'Live', title: 'Live engine not built yet', disabled: !s.liveAvailable }]} />
        </div>
        {!s.liveAvailable && <div className="row-sep px-4 py-2 text-[13px] text-label-2">Live engine not built yet.</div>}
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

      <Group title="Costs" footer="Used by paper fills so results match what live trading would pay. Paper latency is the wait between quote and fill.">
        {costs.map((c) => <SliderRow key={c.key} spec={c} value={draft[c.key]} onChange={(v) => set(c.key, v)} />)}
      </Group>

      <Group title="Hard limits" footer="Set in .env. Agents and this page cannot change them.">
        <div className="row-sep flex items-center justify-between px-4 py-2.5 text-[15px]">
          Agents may trade live
          <span className="text-label-2">{hl.agentLiveEnabled ? 'Yes' : 'No'}</span>
        </div>
        {limitRows.map((r) => {
          const v = hl[r.key] as number | null;
          return (
            <div key={r.key} className="row-sep flex items-center justify-between px-4 py-2.5 text-[15px]">
              {r.label}
              <span className="text-label-2">{v === null ? 'not set' : `${v}${r.unit && ` ${r.unit}`}`}</span>
            </div>
          );
        })}
      </Group>

      <Group title="Danger zone">
        <button className="w-full px-4 py-2.5 text-center text-[15px] text-neg" onClick={() => void reset()}>Reset paper wallet</button>
      </Group>

      {dirty && (
        <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 lg:bottom-2">
          <div className="card flex items-center gap-2 px-4 py-2 shadow-lg ring-1 ring-sep">
            <span className="mr-auto text-[13px] text-label-2">Unsaved changes</span>
            <button className="btn text-tint" onClick={() => setDirty(false)}>Cancel</button>
            <button className="btn btn-filled" onClick={() => void save()}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
