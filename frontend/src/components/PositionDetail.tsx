import { useEffect, useState, type ReactNode } from 'react';
import { call, dur, pct, px, short, sol, tone } from '../lib/api';
import type { PositionDetail, Snapshot } from '../lib/types';
import { PriceChart } from './PriceChart';

/** Bottom sheet on phones, centred dialog on desktop: chart, numbers and every fill of one position. */
export function PositionDetailSheet({ id, s, onClose, onError }: { id: number; s: Snapshot; onClose: () => void; onError: (e: string) => void }) {
  const [d, setD] = useState<PositionDetail | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await call<PositionDetail>('GET', `/api/positions/${id}`);
        if (!alive) return;
        setD(r);
        if (r.position.status === 'open') timer = setTimeout(load, 3000);
      } catch (e) {
        if (alive) onError((e as Error).message);
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      root.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Position details">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-2xl bg-bg shadow-2xl
        sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:w-[min(760px,94vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-fill-2 sm:hidden" aria-hidden />
        {d ? <Body d={d} s={s} onClose={onClose} onError={onError} /> : <div className="p-10 text-center text-label-2">Loading…</div>}
      </div>
    </div>
  );
}

function Body({ d, s, onClose, onError }: { d: PositionDetail; s: Snapshot; onClose: () => void; onError: (e: string) => void }) {
  const p = d.position;
  const open = p.status === 'open';
  const now = d.serverTime;
  const openValue = p.tokensHeld * p.lastPriceSol;
  const pnl = p.realizedSol + openValue - p.costSol;
  const pnlPct = (pnl / p.costSol) * 100;
  const sells = d.trades.filter((t) => t.side === 'sell');
  const soldTokens = sells.reduce((a, t) => a + t.tokens, 0);
  const avgExit = soldTokens > 0 ? sells.reduce((a, t) => a + t.sol, 0) / soldTokens : null;
  const fees = d.trades.reduce((a, t) => a + t.feeSol, 0);
  const roiOf = (price: number) => (price / p.entryPriceSol - 1) * 100;
  const rois = d.ticks.map((k) => ({ t: k.ts, r: roiOf(k.price) }));
  const tickPeak = rois.length ? rois.reduce((a, b) => (b.r > a.r ? b : a)) : null;
  const peakR = Math.max(roiOf(p.peakPriceSol), tickPeak?.r ?? -Infinity);
  const peakAt = tickPeak && tickPeak.r >= peakR - 0.05 ? tickPeak.t : null;
  // History may start after the position opened (recorded since this feature shipped / since a restart).
  const coverFrom = rois.length ? rois[0]!.t - p.openedAt : null;
  const partial = coverFrom !== null && coverFrom > 30_000;
  const low = rois.length ? Math.min(...rois.map((x) => x.r)) : null;
  const name = p.symbol ? `$${p.symbol}` : short(p.mint);
  const sell = () =>
    confirm(`Sell ${name} now?`) && call('POST', `/api/positions/${p.id}/sell`).catch((e) => onError((e as Error).message));

  const stats: [string, ReactNode][] = [
    ['Invested', `${sol(p.costSol, 4)} SOL`],
    ['Returned', `${sol(p.realizedSol, 4)} SOL`],
    ...(open ? [['Open value', `${sol(openValue, 4)} SOL`] as [string, ReactNode]] : []),
    ['Time in trade', dur((p.closedAt ?? now) - p.openedAt)],
    ['Entry price', <span className="mono">{px(p.entryPriceSol)}</span>],
    ['Avg exit price', avgExit ? <span className="mono">{px(avgExit)}</span> : '—'],
    ['Peak', <span className={tone(peakR)}>{pct(peakR)}{peakAt !== null && <span className="text-label-3"> at +{dur(peakAt - p.openedAt)}</span>}</span>],
    [partial ? `Lowest since +${dur(coverFrom!)}` : 'Lowest', low === null ? '—' : <span className={tone(low)}>{pct(low)}</span>],
    ['Sold', `${Math.round((soldTokens / p.initialTokens) * 100)}% in ${sells.length} sell${sells.length === 1 ? '' : 's'}`],
    ['Fees', `${sol(fees, 4)} SOL`],
    ['Route', p.route === 'pump-curve' ? 'Pump.fun curve' : 'Jupiter'],
    ['Strategy', p.preset ?? 'Custom'],
  ];

  return (
    <>
      <div className="flex items-start gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="mono truncate text-[20px] font-bold">{name}</h2>
            <span className={`shrink-0 rounded px-1.5 text-[11px] font-semibold ${open ? 'bg-tint/15 text-tint' : 'bg-fill text-label-2'}`}>{open ? 'OPEN' : 'CLOSED'}</span>
          </div>
          <div className="text-[13px] text-label-2">
            {new Date(p.openedAt).toLocaleString([], { hour12: false })}{!open && p.closeReason && ` · ${p.closeReason}`}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="icon-btn shrink-0">
          <svg viewBox="0 0 20 20" className="h-4 w-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l10 10M15 5 5 15" /></svg>
        </button>
      </div>

      <div className="scroll-y min-h-0 flex-1 space-y-4 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <div>
            <div className="text-[12px] text-label-2">{open ? 'Unrealised + realised' : 'Result'}</div>
            <div className={`text-[34px] font-bold leading-none tracking-tight ${tone(pnl)}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div>
          </div>
          <div className={`pb-1 text-[17px] font-semibold ${tone(pnl)}`}>{pnl >= 0 ? '+' : ''}{sol(pnl, 4)} SOL</div>
          {open && <button className="btn btn-danger-tinted ml-auto shrink-0 whitespace-nowrap" onClick={sell}>Sell</button>}
        </div>

        <div className="card p-2"><PriceChart d={d} /></div>

        <div className="card grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-[13px] sm:grid-cols-3">
          {stats.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-label-2">{k}</div>
              <div className="truncate font-medium tabular-nums">{v}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="section-title">Fills</div>
          <div className="card overflow-hidden">
            {d.trades.map((t) => {
              const r = roiOf(t.priceSol);
              return (
                <div key={t.id} className="row-sep flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className={`w-11 shrink-0 rounded-md py-0.5 text-center text-[11px] font-semibold uppercase ${t.side === 'buy' ? 'bg-tint/15 text-tint' : 'bg-fill text-label'}`}>{t.side}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{t.side === 'buy' ? 'Entry' : t.reason}</div>
                    <div className="text-[11px] text-label-2">
                      +{dur(t.ts - p.openedAt)} · impact {t.impactPct.toFixed(1)}% · {t.latencyMs} ms
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <div className="font-medium">{t.side === 'buy' ? '−' : '+'}{sol(t.sol, 4)} SOL</div>
                    <div className={`text-[11px] ${t.side === 'buy' ? 'text-label-2' : tone(r)}`}>{t.side === 'buy' ? <span className="mono">{px(t.priceSol)}</span> : pct(r)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 pb-2 text-[13px]">
          <a className="text-tint" href={`https://dexscreener.com/solana/${p.mint}`} target="_blank" rel="noreferrer">DexScreener ↗</a>
          <a className="text-tint" href={`https://pump.fun/coin/${p.mint}`} target="_blank" rel="noreferrer">pump.fun ↗</a>
          <a className="text-tint" href={`https://solscan.io/token/${p.mint}`} target="_blank" rel="noreferrer">Solscan ↗</a>
          <button className="mono ml-auto text-label-2" title="Copy contract address" onClick={() => void navigator.clipboard?.writeText(p.mint)}>{short(p.mint)} ⧉</button>
        </div>
        {s.mode === 'paper' && <p className="pb-2 text-[11px] text-label-3">Paper trade: fills are simulated from live quotes.</p>}
      </div>
    </>
  );
}
