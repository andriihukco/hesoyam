import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { dur, px } from '../lib/api';
import type { PositionDetail } from '../lib/types';

const H = 220;
const M = { l: 44, r: 12, t: 18, b: 24 };

interface Pt { t: number; roi: number; price: number }
interface Ev extends Pt { label: string; side: 'buy' | 'sell' }

/** Short name for a fill reason, used as the direct label on its marker. */
function evLabel(reason: string, side: string): string {
  if (side === 'buy') return 'Buy';
  const tp = /^TP(\d)/.exec(reason);
  if (tp) return `TP${tp[1]}`;
  if (reason.startsWith('hard stop')) return 'Stop';
  if (reason.startsWith('trailing')) return 'Trail';
  if (reason.startsWith('stagnant')) return 'Stalled';
  if (reason.startsWith('no price')) return 'No price';
  if (reason.startsWith('panic')) return 'Panic';
  return 'Manual';
}

/** "Nice" tick step so the y axis gets about four labels. */
function step(span: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]) if (span / s <= 5) return s;
  return 2000;
}

/**
 * Price over the life of a position, as ROI vs the entry price (fees included).
 * One series, so no legend: entry, stop and take-profit levels are labelled lines; fills are labelled markers.
 */
export function PriceChart({ d }: { d: PositionDetail }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<Pt | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const p = d.position;
  const t0 = p.openedAt;
  const lastTs = d.ticks.at(-1)?.ts ?? 0;
  // After an exit the chart keeps going: x runs to the last post-exit tick.
  const end = Math.max((p.closedAt ?? d.serverTime) - t0, lastTs - t0, 10_000);
  const closeT = p.closedAt ? p.closedAt - t0 : null;
  const roi = (price: number) => (price / p.entryPriceSol - 1) * 100;

  const { line, events, levels, yMin, yMax } = useMemo(() => {
    const line: Pt[] = d.ticks.map((k) => ({ t: k.ts - t0, roi: roi(k.price), price: k.price }));
    const events: Ev[] = d.trades.map((tr) => ({
      t: tr.ts - t0, roi: roi(tr.priceSol), price: tr.priceSol, side: tr.side, label: evLabel(tr.reason, tr.side),
    }));
    // Without stored history (older trades), connect the fills so the shape is still visible.
    const path = line.length >= 2 ? line : events;
    const steps = [...(d.rules?.takeProfitLadder ?? [])].sort((a, b) => a.roiPct - b.roiPct);
    const dataMax = Math.max(0, ...path.map((x) => x.roi), ...events.map((x) => x.roi));
    const dataMin = Math.min(0, ...path.map((x) => x.roi), ...events.map((x) => x.roi));
    // Rules are stored per position; older positions have none, so no level lines rather than wrong ones.
    const levels: { y: number; label: string; kind: 'stop' | 'tp' }[] = d.rules
      ? [{ y: -d.rules.hardStopLossPct, label: `stop −${d.rules.hardStopLossPct}%`, kind: 'stop' }]
      : [];
    steps.forEach((s, i) => {
      // Show reached steps, and the next pending one while the position is open.
      if (s.roiPct <= dataMax * 1.15 || (p.status === 'open' && i === p.ladderDone)) levels.push({ y: s.roiPct, label: `TP${i + 1} +${s.roiPct}%`, kind: 'tp' });
    });
    const lo = Math.min(dataMin, ...levels.map((l) => l.y));
    const hi = Math.max(dataMax, ...levels.map((l) => l.y));
    const pad = Math.max(3, (hi - lo) * 0.08);
    return { line: path, events, levels, yMin: lo - pad, yMax: hi + pad };
  }, [d, t0, p.entryPriceSol, p.status, p.ladderDone]);

  const iw = w - M.l - M.r;
  const ih = H - M.t - M.b;
  const x = (t: number) => M.l + (Math.min(Math.max(t, 0), end) / end) * iw;
  const y = (v: number) => M.t + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const st = step(yMax - yMin);
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / st) * st; v <= yMax; v += st) yTicks.push(v);
  const toD = (pts: Pt[]) => pts.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(pt.roi).toFixed(1)}`).join('');
  const held = closeT === null ? line : line.filter((pt) => pt.t <= closeT);
  const after = closeT === null ? [] : line.filter((pt) => pt.t >= closeT);
  // The dashed part starts at the last held point so the two lines meet.
  const afterLine = after.length && held.length ? [held.at(-1)!, ...after] : after;
  const pathD = toD(held);
  const afterD = toD(afterLine);
  const all = [...line, ...events].sort((a, b) => a.t - b.t);

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * end;
    let best: Pt | null = null;
    for (const pt of all) if (!best || Math.abs(pt.t - t) < Math.abs(best.t - t)) best = pt;
    setHover(best);
  };

  return (
    <div ref={wrap} className="relative w-full select-none">
      <svg width={w} height={H} role="img" aria-label="Price since entry, as profit or loss percent" className="block">
        {/* recessive grid + y labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={w - M.r} y1={y(v)} y2={y(v)} stroke="var(--sep)" strokeWidth={1} />
            <text x={M.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--label-3)">{v > 0 ? '+' : ''}{v}%</text>
          </g>
        ))}
        {/* entry, stop and take-profit levels */}
        <line x1={M.l} x2={w - M.r} y1={y(0)} y2={y(0)} stroke="var(--label-2)" strokeWidth={1} />
        <text x={w - M.r} y={y(0) - 4} textAnchor="end" fontSize={10} fill="var(--label-2)">entry</text>
        {levels.map((l) => (
          <g key={l.label}>
            <line x1={M.l} x2={w - M.r} y1={y(l.y)} y2={y(l.y)} stroke={l.kind === 'stop' ? 'var(--neg-solid)' : 'var(--pos-solid)'}
              strokeWidth={1} strokeDasharray="4 4" opacity={0.8} />
            <text x={w - M.r} y={y(l.y) - 4} textAnchor="end" fontSize={10} fill="var(--label-2)">{l.label}</text>
          </g>
        ))}
        {/* x labels */}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={M.l + f * iw} y={H - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize={10} fill="var(--label-3)">
            {f === 0 ? 'open' : dur(f * end)}
          </text>
        ))}
        {/* price line */}
        {held.length >= 2 && <path d={pathD} fill="none" stroke="var(--tint)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {afterLine.length >= 2 && <path d={afterD} fill="none" stroke="var(--label-2)" strokeWidth={1.75} strokeDasharray="5 4" strokeLinejoin="round" />}
        {closeT !== null && afterLine.length >= 2 && (
          <g>
            <line x1={x(closeT)} x2={x(closeT)} y1={M.t} y2={H - M.b} stroke="var(--label-3)" strokeWidth={1} strokeDasharray="2 3" />
            <text x={x(closeT) + 4} y={M.t + 10} fontSize={10} fill="var(--label-2)">after exit</text>
          </g>
        )}
        {/* fills: marker + direct label, alternating above/below to avoid collisions */}
        {events.map((ev, i) => {
          const cx = x(ev.t);
          const cy = y(ev.roi);
          const fill = ev.side === 'buy' ? 'var(--tint)' : ev.roi >= 0 ? 'var(--pos-solid)' : 'var(--neg-solid)';
          const above = i % 2 === 0;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={5} fill={fill} stroke="var(--card)" strokeWidth={2} />
              <text x={Math.min(Math.max(cx, M.l + 14), w - M.r - 14)} y={above ? cy - 10 : cy + 18} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--label)">
                {ev.label}
              </text>
            </g>
          );
        })}
        {/* crosshair */}
        {hover && (
          <g pointerEvents="none">
            <line x1={x(hover.t)} x2={x(hover.t)} y1={M.t} y2={H - M.b} stroke="var(--label-3)" strokeWidth={1} />
            <circle cx={x(hover.t)} cy={y(hover.roi)} r={4.5} fill="var(--tint)" stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
        <rect x={M.l} y={0} width={iw} height={H} fill="transparent" style={{ touchAction: 'pan-y' }}
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover && (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-card px-2 py-1 text-[12px] tabular-nums shadow-lg ring-1 ring-sep"
          style={{ left: Math.min(Math.max(x(hover.t) - 70, 0), w - 140), width: 140 }}>
          <div className="text-label-2">+{dur(hover.t)}</div>
          <div className="font-semibold">{hover.roi >= 0 ? '+' : ''}{hover.roi.toFixed(1)}%</div>
          <div className="mono text-[11px] text-label-2">{px(hover.price)} SOL</div>
        </div>
      )}
      {d.ticks.length < 2 ? (
        <p className="px-1 pt-1 text-[12px] text-label-3">No price history for this trade (recorded since today's update); the line joins its fills.</p>
      ) : d.ticks[0]!.ts - t0 > 30_000 && (
        <p className="px-1 pt-1 text-[12px] text-label-3">Price history starts at +{dur(d.ticks[0]!.ts - t0)} (recording began after this trade opened).</p>
      )}
    </div>
  );
}
