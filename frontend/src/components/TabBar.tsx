import type { ReactNode } from 'react';


export type Tab = 'home' | 'logs' | 'strategy';

const icons: Record<Tab, ReactNode> = {
  home: <path d="M4 12.5 12 5l8 7.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1v-7.5Z" />,
  logs: <path d="M5 6.5h14M5 12h14M5 17.5h9" />,
  strategy: <path d="M5 7h9m4 0h1M5 17h1m4 0h9M16 4.5v5M8 14.5v5" />,
};
const labels: Record<Tab, string> = { home: 'Positions', logs: 'Logs', strategy: 'Strategy' };

/** iOS-style bottom tab bar, phones and small tablets only. */
export function TabBar({ tab, setTab, openPositions }: { tab: Tab; setTab: (t: Tab) => void; openPositions: number }) {
  return (
    <nav aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-sep bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden">
      <div className="mx-auto flex max-w-md">
        {(Object.keys(labels) as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium ${tab === t ? 'text-tint' : 'text-label-2'}`}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {icons[t]}
            </svg>
            {labels[t]}
            {t === 'home' && openPositions > 0 && (
              <span className="absolute left-1/2 top-1 ml-2 min-w-[18px] rounded-full bg-neg-solid px-1 text-[11px] leading-[18px] text-white">{openPositions}</span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
