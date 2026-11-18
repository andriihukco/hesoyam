import { useEffect, useState } from 'react';
import { ago, call, short } from '../lib/api';
import type { HolderReport } from '../lib/types';

const riskTone = (n: number) => (n >= 60 ? 'text-neg' : n >= 30 ? 'text-warn' : 'text-pos');

/** Top holders of a coin: balances, age, funder, buys/sells, other tokens, rug links, and Claude's read. */
export function HolderReportCard({ mint, now }: { mint: string; now: number }) {
  const [r, setR] = useState<HolderReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'load' | 'ai' | null>('load');

  const load = (refresh = false) => {
    setBusy('load');
    setErr(null);
    call<HolderReport>('GET', `/api/holders/${mint}${refresh ? '?refresh=1' : ''}`)
      .then(setR)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(null));
  };
  useEffect(() => load(), [mint]);

  const ask = () => {
    setBusy('ai');
    setErr(null);
    call<HolderReport>('POST', `/api/holders/${mint}/summary`)
      .then(setR)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(null));
  };

  return (
    <div>
      <div className="section-title flex items-center gap-2">
        <span className="mr-auto">Holders</span>
        {r && <span className="text-[11px] normal-case text-label-3">{ago(r.at, now)}</span>}
        <button type="button" className="btn btn-tinted btn-sm" disabled={!!busy} onClick={() => load(true)}>
          {busy === 'load' ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <div className="card space-y-3 p-4 text-[13px]">
        {err && <p className="text-neg">{err}</p>}
        {!r && !err && <p className="text-label-2">Looking at top holders…</p>}
        {r && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-label-2">Risk</span>
              <b className={`text-[22px] tabular-nums ${riskTone(r.riskScore)}`}>{r.riskScore}</b>
              <span className="text-label-3">/ 100</span>
            </div>
            {r.flags.length ? (
              <ul className="list-disc space-y-0.5 pl-4">{r.flags.map((f) => <li key={f}>{f}</li>)}</ul>
            ) : <p className="text-label-2">No warning signs in the top holders.</p>}

            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-label-2">
                  <tr>
                    {['Wallet', 'Supply', 'SOL', 'Age', 'Buy/Sell', 'Other', 'Flags'].map((h) => <th key={h} className="px-4 py-1 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {r.wallets.map((w) => (
                    <tr key={w.owner} className="row-sep">
                      <td className="px-4 py-1">
                        <a className="mono text-tint" href={`https://solscan.io/account/${w.owner}`} target="_blank" rel="noopener noreferrer">{short(w.owner)}</a>
                      </td>
                      <td className="px-4 py-1">{w.pct.toFixed(1)}%</td>
                      <td className="px-4 py-1">{w.solBalance === null ? '—' : w.solBalance.toFixed(2)}</td>
                      <td className="px-4 py-1">{w.firstSeenTs ? ago(w.firstSeenTs, now) : `${w.txCount}+ tx`}</td>
                      <td className="px-4 py-1">{w.buys}/{w.sells}</td>
                      <td className="px-4 py-1">{w.otherTokenCount}</td>
                      <td className="px-4 py-1 text-[12px] text-label-2">{w.flags.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {r.summary ? (
              <div className="rounded-lg bg-fill p-3">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-label-2">AI read · {r.summaryAt ? ago(r.summaryAt, now) : ''}</div>
                <p className="whitespace-pre-wrap">{r.summary}</p>
              </div>
            ) : null}
            <button type="button" className="btn btn-tinted btn-sm" disabled={!!busy} onClick={ask}>
              {busy === 'ai' ? 'Asking Claude…' : r.summary ? 'Ask again' : 'Ask Claude to explain'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
