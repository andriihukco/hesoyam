import type { ReactNode } from 'react';

export function Segmented<T extends string>({ value, options, onChange, label, fill }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; fill?: boolean;
}) {
  return (
    <div className={`seg ${fill ? 'seg-fill' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, danger }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={`switch ${danger ? 'switch-danger' : ''}`} onClick={() => onChange(!checked)} />
  );
}

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col ${className}`}>
      {(title || right) && (
        <div className="flex items-end justify-between px-4 pb-1.5">
          <h2 className="text-[13px] font-normal uppercase tracking-wide text-label-2">{title}</h2>
          <div className="text-[13px] text-label-2">{right}</div>
        </div>
      )}
      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  );
}

export function Dot({ tone }: { tone: 'pos' | 'neg' | 'warn' | 'off' }) {
  const c = { pos: 'bg-pos-solid', neg: 'bg-neg-solid', warn: 'bg-warn-solid', off: 'bg-label-3' }[tone];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

export function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <div>
      {title && <div className="section-title">{title}</div>}
      <div className="card overflow-hidden">{children}</div>
      {footer && <p className="px-4 pt-1.5 text-[12px] leading-snug text-label-2">{footer}</p>}
    </div>
  );
}
