import type { CSSProperties } from 'react';

export interface SliderSpec { label: string; min: number; max: number; step: number; unit: string; zeroOff?: boolean }

/** Label + value + range input, one settings row. */
export function SliderRow({ spec, value, onChange, error }: { spec: SliderSpec; value: number; onChange: (v: number) => void; error?: string }) {
  const p = ((value - spec.min) / (spec.max - spec.min)) * 100;
  return (
    <label className="row-sep block px-4 pb-1 pt-2.5">
      <span className="flex justify-between text-[15px]">
        {spec.label}
        <span className="text-label-2">{spec.zeroOff && value === 0 ? 'off' : <>{value}{spec.unit && ` ${spec.unit}`}</>}</span>
      </span>
      <input type="range" min={spec.min} max={spec.max} step={spec.step} value={value} aria-label={spec.label}
        aria-invalid={error ? true : undefined}
        style={{ '--p': `${Math.max(0, Math.min(100, p))}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
      {error && <span className="block pb-1 text-[12px] text-neg">{error}</span>}
    </label>
  );
}
