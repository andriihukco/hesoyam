import { useEffect, useState } from 'react';
import { ago, call, short } from '../lib/api';
import type { Signal, Snapshot } from '../lib/types';
import { PositionDetailSheet } from './PositionDetail';
import { HolderReportCard } from './HolderReport';

interface CoinInfo { signal: Signal | null; positionId: number | null }

const isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

/**
 * Opened from a token chip in Chats. A coin the bot bought opens its position (own chart and fills);
 * any other coin gets a DexScreener chart, since the bot stores no price history for coins it skipped.
 */
export function CoinSheet({ mint, s, onClose, onError }: { mint: string; s: Snapshot; onClose: () => void; onError: (e: string) => void }) {
  const [info, setInfo] = useState<CoinInfo | null>(null);

  useEffect(() => {
    let alive = true;
    call<CoinInfo>('GET', `/api/coin/${mint}`)
      .then((r) => alive && setInfo(r))
      .catch((e) => {
        if (!alive) return;
        onError((e as Error).message);
        setInfo({ signal: null, positionId: null });
      });
    return () => {
      alive = false;
    };
  }, [mint]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (info?.positionId != null) return <PositionDetailSheet id={info.positionId} s={s} onClose={onClose} onError={onError} />;

  const sig = info?.signal ?? s.signals.find((x) => x.mint === mint) ?? null;
  const name = sig?.symbol ? `$${sig.symbol}` : short(mint);
  const theme = isDark() ? 'dark' : 'light';
  const chart = `https://dexscreener.com/solana/${mint}?embed=1&loadChartSettings=0&trades=0&info=0&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=${theme}&theme=${theme}&chartStyle=1&chartType=usd&interval=1`;
  const failed = sig?.reasons.filter((r) => !r.pass) ?? [];

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`Chart for ${name}`}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-2xl bg-bg shadow-2xl
        sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:w-[min(760px,94vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-fill-2 sm:hidden" aria-hidden />
        <div className="flex items-start gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="mono truncate text-[20px] font-bold">{name}</h2>
              {sig && <span className="shrink-0 rounded bg-fill px-1.5 text-[11px] font-semibold uppercase text-label-2">{sig.decision}</span>}
            </div>
            <button type="button" className="mono max-w-full truncate text-left text-[12px] text-label-2" title="Copy address"
              onClick={() => void navigator.clipboard?.writeText(mint)}>
              {mint} · copy
            </button>
          </div>
          <button type="button" onClick={onClose} aria-label="Close chart" className="icon-btn shrink-0">
            <svg viewBox="0 0 20 20" className="h-4 w-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l10 10M15 5 5 15" /></svg>
          </button>
        </div>

        <div className="scroll-y min-h-0 flex-1 space-y-3 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <div className="card overflow-hidden">
            <iframe title={`${name} price chart`} src={chart} className="block h-[min(420px,55dvh)] w-full border-0" loading="lazy"
              referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" />
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              ['DexScreener', `https://dexscreener.com/solana/${mint}`],
              ['Pump.fun', `https://pump.fun/coin/${mint}`],
              ['GMGN', `https://gmgn.ai/sol/token/${mint}`],
            ].map(([label, href]) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="btn btn-tinted btn-sm">{label} ↗</a>
            ))}
          </div>

          {sig ? (
            <div className="card p-4 text-[13px]">
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-label-2">
                <span>Score <b className="text-label">{Math.round(sig.score)}</b></span>
                <span>{sig.channels.length} channel{sig.channels.length === 1 ? '' : 's'}</span>
                <span>First seen {ago(sig.firstSeen, s.serverTime)}</span>
              </div>
              {failed.length ? (
                <ul className="space-y-1">
                  {failed.map((r) => (
                    <li key={r.name}><span className="font-medium text-neg">{r.name}</span> <span className="text-label-2">{r.detail}</span></li>
                  ))}
                </ul>
              ) : <p className="text-label-2">All checks passed.</p>}
            </div>
          ) : info && <p className="text-[13px] text-label-2">The bot has no signal record for this token yet.</p>}

          <HolderReportCard mint={mint} now={s.serverTime} />
        </div>
      </div>
    </div>
  );
}
