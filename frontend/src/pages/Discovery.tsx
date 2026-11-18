import { useEffect, useState } from 'react';
import { ago, call, short } from '../lib/api';
import type { DiscoveryBoard, DiscoveryList, DiscoveryToken, Snapshot } from '../lib/types';
import { Segmented } from '../components/ui';
import { CoinSheet } from '../components/CoinSheet';

const BOARDS: { key: DiscoveryBoard; label: string; hint: string }[] = [
  { key: 'new', label: 'New', hint: 'On the Pump.fun curve, under 30% bonded' },
  { key: 'soon', label: 'About to graduate', hint: '70%+ bonded' },
  { key: 'graduated', label: 'Graduated', hint: 'Moved to PumpSwap in the last 24 h' },
];
const usd = (v: number | null | undefined) =>
  v == null ? '—' : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;

interface Filters { minMc: string; maxMc: string; maxAgeMin: string; maxDevPct: string; socials: boolean }
const NONE: Filters = { minMc: '', maxMc: '', maxAgeMin: '', maxDevPct: '', socials: false };

/** Live boards from the free Pump.fun feed + DexScreener, refreshed every 5 s. View only. */
export function Discovery({ s, onError }: { s: Snapshot; onError: (e: string) => void }) {
  const [side, setSide] = useState<'trending' | 'promoted'>('trending');
  const [phoneBoard, setPhoneBoard] = useState<DiscoveryBoard>('new');
  const [f, setF] = useState<Filters>(NONE);
  const [open, setOpen] = useState<string | null>(null);
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v !== false).map(([k, v]) => [k, v === true ? '1' : String(v)])).toString();

  return (
    <div className="flex flex-col gap-4">
      <div className="px-4">
        <h2 className="text-[22px] font-bold tracking-tight">Discover</h2>
        <p className="text-[13px] text-label-2">New Pump.fun tokens and their market data, refreshed every 15 s. Look only: nothing here buys.</p>
      </div>

      <FilterBar f={f} setF={setF} />

      {/* Phones: one board at a time. */}
      <div className="lg:hidden">
        <Segmented fill label="Board" value={phoneBoard} onChange={setPhoneBoard}
          options={[...BOARDS.map((b) => ({ value: b.key, label: b.key === 'soon' ? 'Soon' : b.label })), { value: 'trending' as const, label: 'Trending' }, { value: 'promoted' as const, label: 'Promoted' }]} />
        <div className="mt-3"><BoardColumn board={phoneBoard} q={q} s={s} onOpen={setOpen} onError={onError} /></div>
      </div>

      {/* Desktop: the three boards side by side, Trending / Promoted below. */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-3">
        {BOARDS.map((b) => (
          <section key={b.key} aria-label={b.label} className="min-w-0">
            <div className="section-title" title={b.hint}>{b.label}</div>
            <BoardColumn board={b.key} q={q} s={s} onOpen={setOpen} onError={onError} />
          </section>
        ))}
      </div>
      <section aria-label="Trending and promoted" className="hidden lg:block">
        <div className="mb-2 px-1">
          <Segmented label="List" value={side} onChange={setSide}
            options={[{ value: 'trending', label: 'Trending (our score)' }, { value: 'promoted', label: 'Promoted (paid)' }]} />
        </div>
        <BoardColumn board={side} q={q} s={s} onOpen={setOpen} onError={onError} grid />
      </section>

      {open && <CoinSheet mint={open} s={s} onClose={() => setOpen(null)} onError={onError} />}
    </div>
  );
}

function FilterBar({ f, setF }: { f: Filters; setF: (f: Filters) => void }) {
  const field = (k: keyof Omit<Filters, 'socials'>, label: string, ph: string) => (
    <label className="flex items-center gap-1.5 text-[13px] text-label-2">
      {label}
      <input className="field w-20 px-2 py-1 text-[13px]" inputMode="decimal" placeholder={ph} value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/[^0-9.]/g, '') })} aria-label={label} />
    </label>
  );
  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      {field('minMc', 'MC from $', '0')}
      {field('maxMc', 'to $', 'any')}
      {field('maxAgeMin', 'Age ≤ min', 'any')}
      {field('maxDevPct', 'Dev buy ≤ %', 'any')}
      <label className="flex items-center gap-1.5 text-[13px] text-label-2">
        <input type="checkbox" checked={f.socials} onChange={(e) => setF({ ...f, socials: e.target.checked })} /> Has socials
      </label>
      {JSON.stringify(f) !== JSON.stringify(NONE) && <button type="button" className="text-[13px] text-tint" onClick={() => setF(NONE)}>Clear</button>}
    </div>
  );
}

function BoardColumn({ board, q, s, onOpen, onError, grid }: {
  board: DiscoveryBoard; q: string; s: Snapshot; onOpen: (mint: string) => void; onError: (e: string) => void; grid?: boolean;
}) {
  const [d, setD] = useState<DiscoveryList | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => call<DiscoveryList>('GET', `/api/discovery?board=${board}${q ? `&${q}` : ''}`)
      .then((r) => live && setD(r), (e) => live && onError((e as Error).message));
    void load();
    const t = setInterval(load, 5_000);
    return () => { live = false; clearInterval(t); };
  }, [board, q]);

  if (!d) return <div className="card px-4 py-8 text-center text-[13px] text-label-3">Loading…</div>;
  if (!d.status.enabled) return <div className="card px-4 py-8 text-center text-[13px] text-label-3">Discovery is off (DISCOVERY_ENABLED=false).</div>;
  if (!d.tokens.length) {
    return (
      <div className="card px-4 py-8 text-center text-[13px] text-label-3">
        {d.status.connected ? 'Nothing here yet. New tokens appear as they launch.' : 'Connecting to the Pump.fun feed…'}
      </div>
    );
  }
  return (
    <div className={grid ? 'grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-2'}>
      {d.tokens.map((t) => <TokenCard key={t.mint} t={t} now={d.serverTime} s={s} onOpen={onOpen} showScore={board === 'trending'} />)}
    </div>
  );
}

const decisionStyle: Record<string, string> = {
  buy: 'bg-pos-solid/15 text-pos', reject: 'bg-fill text-label-2', skipped: 'bg-warn-solid/15 text-warn', pending: 'bg-tint/15 text-tint', error: 'bg-neg-solid/15 text-neg',
};

function TokenCard({ t, now, onOpen, showScore }: { t: DiscoveryToken; now: number; s: Snapshot; onOpen: (mint: string) => void; showScore: boolean }) {
  const m = t.market;
  const tx = m ? m.buys5m + m.sells5m : 0;
  return (
    <button type="button" onClick={() => onOpen(t.mint)} className="card flex w-full min-w-0 flex-col gap-1.5 px-3 py-2.5 text-left active:opacity-80">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          {t.symbol || short(t.mint)} <span className="font-normal text-label-2">{t.name && t.name !== t.symbol ? t.name : ''}</span>
        </span>
        {t.promoted && <span className="shrink-0 rounded bg-warn-solid/15 px-1.5 text-[11px] font-semibold text-warn">Promoted</span>}
        {t.decision && <span className={`shrink-0 rounded px-1.5 text-[11px] font-semibold uppercase ${decisionStyle[t.decision] ?? ''}`} title="The bot's own decision on this token">{t.decision}</span>}
        <span className="shrink-0 text-[15px] font-semibold tabular-nums" title={m?.mcUsd == null ? 'Market cap at launch from the curve; DexScreener has no data yet' : 'Market cap'}>
          {m?.mcUsd != null ? usd(m.mcUsd) : t.firstMcSol > 0 ? `~${t.firstMcSol.toFixed(0)} SOL` : '—'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums text-label-2">
        <span title="Age">{ago(t.createdAt, now)}</span>
        {t.migratedAt ? <span>graduated {ago(t.migratedAt, now)} ago</span> : t.origin === 'created' && <BondBar pct={t.bondingPct} />}
        <span title="Volume, last 5 min">V5m {usd(m?.vol5mUsd)}</span>
        <span title="Buys / sells, last 5 min">TX <span className="text-pos">{m?.buys5m ?? 0}</span>/<span className="text-neg">{m?.sells5m ?? 0}</span></span>
        {m && tx > 0 && <span className={m.change5mPct >= 0 ? 'text-pos' : 'text-neg'}>{m.change5mPct >= 0 ? '+' : ''}{m.change5mPct.toFixed(1)}%</span>}
        {t.origin === 'created' && <span title="Dev's first buy, % of supply" className={t.devBuyPct > 10 ? 'text-neg' : ''}>dev {t.devBuyPct.toFixed(1)}%</span>}
        {m?.socials.length ? <span title={m.socials.join(', ')}>{m.socials.slice(0, 3).join(' · ')}</span> : null}
        {showScore && <span className="ml-auto font-semibold text-tint" title="Our trend score, 0–100">{t.score}</span>}
      </div>
    </button>
  );
}

function BondBar({ pct }: { pct: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`Bonding curve ${pct.toFixed(1)}%`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-fill-2">
        <span className={`block h-full rounded-full ${pct >= 70 ? 'bg-pos-solid' : 'bg-tint'}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
      {pct.toFixed(0)}%
    </span>
  );
}
