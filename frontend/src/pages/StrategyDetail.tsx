import { useCallback, useEffect, useState } from 'react';
import { call, pct, sol, tone } from '../lib/api';
import type { Snapshot, Strategy, StrategyDetail as Detail, VersionRow } from '../lib/types';
import { Group } from '../components/ui';
import { EquityCurve } from '../components/EquityCurve';
import { StrategyEditor, fieldLabel } from '../components/StrategyEditor';
import { useConfirm } from '../components/ConfirmSheet';
import { authorLabel, stageStyle } from './Strategies';

const INFRA = ['rpc', 'priorityFeeSol', 'jitoTipSol', 'pumpFeeBps', 'simulatedLatencyMs'];

/** Keys whose values differ; the ladder compares as one key. Infra/cost keys are not part of a version. */
function diff(a: Record<string, unknown>, b: Record<string, unknown>) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => !INFRA.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ key: k, from: a[k], to: b[k] }));
}
const show = (v: unknown) =>
  Array.isArray(v) ? v.map((s: { roiPct: number; sellPct: number }) => `+${s.roiPct}%→${s.sellPct}%`).join(', ') || 'none' : String(v);

export function StrategyDetail({ id, s, onBack, onError }: { id: string; s: Snapshot; onBack: () => void; onError: (e: string) => void }) {
  const ask = useConfirm();
  const [d, setD] = useState<Detail | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const statsKey = s.versionStats.map((x) => `${x.versionId}:${x.count}`).join(',');

  const load = useCallback(() => call<Detail>('GET', `/api/strategies/${encodeURIComponent(id)}`).then(setD, (e) => onError((e as Error).message)), [id]);
  useEffect(() => { void load(); }, [load, statsKey]);

  if (!d) return <div className="px-4 py-10 text-center text-label-2">Loading…</div>;
  const latest = d.versions[0]!;
  const v = d.versions.find((x) => x.id === sel) ?? latest;
  const st = d.stats.find((x) => x.versionId === v.id);
  const isMainNow = s.mainVersionId === v.id;

  const apply = async (ver: VersionRow) => {
    const changes = diff(s.strategy as unknown as Record<string, unknown>, { ...s.strategy, ...ver.values });
    if (!changes.length) return setMsg('Already your main settings.');
    const ok = await ask({
      title: `Apply ${d.strategy.name} v${ver.version}?`,
      body: (
        <>
          <ul className="mb-2 max-h-48 space-y-0.5 overflow-y-auto">
            {changes.map((c) => <li key={c.key}><b className="font-medium text-label">{fieldLabel(c.key)}</b>: {show(c.from)} → {show(c.to)}</li>)}
          </ul>
          {s.positions.length > 0 && <p>Open positions keep their own exit rules.</p>}
        </>
      ),
      confirm: 'Apply',
    });
    if (ok) await call('POST', `/api/versions/${ver.id}/apply`).then(() => setMsg(`v${ver.version} is now your main strategy.`), (e) => onError((e as Error).message));
  };

  const save = async (values: Strategy, note: string) => {
    setBusy(true);
    try {
      const r = await call<{ version: VersionRow; changed: boolean }>('POST', `/api/strategies/${encodeURIComponent(id)}/versions`, { values, note });
      setMsg(r.changed ? `Saved as v${r.version.version}.` : 'No changes.');
      setEditing(false);
      setSel(r.version.id);
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!(await ask({ title: `Archive "${d.strategy.name}"?`, body: 'It leaves the list and Arena. Its versions and trade history are kept.', confirm: 'Archive', danger: true }))) return;
    await call('POST', `/api/strategies/${encodeURIComponent(id)}/archive`).then(onBack, (e) => onError((e as Error).message));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="px-4">
        <button type="button" className="mb-1 text-[15px] text-tint" onClick={editing ? () => setEditing(false) : onBack}>‹ {editing ? d.strategy.name : 'Strategies'}</button>
        <h2 className="flex items-center gap-2 text-[22px] font-bold tracking-tight">
          {d.strategy.name}
          {s.activePresetId === id && <span className="rounded bg-tint/15 px-1.5 text-[11px] font-semibold text-tint">MAIN</span>}
        </h2>
        {d.strategy.description && <p className="text-[13px] text-label-2">{d.strategy.description}</p>}
        {msg && <p role="status" className="mt-1 text-[13px] text-pos">{msg}</p>}
      </div>

      {editing ? (
        <StrategyEditor initial={{ ...s.strategy, ...latest.values }} busy={busy} onCancel={() => setEditing(false)} onSave={(vals, note) => void save(vals, note)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 px-4">
            <button type="button" className="btn btn-filled" disabled={isMainNow} onClick={() => void apply(v)}>
              {isMainNow ? 'Main strategy' : `Apply v${v.version}`}
            </button>
            <button type="button" className="btn btn-tinted" onClick={() => setEditing(true)}>Edit → v{latest.version + 1}</button>
            {!d.strategy.builtIn && <button type="button" className="btn text-neg" onClick={() => void archive()}>Archive</button>}
          </div>

          <Group title={`v${v.version} · paper results`} footer="A version counts only after about 30 closed trades; before that the numbers are mostly luck.">
            <div className="px-4 pt-3"><EquityCurve points={d.curves[v.id] ?? []} /></div>
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-5">
              <Metric label="Trades" value={String(st?.count ?? 0)} />
              <Metric label="Win rate" value={st ? `${Math.round((st.wins / st.count) * 100)}%` : '—'} />
              <Metric label="PnL" value={st ? `${st.pnl >= 0 ? '+' : ''}${sol(st.pnl, 3)}` : '—'} cls={st ? tone(st.pnl) : ''} />
              <Metric label="Avg / trade" value={st ? pct(st.avgPnlPct) : '—'} cls={st ? tone(st.avgPnlPct) : ''} />
              <Metric label="Max drawdown" value={st ? sol(st.maxDrawdownSol, 3) : '—'} />
            </div>
          </Group>

          <Group title="Versions" footer="Versions never change once saved. Tap one to see its results.">
            {d.versions.map((x) => {
              const xs = d.stats.find((y) => y.versionId === x.id);
              const parent = d.versions.find((y) => y.id === x.parentId);
              const changes = parent ? diff(parent.values as unknown as Record<string, unknown>, x.values as unknown as Record<string, unknown>) : [];
              return (
                <button key={x.id} type="button" onClick={() => setSel(x.id)} aria-pressed={x.id === v.id}
                  className={`row-sep flex w-full items-start gap-3 px-4 py-2.5 text-left ${x.id === v.id ? 'bg-fill' : 'active:bg-fill'}`}>
                  <span className="w-9 shrink-0 text-[15px] font-semibold">v{x.version}</span>
                  <div className="min-w-0 flex-1 text-[12px] text-label-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-1.5 text-[11px] font-semibold ${stageStyle[x.stage]}`}>{x.stage}</span>
                      <span>by {authorLabel[x.author]}</span>
                      <span>· {new Date(x.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                    </div>
                    {x.note && <div className="truncate text-label">{x.note}</div>}
                    {changes.length > 0 && <div className="truncate">{changes.map((c) => `${fieldLabel(c.key)} ${show(c.from)}→${show(c.to)}`).join(' · ')}</div>}
                  </div>
                  <span className={`shrink-0 text-[13px] tabular-nums ${xs ? tone(xs.pnl) : 'text-label-3'}`}>
                    {xs ? `${xs.pnl >= 0 ? '+' : ''}${sol(xs.pnl, 3)} · ${xs.count}` : '—'}
                  </span>
                </button>
              );
            })}
          </Group>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-card-2 px-3 py-2">
      <div className="truncate text-[11px] text-label-2">{label}</div>
      <div className={`mono truncate text-[15px] font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
