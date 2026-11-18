/** Time-scaled line (x = timestamp), for equity and drawdown. tone "auto" = green if last ≥ first, else red. */
export function LineChart({ points, height = 140, tone = 'auto', fill = false, label }: {
  points: { ts: number; v: number }[]; height?: number; tone?: 'auto' | 'neg'; fill?: boolean; label: string;
}) {
  if (points.length < 2) {
    return <div className="grid place-items-center text-[13px] text-label-3" style={{ height }}>Not enough data yet</div>;
  }
  const W = 600;
  const t0 = points[0]!.ts;
  const t1 = points.at(-1)!.ts;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || Math.abs(hi) || 1;
  const x = (ts: number) => ((ts - t0) / (t1 - t0 || 1)) * W;
  const y = (v: number) => height - 8 - ((v - lo) / span) * (height - 16);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const up = points.at(-1)!.v >= points[0]!.v;
  const color = tone === 'neg' ? 'var(--neg-solid)' : up ? 'var(--pos-solid)' : 'var(--neg-solid)';
  const fmt = (ts: number) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img"
        aria-label={`${label}: from ${points[0]!.v.toFixed(3)} to ${points.at(-1)!.v.toFixed(3)} SOL`}>
        {fill && <path d={`${d} L${W},${height} L0,${height} Z`} fill={color} opacity="0.12" />}
        <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="flex justify-between pt-1 text-[11px] text-label-3"><span>{fmt(t0)}</span><span>{fmt(t1)}</span></figcaption>
    </figure>
  );
}
