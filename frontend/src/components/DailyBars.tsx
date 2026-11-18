/** Profit/loss per UTC day as bars around a zero line. */
export function DailyBars({ days, height = 110 }: { days: { day: string; pnl: number; count: number }[]; height?: number }) {
  if (!days.length) return <div className="grid place-items-center text-[13px] text-label-3" style={{ height }}>No closed trades yet</div>;
  const max = Math.max(...days.map((d) => Math.abs(d.pnl)), 1e-9);
  const mid = height / 2;
  // At least 14 slots so a few days do not turn into very wide bars.
  const w = 100 / Math.max(days.length, 14);
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img"
      aria-label={`Daily PnL over ${days.length} days`}>
      <line x1="0" x2="100" y1={mid} y2={mid} stroke="var(--sep)" vectorEffect="non-scaling-stroke" />
      {days.map((d, i) => {
        const h = (Math.abs(d.pnl) / max) * (mid - 4);
        return (
          <rect key={d.day} x={i * w + w * 0.15} width={w * 0.7} y={d.pnl >= 0 ? mid - h : mid} height={Math.max(h, 0.5)}
            fill={d.pnl >= 0 ? 'var(--pos-solid)' : 'var(--neg-solid)'} rx="0.6">
            <title>{`${d.day}: ${d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(4)} SOL · ${d.count} trades`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
