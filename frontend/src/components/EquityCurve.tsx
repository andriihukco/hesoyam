/** Cumulative PnL line, one point per closed trade. Zero line dashed. */
export function EquityCurve({ points, height = 96 }: { points: { ts: number; pnl: number }[]; height?: number }) {
  if (points.length < 2) {
    return <div className="grid place-items-center text-[13px] text-label-3" style={{ height }}>Needs 2+ closed trades</div>;
  }
  const W = 300;
  const ys = [0, ...points.map((p) => p.pnl)];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const y = (v: number) => height - 6 - ((v - lo) / span) * (height - 12);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pnl).toFixed(1)}`).join(' ');
  const last = points.at(-1)!.pnl;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img"
      aria-label={`Cumulative PnL over ${points.length} trades, ending at ${last.toFixed(3)} SOL`}>
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--sep)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={last >= 0 ? 'var(--pos-solid)' : 'var(--neg-solid)'} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
