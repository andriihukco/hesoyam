import { ago, call, pct, short, sol, tone } from '../lib/api';
import type { Position, Snapshot } from '../lib/types';
import { Card } from './ui';
import { useConfirm } from './ConfirmSheet';

export function Positions({ s, onError, onOpen }: { s: Snapshot; onError: (e: string) => void; onOpen: (id: number) => void }) {
  const steps = s.strategy.takeProfitLadder.length;
  const ask = useConfirm();
  const panic = async () => {
    if (!(await ask({ title: `Sell all ${s.positions.length} open positions?`, body: 'Sells at the current price. This cannot be undone.', confirm: 'Sell all', danger: true }))) return;
    await call('POST', '/api/panic-sell').catch((e) => onError((e as Error).message));
  };
  const dump = async (p: Position) => {
    const name = p.symbol ? '$' + p.symbol : short(p.mint);
    if (!(await ask({ title: `Sell ${name} now?`, body: 'Sells the whole position at the current price.', confirm: 'Sell', danger: true }))) return;
    await call('POST', `/api/positions/${p.id}/sell`).catch((e) => onError((e as Error).message));
  };

  return (
    <Card
      className="min-h-0 xl:flex-1"
      title={`Positions · ${s.positions.length}/${s.strategy.maxOpenPositions}`}
      right={s.positions.length > 0 && <button className="font-semibold text-neg" onClick={() => void panic()}>Sell all</button>}
    >
      <div className="scroll-y min-h-0">
      {s.positions.map((p) => {
        const roi = (p.lastPriceSol / p.entryPriceSol - 1) * 100;
        const upnl = p.tokensHeld * p.lastPriceSol + p.realizedSol - p.costSol;
        return (
          <div key={p.id} className="row-sep flex items-center gap-3 px-4 py-3">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70" onClick={() => onOpen(p.id)} aria-label={`Details for ${p.symbol ?? p.mint}`}>
            <div className="min-w-0 flex-1">
              <div className="mono truncate text-[15px] font-medium">{p.symbol ? `$${p.symbol}` : short(p.mint)}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-label-2">
                {p.lane && <span className="rounded bg-fill px-1.5 text-[11px] text-label">{p.preset ?? p.lane}</span>}
                <span>{p.route === 'pump-curve' ? 'Curve' : 'Jupiter'}</span>
                <span>·</span>
                <span>{sol(p.costSol, 3)} SOL</span>
                <span>·</span>
                <LadderPips done={p.ladderDone} total={steps} />
                {p.ladderDone >= steps && <span className="text-warn">trailing</span>}
                <span>·</span>
                <span>idle {ago(p.lastActivityAt, s.serverTime)}</span>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-[17px] font-semibold ${tone(roi)}`}>{pct(roi)}</div>
              <div className={`text-[12px] ${tone(upnl)}`}>{upnl >= 0 ? '+' : ''}{sol(upnl)} SOL</div>
            </div>
            </button>
            <button className="btn btn-sm btn-danger-tinted" onClick={() => void dump(p)}>Sell</button>
          </div>
        );
      })}
      {!s.positions.length && (
        <div className="px-4 py-8 text-center">
          <div className="text-[15px] text-label-2">No open positions</div>
          <div className="mt-1 text-[13px] text-label-3">
            All-time {s.stats.all.wins}/{s.stats.all.count} wins · <span className={tone(s.stats.all.pnl)}>{s.stats.all.pnl >= 0 ? '+' : ''}{s.stats.all.pnl.toFixed(3)} SOL</span>
          </div>
        </div>
      )}

      {s.closed.length > 0 && (
        <details className="border-t border-sep">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[15px] text-tint">
            Closed positions <span className="text-label-3">{s.closed.length} ›</span>
          </summary>
          <div>
            {s.closed.map((p) => {
              const pnl = p.realizedSol - p.costSol;
              return (
                <button type="button" key={p.id} onClick={() => onOpen(p.id)} className="row-sep flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] active:bg-fill">
                  <span className="mono w-24 shrink-0 truncate">{p.symbol ? `$${p.symbol}` : short(p.mint)}</span>
                  <span className="min-w-0 flex-1 truncate text-label-2">{p.lane && <span className="text-label">{p.preset ?? p.lane} · </span>}{p.closeReason}</span>
                  <span className={`${tone(pnl)}`}>{pct((pnl / p.costSol) * 100)}</span>
                  <span className={`w-20 text-right ${tone(pnl)}`}>{sol(pnl)}</span>
                  <span className="hidden w-8 text-right text-label-3 sm:inline">{p.closedAt ? ago(p.closedAt, s.serverTime) : ''}</span>
                </button>
              );
            })}
          </div>
        </details>
      )}
      </div>
    </Card>
  );
}

function LadderPips({ done, total }: { done: number; total: number }) {
  return (
    <span className="inline-flex gap-0.5" title={`${done}/${total} take-profit steps hit`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 w-3 rounded-full ${i < done ? 'bg-pos-solid' : 'bg-fill-2'}`} />
      ))}
    </span>
  );
}
